import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { deleteContribution } from "@/app/lib/securities/fiscal-service";

export const dynamic = "force-dynamic";

/**
 * DELETE — retire un mouvement déclaré.
 *
 * Corriger une saisie doit rester possible : le plafond de versement en
 * dépend directement, et une erreur de frappe non rattrapable afficherait un
 * dépassement fantôme.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await params;

  try {
    return NextResponse.json(await deleteContribution(userId, id));
  } catch (e) {
    console.error("[securities/contributions/:id DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: 500 }
    );
  }
}
