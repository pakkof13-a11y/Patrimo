import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getAlternativesPortfolioSlice } from "@/app/lib/alternatives/portfolio";

/** Dashboard-friendly aggregate of all alternative sleeves */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  try {
    const slice = await getAlternativesPortfolioSlice(userId);
    return NextResponse.json({ summary: slice });
  } catch (e) {
    console.error("[alternatives/summary]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 500 }
    );
  }
}
