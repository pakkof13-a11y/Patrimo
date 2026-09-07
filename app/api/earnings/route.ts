import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import type { PortfolioTickerRef } from "@/app/lib/news/service";
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
  /*
    Le plafond passe de 20 à 60.

    Il suffisait tant que la liste ne portait que les titres détenus. Depuis que
    les publications des vingt-quatre heures y figurent aussi, vingt lignes se
    remplissaient des seules valeurs du portefeuille — triées en tête — et
    l'univers était tronqué avant d'atteindre l'écran.
  */
  const limit = Math.min(
    60,
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
    const { events, source, diagnostics } = await resolveEarningsCalendar({
      portfolio,
      limit,
    });

    /*
      Même règle de partage que le calendrier macro, et pour la même raison.

      `isEarningsEventPublished` répond à « le bénéfice par action est-il
      tombé ? ». Une publication dont le fournisseur ne renseigne jamais l'EPS
      réel restait donc « à venir » indéfiniment, des jours après son heure.
      C'est le temps qui tranche : passé son heure, une annonce quitte « à
      venir » et rejoint « passés ».

      La sémantique de `isEarningsEventPublished` est conservée pour le détail
      affiché — l'EPS réel n'a de sens à montrer que s'il existe.
    */
    const nowMs = Date.now();
    const timeOf = (e: { time: string }) => Date.parse(e.time);

    return NextResponse.json({
      events,
      upcoming: events.filter((e) => {
        const t = timeOf(e);
        return !Number.isFinite(t) || t > nowMs;
      }),
      published: events.filter((e) => {
        const t = timeOf(e);
        return Number.isFinite(t) && t <= nowMs;
      }),
      source,
      /*
        Pourquoi la liste ressemble à ce qu'elle est.

        Une liste réduite aux titres détenus a deux causes que l'écran ne
        distingue pas : le fournisseur d'univers n'a pas été interrogé — pas
        de clé — ou il a répondu sans rien. La première est une configuration
        absente, la seconde une journée sans publication. Les confondre fait
        chercher un défaut de filtrage là où il n'y en a pas.
      */
      diagnostics,
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
