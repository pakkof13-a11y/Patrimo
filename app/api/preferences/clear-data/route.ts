import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { resetUserData } from "@/app/lib/portfolio/clear-user-data";

/**
 * DELETE /api/preferences/clear-data
 *
 * Full user-data reset: all entered portfolio data wiped (transactions,
 * positions, platforms, banks, AV, liabilities, alternatives, etc.).
 * The User account itself is kept.
 */
export async function DELETE(req: Request) {
  void req;

  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Non authentifié — action refusée" },
      { status: 401 }
    );
  }

  try {
    const result = await resetUserData(userId);
    return NextResponse.json({
      ok: true,
      message:
        "Base de données utilisateur réinitialisée — toutes les saisies ont été effacées",
      ...result,
    });
  } catch (e) {
    console.error("[preferences/clear-data DELETE]", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Erreur base de données lors de la réinitialisation",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Utilisez DELETE." },
    { status: 405, headers: { Allow: "DELETE" } }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: "Méthode non autorisée. Utilisez DELETE." },
    { status: 405, headers: { Allow: "DELETE" } }
  );
}
