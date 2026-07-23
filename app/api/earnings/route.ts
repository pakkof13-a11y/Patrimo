import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import type { PortfolioTickerRef } from "@/app/lib/news/service";
import { isEarningsEventPublished } from "@/app/lib/news/service";
import { resolveEarningsCalendar } from "@/app/lib/news/earnings-live";

/**
 * GET /api/earnings?tickers=ASML.AS:ASML Holding,AAPL:Apple&limit=8
 * Tickers format: TICKER or TICKER:Name (comma-separated).
 *
 * Sources (dans l’ordre) : Yahoo Finance → Finnhub (si clé) → mock.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(
    20,
    Math.max(1, Number(searchParams.get("limit") || 8) || 8)
  );
  const raw = searchParams.get("tickers") || "";
  const portfolio: PortfolioTickerRef[] = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [ticker, ...rest] = part.split(":");
      return {
        ticker: (ticker || "").trim(),
        name: rest.join(":").trim() || ticker || "",
      };
    })
    .filter((p) => p.ticker);

  try {
    const { events, source } = await resolveEarningsCalendar({
      portfolio,
      limit,
    });

    return NextResponse.json({
      events,
      upcoming: events.filter((e) => !isEarningsEventPublished(e)),
      published: events.filter((e) => isEarningsEventPublished(e)),
      source,
      date: new Date().toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[api/earnings]", e);
    return NextResponse.json(
      {
        error: "Calendrier des résultats indisponible",
        events: [],
        upcoming: [],
        published: [],
        source: "mock",
      },
      { status: 502 }
    );
  }
}
