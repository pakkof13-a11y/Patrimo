import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { ZERION_CHAINS } from "@/app/lib/zerion/chains";

const ZERION_PRESET_KEYS = ZERION_CHAINS.map((c) => c.presetKey);

function maskApiKey(key: string | null | undefined): string | null {
  const trimmed = (key || "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 2)}…${trimmed.slice(-4)}`;
}

/**
 * GET /api/platforms/blockchain-defaults
 * Pré-remplissage adresse/clé API entre blockchains déjà configurées
 * (utilisateur courant uniquement — jamais loggé).
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const [evmPlatform, solanaPlatform] = await Promise.all([
    prisma.platform.findFirst({
      where: {
        userId,
        type: "BLOCKCHAIN",
        logoKey: { in: ZERION_PRESET_KEYS },
        walletAddress: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { walletAddress: true, walletApiKey: true },
    }),
    prisma.platform.findFirst({
      where: {
        userId,
        type: "BLOCKCHAIN",
        logoKey: "SOLANA",
        walletApiKey: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { walletApiKey: true },
    }),
  ]);

  const evmAddress = evmPlatform?.walletAddress?.trim() || null;
  const evmApiKey = evmPlatform?.walletApiKey?.trim() || null;
  const solanaApiKey = solanaPlatform?.walletApiKey?.trim() || null;

  return NextResponse.json({
    evmAddress,
    evmApiKey,
    evmApiKeyMasked: maskApiKey(evmApiKey),
    solanaApiKey,
    solanaApiKeyMasked: maskApiKey(solanaApiKey),
  });
}
