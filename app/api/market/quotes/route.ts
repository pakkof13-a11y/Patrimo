import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { requireUserId } from "@/app/lib/auth-helpers";
import { cacheGet, cacheSet, cachePrune } from "@/app/lib/api/memory-cache";
import { consumeRateLimit } from "@/app/lib/api/simple-rate-limit";
import { withTimeout } from "@/app/lib/utils/with-timeout";
import { MARKET_TICKERS } from "@/app/lib/portfolio/market-indices";
import {
  normalizeMarketState,
  type MarketQuote,
} from "@/app/lib/market/quotes";

/**
 * Cotations du bandeau de marché.
 *
 * Distincte de `/api/benchmark`, qui rend des **clôtures journalières** : ici on
 * veut le dernier cours connu et l'état de la place, ce que `quote()` donne en
 * un seul aller-retour pour les onze instruments. Passer par les clôtures
 * obligerait à onze requêtes d'historique pour n'en garder que le dernier
 * point, et ne dirait jamais si la bourse est ouverte.
 */

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

/**
 * Une minute.
 *
 * Assez court pour que le bandeau vive, assez long pour qu'une page laissée
 * ouverte ne martèle pas Yahoo. Le cache est partagé par tous les utilisateurs
 * — un cours d'indice n'a rien de personnel.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_KEY = "market-quotes:v1";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

type QuotesPayload = { quotes: MarketQuote[]; fetchedAt: string };

/** Champs réellement lus sur la réponse Yahoo — le reste ne nous regarde pas. */
type YahooQuote = {
  symbol?: string;
  regularMarketPrice?: number | null;
  regularMarketPreviousClose?: number | null;
  regularMarketChangePercent?: number | null;
  marketState?: string | null;
  currency?: string | null;
};

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  cachePrune();

  const rl = await consumeRateLimit(
    `market-quotes:${userId}`,
    RATE_LIMIT,
    RATE_WINDOW_MS
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Trop de requêtes — réessayez plus tard" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const cached = cacheGet<QuotesPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  try {
    const rows = (await withTimeout(
      yahooFinance.quote(MARKET_TICKERS.map((t) => t.yahoo)),
      10_000,
      "yahooFinance.quote"
    )) as YahooQuote[] | YahooQuote;

    const bySymbol = new Map<string, YahooQuote>();
    for (const r of Array.isArray(rows) ? rows : [rows]) {
      if (r?.symbol) bySymbol.set(r.symbol, r);
    }

    const quotes: MarketQuote[] = MARKET_TICKERS.map((t) => {
      const r = bySymbol.get(t.yahoo);
      const last =
        typeof r?.regularMarketPrice === "number" && r.regularMarketPrice > 0
          ? r.regularMarketPrice
          : null;
      const changePct =
        typeof r?.regularMarketChangePercent === "number"
          ? r.regularMarketChangePercent
          : null;

      return {
        key: t.key,
        label: t.label,
        // Un instrument absent de la réponse n'a pas de cours : `null`, et
        // l'écran dira « indisponible ». Reporter la veille serait présenter
        // un cours périmé comme le cours du moment.
        last,
        changePct: last != null ? changePct : null,
        state: normalizeMarketState(r?.marketState),
        currency: r?.currency ?? null,
      };
    });

    const payload: QuotesPayload = {
      quotes,
      fetchedAt: new Date().toISOString(),
    };
    cacheSet(CACHE_KEY, payload, CACHE_TTL_MS);

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    console.error("[market/quotes]", e);
    /*
      Panne de la source : on rend 200 avec des cotations vides plutôt qu'une
      erreur. Le bandeau est décoratif — il ne doit ni faire clignoter une
      alerte rouge en haut de l'écran, ni déclencher les nouvelles tentatives
      d'un client qui n'y peut rien.
    */
    return NextResponse.json(
      {
        quotes: MARKET_TICKERS.map((t) => ({
          key: t.key,
          label: t.label,
          last: null,
          changePct: null,
          state: "unknown" as const,
          currency: null,
        })),
        fetchedAt: new Date().toISOString(),
        unavailable: true,
      },
      { status: 200 }
    );
  }
}
