import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getPatrimonyState } from "@/app/lib/portfolio/patrimony-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/patrimony-state
 *
 * Le compte porte-t-il la moindre donnée patrimoniale ? C'est cette réponse,
 * et elle seule, qui décide entre le cockpit d'accueil et le tableau de bord.
 *
 * Jamais mise en cache : après une réinitialisation ou la création d'une
 * première ligne, l'écran doit basculer immédiatement. Une réponse gardée
 * quelques secondes afficherait le cockpit à un compte qui vient d'être
 * rempli, ou l'inverse.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const state = await getPatrimonyState(userId);
  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
