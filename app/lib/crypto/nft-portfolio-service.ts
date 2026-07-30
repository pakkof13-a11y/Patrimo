/**
 * Agrégation du portefeuille NFT — assemble Prisma + les modules purs.
 *
 * Miroir de `defi-portfolio-service.ts` (chantier F1) : charger, valoriser
 * par le journal, détecter les doublons, **puis** agréger en écartant les
 * doublons et les détentions ignorées.
 */

import type Decimal from "decimal.js";
import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { getAssetValues } from "../portfolio/asset-values";
import {
  countsInTotals,
  computeTotals,
  computeExclusions,
  aggregateBy,
  type AggregableHolding,
  type AggregableNftValues,
} from "./nft-aggregates";
import { detectNftDoubleCounting, type DedupHolding, type NftConflict } from "./nft-dedup";
import { isInactiveHoldingStatus, isIlliquidHoldingStatus } from "./nft-taxonomy";
import { isNftValuationStale } from "./nft-valuation";

export type NftPositionFilters = {
  chain?: string;
  standard?: string;
  collectionId?: string;
  category?: string;
  platformId?: string;
  status?: string;
  isHidden?: boolean;
  isIgnoredInPortfolio?: boolean;
  ownerLabel?: string;
  includeInactive?: boolean;
};

export type EnrichedNftHolding = {
  holdingId: string;
  assetId: string;
  nftAssetId: string;
  name: string;
  chainId: string;
  standard: string;
  contractAddress: string | null;
  tokenId: string | null;
  mintAddress: string | null;
  imageUrl: string | null;
  collectionId: string | null;
  collectionName: string | null;
  collectionSlug: string | null;
  collectionVerifiedStatus: string;
  category: string;
  isSpam: boolean;
  isScamSuspected: boolean;
  isWrapped: boolean;
  isBridged: boolean;
  isCompressed: boolean;
  isSoulbound: boolean;
  rarityRank: number | null;
  metadataQuality: string;
  platformId: string;
  platformName: string;
  ownerLabel: string | null;
  ownershipShare: string | null;
  accessMode: string;
  custodyModel: string;
  dataOrigin: string;
  status: string;
  isHidden: boolean;
  isIgnoredInPortfolio: boolean;
  conflictFlag: boolean;
  conflictReason: string | null;
  linkedHoldingId: string | null;
  acquisitionDate: string | null;
  disposalDate: string | null;
  acquisitionCostEur: string | null;
  quantity: string;
  retainedValueEur: string;
  retainedValueMethod: string;
  retainedValueUpdatedAt: string | null;
  isValuable: boolean;
  isStale: boolean;
  isIlliquid: boolean;
  isDuplicate: boolean;
  eventCount: number;
};

export type NftAggregate = {
  key: string;
  label: string;
  holdingCount: number;
  retainedEur: string;
  acquisitionCostEur: string;
};

export type NftPortfolioBundle = {
  holdings: EnrichedNftHolding[];
  totals: {
    retainedEur: string;
    acquisitionCostEur: string;
    gainLossEur: string;
    holdingCount: number;
    countedHoldingCount: number;
    spamCount: number;
    suspectedSpamCount: number;
  };
  excluded: {
    ignoredRetainedEur: string;
    ignoredCount: number;
    hiddenCount: number;
    inactiveCount: number;
    nonOwnedCount: number;
    duplicateRetainedEur: string;
    duplicateCount: number;
  };
  byChain: NftAggregate[];
  byCollection: NftAggregate[];
  byCategory: NftAggregate[];
  valuationQuality: {
    unvaluableCount: number;
    staleCount: number;
    weakCount: number;
  };
  conflicts: NftConflict[];
};

type HoldingRow = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(userId: string, filters: NftPositionFilters) {
  return prisma.nftItemDetail.findMany({
    where: {
      asset: { is: { userId, ...(filters.platformId ? { platformId: filters.platformId } : {}) } },
      ...(filters.ownerLabel ? { ownerLabel: filters.ownerLabel } : {}),
      ...(filters.isHidden !== undefined ? { isHidden: filters.isHidden } : {}),
      ...(filters.isIgnoredInPortfolio !== undefined
        ? { isIgnoredInPortfolio: filters.isIgnoredInPortfolio }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
      nftAsset: {
        ...(filters.chain ? { chainId: filters.chain } : {}),
        ...(filters.standard ? { standard: filters.standard } : {}),
        ...(filters.collectionId ? { collectionId: filters.collectionId } : {}),
        ...(filters.category ? { category: filters.category } : {}),
      },
      // Sorties (vendu/brûlé/transféré) écartées par défaut — même
      // raisonnement que la DeFi : plus d'exposition, mais historisées.
      ...(filters.includeInactive
        ? {}
        : filters.status
          ? {}
          : { status: { notIn: ["SOLD", "BURNED", "TRANSFERRED_OUT"] } }),
    },
    include: {
      asset: {
        select: {
          id: true,
          name: true,
          platformId: true,
          platform: { select: { name: true } },
        },
      },
      nftAsset: { include: { collection: true } },
      _count: { select: { events: true } },
    },
  });
}

function toDedup(row: HoldingRow): DedupHolding {
  return {
    id: row.id,
    nftAssetId: row.nftAssetId,
    dataOrigin: row.dataOrigin,
    status: row.status,
    linkedHoldingId: row.linkedHoldingId,
    acquisitionDate: row.acquisitionDate,
  };
}

function toAggregable(
  row: HoldingRow,
  spamStatus: string,
  isDuplicate: boolean
): AggregableHolding & { source: HoldingRow } {
  return {
    id: row.id,
    isHidden: row.isHidden,
    isIgnoredInPortfolio: row.isIgnoredInPortfolio,
    status: row.status,
    spamStatus,
    isDuplicate,
    source: row,
  };
}

function formatBucket(b: { key: string; label: string; holdingCount: number; retainedEur: Decimal; acquisitionCostEur: Decimal }): NftAggregate {
  return {
    key: b.key,
    label: b.label,
    holdingCount: b.holdingCount,
    retainedEur: b.retainedEur.toFixed(2),
    acquisitionCostEur: b.acquisitionCostEur.toFixed(2),
  };
}

/**
 * Charge et enrichit les détentions NFT de l'utilisateur.
 *
 * Ordre : 1. charger, 2. valoriser par le journal, 3. détecter les doublons,
 * 4. agréger en écartant doublons et détentions ignorées — même ordre que
 * `getDefiPortfolio`, pour la même raison (le choix de la détention gardée
 * dépend de son origine, pas de sa valeur).
 */
export async function getNftPortfolio(
  userId: string,
  filters: NftPositionFilters = {}
): Promise<NftPortfolioBundle> {
  const rows = await loadRows(userId, filters);

  const assetIds = rows.map((r) => r.assetId);
  const values = assetIds.length ? await getAssetValues(userId, assetIds) : new Map();

  const conflicts = detectNftDoubleCounting(rows.map(toDedup));
  const duplicateIds = new Set(
    conflicts
      .filter((c) => !conflicts.some((k) => k.keepId === c.duplicateId))
      .map((c) => c.duplicateId)
  );

  const enriched: EnrichedNftHolding[] = [];
  const aggregableEntries: Array<{ holding: AggregableHolding & { source: HoldingRow }; values: AggregableNftValues }> = [];

  const now = new Date();
  let unvaluableCount = 0;
  let staleCount = 0;
  let weakCount = 0;

  for (const row of rows) {
    const value = values.get(row.assetId);
    const retainedEur = value ? value.marketValueEur : d(0);
    const acquisitionCostEur = row.acquisitionCostEur ? d(row.acquisitionCostEur.toString()) : d(0);
    const spamStatus = row.nftAsset.isSpam ? "CONFIRMED_SPAM" : row.nftAsset.isScamSuspected ? "SUSPECTED" : "CLEAN";
    const isDuplicate = duplicateIds.has(row.id);

    const isValuable = row.retainedValueMethod !== "UNKNOWN" && retainedEur.gt(0);
    const isStale = isNftValuationStale(row.retainedValueUpdatedAt, now);
    const isWeak = row.retainedValueMethod === "ACQUISITION_COST_FALLBACK" || row.retainedValueMethod === "COLLECTION_ESTIMATE";
    if (!isValuable) unvaluableCount += 1;
    if (isStale && isValuable) staleCount += 1;
    if (isWeak) weakCount += 1;

    enriched.push({
      holdingId: row.id,
      assetId: row.assetId,
      nftAssetId: row.nftAssetId,
      name: row.asset.name,
      chainId: row.nftAsset.chainId,
      standard: row.nftAsset.standard,
      contractAddress: row.nftAsset.contractAddress,
      tokenId: row.nftAsset.tokenId,
      mintAddress: row.nftAsset.mintAddress,
      imageUrl: row.nftAsset.imageUrl,
      collectionId: row.nftAsset.collectionId,
      collectionName: row.nftAsset.collection?.name ?? null,
      collectionSlug: row.nftAsset.collection?.slug ?? null,
      collectionVerifiedStatus: row.nftAsset.collection?.verifiedStatus ?? "UNKNOWN",
      category: row.nftAsset.category,
      isSpam: row.nftAsset.isSpam,
      isScamSuspected: row.nftAsset.isScamSuspected,
      isWrapped: row.nftAsset.isWrapped,
      isBridged: row.nftAsset.isBridged,
      isCompressed: row.nftAsset.isCompressed,
      isSoulbound: row.nftAsset.isSoulbound,
      rarityRank: row.nftAsset.rarityRank,
      metadataQuality: row.nftAsset.metadataQuality,
      platformId: row.asset.platformId,
      platformName: row.asset.platform.name,
      ownerLabel: row.ownerLabel,
      ownershipShare: row.ownershipShare?.toString() ?? null,
      accessMode: row.accessMode,
      custodyModel: row.custodyModel,
      dataOrigin: row.dataOrigin,
      status: row.status,
      isHidden: row.isHidden,
      isIgnoredInPortfolio: row.isIgnoredInPortfolio,
      conflictFlag: isDuplicate || row.conflictFlag,
      conflictReason: isDuplicate
        ? conflicts.find((c) => c.duplicateId === row.id)?.reason ?? null
        : row.conflictReason,
      linkedHoldingId: row.linkedHoldingId,
      acquisitionDate: row.acquisitionDate?.toISOString() ?? null,
      disposalDate: row.disposalDate?.toISOString() ?? null,
      acquisitionCostEur: acquisitionCostEur.toFixed(2),
      quantity: value ? value.quantity.toFixed(0) : "0",
      retainedValueEur: retainedEur.toFixed(2),
      retainedValueMethod: row.retainedValueMethod,
      retainedValueUpdatedAt: row.retainedValueUpdatedAt?.toISOString() ?? null,
      isValuable,
      isStale,
      isIlliquid: isIlliquidHoldingStatus(row.status),
      isDuplicate,
      eventCount: row._count.events,
    });

    aggregableEntries.push({
      holding: toAggregable(row, spamStatus, isDuplicate),
      values: { retainedEur, acquisitionCostEur },
    });
  }

  const totals = computeTotals(aggregableEntries);
  const exclusions = computeExclusions(aggregableEntries);

  const byChain = aggregateBy(
    aggregableEntries,
    (h) => h.source.nftAsset.chainId,
    (h) => h.source.nftAsset.chainId
  ).map(formatBucket);
  const byCollection = aggregateBy(
    aggregableEntries,
    (h) => h.source.nftAsset.collectionId ?? "no-collection",
    (h) => h.source.nftAsset.collection?.name ?? "Sans collection"
  ).map(formatBucket);
  const byCategory = aggregateBy(
    aggregableEntries,
    (h) => h.source.nftAsset.category,
    (h) => h.source.nftAsset.category
  ).map(formatBucket);

  return {
    holdings: enriched,
    totals: {
      retainedEur: totals.retainedEur.toFixed(2),
      acquisitionCostEur: totals.acquisitionCostEur.toFixed(2),
      gainLossEur: totals.gainLossEur.toFixed(2),
      holdingCount: totals.holdingCount,
      countedHoldingCount: totals.countedHoldingCount,
      spamCount: totals.spamCount,
      suspectedSpamCount: totals.suspectedSpamCount,
    },
    excluded: {
      ignoredRetainedEur: exclusions.ignoredRetainedEur.toFixed(2),
      ignoredCount: exclusions.ignoredCount,
      hiddenCount: exclusions.hiddenCount,
      inactiveCount: exclusions.inactiveCount,
      nonOwnedCount: exclusions.nonOwnedCount,
      duplicateRetainedEur: exclusions.duplicateRetainedEur.toFixed(2),
      duplicateCount: exclusions.duplicateCount,
    },
    byChain,
    byCollection,
    byCategory,
    valuationQuality: { unvaluableCount, staleCount, weakCount },
    conflicts,
  };
}

export { countsInTotals, isInactiveHoldingStatus };
