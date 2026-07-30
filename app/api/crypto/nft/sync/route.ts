import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { syncNftsFromWallet } from "@/app/lib/crypto/nft-wallet-sync";
import { NFT_CHAINS } from "@/app/lib/crypto/nft-constants";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({
  platformId: z.string().min(1),
  chain: z.enum(Object.keys(NFT_CHAINS) as [string, ...string[]]),
});

/**
 * POST /api/crypto/nft/sync
 *
 * Découvre les NFT détenus par l'adresse d'une plateforme wallet. Tant
 * qu'aucune clé (OpenSea, Magic Eden) n'est configurée, répond 200 avec
 * `fetched.reason: "not-configured"` — ce n'est pas un échec serveur, c'est
 * l'état attendu avant intégration des clés.
 */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  const platform = await prisma.platform.findFirst({
    where: { id: parsed.data.platformId, userId },
    select: { id: true, walletAddress: true },
  });
  if (!platform) {
    return NextResponse.json({ error: "Plateforme introuvable" }, { status: 404 });
  }
  const address = (platform.walletAddress || "").trim();
  if (!address) {
    return NextResponse.json(
      { error: "Adresse wallet manquante sur cette plateforme", code: "NO_WALLET" },
      { status: 400 }
    );
  }

  try {
    const result = await syncNftsFromWallet(userId, platform.id, address, parsed.data.chain);
    return NextResponse.json({
      ok: result.fetched.ok,
      reason: result.fetched.ok ? null : result.fetched.reason,
      itemsFound: result.fetched.ok ? result.fetched.items.length : 0,
      assetsCreated: result.assetsCreated,
      assetsExisting: result.assetsExisting,
      reappeared: result.reappeared,
      missingFlagged: result.missingFlagged,
      completed: result.completed,
    });
  } catch (e) {
    console.error("[crypto/nft/sync POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Synchronisation impossible") },
      { status: 500 }
    );
  }
}
