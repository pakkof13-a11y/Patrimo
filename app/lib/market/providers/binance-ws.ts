/**
 * Provider prix CRYPTO — Binance (temps réel).
 *
 * Architecture (Option A — compatible Vercel serverless) :
 * Vercel ne garde pas de WebSocket persistant dans un Route Handler. On utilise
 * donc l'API REST publique Binance (aucune clé requise) :
 *   GET https://api.binance.com/api/v3/ticker/price?symbols=["BTCEUR",...]
 * avec un cache mémoire TTL 30 s côté serveur. Le refresh périodique existant
 * (server-side, app/lib/market/refresh.ts) et le Route Handler
 * /api/market/crypto-prices partagent ce cache.
 *
 * Le nom du fichier conserve le suffixe `-ws` pour la nomenclature de la tâche ;
 * l'implémentation est REST+cache (pas de socket serveur).
 *
 * Paires : Binance cote en <BASE>EUR (majors) ou <BASE>USDT (alts). Pour les
 * paires USDT on convertit USD→EUR via app/lib/market/fx.ts (USDT ≈ USD).
 * Les tokens non listés sur Binance (liquid staking Solana, wrapped, Monad…)
 * ne sont pas « supportés » → le registry bascule sur CoinGecko.
 */

import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";
import { getEurRates, convertToEurSync } from "../fx";
import { pricePrecision } from "../price-utils";

export const BINANCE_BASE_URL = "https://api.binance.com/api/v3";

// NOTE : cache local lambda — non partagé entre instances Vercel. Deux lambdas
// peuvent servir des prix Binance décalés de ±TTL. Acceptable pour un TTL
// court (30 s) ; voir effectiveBinanceCacheTtlMs() pour le garde-fou.
/** Cache serveur TTL — l'aspect « temps réel » côté client vient du polling 30 s. */
export const BINANCE_CACHE_TTL_MS = 30_000;

/**
 * TTL effectif appliqué au cache — clampe à 30 s sur Vercel si la constante
 * est un jour relevée au-delà de 60 s (un cache long-lived cross-lambda non
 * partagé fausserait le PnL entre deux lambdas divergentes).
 */
export function effectiveBinanceCacheTtlMs(): number {
  const onVercel = process.env.VERCEL === "1";
  if (onVercel && BINANCE_CACHE_TTL_MS > 60_000) return 30_000;
  return BINANCE_CACHE_TTL_MS;
}

/**
 * Renommages / alias de tickers vers la base Binance réelle.
 * MATIC a migré vers POL sur Binance (marché POLUSDT).
 */
const TICKER_ALIAS: Record<string, string> = {
  MATIC: "POL",
};

/**
 * Bases crypto listées sur Binance avec une paire EUR fiable → `<BASE>EUR`
 * (prix déjà en EUR, aucune conversion FX).
 */
const BINANCE_EUR_PAIRS = new Set<string>([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "DOT", "LINK", "LTC",
  "AVAX", "TRX", "ATOM", "UNI", "NEAR", "XLM", "BCH", "SHIB", "PEPE", "ARB",
  "OP", "TON", "AAVE", "ALGO", "FET", "INJ", "SEI", "TIA", "RENDER", "WIF",
  "BONK", "JUP", "PYTH", "SUI", "APT",
]);

/**
 * Bases supportées par Binance mais interrogées via USDT (pas de paire EUR
 * directe retenue) → `<BASE>USDT` puis conversion USD→EUR.
 */
const BINANCE_USDT_ONLY = new Set<string>([
  "POL", "RAY", "ORCA", "JTO", "W",
]);

/** Stablecoins ~1 USD — valorisés via FX USD→EUR (pas d'appel Binance). */
const STABLECOINS = new Set<string>(["USDT", "USDC"]);

/**
 * Tokens explicitement NON couverts par Binance (liquid staking Solana,
 * wrapped, Monad, dérivés) → fallback CoinGecko via le registry.
 * Listés ici pour la lisibilité ; `supports()` renvoie false pour eux.
 */
export const BINANCE_UNSUPPORTED = new Set<string>([
  "MON", "FLR", "WETH", "WSOL", "MSOL", "STSOL", "JITOSOL", "JSOL", "JUPSOL",
  "BSOL", "STETH", "WSTETH", "RETH", "CBETH", "DOOD",
]);

export function isBinanceEnabled(): boolean {
  const v = (process.env.BINANCE_WS_ENABLED ?? "true").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

type BinancePlan =
  | { kind: "stable"; base: string }
  | { kind: "eur"; base: string; symbol: string }
  | { kind: "usdt"; base: string; symbol: string };

/**
 * Résout un asset vers un plan Binance (paire + mode de conversion), ou null
 * si non couvert (→ le registry basculera sur CoinGecko).
 */
export function resolveBinancePlan(
  ticker?: string | null,
  providerSymbol?: string | null
): BinancePlan | null {
  const raw = (ticker || providerSymbol || "").trim().toUpperCase();
  if (!raw) return null;
  // Nettoyage : garder lettres/chiffres (mSOL, jitoSOL…)
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  const base = TICKER_ALIAS[cleaned] ?? cleaned;

  if (BINANCE_UNSUPPORTED.has(base) || BINANCE_UNSUPPORTED.has(cleaned)) {
    return null;
  }
  if (STABLECOINS.has(base)) return { kind: "stable", base };
  if (BINANCE_EUR_PAIRS.has(base)) {
    return { kind: "eur", base, symbol: `${base}EUR` };
  }
  if (BINANCE_USDT_ONLY.has(base)) {
    return { kind: "usdt", base, symbol: `${base}USDT` };
  }
  return null;
}

/** true si l'asset a un mapping Binance connu. */
export function isBinanceSupported(asset: AssetMeta): boolean {
  if (!isBinanceEnabled()) return false;
  if (asset.assetClass !== "CRYPTO") return false;
  return resolveBinancePlan(asset.ticker, asset.providerSymbol) != null;
}

// ── Cache serveur (Map + TTL) ────────────────────────────────────────────────

type CacheEntry = { price: number; at: number };
const priceCache = new Map<string, CacheEntry>();

/** Réinitialise le cache (tests / hot-reload). */
export function __resetBinanceCache(): void {
  priceCache.clear();
}

/** Snapshot du cache local — exposé pour /api/health (diagnostic, pas d'alerte). */
export function getBinanceCacheStats(): {
  size: number;
  effectiveTtlMs: number;
  onVercel: boolean;
} {
  return {
    size: priceCache.size,
    effectiveTtlMs: effectiveBinanceCacheTtlMs(),
    onVercel: process.env.VERCEL === "1",
  };
}

type BinanceTickerRow = { symbol: string; price: string };

async function fetchBinanceTickers(
  symbols: string[],
  signal?: AbortSignal
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(symbols.filter(Boolean))];
  if (unique.length === 0) return out;

  const url = new URL(`${BINANCE_BASE_URL}/ticker/price`);
  if (unique.length === 1) {
    url.searchParams.set("symbol", unique[0]!);
  } else {
    url.searchParams.set("symbols", JSON.stringify(unique));
  }

  const sig =
    signal ??
    (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(8_000)
      : undefined);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: sig,
  });
  if (!res.ok) {
    throw new Error(`Binance HTTP ${res.status}`);
  }
  const body = (await res.json()) as BinanceTickerRow | BinanceTickerRow[];
  const rows = Array.isArray(body) ? body : [body];
  for (const row of rows) {
    const p = Number(row.price);
    if (row.symbol && Number.isFinite(p) && p >= 0) {
      out.set(row.symbol, p);
    }
  }
  return out;
}

/**
 * Prix de plusieurs symboles Binance (bruts, dans leur devise de cotation),
 * avec cache TTL 30 s. Un seul appel réseau pour les symboles manquants/périmés.
 */
export async function getBinancePrices(
  symbols: string[],
  opts?: { signal?: AbortSignal; now?: number }
): Promise<Map<string, number>> {
  const now = opts?.now ?? Date.now();
  const result = new Map<string, number>();
  const stale: string[] = [];

  const ttlMs = effectiveBinanceCacheTtlMs();
  for (const s of [...new Set(symbols.filter(Boolean))]) {
    const hit = priceCache.get(s);
    if (hit && now - hit.at < ttlMs) {
      result.set(s, hit.price);
    } else {
      stale.push(s);
    }
  }

  if (stale.length > 0) {
    const fresh = await fetchBinanceTickers(stale, opts?.signal);
    for (const [sym, price] of fresh) {
      priceCache.set(sym, { price, at: now });
      result.set(sym, price);
    }
  }
  return result;
}

async function usdToEur(priceUsd: number): Promise<string> {
  const rates = await getEurRates();
  return convertToEurSync(d(priceUsd), "USD", rates);
}

export const binanceProvider: MarketDataProvider = {
  id: "binance",
  supports(asset) {
    return isBinanceSupported(asset);
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    const plan = resolveBinancePlan(asset.ticker, asset.providerSymbol);
    if (!plan) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "binance",
        status: "ERROR",
        error: "Ticker non couvert par Binance",
      };
    }

    try {
      // Stablecoin : 1 unité ≈ 1 USD → EUR via FX (aucun appel Binance).
      if (plan.kind === "stable") {
        const priceEur = await usdToEur(1);
        const prec = pricePrecision(Number(priceEur));
        return {
          priceEur: toFixed(d(priceEur), prec),
          priceNative: "1",
          nativeCurrency: "USD",
          currency: "EUR",
          source: "binance",
          status: "OK",
        };
      }

      // Paire EUR d'abord si connue, repli USDT sinon (auto-correction si la
      // paire EUR n'existe pas / pas de prix).
      const candidates: string[] =
        plan.kind === "eur"
          ? [plan.symbol, `${plan.base}USDT`]
          : [plan.symbol];

      const prices = await getBinancePrices(candidates);

      // 1) Paire EUR directe
      if (plan.kind === "eur") {
        const eur = prices.get(plan.symbol);
        if (typeof eur === "number" && Number.isFinite(eur) && eur > 0) {
          const prec = pricePrecision(eur);
          return {
            priceEur: toFixed(d(eur), prec),
            priceNative: toFixed(d(eur), prec),
            nativeCurrency: "EUR",
            currency: "EUR",
            source: "binance",
            status: "OK",
          };
        }
      }

      // 2) Paire USDT → conversion USD→EUR
      const usdtSymbol = plan.kind === "eur" ? `${plan.base}USDT` : plan.symbol;
      const usd = prices.get(usdtSymbol);
      if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
        const priceEur = await usdToEur(usd);
        const prec = pricePrecision(Number(priceEur));
        return {
          priceEur: toFixed(d(priceEur), prec),
          priceNative: toFixed(d(usd), pricePrecision(usd)),
          nativeCurrency: "USD",
          currency: "EUR",
          source: "binance",
          status: "OK",
        };
      }

      return {
        priceEur: "0",
        currency: "EUR",
        source: "binance",
        status: "ERROR",
        error: `Prix Binance introuvable (${plan.base})`,
      };
    } catch (e) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "binance",
        status: "ERROR",
        error: e instanceof Error ? e.message : "Erreur Binance",
      };
    }
  },
};
