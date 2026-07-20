import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { listOnchainTxsForPlatform } from "@/app/lib/market/solana-onchain-to-ledger";

/**
 * GET /api/wallets/solana/transactions?platformId=…&limit=50
 * Historique on-chain stocké (RPC) pour une plateforme.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const platformId = (searchParams.get("platformId") || "").trim();
  const limitRaw = Number(searchParams.get("limit") || "50");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(100, Math.max(1, Math.floor(limitRaw)))
    : 50;

  if (!platformId) {
    return NextResponse.json(
      { error: "platformId requis" },
      { status: 400 }
    );
  }

  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
    select: { id: true, name: true, walletAddress: true },
  });
  if (!platform) {
    return NextResponse.json(
      { error: "Plateforme introuvable" },
      { status: 404 }
    );
  }

  const transactions = await listOnchainTxsForPlatform(
    userId,
    platformId,
    limit
  );

  return NextResponse.json({
    platformId: platform.id,
    platformName: platform.name,
    walletAddress: platform.walletAddress,
    count: transactions.length,
    transactions,
  });
}
