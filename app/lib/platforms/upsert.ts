/**
 * Création / résolution de plateformes — race-safe (upsert logique).
 * Aucune migration Prisma : s’appuie sur @@unique([userId, name]) + relecture.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { findPreset, primaryType } from "@/app/lib/platforms/presets";

export type UpsertPlatformInput = {
  name: string;
  type?: string | null;
  subtype?: string | null;
  logoKey?: string | null;
  logoUrl?: string | null;
  walletAddress?: string | null;
  walletApiKey?: string | null;
  notes?: string | null;
};

export type UpsertPlatformResult = {
  platform: {
    id: string;
    userId: string;
    name: string;
    type: string;
    subtype: string | null;
    logoKey: string | null;
    logoUrl: string | null;
    walletAddress: string | null;
    walletApiKey?: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  created: boolean;
};

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Trouve une plateforme par nom (insensible à la casse) ou la crée.
 * Concurrent create → P2002 → relecture (jamais d’échec « déjà existe » côté appelant).
 */
export async function findOrCreatePlatform(
  userId: string,
  input: UpsertPlatformInput
): Promise<UpsertPlatformResult> {
  const name = normalizeName(input.name || "");
  if (name.length < 2) {
    throw new Error("Nom de plateforme trop court");
  }

  const walletIn =
    input.walletAddress != null && String(input.walletAddress).trim().length > 0
      ? String(input.walletAddress).trim()
      : null;
  const apiKeyIn =
    input.walletApiKey != null && String(input.walletApiKey).trim().length > 0
      ? String(input.walletApiKey).trim()
      : null;

  const existing = await prisma.platform.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    // Enrichissement soft : logos manquants + wallet si fourni (critique pour blockchain)
    const patch: Prisma.PlatformUpdateInput = {};
    if (!existing.logoUrl && input.logoUrl) {
      patch.logoUrl = input.logoUrl;
    }
    if (!existing.logoKey && input.logoKey) {
      patch.logoKey = input.logoKey;
    }
    // Persiste / met à jour walletAddress quand l’appelant en envoie une
    // (sinon une plateforme seed « Solana (SOL) » restait sans adresse → synchro KO)
    if (walletIn != null && existing.walletAddress !== walletIn) {
      patch.walletAddress = walletIn;
    }
    if (
      apiKeyIn != null &&
      (existing as { walletApiKey?: string | null }).walletApiKey !== apiKeyIn
    ) {
      (patch as Record<string, unknown>).walletApiKey = apiKeyIn;
    }
    // Type BLOCKCHAIN si fourni et plateforme encore générique
    if (
      input.type === "BLOCKCHAIN" &&
      existing.type !== "BLOCKCHAIN"
    ) {
      patch.type = "BLOCKCHAIN";
    }
    if (input.subtype && !existing.subtype) {
      patch.subtype = input.subtype;
    }
    if (Object.keys(patch).length > 0) {
      const updated = await prisma.platform.update({
        where: { id: existing.id },
        data: patch,
      });
      return { platform: updated, created: false };
    }
    return { platform: existing, created: false };
  }

  const preset =
    (input.logoKey ? findPreset(input.logoKey) : undefined) || findPreset(name);

  const data = {
    userId,
    name,
    type: input.type || (preset ? primaryType(preset) : "AUTRE"),
    subtype: input.subtype || preset?.subtype || null,
    logoKey: input.logoKey || preset?.key || null,
    logoUrl: input.logoUrl || preset?.logoUrl || null,
    walletAddress: walletIn,
    walletApiKey: apiKeyIn,
    notes: input.notes ?? null,
  };

  try {
    const platform = await prisma.platform.create({
      data: data as never,
    });
    return { platform, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.platform.findFirst({
        where: { userId, name: { equals: name, mode: "insensitive" } },
      });
      if (again) return { platform: again, created: false };
    }
    throw e;
  }
}

/**
 * Fusionne `sourceId` → `targetId` (même user).
 * Déplace actifs + transactions, puis supprime la source.
 */
export async function mergePlatforms(
  userId: string,
  sourceId: string,
  targetId: string
): Promise<{
  assetsMoved: number;
  transactionsMoved: number;
  deletedSourceId: string;
}> {
  if (sourceId === targetId) {
    throw new Error("Impossible de fusionner une plateforme avec elle-même");
  }

  const [source, target] = await Promise.all([
    prisma.platform.findFirst({ where: { id: sourceId, userId } }),
    prisma.platform.findFirst({ where: { id: targetId, userId } }),
  ]);
  if (!source) throw new Error("Plateforme source introuvable");
  if (!target) throw new Error("Plateforme cible introuvable");

  const result = await prisma.$transaction(async (tx) => {
    const assets = await tx.asset.updateMany({
      where: { userId, platformId: sourceId },
      data: { platformId: targetId },
    });
    const txsFrom = await tx.transaction.updateMany({
      where: { userId, platformId: sourceId },
      data: { platformId: targetId },
    });
    const txsTo = await tx.transaction.updateMany({
      where: { userId, toPlatformId: sourceId },
      data: { toPlatformId: targetId },
    });
    await tx.platform.delete({ where: { id: sourceId } });
    return {
      assetsMoved: assets.count,
      transactionsMoved: txsFrom.count + txsTo.count,
      deletedSourceId: sourceId,
    };
  });

  return result;
}
