/**
 * Provider prix ACTIONS / ETF — Finnhub (REST).
 *
 * Même architecture que le provider Binance : REST + cache mémoire TTL, pas de
 * WebSocket. Le socket temps réel de Finnhub suppose un processus qui vit entre
 * deux requêtes ; une fonction serverless est gelée puis détruite après la
 * réponse, donc le socket serait ouvert, abonné — consommant l'un des 50 slots
 * du free tier — puis tué avant d'avoir reçu le moindre tick. L'effet « temps
 * réel » côté client vient du polling, comme pour les cryptos.
 *
 * Deux garde-fous encadrent les appels :
 *
 * 1. **Budget 60 appels/minute** (`finnhubRestLimiter`). `/quote` est
 *    mono-symbole sur le free tier, donc un actif = un appel : un portefeuille
 *    de 80 lignes dépasse le quota à lui seul. Les appels sont étalés plutôt
 *    que refusés, ce qui laisse le refresh aboutir au lieu de récolter des 429.
 * 2. **Cache TTL 30 s** partagé par le refresh périodique et les lectures à la
 *    demande. Deux actifs sur le même symbole, ou deux rafraîchissements
 *    rapprochés, ne consomment qu'un seul jeton.
 */

import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";
import { toFinnhubSymbol, guessQuoteCurrency } from "../symbol";
import { toEurAmount } from "../fx";
import { finnhubRestLimiter } from "../rate-limit";

/** Durée de validité d'un cours en cache — alignée sur le provider Binance. */
export const FINNHUB_CACHE_TTL_MS = 30_000;

function getApiKey(): string | null {
  const key = (process.env.FINNHUB_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!key || key === "demo" || key === "votre-cle-finnhub") return null;
  return key;
}

export function hasFinnhubApiKey(): boolean {
  return getApiKey() != null;
}

type CacheEntry = { price: number; at: number };
const quoteCache = new Map<string, CacheEntry>();

/**
 * Requêtes en vol, par symbole.
 *
 * Deux actifs peuvent porter le même ticker (même titre logé sur deux
 * plateformes), et le refresh les traite en parallèle. Sans ce dédoublonnage,
 * chacun consommerait son propre jeton pour exactement le même cours — un
 * gaspillage direct sur un quota de 60 appels par minute. Les appelants
 * simultanés partagent donc la même promesse.
 */
const inFlight = new Map<string, Promise<FinnhubQuoteOutcome>>();

/** Réinitialise le cache (tests / hot-reload). */
export function __resetFinnhubCache(): void {
  quoteCache.clear();
  inFlight.clear();
}

/** Snapshot du cache et du budget — diagnostic (/api/health), pas d'alerte. */
export function getFinnhubStats(): {
  cacheSize: number;
  ttlMs: number;
  budgetUsed: number;
  budgetAvailable: number;
} {
  return {
    cacheSize: quoteCache.size,
    ttlMs: FINNHUB_CACHE_TTL_MS,
    budgetUsed: finnhubRestLimiter.used(),
    budgetAvailable: finnhubRestLimiter.available(),
  };
}

/**
 * Message porté par le résultat quand le quota de la minute est consommé.
 * Ce n'est pas une panne : le registry doit y lire un signal de bascule vers
 * Yahoo, pas un échec définitif de l'actif.
 */
export const FINNHUB_BUDGET_EXHAUSTED = "Quota Finnhub atteint — repli fournisseur";

function errorQuote(error: string): PriceQuoteResult {
  return {
    priceEur: "0",
    currency: "EUR",
    source: "finnhub",
    status: "ERROR",
    error,
  };
}

/**
 * Issue d'une demande de cours.
 *
 * Un simple `number | null` mélangeait trois situations qui appellent des
 * réactions opposées : un symbole inconnu (inutile de réessayer ailleurs, le
 * ticker est faux), une clé absente (problème de configuration) et un budget
 * épuisé (le cours existe, c'est nous qui n'avons plus de jetons — il faut
 * basculer sur un autre fournisseur). Le registry a besoin de les distinguer.
 */
export type FinnhubQuoteOutcome =
  | { kind: "ok"; price: number }
  | { kind: "no-quote" }
  | { kind: "no-key" }
  | { kind: "budget-exhausted" };

/**
 * Dernier cours d'un symbole, en devise de cotation.
 *
 * `waitForBudget` arbitre entre deux usages opposés :
 *
 * - **false (défaut)** — chemin utilisateur. Si le budget est épuisé, on rend
 *   la main immédiatement pour que le registry bascule sur Yahoo. Le free tier
 *   plafonne à 60 appels/minute pour un symbole par appel : un portefeuille de
 *   80 actions mettrait plus d'une minute à se rafraîchir si chaque ligne
 *   attendait son jeton, alors que Yahoo répond tout de suite. Finnhub sert
 *   donc autant de lignes que son quota le permet, Yahoo couvre le reste.
 * - **true** — traitements de fond, où la lenteur est sans conséquence et où
 *   l'on préfère la source demandée à un repli.
 */
export async function fetchFinnhubQuote(
  symbol: string,
  opts?: { now?: number; signal?: AbortSignal; waitForBudget?: boolean }
): Promise<FinnhubQuoteOutcome> {
  const apiKey = getApiKey();
  if (!apiKey) return { kind: "no-key" };

  // Horloge unique pour la lecture, la relecture et l'écriture : dater une
  // entrée avec `Date.now()` alors qu'on la relit avec un instant injecté rend
  // le cache éternel pour l'appelant qui fournit son horloge.
  const clock = (): number => opts?.now ?? Date.now();

  const hit = quoteCache.get(symbol);
  if (hit && clock() - hit.at < FINNHUB_CACHE_TTL_MS) {
    return { kind: "ok", price: hit.price };
  }

  // Une requête est déjà partie pour ce symbole : la partager plutôt que d'en
  // lancer une seconde et de consommer un jeton pour le même cours.
  const pending = inFlight.get(symbol);
  if (pending) return pending;

  const run = requestQuote(symbol, apiKey, clock, opts);
  inFlight.set(symbol, run);
  try {
    return await run;
  } finally {
    inFlight.delete(symbol);
  }
}

async function requestQuote(
  symbol: string,
  apiKey: string,
  clock: () => number,
  opts?: { signal?: AbortSignal; waitForBudget?: boolean }
): Promise<FinnhubQuoteOutcome> {
  if (opts?.waitForBudget) {
    await finnhubRestLimiter.acquire();
  } else if (!finnhubRestLimiter.tryAcquire()) {
    return { kind: "budget-exhausted" };
  }

  // Le temps d'attendre son tour dans le budget, un autre appelant a pu
  // renseigner le cache pour ce même symbole.
  const fresh = quoteCache.get(symbol);
  if (fresh && clock() - fresh.at < FINNHUB_CACHE_TTL_MS) {
    return { kind: "ok", price: fresh.price };
  }

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: opts?.signal ?? AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`Finnhub HTTP ${res.status}`);
  }

  const data = (await res.json()) as { c?: number };
  if (typeof data.c !== "number" || !Number.isFinite(data.c) || data.c <= 0) {
    return { kind: "no-quote" };
  }

  quoteCache.set(symbol, { price: data.c, at: clock() });
  return { kind: "ok", price: data.c };
}

export const finnhubProvider: MarketDataProvider = {
  id: "finnhub",
  supports(asset) {
    // CRYPTO : CoinGecko exclusif — jamais Finnhub
    if (asset.assetClass === "CRYPTO") return false;
    return (
      asset.priceProvider === "FINNHUB" ||
      asset.assetClass === "ACTIONS"
    );
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    if (!hasFinnhubApiKey()) {
      return errorQuote("FINNHUB_API_KEY manquante ou invalide");
    }

    const symbol = toFinnhubSymbol(
      asset.ticker || "",
      asset.providerSymbol,
      asset.assetClass
    );
    if (!symbol) return errorQuote("Symbole manquant");

    try {
      const outcome = await fetchFinnhubQuote(symbol);
      if (outcome.kind === "budget-exhausted") {
        return errorQuote(FINNHUB_BUDGET_EXHAUSTED);
      }
      if (outcome.kind !== "ok") {
        return errorQuote(`Cours indisponible Finnhub (${symbol})`);
      }

      const nativeCurrency = guessQuoteCurrency(symbol, asset.assetClass);
      const priceNative = d(outcome.price);
      const priceEur = await toEurAmount(priceNative, nativeCurrency);

      return {
        priceEur,
        priceNative: toFixed(priceNative, 8),
        nativeCurrency,
        currency: "EUR",
        source: "finnhub",
        status: "OK",
      };
    } catch (e) {
      return errorQuote(e instanceof Error ? e.message : "Erreur Finnhub");
    }
  },
};
