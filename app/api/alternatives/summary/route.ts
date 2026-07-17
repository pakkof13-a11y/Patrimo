import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getAlternativesDashboardBundle } from "@/app/lib/alternatives/portfolio";

/**
 * GET /api/alternatives/summary
 * Bundle dashboard (slice EUR + KPI par poche) — 1 HTTP pour la vue d’ensemble.
 * Query `?lite=1` : uniquement le slice (compat net-worth / holdings).
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }

  try {
    const lite = new URL(req.url).searchParams.get("lite") === "1";
    if (lite) {
      const { getAlternativesPortfolioSlice } = await import(
        "@/app/lib/alternatives/portfolio"
      );
      const summary = await getAlternativesPortfolioSlice(userId);
      return NextResponse.json(
        { summary },
        { headers: { "Cache-Control": "private, max-age=30" } }
      );
    }

    const bundle = await getAlternativesDashboardBundle(userId);
    return NextResponse.json(bundle, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    console.error("[alternatives/summary]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 500 }
    );
  }
}
