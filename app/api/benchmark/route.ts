import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

/** Symboles indices supportés */
const SYMBOLS: Record<string, string> = {
  cac40: "^FCHI",
  sp500: "^GSPC",
  eurostoxx50: "^STOXX50E",
};

/**
 * Clôtures d'indice pour benchmark perf (Yahoo).
 * GET /api/benchmark?symbol=cac40&from=ISO&to=ISO
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = (searchParams.get("symbol") || "cac40").toLowerCase();
  const yahooSym = SYMBOLS[key] || SYMBOLS.cac40!;
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw
    ? new Date(fromRaw)
    : new Date(to.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Dates invalides" }, { status: 400 });
  }

  try {
    const result = (await yahooFinance.chart(yahooSym, {
      period1: from,
      period2: to,
      interval: "1d",
    })) as {
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

    return NextResponse.json({
      symbol: yahooSym,
      key,
      points,
      source: "yahoo",
    });
  } catch (e) {
    console.error("[benchmark]", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Échec Yahoo indice",
        symbol: yahooSym,
        points: [],
      },
      { status: 502 }
    );
  }
}
