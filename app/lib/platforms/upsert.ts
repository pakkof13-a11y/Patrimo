/**
 * Création / résolution de plateformes — race-safe (upsert logique).
 * Aucune migration Prisma : s’appuie sur @@unique([userId, name]) + relecture.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
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

  const data: Prisma.PlatformCreateInput = {
    user: { connect: { id: userId } },
    name,
    type: input.type || (preset ? primaryType(preset) : "AUTRE"),
    subtype: input.subtype || preset?.subtype || null,
    logoKey: input.logoKey || preset?.key || null,
    logoUrl: input.logoUrl || preset?.logoUrl || null,
    walletAddress: walletIn,
    notes: input.notes ?? null,
  };
  // walletApiKey : colonne optionnelle (migration 20260720120000)
  if (apiKeyIn != null) {
    (data as { walletApiKey?: string | null }).walletApiKey = apiKeyIn;
  }

  try {
    const platform = await prisma.platform.create({
      data,
    });
    return { platform, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.platform.findFirst({
        where: { userId, name: { equals: name, mode: "insensitive" } },
      });
      if (again) return { platform: again, created: false };
    }
    // Schéma cloud en retard (colonne walletApiKey absente) : retry sans clé
    const msg = e instanceof Error ? e.message : String(e);
    if (
      apiKeyIn != null &&
      /walletApiKey|column .* does not exist/i.test(msg)
    ) {
      console.warn(
        "[findOrCreatePlatform] retry without walletApiKey — run prisma migrate deploy"
      );
      const { walletApiKey: _k, ...rest } = data as typeof data & {
        walletApiKey?: string | null;
      };
      void _k;
      const platform = await prisma.platform.create({
        data: rest as Prisma.PlatformCreateInput,
      });
      return { platform, created: true };
    }
    throw e;
  }
}

/**
 * Fusionne `sourceId` → `targetId` (même user).
 * Déplace actifs + transactions + comptes-titres, puis supprime la source.
 *
 * Ce que cette fonction NE déplace PAS (documenté, pas oublié) :
 * `DefiSyncCursor` / `NftSyncCursor` — leur `scopeKey` est dérivé de
 * `platformId` (cf. schema.prisma) : les réassigner exigerait de recalculer
 * cette clé ET de choisir quel curseur gagne si la cible en a déjà un pour le
 * même provider (contrainte `@@unique([userId, provider, scopeKey])`). C'est
 * une décision de synchro, pas de fusion — hors périmètre de ce lot.
 * `BlockchainOnchainTx` — `@@unique([platformId, signature])` : un déplacement
 * aveugle peut heurter cette contrainte si la même signature existe déjà sous
 * la cible (ex. wallet importé deux fois). Ces trois modèles restent en
 * Cascade sur `Platform` : ils sont supprimés avec la source (perte de
 * métadonnées de synchro/historique on-chain, pas de données patrimoniales
 * utilisateur — Asset/Transaction/SecuritiesAccount, elles, sont préservées).
 * Qui doit trancher une politique de fusion pour ces deux modèles :
 * connectors-exchanges (curseurs de synchro) / crypto-onchain (historique on-chain).
 */
export async function mergePlatforms(
  userId: string,
  sourceId: string,
  targetId: string
): Promise<{
  assetsMoved: number;
  transactionsMoved: number;
  securitiesAccountsMoved: number;
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

  // JOU-01 : un TRANSFERT_CASH / TRANSFERT_TITRE déjà présent entre A et B
  // (peu importe le sens) se retrouverait, une fois la fusion faite, avec
  // platformId === toPlatformId === targetId. Le moteur de rejeu
  // (app/lib/accounting/ledger.ts) refuse ce cas via `AccountingError
  // "SAME_PLATFORM"` pour ces deux types — la fusion casserait alors tout
  // rejeu du journal de l'utilisateur (dashboard, positions, futures
  // écritures). Option la moins destructive : refuser la fusion et nommer les
  // transactions en cause, plutôt que les supprimer ou les réinterpréter
  // silencieusement (aucune règle métier existante ne dit ce que devient un
  // « transfert vers soi-même »).
  const intraMergeTransfers = await prisma.transaction.findMany({
    where: {
      userId,
      type: { in: ["TRANSFERT_CASH", "TRANSFERT_TITRE"] },
      OR: [
        { platformId: sourceId, toPlatformId: targetId },
        { platformId: targetId, toPlatformId: sourceId },
      ],
    },
    select: { id: true, type: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
    take: 20,
  });
  if (intraMergeTransfers.length > 0) {
    const names = intraMergeTransfers
      .map(
        (t) =>
          `${t.type} du ${t.occurredAt.toISOString().slice(0, 10)} (#${t.id})`
      )
      .join(", ");
    throw new Error(
      `Fusion impossible : ${intraMergeTransfers.length} transfert(s) existent déjà entre ces deux plateformes et deviendraient invalides après fusion — supprimez ou modifiez d'abord : ${names}`
    );
  }

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
    // PRI-01/PLA-03 : SecuritiesAccount.platformId est en onDelete: Restrict —
    // sans ce déplacement, platform.delete(source) échoue en P2003 dès qu'un
    // PEA/PEA_PME/CTO est rattaché à la plateforme source.
    const securitiesAccounts = await tx.securitiesAccount.updateMany({
      where: { userId, platformId: sourceId },
      data: { platformId: targetId },
    });
    await tx.platform.delete({ where: { id: sourceId } });
    return {
      assetsMoved: assets.count,
      transactionsMoved: txsFrom.count + txsTo.count,
      securitiesAccountsMoved: securitiesAccounts.count,
      deletedSourceId: sourceId,
    };
  });

  return result;
}
