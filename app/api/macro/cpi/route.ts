import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { buildCpiSeries, MIN_CPI_MONTHS } from "@/app/lib/macro/cpi-repository";

/**
 * GET /api/macro/cpi?days=180
 *
 * Inflation cumulée sur une fenêtre, à partir des observations mensuelles
 * réellement enregistrées.
 *
 * ## Lecture pure
 *
 * Aucun appel à l'INSEE ni à quiconque : ce qui manque au cache manque à la
 * réponse. Afficher un graphique ne doit pas déclencher une requête vers un
 * institut statistique.
 *
 * ## L'absence est une réponse
 *
 * `available: false` avec une raison nommée — fenêtre trop courte, aucune
 * donnée, ou mois manquant. Le frontend l'affiche telle quelle plutôt que de
 * tracer une ligne à zéro, qui affirmerait une inflation nulle.
 */

const MAX_DAYS = 3650;
const DEFAULT_DAYS = 365;

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const raw = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isFinite(raw)
    ? Math.min(MAX_DAYS, Math.max(1, Math.trunc(raw)))
    : DEFAULT_DAYS;

  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const series = await buildCpiSeries({ from, to });

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    minMonths: MIN_CPI_MONTHS,
    ...series,
  });
}
