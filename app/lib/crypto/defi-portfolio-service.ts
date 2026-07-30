/**
 * Assemblage des positions DeFi enrichies — legs, valorisation, dédup, agrégats.
 *
 * Successeur de `getDefiBundle` (`defi-service.ts`), qui reste en place et
 * inchangé : il alimente l'onglet DeFi existant, et le casser pour un chantier
 * backend serait gratuit. Ce module apporte ce que l'ancien ne sait pas faire —
 * décomposition par jambes, méthode de valorisation, anti-double-compte,
 * agrégats par chaîne / protocole / type, séparation hidden / ignored.
 *
 * Comme l'ancien, il ne stocke aucune valeur : la valeur vivante vient du
 * journal via `getAssetValues`, les jambes ne portent que l'exposition.
 */

import type Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import { prisma } from "@/app/lib/prisma";
import { getAssetValues } from "@/app/lib/portfolio/asset-values";
import {
  isInactiveStatus,
  isIlliquidStatus,
  type DefiAccessMode,
  type DefiValuationMethod,
} from "./defi-taxonomy";
import {
  computeDebtRatios,
  debtRiskLevel,
  isStaleValuation,
  summarizeValuationQuality,
  valuePosition,
  type DebtRatios,
  type RiskLevel,
  type ValuationBreakdown,
  type ValuationLeg,
  type ValuationReward,
} from "./defi-valuation";
import {
  detectDoubleCounting,
  duplicateIdsToExclude,
  type Conflict,
  type DedupPosition,
} from "./defi-dedup";
import {
  aggregateBy,
  computeExclusions,
  computeTotals,
  countsInTotals,
  type AggregablePosition,
  type AggregableValues,
  type DefiAggregateBucket,
} from "./defi-aggregates";

export type DefiPositionFilters = {
  accessMode?: string | null;
  platformId?: string | null;
  ownerLabel?: string | null;
  chain?: string | null;
  protocol?: string | null;
  positionType?: string | null;
  status?: string | null;
  strategyId?: string | null;
  /** `undefined` = sans filtre ; `true`/`false` = filtre explicite. */
  isHidden?: boolean;
  isIgnoredInPortfolio?: boolean;
  withDebt?: boolean;
  withRewards?: boolean;
  /** Positions dont la dernière valorisation est périmée. */
  stale?: boolean;
  valuationMethod?: string | null;
  /** Inclut les positions fermées / liquidées, exclues par défaut. */
  includeInactive?: boolean;
};

export type EnrichedDefiPosition = {
  id: string;
  assetId: string;
  assetName: string;
  assetSymbol: string;
  platformId: string;
  platformName: string;

  accessMode: string;
  custodyModel: string;
  dataOrigin: string;
  ownerLabel: string | null;
  ownershipPct: string | null;

  protocol: string;
  protocolVersion: string | null;
  underlyingProtocol: string | null;
  chain: string | null;
  positionType: string;
  marketRef: string | null;
  vaultRef: string | null;
  poolRef: string | null;
  validatorName: string | null;
  nftPositionRef: string | null;

  status: string;
  isLiquid: boolean;
  openedAt: string | null;
  closedAt: string | null;
  isHidden: boolean;
  isIgnoredInPortfolio: boolean;
  strategyId: string | null;

  legs: Array<{
    legType: string;
    symbol: string;
    quantity: string;
    tokenRole: string | null;
    isActive: boolean;
    valueEur: string | null;
  }>;

  rewards: Array<{
    symbol: string;
    rewardType: string;
    accruedQuantity: string | null;
    claimedQuantity: string | null;
    valueEur: string | null;
    isValuable: boolean;
  }>;

  /** Décomposition — `retainedEur` est ce qui entre au patrimoine. */
  valuation: {
    grossEur: string;
    netEur: string;
    debtEur: string;
    collateralEur: string;
    rewardsEur: string;
    retainedEur: string;
    underlyingEur: string | null;
    method: DefiValuationMethod;
    confidenceScore: number;
    fallbackReason: string | null;
    isValuable: boolean;
    unpricedSymbols: string[];
    isStale: boolean;
    lastValuationAt: string | null;
  };

  debt: {
    ltvPct: string | null;
    collateralRatio: string | null;
    healthFactor: string | null;
    /** Health factor déclaré par le protocole, quand il diffère du recalculé. */
    reportedHealthFactor: string | null;
    liqThresholdPct: string | null;
    riskLevel: RiskLevel | null;
  } | null;

  apyPct: string | null;
  /** Conflit de double compte détecté — jamais résolu en silence. */
  conflict: { flagged: boolean; reason: string | null; excludedFromTotals: boolean };
  eventCount: number;
};

export type DefiAggregate = {
  key: string;
  label: string;
  positionCount: number;
  grossEur: string;
  netEur: string;
  debtEur: string;
  collateralEur: string;
  rewardsEur: string;
  retainedEur: string;
};

export type DefiPortfolioBundle = {
  positions: EnrichedDefiPosition[];

  /** Totaux du patrimoine DeFi — hors hidden ? non : hors **ignored**. */
  totals: {
    grossEur: string;
    netEur: string;
    debtEur: string;
    collateralEur: string;
    rewardsEur: string;
    /** Le seul chiffre qui entre au patrimoine net. */
    retainedEur: string;
    positionCount: number;
    /** Positions comptées dans les totaux. */
    countedPositionCount: number;
  };

  /**
   * Séparés des totaux, et non additionnés : ce sont précisément les positions
   * que l'utilisateur a demandé à écarter, les inclure annulerait sa décision.
   */
  excluded: {
    ignoredRetainedEur: string;
    ignoredCount: number;
    /** Masquées de l'affichage mais **comptées** dans les totaux. */
    hiddenCount: number;
    inactiveCount: number;
    duplicateRetainedEur: string;
    duplicateCount: number;
  };

  byChain: DefiAggregate[];
  byProtocol: DefiAggregate[];
  byPositionType: DefiAggregate[];
  byAccessMode: DefiAggregate[];

  valuationQuality: {
    byMethod: Array<{ method: DefiValuationMethod; count: number; retainedEur: string }>;
    weakSharePct: string;
    unvaluableCount: number;
    weightedConfidence: string | null;
    staleCount: number;
  };

  conflicts: Conflict[];

  /** Positions dont le prêt mérite une alerte, les plus risquées d'abord. */
  debtAlerts: Array<{
    positionId: string;
    protocol: string;
    riskLevel: RiskLevel;
    healthFactor: string | null;
    ltvPct: string | null;
  }>;
};

type PositionRow = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(userId: string, filters: DefiPositionFilters) {
  return prisma.defiPositionDetail.findMany({
    where: {
      asset: { is: { userId, ...(filters.platformId ? { platformId: filters.platformId } : {}) } },
      ...(filters.accessMode ? { accessMode: filters.accessMode } : {}),
      ...(filters.ownerLabel ? { ownerLabel: filters.ownerLabel } : {}),
      ...(filters.chain ? { chain: filters.chain } : {}),
      ...(filters.protocol ? { protocol: filters.protocol } : {}),
      ...(filters.positionType ? { positionType: filters.positionType } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.strategyId ? { strategyId: filters.strategyId } : {}),
      ...(filters.isHidden !== undefined ? { isHidden: filters.isHidden } : {}),
      ...(filters.isIgnoredInPortfolio !== undefined
        ? { isIgnoredInPortfolio: filters.isIgnoredInPortfolio }
        : {}),
      // Fermées et liquidées écartées par défaut : elles n'ont plus
      // d'exposition, et les afficher à 0 € encombrerait la vue. Leur
      // historique reste en base.
      ...(filters.includeInactive
        ? {}
        : { status: filters.status ?? { notIn: ["CLOSED", "LIQUIDATED"] } }),
    },
    include: {
      asset: {
        select: {
          id: true,
          name: true,
          ticker: true,
          platformId: true,
          platform: { select: { name: true } },
        },
      },
      legs: true,
      rewards: true,
      valuations: { orderBy: { valuationDate: "desc" }, take: 1 },
      _count: { select: { events: true } },
    },
  });
}

/**
 * Prix courant de chaque symbole rencontré.
 *
 * Les jambes rattachées à un `Asset` sont valorisées par le journal — c'est la
 * règle du dépôt. Les jambes sans `Asset` (un jeton apparié qui n'a pas de
 * position ouverte propre) n'ont pas de prix disponible ici : `valuePosition`
 * les traitera comme non cotées et choisira un repli, en le signalant. Aucun
 * appel réseau n'est fait dans cette fonction : la valorisation d'un onglet ne
 * doit pas dépendre de la disponibilité d'un fournisseur externe.
 */
function legPrice(
  leg: PositionRow["legs"][number],
  assetPrices: Map<string, Decimal>
): Decimal | null {
  if (leg.assetId) {
    const p = assetPrices.get(leg.assetId);
    if (p) return p;
  }
  return null;
}

function toValuationLegs(
  row: PositionRow,
  assetPrices: Map<string, Decimal>,
  primaryPriceEur: Decimal | null
): ValuationLeg[] {
  if (row.legs.length > 0) {
    return row.legs.map((leg) => ({
      legType: leg.legType,
      symbol: leg.symbol,
      quantity: d(leg.quantity.toString()),
      // La jambe portant l'actif principal hérite du prix du journal.
      priceEur:
        legPrice(leg, assetPrices) ??
        (leg.assetId === row.assetId ? primaryPriceEur : null),
      unitCostEur: leg.unitCostEur ? d(leg.unitCostEur.toString()) : null,
      isActive: leg.isActive,
    }));
  }

  // Aucune jambe : position antérieure au chantier F1, ou synchronisée par un
  // provider qui n'en fournit pas. L'appelant fabrique alors une jambe depuis
  // l'actif lui-même (cf. `legacyLegs`) plutôt que de déclarer la position non
  // valorisable — sinon toutes les positions existantes disparaîtraient des
  // totaux du jour au lendemain.
  return [];
}

function toValuationRewards(row: PositionRow): ValuationReward[] {
  return row.rewards.map((r) => ({
    symbol: r.symbol,
    rewardType: r.rewardType,
    accruedQuantity: r.accruedQuantity ? d(r.accruedQuantity.toString()) : null,
    valueEur: r.valueEur ? d(r.valueEur.toString()) : null,
  }));
}

/**
 * Adapte une position enrichie au contrat des agrégats purs.
 *
 * `isDuplicate` est dérivé du diagnostic de conflit, pas du drapeau persisté :
 * la détection vient d'être rejouée sur l'ensemble courant, et s'appuyer sur le
 * drapeau en base ferait dépendre les totaux d'un rafraîchissement antérieur.
 */
function toAggregable(
  position: EnrichedDefiPosition
): AggregablePosition & { source: EnrichedDefiPosition } {
  return {
    id: position.id,
    isHidden: position.isHidden,
    isIgnoredInPortfolio: position.isIgnoredInPortfolio,
    status: position.status,
    isDuplicate: position.conflict.excludedFromTotals,
    source: position,
  };
}

function toValues(breakdown: ValuationBreakdown): AggregableValues {
  return {
    grossEur: breakdown.grossEur,
    netEur: breakdown.netEur,
    debtEur: breakdown.debtEur,
    collateralEur: breakdown.collateralEur,
    rewardsEur: breakdown.rewardsEur,
    retainedEur: breakdown.retainedEur,
  };
}

function formatBucket(b: DefiAggregateBucket): DefiAggregate {
  return {
    key: b.key,
    label: b.label,
    positionCount: b.positionCount,
    grossEur: b.grossEur.toFixed(2),
    netEur: b.netEur.toFixed(2),
    debtEur: b.debtEur.toFixed(2),
    collateralEur: b.collateralEur.toFixed(2),
    rewardsEur: b.rewardsEur.toFixed(2),
    retainedEur: b.retainedEur.toFixed(2),
  };
}

/**
 * Charge et enrichit les positions DeFi de l'utilisateur.
 *
 * Ordre des opérations, qui n'est pas arbitraire :
 * 1. charger les positions et leurs satellites ;
 * 2. valoriser chaque position par le journal, jambe par jambe ;
 * 3. détecter les doublons entre positions ;
 * 4. **puis** agréger, en écartant les doublons et les positions ignorées.
 *
 * Détecter les doublons après valorisation et non avant : le choix de la
 * position à conserver dépend de son origine, pas de sa valeur, mais l'exclure
 * avant de valoriser empêcherait d'afficher ce qu'on écarte et pourquoi.
 */
export async function getDefiPortfolio(
  userId: string,
  filters: DefiPositionFilters = {}
): Promise<DefiPortfolioBundle> {
  const rows = await loadRows(userId, filters);

  const assetIds = [
    ...new Set([
      ...rows.map((r) => r.assetId),
      ...rows.flatMap((r) => r.legs.map((l) => l.assetId).filter((id): id is string => !!id)),
    ]),
  ];
  const values = assetIds.length ? await getAssetValues(userId, assetIds) : new Map();

  const assetPrices = new Map<string, Decimal>();
  for (const [assetId, v] of values) assetPrices.set(assetId, v.priceEur);

  const now = new Date();
  const enriched: Array<{ position: EnrichedDefiPosition; breakdown: ValuationBreakdown }> = [];

  for (const row of rows) {
    const primary = values.get(row.assetId);
    const primaryPrice = primary?.priceEur ?? null;
    const legs = toValuationLegs(row, assetPrices, primaryPrice);
    const rewards = toValuationRewards(row);
    const manual = row.valuations[0]?.isManual ? row.valuations[0] : null;
    const lastValuation = row.valuations[0] ?? null;

    const inactive = isInactiveStatus(row.status);

    // Position sans jambe : repli sur la valeur de l'actif au journal, de sorte
    // que les positions antérieures au chantier restent valorisées. La méthode
    // reste `MARKET` — c'est bien un prix de marché, simplement pas décomposé.
    const legacyLegs: ValuationLeg[] =
      legs.length === 0 && primary
        ? [
            {
              legType: row.positionType === "BORROWING" ? "DEBT" : "ASSET",
              symbol: row.asset.ticker || row.asset.name,
              quantity: primary.quantity.abs(),
              priceEur: primary.priceEur,
              unitCostEur: primary.quantity.gt(0)
                ? primary.costBasisEur.div(primary.quantity)
                : null,
              isActive: true,
            },
          ]
        : legs;

    const breakdown = valuePosition({
      legs: legacyLegs,
      rewards,
      ownershipPct: row.ownershipPct ? d(row.ownershipPct.toString()) : null,
      manualGrossValueEur:
        manual?.grossValueEur != null ? d(manual.grossValueEur.toString()) : null,
      excluded: inactive,
      excludedReason: inactive
        ? `Position ${row.status.toLowerCase()} — hors valorisation, historique conservé`
        : null,
    });

    const ratios: DebtRatios = computeDebtRatios(
      breakdown.debtEur,
      breakdown.collateralEur,
      row.liqThresholdPct ? d(row.liqThresholdPct.toString()) : null
    );
    const hasDebt = breakdown.debtEur.gt(0) || row.positionType === "BORROWING";

    const position: EnrichedDefiPosition = {
      id: row.id,
      assetId: row.assetId,
      assetName: row.asset.name,
      assetSymbol: row.asset.ticker || row.asset.name,
      platformId: row.asset.platformId,
      platformName: row.asset.platform.name,

      accessMode: row.accessMode,
      custodyModel: row.custodyModel,
      dataOrigin: row.dataOrigin,
      ownerLabel: row.ownerLabel,
      ownershipPct: row.ownershipPct ? row.ownershipPct.toString() : null,

      protocol: row.protocol,
      protocolVersion: row.protocolVersion,
      underlyingProtocol: row.underlyingProtocol,
      chain: row.chain,
      positionType: row.positionType,
      marketRef: row.marketRef,
      vaultRef: row.vaultRef,
      poolRef: row.poolRef,
      validatorName: row.validatorName,
      nftPositionRef: row.nftPositionRef,

      status: row.status,
      isLiquid: !isIlliquidStatus(row.status) && !inactive,
      openedAt: row.openedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      isHidden: row.isHidden,
      isIgnoredInPortfolio: row.isIgnoredInPortfolio,
      strategyId: row.strategyId,

      legs: legacyLegs.map((l) => ({
        legType: String(l.legType),
        symbol: l.symbol,
        quantity: l.quantity.toString(),
        tokenRole:
          row.legs.find((r) => r.symbol === l.symbol && r.legType === l.legType)
            ?.tokenRole ?? null,
        isActive: l.isActive !== false,
        valueEur:
          l.priceEur != null ? l.quantity.abs().times(l.priceEur).toFixed(2) : null,
      })),

      rewards: row.rewards.map((r) => ({
        symbol: r.symbol,
        rewardType: r.rewardType,
        accruedQuantity: r.accruedQuantity ? r.accruedQuantity.toString() : null,
        claimedQuantity: r.claimedQuantity ? r.claimedQuantity.toString() : null,
        valueEur: r.valueEur ? r.valueEur.toString() : null,
        isValuable: r.valueEur != null,
      })),

      valuation: {
        grossEur: breakdown.grossEur.toFixed(2),
        netEur: breakdown.netEur.toFixed(2),
        debtEur: breakdown.debtEur.toFixed(2),
        collateralEur: breakdown.collateralEur.toFixed(2),
        rewardsEur: breakdown.rewardsEur.toFixed(2),
        retainedEur: breakdown.retainedEur.toFixed(2),
        underlyingEur: breakdown.underlyingEur?.toFixed(2) ?? null,
        method: breakdown.method,
        confidenceScore: breakdown.confidenceScore,
        fallbackReason: breakdown.fallbackReason,
        isValuable: breakdown.isValuable,
        unpricedSymbols: breakdown.unpricedSymbols,
        isStale: isStaleValuation(lastValuation?.valuationDate ?? null, now),
        lastValuationAt: lastValuation?.valuationDate.toISOString() ?? null,
      },

      debt: hasDebt
        ? {
            ltvPct: ratios.ltvPct?.toFixed(3) ?? null,
            collateralRatio: ratios.collateralRatio?.toFixed(4) ?? null,
            healthFactor: ratios.healthFactor?.toFixed(4) ?? null,
            reportedHealthFactor: row.healthFactor
              ? row.healthFactor.toString()
              : null,
            liqThresholdPct: row.liqThresholdPct
              ? row.liqThresholdPct.toString()
              : null,
            riskLevel: debtRiskLevel(ratios),
          }
        : null,

      apyPct: row.apyPct ? row.apyPct.toString() : null,
      conflict: {
        flagged: row.conflictFlag,
        reason: row.conflictReason,
        excludedFromTotals: false,
      },
      eventCount: row._count.events,
    };

    enriched.push({ position, breakdown });
  }

  // ── Anti-double-compte entre positions ────────────────────────────────────
  const dedupInput: DedupPosition[] = rows.map((row) => ({
    id: row.id,
    providerKey: row.providerKey,
    dataOrigin: row.dataOrigin,
    protocol: row.protocol,
    protocolVersion: row.protocolVersion,
    chain: row.chain,
    positionType: row.positionType,
    symbols:
      row.legs.length > 0
        ? row.legs
            .filter((l) => l.legType === "ASSET" || l.legType === "RECEIPT" || l.legType === "SHARE")
            .map((l) => l.symbol)
        : [row.asset.ticker || row.asset.name],
    linkedPositionId: row.linkedPositionId,
    status: row.status,
    nftPositionRef: row.nftPositionRef,
    openedAt: row.openedAt,
  }));
  const conflicts = detectDoubleCounting(dedupInput);
  const excludedIds = duplicateIdsToExclude(conflicts);

  for (const { position } of enriched) {
    if (excludedIds.has(position.id)) {
      position.conflict.excludedFromTotals = true;
      if (!position.conflict.reason) {
        position.conflict.reason =
          conflicts.find((c) => c.duplicateId === position.id)?.reason ?? null;
      }
    }
  }

  // ── Totaux ────────────────────────────────────────────────────────────────
  // Les règles d'inclusion vivent dans `defi-aggregates.ts` (fonctions pures,
  // testées sans base) : totaux et agrégats partagent ainsi la même définition
  // de « ce qui compte », faute de quoi un total ne serait pas la somme de ses
  // parts.
  const entries = enriched.map(({ position, breakdown }) => ({
    position: toAggregable(position),
    values: toValues(breakdown),
  }));

  const totals = computeTotals(entries);
  const exclusions = computeExclusions(entries);
  const counted = enriched.filter(({ position }) =>
    countsInTotals(toAggregable(position))
  );

  const quality = summarizeValuationQuality(counted.map((e) => e.breakdown));

  const debtAlerts = enriched
    .filter(({ position }) => position.debt?.riskLevel && position.debt.riskLevel !== "OK")
    .map(({ position }) => ({
      positionId: position.id,
      protocol: position.protocol,
      riskLevel: position.debt!.riskLevel!,
      healthFactor: position.debt!.healthFactor,
      ltvPct: position.debt!.ltvPct,
    }))
    .sort((a, b) => {
      if (a.riskLevel === b.riskLevel) return 0;
      return a.riskLevel === "CRITICAL" ? -1 : 1;
    });

  return {
    positions: enriched.map((e) => e.position),
    totals: {
      grossEur: totals.grossEur.toFixed(2),
      netEur: totals.netEur.toFixed(2),
      debtEur: totals.debtEur.toFixed(2),
      collateralEur: totals.collateralEur.toFixed(2),
      rewardsEur: totals.rewardsEur.toFixed(2),
      retainedEur: totals.retainedEur.toFixed(2),
      positionCount: totals.positionCount,
      countedPositionCount: totals.countedPositionCount,
    },
    excluded: {
      ignoredRetainedEur: exclusions.ignoredRetainedEur.toFixed(2),
      ignoredCount: exclusions.ignoredCount,
      hiddenCount: exclusions.hiddenCount,
      inactiveCount: exclusions.inactiveCount,
      duplicateRetainedEur: exclusions.duplicateRetainedEur.toFixed(2),
      duplicateCount: exclusions.duplicateCount,
    },
    byChain: aggregateBy(
      entries,
      (p) => p.source.chain ?? "unknown",
      (p) => p.source.chain ?? "Chaîne non renseignée"
    ).map(formatBucket),
    byProtocol: aggregateBy(
      entries,
      (p) => p.source.protocol.toLowerCase(),
      (p) => p.source.protocol
    ).map(formatBucket),
    byPositionType: aggregateBy(
      entries,
      (p) => p.source.positionType,
      (p) => p.source.positionType
    ).map(formatBucket),
    byAccessMode: aggregateBy(
      entries,
      (p) => p.source.accessMode,
      (p) => p.source.accessMode
    ).map(formatBucket),
    valuationQuality: {
      byMethod: quality.byMethod.map((m) => ({
        method: m.method,
        count: m.count,
        retainedEur: m.retainedEur.toFixed(2),
      })),
      weakSharePct: quality.weakSharePct.toFixed(2),
      unvaluableCount: quality.unvaluableCount,
      weightedConfidence: quality.weightedConfidence?.toFixed(1) ?? null,
      staleCount: counted.filter((e) => e.position.valuation.isStale).length,
    },
    conflicts,
    debtAlerts,
  };
}

/**
 * Applique les filtres qui dépendent de la valorisation.
 *
 * Séparés des filtres SQL de `loadRows` : `withDebt`, `withRewards` et `stale`
 * portent sur des grandeurs calculées, pas sur des colonnes. Les évaluer en SQL
 * demanderait de stocker ces valeurs — ce que la règle de vérité interdit.
 */
export function applyComputedFilters(
  positions: EnrichedDefiPosition[],
  filters: DefiPositionFilters
): EnrichedDefiPosition[] {
  return positions.filter((p) => {
    if (filters.withDebt && d(p.valuation.debtEur).lte(0)) return false;
    if (filters.withRewards && d(p.valuation.rewardsEur).lte(0)) return false;
    if (filters.stale && !p.valuation.isStale) return false;
    if (filters.valuationMethod && p.valuation.method !== filters.valuationMethod) {
      return false;
    }
    return true;
  });
}

/**
 * Contribution de la DeFi au patrimoine net.
 *
 * Un seul chiffre, et c'est `retainedEur` : net de dette et au prorata de la
 * quote-part. Exposé à part pour que l'agrégation patrimoniale n'ait pas à
 * connaître la structure du bundle ni à choisir entre `gross` et `net` — un
 * appelant qui prendrait `gross` gonflerait le patrimoine de toutes les dettes.
 */
export async function getDefiNetContribution(userId: string): Promise<{
  retainedEur: string;
  debtEur: string;
  rewardsEur: string;
  positionCount: number;
  accessModeSplit: Array<{ accessMode: DefiAccessMode | string; retainedEur: string }>;
}> {
  const bundle = await getDefiPortfolio(userId);
  return {
    retainedEur: bundle.totals.retainedEur,
    debtEur: bundle.totals.debtEur,
    rewardsEur: bundle.totals.rewardsEur,
    positionCount: bundle.totals.countedPositionCount,
    accessModeSplit: bundle.byAccessMode.map((a) => ({
      accessMode: a.key,
      retainedEur: a.retainedEur,
    })),
  };
}
