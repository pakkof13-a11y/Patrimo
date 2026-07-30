import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { DefiInputError } from "@/app/lib/crypto/defi-manual-service";
import { overrideValuation } from "@/app/lib/crypto/defi-position-service";

export const dynamic = "force-dynamic";

const overrideSchema = z.object({
  grossValueEur: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d+)?$/, "Montant invalide")
    .transform((v) => v.replace(",", ".")),
  /** Pourquoi le marché ne suffit pas — vault opaque, jeton non coté… */
  reason: z.string().trim().max(500).optional().nullable(),
  valuationDate: z.string().optional().nullable(),
});

/**
 * POST /api/crypto/defi/positions/[id]/valuation
 *
 * Pose une valorisation manuelle, qui **prévaut** sur toute autre méthode pour
 * cette position. Réservée aux cas où aucun marché ne donne le prix : part de
 * vault opaque, jeton de reçu non coté, produit CeFi dont la plateforme ne
 * publie qu'un solde.
 *
 * Écrit aussi un événement `MANUAL_OVERRIDE` : une valeur qui change sans trace
 * est indistinguable d'un bug de synchronisation, et c'est précisément le genre
 * d'écart qu'on cherche à pouvoir expliquer trois mois plus tard.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const position = await prisma.defiPositionDetail.findFirst({
      where: { id, asset: { is: { userId } } },
      select: { status: true },
    });
    if (!position) {
      return NextResponse.json({ error: "Position introuvable" }, { status: 404 });
    }
    // Valoriser une position fermée la ferait rentrer dans les agrégats alors
    // qu'elle n'a plus d'exposition — exactement le gonflement de patrimoine
    // que les règles du module interdisent.
    if (position.status === "CLOSED" || position.status === "LIQUIDATED") {
      return NextResponse.json(
        {
          error: `Position ${position.status.toLowerCase()} — elle n'a plus d'exposition à valoriser`,
        },
        { status: 400 }
      );
    }

    const snapshot = await overrideValuation(userId, id, parsed.data.grossValueEur, {
      reason: parsed.data.reason,
      valuationDate: parsed.data.valuationDate,
    });
    return NextResponse.json(snapshot, { status: 201 });
  } catch (e) {
    if (e instanceof DefiInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/positions/[id]/valuation POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Valorisation manuelle impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

/**
 * DELETE — retire la valorisation manuelle et rend la position au calcul
 * automatique.
 *
 * Les snapshots sont conservés mais démarqués : effacer l'historique
 * rendrait inexplicable la valeur affichée pendant la période concernée.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const position = await prisma.defiPositionDetail.findFirst({
      where: { id, asset: { is: { userId } } },
      select: { id: true },
    });
    if (!position) {
      return NextResponse.json({ error: "Position introuvable" }, { status: 404 });
    }

    const { count } = await prisma.defiValuation.updateMany({
      where: { defiPositionId: id, isManual: true },
      data: { isManual: false, fallbackReason: "Valorisation manuelle retirée" },
    });

    return NextResponse.json({ cleared: count });
  } catch (e) {
    console.error("[crypto/defi/positions/[id]/valuation DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Retrait de la valorisation impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
