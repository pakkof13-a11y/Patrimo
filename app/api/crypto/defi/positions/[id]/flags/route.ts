import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { POSITION_STATUS_KEYS } from "@/app/lib/crypto/defi-taxonomy";

export const dynamic = "force-dynamic";

const flagsSchema = z
  .object({
    /** Masquée de l'affichage — **reste comptée** au patrimoine. */
    isHidden: z.boolean().optional(),
    /** Exclue des agrégats patrimoniaux, mais historisée. */
    isIgnoredInPortfolio: z.boolean().optional(),
    /**
     * Statut de cycle de vie. `CLOSED`/`LIQUIDATED` sont refusés : les
     * atteindre demande de ramener la quantité à zéro au journal, ce que seul
     * le dénouement sait faire.
     */
    status: z
      .enum(POSITION_STATUS_KEYS)
      .refine((s) => s !== "CLOSED" && s !== "LIQUIDATED", {
        message:
          "Utilisez le dénouement pour fermer ou liquider une position — le statut seul laisserait des jetons au journal",
      })
      .optional(),
    /** Lève un conflit de double compte après revue humaine. */
    clearConflict: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucune modification demandée",
  });

/**
 * PATCH /api/crypto/defi/positions/[id]/flags
 *
 * Masquage, exclusion des agrégats, statut de cycle de vie, et lever d'un
 * conflit de déduplication.
 *
 * `isHidden` et `isIgnoredInPortfolio` sont volontairement deux drapeaux et non
 * un seul : masquer une ligne est cosmétique — elle continue de peser au
 * patrimoine — tandis que l'ignorer change les totaux. Les confondre ferait
 * disparaître de l'argent d'un clic destiné à ranger l'écran.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = flagsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  try {
    const position = await prisma.defiPositionDetail.findFirst({
      where: { id, asset: { is: { userId } } },
      select: { id: true },
    });
    if (!position) {
      return NextResponse.json({ error: "Position introuvable" }, { status: 404 });
    }

    await prisma.defiPositionDetail.update({
      where: { id },
      data: {
        ...(input.isHidden !== undefined ? { isHidden: input.isHidden } : {}),
        ...(input.isIgnoredInPortfolio !== undefined
          ? { isIgnoredInPortfolio: input.isIgnoredInPortfolio }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.clearConflict
          ? { conflictFlag: false, conflictReason: null }
          : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[crypto/defi/positions/[id]/flags PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
