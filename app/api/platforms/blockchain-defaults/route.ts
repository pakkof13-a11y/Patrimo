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
 *
 * Pré-remplissage de l'adresse publique entre blockchains déjà configurées.
 *
 * ## Ce que cette route ne renvoie pas
 *
 * **Aucune clé API en clair.** Elle en renvoyait deux — `evmApiKey` et
 * `solanaApiKey` — à côté de leurs versions masquées, dans le même objet. Le
 * navigateur recevait donc un secret que le serveur possède déjà, dans le seul
 * but d'éviter une ressaisie.
 *
 * `/api/platforms` applique depuis toujours la bonne politique : la clé ne
 * quitte pas le serveur, seule sa présence est exposée. Deux routes, une seule
 * politique désormais.
 *
 * La version masquée reste renvoyée, mais comme **indice d'affichage** : elle
 * contient un caractère de suspension, et `resolveZerionApiKey` rejette
 * explicitement toute valeur en contenant un. Elle ne peut donc jamais être
 * confondue avec une clé utilisable, même si elle était renvoyée au serveur.
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

  /*
    Les clés sont lues pour être masquées, puis abandonnées. Elles ne sont
    liées à aucune variable exposée : la seule chose qui sort de cette fonction
    est un masque et un booléen.
  */
  const evmApiKeyMasked = maskApiKey(evmPlatform?.walletApiKey);
  const solanaApiKeyMasked = maskApiKey(solanaPlatform?.walletApiKey);

  return NextResponse.json({
    evmAddress,
    /** Indice d'affichage — jamais une valeur soumettable. */
    evmApiKeyMasked,
    solanaApiKeyMasked,
    /** Même convention que `hasWalletApiKey` sur `/api/platforms`. */
    hasEvmApiKey: evmApiKeyMasked != null,
    hasSolanaApiKey: solanaApiKeyMasked != null,
  });
}
