import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  deleteAccount,
  SecuritiesInputError,
  updateAccount,
} from "@/app/lib/securities/account-service";

export const dynamic = "force-dynamic";

/**
 * `envelopeType` est volontairement absent : le muter changerait le régime
 * fiscal de toutes les lignes détenues sans qu'aucune opération réelle n'ait
 * eu lieu (cf. `account-service`).
 */
const updateSchema = z.object({
  platformId: z.string().min(1).optional(),
  openDate: z.string().min(1).optional(),
  iban: z.string().trim().max(34).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const account = await updateAccount(userId, id, parsed.data);
    return NextResponse.json({
      ...account,
      openDate: account.openDate.toISOString(),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof SecuritiesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[securities/accounts/:id PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: 500 }
    );
  }
}

/**
 * DELETE — ferme un compte.
 *
 * Les titres détenus ne sont jamais supprimés : ils sont détachés, journal
 * intact. Le nombre de lignes concernées est renvoyé pour que l'UI puisse le
 * confirmer avant, et le rappeler après.
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
    return NextResponse.json(await deleteAccount(userId, id));
  } catch (e) {
    console.error("[securities/accounts/:id DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: 500 }
    );
  }
}
