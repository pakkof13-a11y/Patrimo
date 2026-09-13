import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { resetUserData } from "@/app/lib/portfolio/clear-user-data";
import { clientErrorMessage } from "@/app/lib/api/error-response";

/**
 * Mot de confirmation exigé dans le corps de la requête. La modale côté
 * client fait déjà saisir ce mot avant d'appeler cette route — sans ce
 * garde-fou côté serveur, n'importe quelle requête DELETE authentifiée
 * (session cookie httpOnly déjà valide) efface tout le patrimoine, sans
 * corps ni confirmation d'aucune sorte. La comparaison est insensible à la
 * casse et aux espaces superflus, comme la vérification déjà faite côté
 * client (`confirmText.trim().toUpperCase()`).
 */
const CLEAR_CONFIRM_WORD = "SUPPRIMER";

/**
 * DELETE /api/preferences/clear-data
 *
 * Full user-data reset: all entered portfolio data wiped (transactions,
 * positions, platforms, banks, AV, liabilities, alternatives, etc.).
 * The User account itself is kept.
 *
 * Exige `{ confirm: "SUPPRIMER" }` dans le corps JSON. Absent, JSON invalide
 * ou mot incorrect → 400, et `resetUserData` n'est jamais appelée.
 */
export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Non authentifié — action refusée" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requête invalide — confirmation requise" },
      { status: 400 }
    );
  }

  const confirm =
    body && typeof body === "object" && "confirm" in body
      ? (body as { confirm?: unknown }).confirm
      : undefined;

  if (
    typeof confirm !== "string" ||
    confirm.trim().toUpperCase() !== CLEAR_CONFIRM_WORD
  ) {
    return NextResponse.json(
      {
        error: `Confirmation requise — envoyez { "confirm": "${CLEAR_CONFIRM_WORD}" }`,
      },
      { status: 400 }
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
        error: clientErrorMessage(
          e,
          "Erreur base de données lors de la réinitialisation"
        ),
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
