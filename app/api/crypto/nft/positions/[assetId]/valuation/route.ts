import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { overrideNftValuation, NftInputError } from "@/app/lib/crypto/nft-position-service";

export const dynamic = "force-dynamic";

const overrideSchema = z.object({
  amountEur: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d+)?$/, "Montant invalide")
    .transform((v) => v.replace(",", ".")),
  /** Pourquoi le marché ne suffit pas — collection sans floor, pièce unique… */
  reason: z.string().trim().max(500).optional().nullable(),
  valuationDate: z.string().optional().nullable(),
});

/**
 * POST /api/crypto/nft/positions/[assetId]/valuation
 *
 * Pose une expertise manuelle (`APPRAISAL`), qui **prévaut** sur toute autre
 * méthode — y compris sur un spam confirmé (D9 de `docs/nft-backend-v1.md`) :
 * une surcharge explicite de l'utilisateur n'est jamais écrasée
 * silencieusement.
 */
export async function POST(req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { assetId } = await ctx.params;

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
    const snapshot = await overrideNftValuation(userId, assetId, parsed.data.amountEur, {
      reason: parsed.data.reason,
      valuationDate: parsed.data.valuationDate,
    });
    return NextResponse.json(snapshot, { status: 201 });
  } catch (e) {
    if (e instanceof NftInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/nft/positions/[assetId]/valuation POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Valorisation manuelle impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

/**
 * DELETE — retire la valorisation manuelle et rend le NFT au calcul
 * automatique (floor / dernière vente / repli sur le coût d'acquisition,
 * selon `chooseNftValuation`).
 *
 * Les snapshots sont conservés mais démarqués : effacer l'historique
 * rendrait inexplicable la valeur affichée pendant la période concernée.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { assetId } = await ctx.params;

  try {
    const holding = await prisma.nftItemDetail.findFirst({
      where: { assetId, asset: { is: { userId } } },
      select: { nftAssetId: true },
    });
    if (!holding) {
      return NextResponse.json({ error: "NFT introuvable" }, { status: 404 });
    }

    const { count } = await prisma.nftValuation.updateMany({
      where: { nftAssetId: holding.nftAssetId, isManual: true },
      data: { isManual: false, fallbackReason: "Valorisation manuelle retirée" },
    });

    return NextResponse.json({ cleared: count });
  } catch (e) {
    console.error("[crypto/nft/positions/[assetId]/valuation DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Retrait de la valorisation impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
