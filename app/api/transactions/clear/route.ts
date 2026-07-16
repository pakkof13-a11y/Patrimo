import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clearUserTransactionsAndPositions } from "@/app/lib/portfolio/clear-user-data";

/**
 * @deprecated Prefer DELETE /api/preferences/clear-data
 * Kept as alias for compatibility.
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const result = await clearUserTransactionsAndPositions(userId);
    return NextResponse.json({
      ok: true,
      message: "Données réinitialisées avec succès",
      ...result,
      platformsPreserved: true,
    });
  } catch (e) {
    console.error("[transactions/clear]", e);
    return NextResponse.json(
      { error: "Erreur serveur, veuillez réessayer" },
      { status: 500 }
    );
  }
}
