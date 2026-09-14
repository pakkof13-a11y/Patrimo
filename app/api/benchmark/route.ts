import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { requireUserId } from "@/app/lib/auth-helpers";
import { cacheGet, cacheSet, cachePrune } from "@/app/lib/api/memory-cache";
import { consumeRateLimit } from "@/app/lib/api/simple-rate-limit";
import { withTimeout } from "@/app/lib/utils/with-timeout";
import { MARKET_INDEX_SYMBOLS } from "@/app/lib/portfolio/market-indices";
import { MAX_HISTORY_YEARS } from "@/app/lib/portfolio/historical/history-window";
import { serverErrorDetail } from "@/app/lib/api/error-response";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

/** Symboles indices supportés (catalogue partagé UI ↔ API). */
const SYMBOLS: Record<string, string> = MARKET_INDEX_SYMBOLS;

const CACHE_TTL_MS = 60 * 60_000; // 1 h — clôtures journalières
const RATE_LIMIT = 30; // req / user / fenêtre
const RATE_WINDOW_MS = 60_000;

type BenchmarkPayload = {
  symbol: string;
  key: string;
  points: Array<{ date: string; close: number }>;
  source: string;
  cached?: boolean;
};

/**
 * Clôtures d'indice pour benchmark perf (Yahoo).
 * GET /api/benchmark?symbol=cac40&from=ISO&to=ISO
 *
 * Auth requise (requireUserId) — defense-in-depth en plus du middleware NextAuth.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  cachePrune();

  const rl = await consumeRateLimit(
    `benchmark:${userId}`,
    RATE_LIMIT,
    RATE_WINDOW_MS
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Trop de requêtes benchmark — réessayez plus tard" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const key = (searchParams.get("symbol") || "cac40").toLowerCase();
  if (!SYMBOLS[key]) {
    return NextResponse.json(
      {
        error: "Symbole non supporté",
        allowed: Object.keys(SYMBOLS),
      },
      { status: 400 }
    );
  }
  const yahooSym = SYMBOLS[key]!;
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw
    ? new Date(fromRaw)
    : new Date(to.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Dates invalides" }, { status: 400 });
  }

  /*
    Borne de plage — la même profondeur que le reste de l'application.

    Elle valait `6 * 365` jours, soit 2 190. Six ans civils en comptent 2 191
    dès qu'une année bissextile s'y trouve, et le panneau demande en plus sept
    jours avant la fenêtre pour disposer d'une ancre de rebasage. Une demande
    « Tout » pesait donc 2 198 jours et repartait en 400 : l'indice était
    absent de la seule période où on voulait le comparer, et rien à l'écran ne
    disait pourquoi.

    Le plafond se dérive maintenant de `MAX_HISTORY_YEARS`, la constante qui
    borne déjà le moteur, en années civiles et non en tranches de 365 jours.
    La marge d'ancrage est nommée plutôt que devinée : un fournisseur ne rend
    pas de cours les jours fériés, et l'ancre doit pouvoir reculer jusqu'à
    trouver une séance.
  */
  const ANCHOR_MARGIN_DAYS = 30;
  const spanFloor = new Date(to.getTime());
  spanFloor.setUTCFullYear(spanFloor.getUTCFullYear() - MAX_HISTORY_YEARS);
  spanFloor.setUTCDate(spanFloor.getUTCDate() - ANCHOR_MARGIN_DAYS);
  if (from.getTime() < spanFloor.getTime()) {
    return NextResponse.json(
      { error: `Plage trop large (max ${MAX_HISTORY_YEARS} ans)` },
      { status: 400 }
    );
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json(
      { error: "from doit être antérieur à to" },
      { status: 400 }
    );
  }

  const fromKey = from.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);
  const cacheKey = `benchmark:v1:${key}:${fromKey}:${toKey}`;

  const cached = cacheGet<BenchmarkPayload>(cacheKey);
  if (cached) {
    return NextResponse.json(
      { ...cached, cached: true },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
          "X-Benchmark-Cache": "HIT",
        },
      }
    );
  }

  try {
    const result = (await withTimeout(
      yahooFinance.chart(yahooSym, {
        period1: from,
        period2: to,
        interval: "1d",
      }),
      /*
        Sous le couperet de la plateforme, pas au-dessus.

        Douze secondes ne pouvaient jamais s'écouler : l'hébergement coupe la
        fonction autour de dix, et la page recevait une erreur de plateforme au
        lieu du message de la route. Un délai qui expire après la coupure ne
        protège de rien — il garantit seulement que l'échec sera muet.
      */
      8_000,
      "yahooFinance.chart"
    )) as {
      quotes?: Array<{
        date?: Date;
        close?: number | null;
        adjclose?: number | null;
      }>;
    };

    const points = (result.quotes ?? [])
      .filter((q) => q.date && typeof (q.close ?? q.adjclose) === "number")
      .map((q) => {
        const close = Number(q.close ?? q.adjclose);
        return {
          date: new Date(q.date!).toISOString(),
          close,
        };
      })
      .filter((p) => Number.isFinite(p.close) && p.close > 0);

    if (points.length < 2) {
      return NextResponse.json(
        { error: "Historique indice insuffisant", symbol: yahooSym, points: [] },
        { status: 502 }
      );
    }

    const payload: BenchmarkPayload = {
      symbol: yahooSym,
      key,
      points,
      source: "yahoo",
    };
    cacheSet(cacheKey, payload, CACHE_TTL_MS);

    return NextResponse.json(
      { ...payload, cached: false },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
          "X-Benchmark-Cache": "MISS",
        },
      }
    );
  } catch (e) {
    // Log serveur : détail complet conservé (jamais renvoyé au client).
    console.error("[benchmark]", serverErrorDetail(e));
    return NextResponse.json(
      {
        error: "Échec récupération indice",
        symbol: yahooSym,
        points: [],
      },
      { status: 502 }
    );
  }
}
