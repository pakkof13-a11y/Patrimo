/**
 * Client CoinGecko — plan Demo (confirmé pour Patrimo).
 *
 * - Base : https://api.coingecko.com/api/v3
 * - Auth : header x-cg-demo-api-key (clé COINGECKO_API_KEY, préfixe CG-)
 * - Ne pas mélanger header + query param
 * - Docs : https://docs.coingecko.com/
 *
 * Si migration Pro : changer BASE_URL → pro-api.coingecko.com
 * et AUTH_HEADER → x-cg-pro-api-key (pas de bascule auto).
 */

import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";

/** Plan Demo — hardcodé (pas de branchement Demo/Pro). */
export const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const AUTH_HEADER = "x-cg-demo-api-key";

/**
 * ticker / symbol court → coin id CoinGecko (`/simple/price?ids=`).
 * Les tickers Revolut (ALGO, FLR, MON…) ne correspondent pas aux ids API.
 */
const ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  USDT: "tether",
  USDC: "usd-coin",
  // Revolut / exports fréquents
  ALGO: "algorand",
  FLR: "flare-networks",
  MON: "monad",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  TON: "the-open-network",
  TRX: "tron",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  XLM: "stellar",
  UNI: "uniswap",
  AAVE: "aave",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  // Liquid staking / dérivés fréquents (Solana, ETH…)
  MSOL: "msol",
  STSOL: "lido-staked-sol",
  JITOSOL: "jito-staked-sol",
  JSOL: "jpool",
  JUPSOL: "jupiter-staked-sol",
  BSOL: "blazestake-staked-sol",
  STETH: "staked-ether",
  WSTETH: "wrapped-steth",
  RETH: "rocket-pool-eth",
  CBETH: "coinbase-wrapped-staked-eth",
  WETH: "weth",
  WSOL: "wrapped-solana",
  JUP: "jupiter-exchange-solana",
  RAY: "raydium",
  ORCA: "orca",
  PYTH: "pyth-network",
  JTO: "jito-governance-token",
  W: "wormhole",
  BONK: "bonk",
  WIF: "dogwifcoin",
  RENDER: "render-token",
  FET: "fetch-ai",
  INJ: "injective-protocol",
  SEI: "sei-network",
  TIA: "celestia",
  DOOD: "doodles",
  // Noms affichés → id
  "JUPITER STAKED SOL": "jupiter-staked-sol",
  "LIDO STAKED SOL": "lido-staked-sol",
  "JITO STAKED SOL": "jito-staked-sol",
};

/** Résout ticker / symbole → coin id CoinGecko. */
export function resolveCoingeckoId(
  ticker?: string | null,
  providerSymbol?: string | null,
  name?: string | null
): string | null {
  const t = (ticker || "").trim().toUpperCase();
  const p = (providerSymbol || "").trim();
  const n = (name || "").trim().toUpperCase();
  if (t && ID_MAP[t]) return ID_MAP[t];
  if (n && ID_MAP[n]) return ID_MAP[n];
  if (p && ID_MAP[p.toUpperCase()]) return ID_MAP[p.toUpperCase()];
  // "Jupiter Staked SOL" / "Lido Staked SOL"
  if (n.includes("STAKED SOL") || n.includes("STAKED-SOL")) {
    if (n.includes("JUPITER") || n.includes("JUP")) return "jupiter-staked-sol";
    if (n.includes("LIDO")) return "lido-staked-sol";
    if (n.includes("JITO")) return "jito-staked-sol";
    if (n.includes("BLAZE")) return "blazestake-staked-sol";
    return "solana"; // fallback prix SOL
  }
  if (n.includes("STAKED ETH") || n.includes("STETH")) return "staked-ether";
  // providerSymbol déjà un id CG (ex. "monad", "flare-networks")
  if (p && !/^[A-Z0-9]{2,12}$/.test(p.toUpperCase())) {
    return p.toLowerCase();
  }
  if (p && p.includes("-")) return p.toLowerCase();
  // mSOL / jupSOL variants
  if (t.replace(/[^A-Z0-9]/g, "") && ID_MAP[t.replace(/[^A-Z0-9]/g, "")]) {
    return ID_MAP[t.replace(/[^A-Z0-9]/g, "")];
  }
  if (t) return t.toLowerCase();
  if (p) return p.toLowerCase();
  return null;
}

export function getCoingeckoApiKey(): string | null {
  const key = (process.env.COINGECKO_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return key.length > 0 ? key : null;
}

export function isCoingeckoConfigured(): boolean {
  return getCoingeckoApiKey() != null;
}

export type CoingeckoFetchOptions = {
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** ms — défaut 8s */
  timeoutMs?: number;
};

export class CoingeckoHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string | number
  ) {
    super(message);
    this.name = "CoingeckoHttpError";
  }
}

function buildUrl(
  path: string,
  query?: CoingeckoFetchOptions["query"]
): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${COINGECKO_BASE_URL}${p}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * GET CoinGecko Demo — auth header uniquement si clé présente.
 * Sans clé : l’API publique peut répondre (rate limit bas) ; préférer COINGECKO_API_KEY.
 */
export async function coingeckoGet<T = unknown>(
  opts: CoingeckoFetchOptions
): Promise<T> {
  const url = buildUrl(opts.path, opts.query);
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = getCoingeckoApiKey();
  if (apiKey) {
    headers[AUTH_HEADER] = apiKey;
  }

  const timeoutMs = opts.timeoutMs ?? 8_000;
  const signal =
    opts.signal ??
    (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined);

  const res = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    let code: string | number | undefined;
    let detail = `CoinGecko HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: string;
        status?: { error_code?: number; error_message?: string };
      };
      if (body.status?.error_message) detail = body.status.error_message;
      else if (body.error) detail = body.error;
      code = body.status?.error_code;
    } catch {
      /* ignore parse */
    }
    if (res.status === 401) {
      throw new CoingeckoHttpError(
        "Clé CoinGecko invalide ou manquante (Demo : x-cg-demo-api-key)",
        401,
        code
      );
    }
    if (res.status === 429) {
      throw new CoingeckoHttpError(
        "Quota CoinGecko dépassé (Demo ~30 appels/min)",
        429,
        code
      );
    }
    throw new CoingeckoHttpError(detail, res.status, code);
  }

  return (await res.json()) as T;
}

/** Prix simple multi-ids (vs_currencies séparés par virgule, ex. "eur" ou "usd,eur"). */
export async function fetchCoingeckoSimplePrices(
  coinIds: string[],
  vsCurrencies: string[] = ["eur"],
  opts?: { signal?: AbortSignal; includeLastUpdatedAt?: boolean }
): Promise<
  Record<
    string,
    Record<string, number | undefined> & { last_updated_at?: number }
  >
> {
  const ids = [...new Set(coinIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return {};

  type PriceRow = Record<string, number | undefined> & {
    last_updated_at?: number;
  };

  return coingeckoGet<Record<string, PriceRow>>({
    path: "/simple/price",
    query: {
      ids: ids.join(","),
      vs_currencies: vsCurrencies.join(","),
      include_last_updated_at: opts?.includeLastUpdatedAt ? true : undefined,
    },
    signal: opts?.signal,
  });
}

export type CoingeckoSearchCoin = {
  id: string;
  name: string;
  symbol: string;
  large?: string;
  thumb?: string;
  market_cap_rank?: number | null;
};

/** Résolution d’ids via GET /search (préféré avant d’appeler d’autres endpoints). */
export async function searchCoingeckoCoins(
  query: string,
  limit = 12,
  opts?: { signal?: AbortSignal }
): Promise<CoingeckoSearchCoin[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const data = await coingeckoGet<{ coins?: CoingeckoSearchCoin[] }>({
      path: "/search",
      query: { query: q },
      signal: opts?.signal,
      timeoutMs: 6_000,
    });
    return (data.coins || []).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Prix USD de tokens SPL par adresse de mint (platform id CoinGecko = solana).
 * GET /simple/token_price/solana?contract_addresses=…
 * Lots de max 100 adresses.
 */
export async function fetchSolanaMintPricesUsd(
  mints: string[],
  opts?: { signal?: AbortSignal }
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [
    ...new Set(
      mints.map((m) => m.trim()).filter((m) => m.length >= 32 && m.length <= 44)
    ),
  ];
  if (unique.length === 0) return map;

  // Demo: batch raisonnable
  const chunkSize = 30;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const data = await coingeckoGet<
        Record<string, { usd?: number } | undefined>
      >({
        path: "/simple/token_price/solana",
        query: {
          contract_addresses: chunk.join(","),
          vs_currencies: "usd",
        },
        signal: opts?.signal,
        timeoutMs: 10_000,
      });
      for (const [addr, row] of Object.entries(data || {})) {
        const usd = row?.usd;
        if (typeof usd === "number" && Number.isFinite(usd) && usd >= 0) {
          // CoinGecko renvoie souvent les clés en minuscules
          map.set(addr, usd);
          map.set(addr.toLowerCase(), usd);
          // retrouver la casse d’origine
          const orig = chunk.find(
            (c) => c.toLowerCase() === addr.toLowerCase()
          );
          if (orig) map.set(orig, usd);
        }
      }
    } catch (e) {
      console.warn(
        "[coingecko] token_price solana batch failed",
        e instanceof Error ? e.message : e
      );
    }
  }
  return map;
}

function pricePrecision(price: number): number {
  if (price > 0 && price < 0.01) return 12;
  if (price < 1) return 10;
  return 8;
}

export const coingeckoProvider: MarketDataProvider = {
  id: "coingecko",
  supports(asset) {
    return (
      asset.priceProvider === "COINGECKO" ||
      (asset.assetClass === "CRYPTO" && !!(asset.providerSymbol || asset.ticker))
    );
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    const ticker = (asset.ticker || "").trim().toUpperCase();
    const providerRaw = (asset.providerSymbol || "").trim();
    const coinId = resolveCoingeckoId(ticker, providerRaw, asset.name);
    if (!coinId) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "coingecko",
        status: "ERROR",
        error: "Symbole crypto manquant",
      };
    }

    try {
      const data = await fetchCoingeckoSimplePrices([coinId], ["eur"], {
        includeLastUpdatedAt: true,
      });
      const row = data[coinId];
      const price = row?.eur;
      if (typeof price !== "number" || !Number.isFinite(price)) {
        return {
          priceEur: "0",
          currency: "EUR",
          source: "coingecko",
          status: "ERROR",
          error: `Prix introuvable pour ${coinId}`,
        };
      }

      const prec = pricePrecision(price);
      return {
        priceEur: toFixed(d(price), prec),
        priceNative: toFixed(d(price), prec),
        nativeCurrency: "EUR",
        currency: "EUR",
        source: "coingecko",
        status: "OK",
      };
    } catch (e) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "coingecko",
        status: "ERROR",
        error: e instanceof Error ? e.message : "Erreur CoinGecko",
      };
    }
  },
};
