import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { NFT_EVENT_TYPES } from "@/app/lib/crypto/nft-taxonomy";

export const dynamic = "force-dynamic";

/** GET — journal d'événements d'un NFT (identité, pas seulement cette détention). */
export async function GET(req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { assetId } = await ctx.params;
  const url = new URL(req.url);
  const eventType = url.searchParams.get("eventType");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 200;

  if (eventType && !(Object.keys(NFT_EVENT_TYPES) as readonly string[]).includes(eventType)) {
    return NextResponse.json({ error: "Type d'événement inconnu" }, { status: 400 });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return NextResponse.json({ error: "Limite invalide" }, { status: 400 });
  }

  try {
    const holding = await prisma.nftItemDetail.findFirst({
      where: { assetId, asset: { is: { userId } } },
      select: { nftAssetId: true },
    });
    if (!holding) {
      return NextResponse.json({ error: "NFT introuvable" }, { status: 404 });
    }

    const events = await prisma.nftEvent.findMany({
      where: { nftAssetId: holding.nftAssetId, ...(eventType ? { eventType } : {}) },
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return NextResponse.json({
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
        bundleId: e.bundleId,
        ledgerTransactionId: e.ledgerTransactionId,
        sourceProvider: e.sourceProvider,
      })),
    });
  } catch (e) {
    console.error("[crypto/nft/positions/[assetId]/events GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Chargement des événements impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
