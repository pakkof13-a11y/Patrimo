/**
 * Services Prisma du backend NFT — identité, collection, événements,
 * valorisation, curseurs de synchronisation.
 *
 * Miroir de `defi-position-service.ts` (chantier F1) adapté à la séparation
 * identité/holding du chantier NFT (D1 de `docs/nft-backend-v1.md`) : les
 * fonctions ci-dessous touchent `NftAsset`/`NftCollection` (identité) et
 * `NftItemDetail` (détention), jamais l'inverse.
 */

import type Decimal from "decimal.js";
import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { buildNftIdentity, collectionDedupKey, normalizeChainId, normalizeEvmAddress } from "./nft-identity";
import type { NftValuationInputs } from "./nft-valuation";
import { defaultNftValuationConfidence } from "./nft-taxonomy";

export class NftInputError extends Error {
  readonly code = "NFT_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "NftInputError";
  }
}

type Db = Prisma.TransactionClient | typeof prisma;
function db(tx?: Db): Db {
  return tx ?? prisma;
}

function money(v: Decimal | string | null | undefined): string | null {
  if (v == null) return null;
  const n = typeof v === "string" ? d(v) : v;
  return n.isFinite() ? n.toFixed(2) : null;
}

// ─────────────────────────────── Collection / identité ───────────────────────────────

export type EnsureCollectionInput = {
  chainId: string;
  contractAddress?: string | null;
  slug?: string | null;
  name?: string | null;
  symbol?: string | null;
  standard?: string | null;
};

/**
 * Trouve ou crée la fiche de collection. `null` sans identité exploitable
 * (ni contrat, ni slug) — le cas "sans collection" (cas 7 du cahier des
 * charges) reste légitime, un `NftAsset` peut avoir `collectionId = null`.
 */
export async function ensureNftCollection(
  userId: string,
  input: EnsureCollectionInput,
  tx?: Db
): Promise<{ id: string } | null> {
  const dedupKey = collectionDedupKey({
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    slug: input.slug,
  });
  if (!dedupKey) return null;

  const client = db(tx);
  const chainId = normalizeChainId(input.chainId);
  const contractAddress = normalizeEvmAddress(input.contractAddress);
  const slug = input.slug?.trim().toLowerCase() || null;

  const existing = await client.nftCollection.findFirst({
    where: { userId, chainId, ...(contractAddress ? { contractAddress } : { slug }) },
    select: { id: true },
  });
  if (existing) return existing;

  const created = await client.nftCollection.create({
    data: {
      userId,
      chainId,
      contractAddress,
      slug,
      name: input.name?.trim() || slug || contractAddress || "Collection inconnue",
      symbol: input.symbol?.trim() || null,
      standard: input.standard || null,
    },
    select: { id: true },
  });
  return created;
}

export type EnsureNftAssetInput = {
  standard: string;
  chainId: string;
  contractAddress?: string | null;
  tokenId?: string | null;
  mintAddress?: string | null;
  collectionId?: string | null;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  animationUrl?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  metadataUrl?: string | null;
  externalUrl?: string | null;
  rawMetadataJson?: unknown;
  metadataQuality?: string;
  contentType?: string | null;
  isWrapped?: boolean;
  isBridged?: boolean;
  isCompressed?: boolean;
  isSoulbound?: boolean;
  isSpam?: boolean;
  isScamSuspected?: boolean;
  isSensitiveMedia?: boolean;
  category?: string;
  rarityRank?: number | null;
  rarityScore?: Decimal | string | null;
};

/**
 * Trouve ou crée l'identité technique d'un NFT. `fallbackKey` sert de repli
 * déterministe quand ni contrat ni mint ne sont connus (saisie manuelle
 * incomplète) — typiquement l'id de l'`Asset` en cours de création.
 */
export async function ensureNftAsset(
  userId: string,
  input: EnsureNftAssetInput,
  fallbackKey: string,
  tx?: Db
): Promise<{ id: string; created: boolean }> {
  const identity = buildNftIdentity(input, fallbackKey);
  const client = db(tx);

  const existing = await client.nftAsset.findUnique({
    where: { userId_uniqueKey: { userId, uniqueKey: identity.uniqueKey } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await client.nftAsset.create({
    data: {
      userId,
      chainId: identity.chainId,
      standard: identity.standard,
      contractAddress: identity.contractAddress,
      tokenId: identity.tokenId,
      mintAddress: identity.mintAddress,
      uniqueKey: identity.uniqueKey,
      collectionId: input.collectionId ?? null,
      name: input.name?.trim() || null,
      description: input.description?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      animationUrl: input.animationUrl?.trim() || null,
      mediaUrl: input.mediaUrl?.trim() || null,
      thumbnailUrl: input.thumbnailUrl?.trim() || null,
      metadataUrl: input.metadataUrl?.trim() || null,
      externalUrl: input.externalUrl?.trim() || null,
      rawMetadataJson: (input.rawMetadataJson ?? undefined) as never,
      metadataQuality: input.metadataQuality || "UNKNOWN",
      contentType: input.contentType || null,
      isWrapped: input.isWrapped ?? false,
      isBridged: input.isBridged ?? false,
      isCompressed: input.isCompressed ?? false,
      isSoulbound: input.isSoulbound ?? false,
      isSpam: input.isSpam ?? false,
      isScamSuspected: input.isScamSuspected ?? false,
      isSensitiveMedia: input.isSensitiveMedia ?? false,
      category: input.category || "UNKNOWN",
      rarityRank: input.rarityRank ?? null,
      rarityScore: input.rarityScore ? money(input.rarityScore) : null,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

// ─────────────────────────────── Événements ───────────────────────────────

export type RecordNftEventInput = {
  eventType: string;
  eventDate: Date | string;
  nftHoldingId?: string | null;
  chainId?: string | null;
  txHash?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  marketplace?: string | null;
  platformId?: string | null;
  quantity?: string | null;
  priceNative?: string | null;
  priceCurrency?: string | null;
  priceEur?: string | null;
  feesNative?: string | null;
  feesCurrency?: string | null;
  feesEur?: string | null;
  royaltyNative?: string | null;
  royaltyCurrency?: string | null;
  royaltyEur?: string | null;
  bundleId?: string | null;
  ledgerTransactionId?: string | null;
  sourceProvider?: string;
  rawPayload?: unknown;
};

/**
 * Enregistre un événement. `null` silencieux sur un doublon exact (même
 * `nftAssetId`/`txHash`/`eventType`) — une re-synchronisation doit pouvoir
 * rejouer les mêmes événements sans échouer ni les empiler.
 */
export async function recordNftEvent(
  nftAssetId: string,
  input: RecordNftEventInput,
  tx?: Db
): Promise<{ id: string } | null> {
  const client = db(tx);
  const eventDate = input.eventDate instanceof Date ? input.eventDate : new Date(input.eventDate);
  if (Number.isNaN(eventDate.getTime())) {
    throw new NftInputError("Date d'événement invalide");
  }

  try {
    const row = await client.nftEvent.create({
      data: {
        nftAssetId,
        nftHoldingId: input.nftHoldingId ?? null,
        eventType: input.eventType,
        eventDate,
        chainId: input.chainId ?? null,
        txHash: input.txHash ?? null,
        fromAddress: input.fromAddress ?? null,
        toAddress: input.toAddress ?? null,
        marketplace: input.marketplace ?? null,
        platformId: input.platformId ?? null,
        quantity: input.quantity ?? null,
        priceNative: input.priceNative ?? null,
        priceCurrency: input.priceCurrency ?? null,
        priceEur: money(input.priceEur),
        feesNative: input.feesNative ?? null,
        feesCurrency: input.feesCurrency ?? null,
        feesEur: money(input.feesEur),
        royaltyNative: input.royaltyNative ?? null,
        royaltyCurrency: input.royaltyCurrency ?? null,
        royaltyEur: money(input.royaltyEur),
        bundleId: input.bundleId ?? null,
        ledgerTransactionId: input.ledgerTransactionId ?? null,
        sourceProvider: input.sourceProvider || "MANUAL",
        rawPayloadJson: (input.rawPayload ?? undefined) as never,
      },
      select: { id: true },
    });
    return row;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return null;
    }
    throw e;
  }
}

export async function listNftEvents(nftAssetId: string, tx?: Db) {
  const client = db(tx);
  return client.nftEvent.findMany({
    where: { nftAssetId },
    orderBy: { eventDate: "desc" },
  });
}

// ─────────────────────────────── Valorisation ───────────────────────────────

export type ValuationSnapshotInput = NftValuationInputs & {
  valuationDate?: Date | string;
  currency?: string;
};

/**
 * Décide et enregistre la valorisation d'un NFT — écrit le snapshot
 * `NftValuation` (historique décisionnel) puis met à jour le cache
 * dénormalisé `NftItemDetail.retainedValue*` et `Asset.manualPrice` (D4 de
 * la note de décision : ce sont les deux seuls "lecteurs" légitimes de la
 * valeur, jamais une vérité indépendante).
 *
 * `holdingAssetId` est l'`Asset.id` de la détention (pas le `NftAsset.id`) :
 * c'est lui qui pilote `getAssetValues()`.
 */
export async function applyNftValuation(
  nftAssetId: string,
  holdingId: string,
  holdingAssetId: string,
  ownershipShare: Decimal,
  choice: {
    method: string;
    amountEur: Decimal | null;
    confidenceScore: number;
    fallbackReason: string | null;
  },
  opts?: {
    valuationDate?: Date | string;
    sourceProvider?: string;
    isManual?: boolean;
    floorPriceEur?: Decimal | null;
    lastSaleEur?: Decimal | null;
    appraisedValueEur?: Decimal | null;
    rawPayload?: unknown;
  },
  tx?: Db
): Promise<{ id: string }> {
  const client = db(tx);
  const valuationDate = opts?.valuationDate
    ? opts.valuationDate instanceof Date
      ? opts.valuationDate
      : new Date(opts.valuationDate)
    : new Date();
  if (Number.isNaN(valuationDate.getTime())) {
    throw new NftInputError("Date de valorisation invalide");
  }

  const payload = {
    valuationMethod: choice.method,
    sourceProvider: opts?.sourceProvider || "MANUAL",
    currency: "EUR",
    amountNative: null,
    amountEur: money(choice.amountEur),
    floorPriceEur: money(opts?.floorPriceEur),
    lastSaleEur: money(opts?.lastSaleEur),
    appraisedValueEur: money(opts?.appraisedValueEur),
    confidenceScore: choice.confidenceScore,
    isManual: opts?.isManual ?? false,
    fallbackReason: choice.fallbackReason,
    rawPayloadJson: (opts?.rawPayload ?? undefined) as never,
  };

  const snapshot = await client.nftValuation.upsert({
    where: { nftAssetId_valuationDate: { nftAssetId, valuationDate } },
    create: { nftAssetId, nftHoldingId: holdingId, valuationDate, ...payload },
    update: payload,
    select: { id: true },
  });

  const retainedEur = choice.amountEur ? choice.amountEur.times(ownershipShare) : null;

  await client.nftItemDetail.update({
    where: { id: holdingId },
    data: {
      retainedValueEur: money(retainedEur),
      retainedValueMethod: choice.method,
      retainedValueUpdatedAt: valuationDate,
    },
  });

  // Pilote la valeur réellement affichée via `getAssetValues()` — jamais un
  // champ concurrent : c'est la même convention déjà en place avant ce
  // chantier (`nft-estimate-service.ts`, `nft-manual-service.ts`).
  if (retainedEur != null) {
    await client.asset.update({
      where: { id: holdingAssetId },
      data: { manualPrice: retainedEur.toFixed(12) },
    });
  }

  return snapshot;
}

/** Dernier snapshot manuel actif d'un NFT, s'il y en a un. */
export async function latestManualNftValuation(nftAssetId: string, tx?: Db) {
  const client = db(tx);
  return client.nftValuation.findFirst({
    where: { nftAssetId, isManual: true },
    orderBy: { valuationDate: "desc" },
  });
}

/**
 * Pose une expertise manuelle (appraisal) — priorité absolue de
 * `chooseNftValuation`, y compris sur un spam confirmé (D9).
 */
export async function overrideNftValuation(
  userId: string,
  assetId: string,
  amountEur: string,
  opts?: { reason?: string | null; valuationDate?: string | null }
): Promise<{ id: string }> {
  const holding = await prisma.nftItemDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true, nftAssetId: true, ownershipShare: true },
  });
  if (!holding) throw new NftInputError("NFT introuvable");

  const amount = d(amountEur);
  if (!amount.isFinite() || amount.lt(0)) {
    throw new NftInputError("La valeur saisie ne peut pas être négative");
  }
  const share = holding.ownershipShare ? d(holding.ownershipShare.toString()).div(100) : d(1);
  const valuationDate = opts?.valuationDate ? new Date(opts.valuationDate) : new Date();

  return prisma.$transaction(async (tx) => {
    const snapshot = await applyNftValuation(
      holding.nftAssetId,
      holding.id,
      assetId,
      share,
      {
        method: "APPRAISAL",
        amountEur: amount,
        confidenceScore: defaultNftValuationConfidence("APPRAISAL"),
        fallbackReason: opts?.reason?.trim() || null,
      },
      { valuationDate, sourceProvider: "MANUAL", isManual: true, appraisedValueEur: amount },
      tx
    );

    await recordNftEvent(
      holding.nftAssetId,
      {
        eventType: "MANUAL_OVERRIDE",
        eventDate: valuationDate,
        nftHoldingId: holding.id,
        priceEur: amount.toFixed(2),
        sourceProvider: "MANUAL",
        rawPayload: opts?.reason ? { reason: opts.reason } : null,
      },
      tx
    );

    return snapshot;
  });
}

// ─────────────────────────────── Cycle de vie ───────────────────────────────

/**
 * Dénoue une détention (vente, burn, transfert) — D8 de la note de décision.
 *
 * Ramène la quantité à zéro par une écriture de sortie (comme
 * `closeDefiPosition`), pose l'événement correspondant, et **conserve** la
 * ligne : jamais de suppression, contrairement à `deleteNftItem` (réservé à
 * la correction d'une saisie manuelle erronée sans historique réel).
 */
export async function disposeNftHolding(
  userId: string,
  assetId: string,
  opts: {
    disposalSource: string;
    disposalDate?: string | null;
    exitPriceEur?: string | null;
    disposalTxHash?: string | null;
  }
): Promise<{ holdingId: string }> {
  const holding = await prisma.nftItemDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    include: { asset: { select: { id: true, platformId: true, manualPrice: true } } },
  });
  if (!holding) throw new NftInputError("NFT introuvable");
  if (holding.status === "SOLD" || holding.status === "BURNED" || holding.status === "TRANSFERRED_OUT") {
    throw new NftInputError("Ce NFT est déjà sorti du patrimoine");
  }

  const disposalDate = opts.disposalDate ? new Date(opts.disposalDate) : new Date();
  if (Number.isNaN(disposalDate.getTime())) {
    throw new NftInputError("Date de sortie invalide");
  }
  const exitPrice = opts.exitPriceEur != null && opts.exitPriceEur !== "" ? d(opts.exitPriceEur) : null;
  if (exitPrice && (!exitPrice.isFinite() || exitPrice.lt(0))) {
    throw new NftInputError("Le prix de sortie ne peut pas être négatif");
  }

  const eventTypeBySource: Record<string, string> = {
    SOLD: "SELL",
    BURNED: "BURN",
    TRANSFER_OUT: "TRANSFER_OUT",
    DONATION_OUT: "DONATION_OUT",
    BRIDGE_OUT: "BRIDGE_OUT",
    WRAP: "WRAP",
    BUNDLE: "BUNDLE",
  };
  const statusBySource: Record<string, string> = {
    SOLD: "SOLD",
    BURNED: "BURNED",
    TRANSFER_OUT: "TRANSFERRED_OUT",
    DONATION_OUT: "TRANSFERRED_OUT",
    BRIDGE_OUT: "BRIDGED_OUT",
    WRAP: "WRAPPED",
    BUNDLE: "TRANSFERRED_OUT",
  };
  const nextStatus = statusBySource[opts.disposalSource] ?? "UNKNOWN";

  // Quantité réellement détenue au journal — jamais supposée, une
  // resynchronisation a pu la faire évoluer depuis l'acquisition.
  const { getHoldings } = await import("../portfolio/service");
  const holdings = await getHoldings(userId);
  const held = holdings.find((h) => h.assetId === assetId);
  const qty = held ? d(held.quantity) : d(0);
  const resolvedExitPrice =
    exitPrice ?? (holding.asset.manualPrice ? d(holding.asset.manualPrice.toString()) : d(0));

  await prisma.$transaction(async (tx) => {
    // Écriture de sortie — ramène la quantité détenue à zéro sans effacer
    // l'historique d'acquisition (même raisonnement que `closeDefiPosition`).
    // Rien à dénouer si le journal est déjà à zéro (sync qui avait déjà
    // vidé la position) : seul le statut bascule.
    let ledgerTransactionId: string | null = null;
    if (qty.gt(0)) {
      const ledgerTx = await createTransaction(
        {
          userId,
          type: "VENTE",
          platformId: holding.asset.platformId,
          assetId,
          quantity: qty.toString(),
          unitPrice: resolvedExitPrice.toFixed(12),
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt: disposalDate.toISOString(),
          allowNegativeCash: true,
          notes: `Sortie NFT (${opts.disposalSource})`,
        } as Parameters<typeof createTransaction>[0],
        tx as unknown as Parameters<typeof createTransaction>[1]
      );
      ledgerTransactionId = extractTransactionId(ledgerTx);
    }

    await tx.nftItemDetail.update({
      where: { id: holding.id },
      data: {
        status: nextStatus,
        disposalSource: opts.disposalSource,
        disposalDate,
        disposalTxHash: opts.disposalTxHash?.trim() || null,
      },
    });

    await recordNftEvent(
      holding.nftAssetId,
      {
        eventType: eventTypeBySource[opts.disposalSource] ?? "MANUAL_OVERRIDE",
        eventDate: disposalDate,
        nftHoldingId: holding.id,
        txHash: opts.disposalTxHash ?? null,
        priceEur: exitPrice ? exitPrice.toFixed(2) : null,
        sourceProvider: "MANUAL",
        ledgerTransactionId,
      },
      tx
    );
  });

  return { holdingId: holding.id };
}

/**
 * Identifiant de l'écriture créée, quand `createTransaction` le renvoie.
 * Défensif à dessein, même raison que dans `defi-manual-service.ts` : le
 * contrat de retour n'est pas typé de façon exploitable ici, et un événement
 * sans lien vers le journal reste utile (`SetNull` côté schéma).
 */
function extractTransactionId(result: unknown): string | null {
  if (result && typeof result === "object" && "id" in result) {
    const id = (result as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** Masque/affiche et inclut/exclut des agrégats — cosmétique vs patrimonial, jamais confondus. */
export async function setNftHoldingFlags(
  userId: string,
  assetId: string,
  flags: { isHidden?: boolean; isIgnoredInPortfolio?: boolean; clearConflict?: boolean }
) {
  const holding = await prisma.nftItemDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true },
  });
  if (!holding) throw new NftInputError("NFT introuvable");

  return prisma.nftItemDetail.update({
    where: { id: holding.id },
    data: {
      ...(flags.isHidden !== undefined ? { isHidden: flags.isHidden } : {}),
      ...(flags.isIgnoredInPortfolio !== undefined
        ? { isIgnoredInPortfolio: flags.isIgnoredInPortfolio }
        : {}),
      ...(flags.clearConflict ? { conflictFlag: false, conflictReason: null } : {}),
    },
  });
}

/**
 * Marque/reclassifie le spam au niveau de l'identité (`NftAsset`), jamais de
 * la détention : le caractère spam est une propriété du NFT, pas de qui le
 * détient. Historisé via un événement `SPAM_FLAG` — jamais silencieux.
 */
export async function reclassifyNftSpam(
  userId: string,
  assetId: string,
  next: { isSpam: boolean; isScamSuspected: boolean; reason?: string | null }
) {
  const holding = await prisma.nftItemDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true, nftAssetId: true },
  });
  if (!holding) throw new NftInputError("NFT introuvable");

  return prisma.$transaction(async (tx) => {
    await tx.nftAsset.update({
      where: { id: holding.nftAssetId },
      data: { isSpam: next.isSpam, isScamSuspected: next.isScamSuspected },
    });
    await recordNftEvent(
      holding.nftAssetId,
      {
        eventType: "SPAM_FLAG",
        eventDate: new Date(),
        nftHoldingId: holding.id,
        sourceProvider: "MANUAL",
        rawPayload: { isSpam: next.isSpam, isScamSuspected: next.isScamSuspected, reason: next.reason ?? null },
      },
      tx
    );
  });
}

// ─────────────────────────────── Curseurs de sync ───────────────────────────────

export type NftSyncCursorUpdate = {
  cursor?: string | null;
  lastError?: string | null;
  importedCount?: number;
  updatedCount?: number;
  ignoredCount?: number;
  success?: boolean;
};

export function nftSyncScopeKey(platformId?: string | null, sourceRef?: string | null): string {
  return `${platformId ?? "-"}:${sourceRef?.trim().toLowerCase() ?? "-"}`;
}

export async function updateNftSyncCursor(
  userId: string,
  provider: string,
  opts: { platformId?: string | null; sourceRef?: string | null } & NftSyncCursorUpdate
): Promise<void> {
  const now = new Date();
  const platformId = opts.platformId ?? null;
  const sourceRef = opts.sourceRef ?? null;
  const scopeKey = nftSyncScopeKey(platformId, sourceRef);

  const payload = {
    cursor: opts.cursor ?? undefined,
    lastSyncAt: now,
    ...(opts.success ? { lastSuccessAt: now, lastError: null } : {}),
    ...(opts.lastError !== undefined && !opts.success ? { lastError: opts.lastError } : {}),
    ...(opts.importedCount !== undefined ? { importedCount: opts.importedCount } : {}),
    ...(opts.updatedCount !== undefined ? { updatedCount: opts.updatedCount } : {}),
    ...(opts.ignoredCount !== undefined ? { ignoredCount: opts.ignoredCount } : {}),
  };

  await prisma.nftSyncCursor.upsert({
    where: { userId_provider_scopeKey: { userId, provider, scopeKey } },
    create: { userId, provider, platformId, sourceRef, scopeKey, ...payload },
    update: payload,
  });
}

export async function getNftSyncCursor(
  userId: string,
  provider: string,
  opts?: { platformId?: string | null; sourceRef?: string | null }
) {
  return prisma.nftSyncCursor.findUnique({
    where: {
      userId_provider_scopeKey: {
        userId,
        provider,
        scopeKey: nftSyncScopeKey(opts?.platformId, opts?.sourceRef),
      },
    },
  });
}

export async function listNftSyncCursors(userId: string) {
  return prisma.nftSyncCursor.findMany({
    where: { userId },
    orderBy: [{ lastSyncAt: "desc" }],
    include: { platform: { select: { id: true, name: true, walletAddress: true } } },
  });
}
