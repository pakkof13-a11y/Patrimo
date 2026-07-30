import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { getNftPortfolio } from "@/app/lib/crypto/nft-portfolio-service";
import { NftInputError } from "@/app/lib/crypto/nft-position-service";
import { NFT_HOLDING_ACCESS_MODES, NFT_CUSTODY_MODELS } from "@/app/lib/crypto/nft-taxonomy";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

/**
 * GET /api/crypto/nft/positions/[assetId]
 *
 * Détail d'une détention, enrichi exactement comme dans la vue portefeuille —
 * passer par `getNftPortfolio` plutôt que de requêter la détention seule
 * évite deux chemins de valorisation divergents (même raisonnement que
 * `defi/positions/[id]`, F1).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { assetId } = await ctx.params;

  try {
    const bundle = await getNftPortfolio(userId, { includeInactive: true });
    const holding = bundle.holdings.find((h) => h.assetId === assetId);
    if (!holding) {
      return NextResponse.json({ error: "NFT introuvable" }, { status: 404 });
    }

    const events = await prisma.nftEvent.findMany({
      where: { nftAssetId: holding.nftAssetId },
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    const valuations = await prisma.nftValuation.findMany({
      where: { nftAssetId: holding.nftAssetId },
      orderBy: { valuationDate: "desc" },
      take: 60,
    });
    const traits = await prisma.nftTrait.findMany({
      where: { nftAssetId: holding.nftAssetId },
      orderBy: { traitType: "asc" },
    });

    return NextResponse.json({
      position: holding,
      conflicts: bundle.conflicts.filter(
        (c) => c.duplicateId === holding.holdingId || c.keepId === holding.holdingId
      ),
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        eventDate: e.eventDate.toISOString(),
        chainId: e.chainId,
        txHash: e.txHash,
        fromAddress: e.fromAddress,
        toAddress: e.toAddress,
        marketplace: e.marketplace,
        quantity: e.quantity?.toString() ?? null,
        priceEur: e.priceEur?.toString() ?? null,
        feesEur: e.feesEur?.toString() ?? null,
        royaltyEur: e.royaltyEur?.toString() ?? null,
        ledgerTransactionId: e.ledgerTransactionId,
        sourceProvider: e.sourceProvider,
      })),
      valuations: valuations.map((v) => ({
        id: v.id,
        valuationDate: v.valuationDate.toISOString(),
        valuationMethod: v.valuationMethod,
        sourceProvider: v.sourceProvider,
        amountEur: v.amountEur?.toString() ?? null,
        floorPriceEur: v.floorPriceEur?.toString() ?? null,
        lastSaleEur: v.lastSaleEur?.toString() ?? null,
        appraisedValueEur: v.appraisedValueEur?.toString() ?? null,
        confidenceScore: v.confidenceScore,
        isManual: v.isManual,
        fallbackReason: v.fallbackReason,
      })),
      traits: traits.map((t) => ({ traitType: t.traitType, value: t.value, rarityPct: t.rarityPct?.toString() ?? null })),
    });
  } catch (e) {
    console.error("[crypto/nft/positions/[assetId] GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Chargement du NFT impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

const updateSchema = z.object({
  accessMode: z.enum(Object.keys(NFT_HOLDING_ACCESS_MODES) as [string, ...string[]]).optional(),
  custodyModel: z.enum(Object.keys(NFT_CUSTODY_MODELS) as [string, ...string[]]).optional(),
  ownerLabel: z.string().trim().max(120).nullable().optional(),
  ownershipShare: decimalString.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/**
 * PUT /api/crypto/nft/positions/[assetId]
 *
 * Met à jour le contexte de détention. N'écrit jamais la quantité, le nom,
 * l'image ou l'identité technique : ce sont des propriétés du journal
 * (`Asset`) ou de l'identité (`NftAsset`), pas de cette route.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ assetId: string }> }) {
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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Paramètres invalides",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }
  const input = parsed.data;

  if (input.ownershipShare != null) {
    const pct = Number(input.ownershipShare);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return NextResponse.json(
        { error: "La quote-part doit être comprise dans ]0 ; 100]" },
        { status: 400 }
      );
    }
  }

  try {
    const existing = await prisma.nftItemDetail.findFirst({
      where: { assetId, asset: { is: { userId } } },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "NFT introuvable" }, { status: 404 });
    }

    await prisma.nftItemDetail.update({
      where: { id: existing.id },
      data: {
        ...(input.accessMode !== undefined ? { accessMode: input.accessMode } : {}),
        ...(input.custodyModel !== undefined ? { custodyModel: input.custodyModel } : {}),
        ...(input.ownerLabel !== undefined ? { ownerLabel: input.ownerLabel?.trim() || null } : {}),
        ...(input.ownershipShare !== undefined ? { ownershipShare: input.ownershipShare } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NftInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/nft/positions/[assetId] PUT]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
