/**
 * Client Zerion Wallet API.
 * Docs : https://developers.zerion.io/api-reference/wallets
 * Auth : Basic base64(apiKey + ":")
 * Rate limit free : 1 req/s → throttle 1100 ms entre appels.
 */

import { DEFAULT_ZERION_API_KEY } from "./chains";
import { formatParisDateTime, toOccurredAtIso } from "./datetime";

const BASE = "https://api.zerion.io/v1";

/** Délai min entre deux appels (plan gratuit ≈ 1 req/s) */
const MIN_INTERVAL_MS = 1100;

let lastCallAt = 0;
let queue: Promise<void> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sérialise + throttle toutes les requêtes Zerion du process. */
async function throttle(): Promise<void> {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  });
  queue = run.catch(() => undefined);
  await run;
}

export function resolveZerionApiKey(override?: string | null): string {
  const fromEnv = (process.env.ZERION_API_KEY || "").trim();
  const fromOverride = (override || "").trim();
  return fromOverride || fromEnv || DEFAULT_ZERION_API_KEY;
}

function basicAuthHeader(apiKey: string): string {
  const token = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export class ZerionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "HTTP"
      | "AUTH"
      | "RATE_LIMIT"
      | "PARSE"
      | "CONFIG" = "HTTP",
    public readonly status?: number
  ) {
    super(message);
    this.name = "ZerionError";
  }
}

export type ZerionBalanceItem = {
  ticker: string;
  name: string;
  amount: number;
  decimals: number | null;
  logo: string | null;
  usdValue: number | null;
  priceUsd: number | null;
  chainId: string | null;
  contractAddress: string | null;
  positionType: string | null;
};

export type ZerionTransferLeg = {
  direction: "in" | "out" | "unknown";
  ticker: string;
  name: string;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  logo: string | null;
  contractAddress: string | null;
};

export type ZerionTxItem = {
  hash: string | null;
  /** DD-MM-YYYY HH:mm:ss Europe/Paris */
  date: string | null;
  timestampUnix: number | null;
  occurredAtIso: string | null;
  type: string;
  status: "success" | "failed";
  chainId: string | null;
  application: string | null;
  /** Legs token (transfers Zerion) pour écriture journal */
  transfers: ZerionTransferLeg[];
  isTrash: boolean;
};

export type ZerionPortfolio = {
  address: string;
  source: "zerion";
  balances: ZerionBalanceItem[];
  transactions: ZerionTxItem[];
  fetchedAt: string;
  /**
   * true si la pagination a atteint maxPages alors qu’il reste une page next
   * (historique potentiellement tronqué — plafonds API free).
   */
  historyTruncated?: boolean;
  historyPageCount?: number;
};

/** Message UI si historique Zerion plafonné (8×100). */
export const ZERION_HISTORY_TRUNCATED_MESSAGE =
  "Historique limité aux 800 dernières transactions. Pour un historique complet, importez un CSV depuis votre exchange.";

async function zerionGet<T>(
  path: string,
  apiKey: string,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  await throttle();

  // path peut déjà contenir ?cursor=… (pagination links.next)
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = normalized.includes("://")
    ? new URL(normalized)
    : new URL(`${BASE}${normalized}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: basicAuthHeader(apiKey),
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw new ZerionError(
      e instanceof Error ? e.message : "Réseau Zerion indisponible",
      "HTTP"
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new ZerionError(
      "Clé API Zerion invalide ou non autorisée",
      "AUTH",
      res.status
    );
  }
  if (res.status === 429) {
    throw new ZerionError(
      "Rate limit Zerion (1 req/s · 300/jour sur free) — réessayez plus tard",
      "RATE_LIMIT",
      429
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ZerionError(
      `Zerion HTTP ${res.status}${body ? ` — ${body.slice(0, 220)}` : ""}`,
      "HTTP",
      res.status
    );
  }
  return (await res.json()) as T;
}

type PositionsResponse = {
  data?: Array<{
    type?: string;
    id?: string;
    attributes?: {
      name?: string;
      position_type?: string;
      quantity?: {
        float?: number;
        numeric?: string;
        decimals?: number;
      };
      value?: number | null;
      price?: number | null;
      fungible_info?: {
        name?: string;
        symbol?: string;
        icon?: { url?: string | null } | null;
        implementations?: Array<{
          chain_id?: string;
          address?: string | null;
          decimals?: number;
        }>;
      };
      flags?: { displayable?: boolean; is_trash?: boolean };
    };
    relationships?: {
      chain?: { data?: { id?: string } };
    };
  }>;
};

type TransactionsResponse = {
  links?: { next?: string | null };
  data?: Array<{
    type?: string;
    id?: string;
    attributes?: {
      hash?: string;
      /** ISO date-time on-chain */
      mined_at?: string | null;
      mined_at_block?: number;
      /** Certains payloads Zerion */
      sent_at?: string | null;
      timestamp?: number | string | null;
      status?: string;
      operation_type?: string;
      application_metadata?: { name?: string | null } | null;
      flags?: { is_trash?: boolean };
      transfers?: Array<{
        direction?: string;
        quantity?: { float?: number; numeric?: string };
        value?: number | null;
        price?: number | null;
        fungible_info?: {
          name?: string;
          symbol?: string;
          icon?: { url?: string | null } | null;
          implementations?: Array<{
            chain_id?: string;
            address?: string | null;
          }>;
        };
      }>;
    };
    relationships?: {
      chain?: { data?: { id?: string } };
    };
  }>;
};

/**
 * GET /v1/wallets/{address}/positions/
 * Par défaut : **toutes les chaînes EVM** (un wallet multi-L2).
 * Passer `chainId` seulement pour filtrer une chaîne.
 */
export async function fetchZerionPositions(
  address: string,
  apiKey?: string | null,
  opts?: { chainId?: string | null; currency?: string }
): Promise<ZerionBalanceItem[]> {
  const key = resolveZerionApiKey(apiKey);
  const query: Record<string, string> = {
    currency: opts?.currency || "usd",
    "filter[positions]": "only_simple",
    "filter[trash]": "only_non_trash",
    sort: "value",
  };
  // Important : ne PAS filtrer par défaut — sinon ETH-only → quasi vide
  // alors que le wallet a des soldes sur Base/Polygon/Arbitrum…
  if (opts?.chainId) {
    query["filter[chain_ids]"] = opts.chainId;
  }

  const body = await zerionGet<PositionsResponse>(
    `/wallets/${encodeURIComponent(address)}/positions/`,
    key,
    query
  );

  const out: ZerionBalanceItem[] = [];
  for (const row of body.data || []) {
    const a = row.attributes;
    if (!a) continue;
    if (a.flags?.is_trash) continue;
    if (a.flags?.displayable === false) continue;

    const amount =
      typeof a.quantity?.float === "number"
        ? a.quantity.float
        : Number(a.quantity?.numeric ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    // Dust ultra-faible (spam) — garder si valeur USD significative
    const usd =
      typeof a.value === "number" && Number.isFinite(a.value) ? a.value : null;
    if (amount < 1e-12 && (usd == null || usd < 0.01)) continue;

    const fi = a.fungible_info;
    const ticker = (fi?.symbol || "???").trim().toUpperCase().slice(0, 24);
    const name = (fi?.name || a.name || ticker).slice(0, 120);
    const chainId =
      row.relationships?.chain?.data?.id ||
      fi?.implementations?.[0]?.chain_id ||
      null;
    const impl =
      fi?.implementations?.find((i) => i.chain_id === chainId) ||
      fi?.implementations?.[0];

    out.push({
      ticker,
      name,
      amount,
      decimals:
        typeof a.quantity?.decimals === "number"
          ? a.quantity.decimals
          : impl?.decimals ?? null,
      logo: fi?.icon?.url || null,
      usdValue: usd,
      priceUsd:
        typeof a.price === "number" && Number.isFinite(a.price)
          ? a.price
          : null,
      chainId,
      contractAddress: impl?.address || null,
      positionType: a.position_type || null,
    });
  }

  out.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
  return out;
}

/**
 * Extrait un timestamp on-chain fiable depuis les attributs Zerion.
 * Priorité : mined_at → sent_at → timestamp (unix s/ms).
 */
export function extractZerionTxTimestamp(a?: {
  mined_at?: string | null;
  sent_at?: string | null;
  timestamp?: number | string | null;
} | null): { unix: number | null; iso: string | null } {
  if (!a) return { unix: null, iso: null };
  const candidates: Array<string | number | null | undefined> = [
    a.mined_at,
    a.sent_at,
    a.timestamp,
  ];
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    const iso = toOccurredAtIso(raw);
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    // Rejeter timestamps absurdes (avant 2015 ou > 24h dans le futur)
    const t = d.getTime();
    if (t < Date.UTC(2015, 0, 1) || t > Date.now() + 86400000) continue;
    return { unix: Math.floor(t / 1000), iso };
  }
  return { unix: null, iso: null };
}

function mapZerionTxRow(
  row: NonNullable<TransactionsResponse["data"]>[number]
): ZerionTxItem {
  const a = row.attributes;
  const { unix, iso } = extractZerionTxTimestamp(a);
  const statusRaw = (a?.status || "").toLowerCase();
  const chainId =
    (row as { relationships?: { chain?: { data?: { id?: string } } } })
      .relationships?.chain?.data?.id || null;
  const transfers: ZerionTransferLeg[] = [];
  for (const tr of a?.transfers || []) {
    const amount =
      typeof tr.quantity?.float === "number"
        ? tr.quantity.float
        : Number(tr.quantity?.numeric ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const dirRaw = (tr.direction || "").toLowerCase();
    const direction: ZerionTransferLeg["direction"] =
      dirRaw === "in" || dirRaw === "out" ? dirRaw : "unknown";
    const fi = tr.fungible_info;
    const ticker = (fi?.symbol || "???").trim().toUpperCase().slice(0, 24);
    const impl =
      fi?.implementations?.find((i) => i.chain_id === chainId) ||
      fi?.implementations?.[0];
    transfers.push({
      direction,
      ticker,
      name: (fi?.name || ticker).slice(0, 120),
      amount,
      priceUsd:
        typeof tr.price === "number" && Number.isFinite(tr.price)
          ? tr.price
          : null,
      valueUsd:
        typeof tr.value === "number" && Number.isFinite(tr.value)
          ? tr.value
          : null,
      logo: fi?.icon?.url || null,
      contractAddress: impl?.address || null,
    });
  }

  return {
    hash: a?.hash || row.id || null,
    date: formatParisDateTime(iso || unix),
    timestampUnix: unix,
    // Ne jamais inventer « now » ici — null si date inconnue
    occurredAtIso: iso,
    type: (a?.operation_type || "transfer").toUpperCase(),
    status:
      statusRaw === "failed" || statusRaw === "reverted" ? "failed" : "success",
    chainId,
    application: a?.application_metadata?.name || null,
    transfers,
    isTrash: Boolean(a?.flags?.is_trash),
  };
}

/**
 * GET /v1/wallets/{address}/transactions/ (pagination multi-pages).
 * Récupère l’historique on-chain pour dater correctement le journal.
 */
export type ZerionTxFetchResult = {
  transactions: ZerionTxItem[];
  /** true si maxPages atteint avec encore un links.next */
  truncated: boolean;
  pageCount: number;
  maxPages: number;
};

export async function fetchZerionTransactions(
  address: string,
  apiKey?: string | null,
  opts?: {
    chainId?: string | null;
    pageSize?: number;
    /** Max pages (défaut 8 × 100 = 800 txs) */
    maxPages?: number;
    currency?: string;
    /** Inclure trash (défaut false) */
    includeTrash?: boolean;
  }
): Promise<ZerionTxFetchResult> {
  const key = resolveZerionApiKey(apiKey);
  const pageSize = Math.min(100, Math.max(10, opts?.pageSize ?? 100));
  const maxPages = Math.min(20, Math.max(1, opts?.maxPages ?? 8));
  const all: ZerionTxItem[] = [];
  const seenHash = new Set<string>();

  let path: string | null =
    `/wallets/${encodeURIComponent(address)}/transactions/`;
  let page = 0;
  let truncated = false;
  let query: Record<string, string | number> | undefined = {
    currency: opts?.currency || "usd",
    "page[size]": pageSize,
    "filter[trash]": opts?.includeTrash ? "no_filter" : "only_non_trash",
    ...(opts?.chainId ? { "filter[chain_ids]": opts.chainId } : {}),
  };

  while (path && page < maxPages) {
    page += 1;
    const reqPath = path.includes("?")
      ? path
      : path.startsWith("http")
        ? path.replace(/^https?:\/\/[^/]+\/v1/, "")
        : path;
    const body: TransactionsResponse = await zerionGet<TransactionsResponse>(
      reqPath,
      key,
      query
    );

    for (const row of body.data || []) {
      const item = mapZerionTxRow(row);
      const h = item.hash || "";
      if (h && seenHash.has(h)) continue;
      if (h) seenHash.add(h);
      all.push(item);
    }

    const nextLink: string | null = body.links?.next ?? null;
    if (!nextLink) {
      path = null;
      break;
    }
    // links.next est une URL absolue → extraire path+query pour la page suivante
    try {
      const u = new URL(nextLink);
      path = `${u.pathname.replace(/^\/v1/, "")}${u.search}`;
      query = undefined; // curseur déjà dans l’URL
    } catch {
      path = null;
      break;
    }
    // Encore une page après maxPages → historique tronqué
    if (page >= maxPages && path) {
      truncated = true;
      path = null;
    }
  }

  if (truncated) {
    console.warn(
      "[zerion] history truncated (plafond pagination)",
      {
        address: address.slice(0, 10) + "…",
        txCount: all.length,
        pageCount: page,
        maxPages,
        pageSize,
      }
    );
  }

  return {
    transactions: all,
    truncated,
    pageCount: page,
    maxPages,
  };
}

/**
 * Positions puis transactions (throttle 1.1s entre les 2).
 * - Par défaut : filtre `chainId` si fourni (une plateforme = une chaîne).
 * - `allChains: true` : ignore le filtre (fusion multi-L2 volontaire).
 */
export async function fetchZerionPortfolio(
  address: string,
  apiKey?: string | null,
  opts?: { chainId?: string | null; allChains?: boolean }
): Promise<ZerionPortfolio> {
  const useChain =
    opts?.allChains === true ? null : opts?.chainId || null;

  const balances = await fetchZerionPositions(address, apiKey, {
    chainId: useChain,
  });
  let transactions: ZerionTxItem[] = [];
  let historyTruncated = false;
  let historyPageCount = 0;
  try {
    // Historique profond (pagination) — critique pour dater les positions
    const txResult = await fetchZerionTransactions(address, apiKey, {
      chainId: useChain,
      pageSize: 100,
      maxPages: 8,
    });
    transactions = txResult.transactions;
    historyTruncated = txResult.truncated;
    historyPageCount = txResult.pageCount;
  } catch (e) {
    console.warn(
      "[zerion] transactions",
      e instanceof Error ? e.message : e
    );
  }

  return {
    address,
    source: "zerion",
    balances,
    transactions,
    fetchedAt: formatParisDateTime(new Date()) || "",
    historyTruncated,
    historyPageCount,
  };
}
