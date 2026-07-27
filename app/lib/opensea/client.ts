/**
 * Client OpenSea API v2.
 * Docs : https://docs.opensea.io/reference/api-overview
 * Auth : header `x-api-key`
 *
 * Clé :
 * - `OPENSEA_API_KEY` (recommandé en prod — portail developer)
 * - ou génération instantanée free-tier : POST /api/v2/auth/keys
 *   (60/min read, expire 30 jours — idéal agents / dev)
 */

import {
  getOpenSeaChain,
  type OpenSeaChainId,
} from "./chains";

const BASE = "https://api.opensea.io/api/v2";

/** Free-tier ~60/min → ~1 req/s ; marge 1100 ms */
const MIN_INTERVAL_MS = 1100;

let lastCallAt = 0;
let queue: Promise<void> = Promise.resolve();

/** Cache process d’une clé instantanée (ne pas logger / ne pas committer). */
let instantKeyCache: {
  apiKey: string;
  expiresAt: string | null;
  fetchedAt: number;
} | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(): Promise<void> {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  });
  queue = run.catch(() => undefined);
  await run;
}

export class OpenSeaError extends Error {
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
    this.name = "OpenSeaError";
  }
}

export type OpenSeaInstantKey = {
  api_key: string;
  name?: string;
  expires_at?: string;
  rate_limits?: {
    read?: string;
    write?: string;
    fulfillment?: string;
  };
  upgrade_url?: string;
};

export type OpenSeaNft = {
  identifier: string;
  collection: string | null;
  contract: string | null;
  tokenStandard: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  displayImageUrl: string | null;
  metadataUrl: string | null;
  openseaUrl: string | null;
  updatedAt: string | null;
  isDisabled: boolean;
  isNsfw: boolean;
};

export type OpenSeaNftPage = {
  nfts: OpenSeaNft[];
  next: string | null;
  chain: OpenSeaChainId;
  address: string;
  fetchedAt: string;
};

export type OpenSeaCollectionStats = {
  slug: string;
  total: {
    volume: number | null;
    sales: number | null;
    averagePrice: number | null;
    numOwners: number | null;
    marketCap: number | null;
    floorPrice: number | null;
    floorPriceSymbol: string | null;
  };
  intervals: Array<{
    interval: string;
    volume: number | null;
    volumeDiff: number | null;
    volumeChange: number | null;
    sales: number | null;
    salesDiff: number | null;
    averagePrice: number | null;
  }>;
  fetchedAt: string;
};

/**
 * Résout la clé OpenSea (server-side uniquement).
 * Priorité : override → OPENSEA_API_KEY → cache instantanée (si déjà créée).
 * Ne crée pas de clé ici — voir `ensureOpenSeaApiKey`.
 */
export function resolveOpenSeaApiKey(override?: string | null): string {
  const fromOverride = (override || "").trim();
  if (
    fromOverride &&
    !fromOverride.includes("…") &&
    fromOverride.length >= 8
  ) {
    return fromOverride;
  }
  const fromEnv = (process.env.OPENSEA_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  if (instantKeyCache?.apiKey) return instantKeyCache.apiKey;
  return "";
}

/**
 * true si on peut auto-créer une clé free-tier.
 * Défaut : activé sauf si OPENSEA_AUTO_KEY=false.
 */
export function isOpenSeaAutoKeyEnabled(): boolean {
  const v = (process.env.OPENSEA_AUTO_KEY || "true").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

/**
 * POST https://api.opensea.io/api/v2/auth/keys
 * Clé free-tier agents (expire ~30 j, 60/min read).
 * Max 3 créations / heure / IP — cache process pour éviter le spam.
 */
export async function createInstantOpenSeaApiKey(): Promise<OpenSeaInstantKey> {
  await throttle();

  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/keys`, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new OpenSeaError(
      e instanceof Error ? e.message : "Réseau OpenSea indisponible",
      "HTTP"
    );
  }

  if (res.status === 429) {
    throw new OpenSeaError(
      "Rate limit création de clé OpenSea (max 3/heure/IP) — définissez OPENSEA_API_KEY",
      "RATE_LIMIT",
      429
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenSeaError(
      `OpenSea auth/keys HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      "HTTP",
      res.status
    );
  }

  const data = (await res.json()) as OpenSeaInstantKey;
  if (!data?.api_key || typeof data.api_key !== "string") {
    throw new OpenSeaError("Réponse auth/keys sans api_key", "PARSE");
  }

  instantKeyCache = {
    apiKey: data.api_key,
    expiresAt: data.expires_at || null,
    fetchedAt: Date.now(),
  };

  console.info(
    "[opensea] clé free-tier instantanée obtenue",
    {
      name: data.name || null,
      expires_at: data.expires_at || null,
      rate_limits: data.rate_limits || null,
    }
  );

  return data;
}

/**
 * Garantit une clé utilisable : env / override, sinon auto-key si autorisé.
 */
export async function ensureOpenSeaApiKey(
  override?: string | null
): Promise<string> {
  const existing = resolveOpenSeaApiKey(override);
  if (existing) return existing;

  if (!isOpenSeaAutoKeyEnabled()) {
    throw new OpenSeaError(
      "Clé API OpenSea manquante — configurez OPENSEA_API_KEY ou OPENSEA_AUTO_KEY=true",
      "CONFIG"
    );
  }

  const created = await createInstantOpenSeaApiKey();
  return created.api_key;
}

/** Infos non secrètes sur la config clé (health / debug). */
export function getOpenSeaKeyStatus(): {
  envConfigured: boolean;
  instantCached: boolean;
  autoKeyEnabled: boolean;
  instantExpiresAt: string | null;
} {
  return {
    envConfigured: Boolean((process.env.OPENSEA_API_KEY || "").trim()),
    instantCached: Boolean(instantKeyCache?.apiKey),
    autoKeyEnabled: isOpenSeaAutoKeyEnabled(),
    instantExpiresAt: instantKeyCache?.expiresAt ?? null,
  };
}

async function openseaFetch<T>(
  path: string,
  apiKey: string,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  await throttle();

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
        "x-api-key": apiKey,
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw new OpenSeaError(
      e instanceof Error ? e.message : "Réseau OpenSea indisponible",
      "HTTP"
    );
  }

  if (res.status === 401 || res.status === 403) {
    // Invalide le cache instantanée si la clé a expiré
    if (instantKeyCache?.apiKey === apiKey) {
      instantKeyCache = null;
    }
    throw new OpenSeaError(
      "Clé API OpenSea invalide, expirée ou non autorisée",
      "AUTH",
      res.status
    );
  }
  if (res.status === 429) {
    const retry = res.headers.get("Retry-After");
    throw new OpenSeaError(
      `Rate limit OpenSea${retry ? ` — Retry-After ${retry}s` : " (60/min free)"}`,
      "RATE_LIMIT",
      429
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenSeaError(
      `OpenSea HTTP ${res.status}${body ? ` — ${body.slice(0, 220)}` : ""}`,
      "HTTP",
      res.status
    );
  }

  return (await res.json()) as T;
}

type RawNft = {
  identifier?: string;
  collection?: string;
  contract?: string;
  token_standard?: string;
  name?: string | null;
  description?: string | null;
  image_url?: string | null;
  display_image_url?: string | null;
  metadata_url?: string | null;
  opensea_url?: string | null;
  updated_at?: string | null;
  is_disabled?: boolean;
  is_nsfw?: boolean;
};

type NftsResponse = {
  nfts?: RawNft[];
  next?: string | null;
};

function mapNft(raw: RawNft): OpenSeaNft {
  return {
    identifier: String(raw.identifier ?? ""),
    collection: raw.collection ?? null,
    contract: raw.contract ?? null,
    tokenStandard: raw.token_standard ?? null,
    name: raw.name ?? null,
    description: raw.description ?? null,
    imageUrl: raw.image_url ?? null,
    displayImageUrl: raw.display_image_url ?? null,
    metadataUrl: raw.metadata_url ?? null,
    openseaUrl: raw.opensea_url ?? null,
    updatedAt: raw.updated_at ?? null,
    isDisabled: Boolean(raw.is_disabled),
    isNsfw: Boolean(raw.is_nsfw),
  };
}

/**
 * GET /api/v2/chain/{chain}/account/{address}/nfts
 */
export async function fetchNftsByAccount(
  address: string,
  opts?: {
    chain?: string | null;
    collection?: string | null;
    limit?: number;
    next?: string | null;
    apiKey?: string | null;
  }
): Promise<OpenSeaNftPage> {
  const chain = getOpenSeaChain(opts?.chain).openseaChain;
  const addr = address.trim();
  if (!addr) {
    throw new OpenSeaError("Adresse wallet manquante", "CONFIG");
  }

  const apiKey = await ensureOpenSeaApiKey(opts?.apiKey);
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));

  const path = `/chain/${encodeURIComponent(chain)}/account/${encodeURIComponent(addr)}/nfts`;
  const body = await openseaFetch<NftsResponse>(path, apiKey, {
    limit,
    collection: opts?.collection || undefined,
    next: opts?.next || undefined,
  });

  const nfts = (body.nfts || []).map(mapNft).filter((n) => n.identifier);

  return {
    nfts,
    next: body.next ?? null,
    chain,
    address: addr,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Paginate jusqu’à maxPages (défaut 5 × limit).
 */
export async function fetchAllNftsByAccount(
  address: string,
  opts?: {
    chain?: string | null;
    collection?: string | null;
    limit?: number;
    maxPages?: number;
    apiKey?: string | null;
  }
): Promise<OpenSeaNftPage & { truncated: boolean; pageCount: number }> {
  const maxPages = Math.min(20, Math.max(1, opts?.maxPages ?? 5));
  const all: OpenSeaNft[] = [];
  let next: string | null | undefined = undefined;
  let page = 0;
  let truncated = false;
  let chain: OpenSeaChainId = getOpenSeaChain(opts?.chain).openseaChain;
  const addr = address.trim();

  while (page < maxPages) {
    page += 1;
    const result = await fetchNftsByAccount(addr, {
      ...opts,
      next: next || undefined,
    });
    chain = result.chain;
    all.push(...result.nfts);
    if (!result.next) {
      next = null;
      break;
    }
    next = result.next;
    if (page >= maxPages) {
      truncated = true;
      break;
    }
  }

  return {
    nfts: all,
    next: truncated ? next || null : null,
    chain,
    address: addr,
    fetchedAt: new Date().toISOString(),
    truncated,
    pageCount: page,
  };
}

type CollectionStatsResponse = {
  total?: {
    volume?: number | null;
    sales?: number | null;
    average_price?: number | null;
    num_owners?: number | null;
    market_cap?: number | null;
    floor_price?: number | null;
    floor_price_symbol?: string | null;
  };
  intervals?: Array<{
    interval?: string;
    volume?: number | null;
    volume_diff?: number | null;
    volume_change?: number | null;
    sales?: number | null;
    sales_diff?: number | null;
    average_price?: number | null;
  }>;
};

/**
 * GET /api/v2/collections/{slug}/stats
 */
export async function fetchCollectionStats(
  collectionSlug: string,
  opts?: { apiKey?: string | null }
): Promise<OpenSeaCollectionStats> {
  const slug = collectionSlug.trim();
  if (!slug) {
    throw new OpenSeaError("Slug collection manquant", "CONFIG");
  }

  const apiKey = await ensureOpenSeaApiKey(opts?.apiKey);
  const body = await openseaFetch<CollectionStatsResponse>(
    `/collections/${encodeURIComponent(slug)}/stats`,
    apiKey
  );

  const t = body.total || {};
  return {
    slug,
    total: {
      volume: typeof t.volume === "number" ? t.volume : null,
      sales: typeof t.sales === "number" ? t.sales : null,
      averagePrice:
        typeof t.average_price === "number" ? t.average_price : null,
      numOwners: typeof t.num_owners === "number" ? t.num_owners : null,
      marketCap: typeof t.market_cap === "number" ? t.market_cap : null,
      floorPrice: typeof t.floor_price === "number" ? t.floor_price : null,
      floorPriceSymbol: t.floor_price_symbol ?? null,
    },
    intervals: (body.intervals || []).map((i) => ({
      interval: i.interval || "",
      volume: typeof i.volume === "number" ? i.volume : null,
      volumeDiff: typeof i.volume_diff === "number" ? i.volume_diff : null,
      volumeChange:
        typeof i.volume_change === "number" ? i.volume_change : null,
      sales: typeof i.sales === "number" ? i.sales : null,
      salesDiff: typeof i.sales_diff === "number" ? i.sales_diff : null,
      averagePrice:
        typeof i.average_price === "number" ? i.average_price : null,
    })),
    fetchedAt: new Date().toISOString(),
  };
}
