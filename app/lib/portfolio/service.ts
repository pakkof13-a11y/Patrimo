import { prisma } from "../prisma";
import { d, toFixed, zero } from "../money/decimal";
import {
  applyTransaction,
  createEmptyLedger,
  replayTransactions,
  totalCash,
  totalCostBasis,
  totalRealizedPnl,
  type LedgerTx,
  type TxType,
} from "../accounting";
import { convertFromEurSync, convertToEurSync, getEurRates } from "../market/fx";
import { endOfParisDay, parisDayKey, parisDayStart } from "../dates/paris";
import { marketValueOfPositions } from "./class-history";
import { PortfolioValuationEngine } from "./historical/engine";
import { loadHistoricalInputs } from "./historical/load";
import type {
  HistoricalDataStatus,
  PortfolioValuationPoint,
  ValuationComponent,
} from "./historical/types";
import type { DailyCloseIndex } from "./class-history";
import { readDailyCloses } from "../market/daily-closes";
import { resolvePlatformLogo } from "../platforms/presets";
import { resolveAssetLogo } from "../assets/logos";
import {
  blockchainLabel,
  buildCustodyDistribution,
  resolveBlockchainKey,
} from "../assets/blockchain";
import {
  mergePlatformSlices,
  sliceFromHoldingLeg,
  type HoldingPlatformSlice,
} from "./holdings-platform-slice";
import { asAccountType } from "../types/account-type";
import { isNonOwnedStatus } from "../crypto/nft-taxonomy";
import {
  asBaseAmount,
  asEurAmount,
  asPercentString,
  asPriceString,
  asQuantityString,
  type BaseAmount,
  type EurAmount,
  type PercentString,
  type PriceString,
  type QuantityString,
} from "../types/money-brands";
import type { AccountType } from "../constants";

import { mapDbTx } from "./tx-mapper";
export { mapDbTx };

/**
 * Charge + rejoue le ledger, avec cache process-local (fingerprint tx).
 * Invalider via `invalidateLedgerCache(userId)` après toute écriture.
 */
export async function loadLedgerForUser(userId: string) {
  // Fingerprint léger (2 requêtes indexées) avant un full scan + replay
  const [count, last] = await Promise.all([
    prisma.transaction.count({ where: { userId } }),
    prisma.transaction.findFirst({
      where: { userId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { id: true, occurredAt: true },
    }),
  ]);
  const fp = {
    count,
    lastId: last?.id ?? null,
    lastAt: last?.occurredAt?.toISOString() ?? null,
  };

  const { getCachedLedger, setCachedLedger } = await import("./ledger-cache");
  const cached = getCachedLedger(userId, fp);
  if (cached) return cached;

  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  // Seed / historique peut contenir ventes > stock ou cash négatif.
  // Ne jamais faire planter le dashboard : clamp + cash négatif en secours.
  const mapped = rows.map(mapDbTx);
  let state;
  try {
    state = replayTransactions(mapped);
  } catch {
    state = replayTransactions(mapped, {
      allowNegativeCash: true,
      clampOversell: true,
    });
  }
  setCachedLedger(userId, fp, state);
  return state;
}

export type HoldingRow = {
  assetId: string;
  name: string;
  ticker: string | null;
  isin?: string | null;
  assetClass: string;
  /** Sous-catégorie UI — hors calculs ledger */
  category: string;
  /** CTO | PEA | AV | CRYPTO | IMMOBILIER | CFD */
  accountType: AccountType;
  currency: string;
  platformId: string;
  /**
   * Toutes les plateformes contribuant à la ligne (crypto multi-custody).
   * Le filtre Positions `?platformId=` matche ce tableau, pas seulement platformId.
   */
  platformIds?: string[];
  /**
   * Jambes par plateforme (qty / coût / MV) — reslice UI si filtre plateforme.
   * Absent ou length=1 → mono-custody.
   */
  platformSlices?: HoldingPlatformSlice[];
  platformName: string;
  platformLogoUrl: string | null;
  platformType?: string | null;
  platformLogoKey?: string | null;
  blockchainKey?: string | null;
  blockchainLabel?: string | null;
  assetLogoUrl: string | null;
  /** Position adossée à un protocole DeFi — exclue du comptant. */
  isDefiPosition?: boolean;
  /** Position adossée à un NFT — exclue du comptant. */
  isNftItem?: boolean;
  quantity: QuantityString;
  /** PRU / CUMP (EUR) — break-even unitaire frais inclus */
  avgCostEur: EurAmount;
  costBasisEur: EurAmount;
  currentPriceEur: PriceString;
  currentPriceNative: PriceString;
  marketValueEur: EurAmount;
  marketValueBase: BaseAmount;
  costBasisBase: BaseAmount;
  unrealizedPnlEur: EurAmount;
  unrealizedPnlBase: BaseAmount;
  unrealizedPnlPct: PercentString;
  priceSource: string | null;
  priceStatus: string | null;
  lastUpdatedAt: string | null;
  logoUrl: string | null;
  priceProvider: string;
  /** Fees paid on purchases (EUR, cumulative) */
  acquisitionFeesEur: EurAmount;
  acquisitionFeesBase: BaseAmount;
  /** Passive income: dividends, coupons, rent, interest (EUR) */
  passiveIncomeEur: EurAmount;
  passiveIncomeBase: BaseAmount;
  /** Break-even unit price (EUR) = PRU */
  breakEvenEur: EurAmount;
  breakEvenBase: BaseAmount;
  /** % of total portfolio market value */
  allocationPct: PercentString;
  /** % of same asset-class bucket */
  allocationPctOfClass: PercentString;
  /** Exit levels (native currency) — null if unset / already fired */
  stopLoss: string | null;
  tp1: string | null;
  tp2: string | null;
  tp3: string | null;
  tp4: string | null;
  /** Ligne épinglée dans la watchlist du tableau de bord. */
  watchlisted: boolean;
  /**
   * True si un niveau SL/TP existe sur une jambe non-principale (multi-plateforme).
   * Les niveaux affichés (stopLoss/tpN) restent ceux de la jambe principale si
   * elle en a, sinon ceux de la jambe secondaire — ce flag signale ce cas.
   */
  hasSecondaryLevels: boolean;
};

/** Helpers locaux — toFixed → montants brandés */
const qtyS = (v: string) => asQuantityString(v);
const eurS = (v: string) => asEurAmount(v);
const baseS = (v: string) => asBaseAmount(v);
const priceS = (v: string) => asPriceString(v);
const pctS = (v: string) => asPercentString(v);

export async function getHoldings(
  userId: string,
  baseCurrency = "EUR",
  rates?: Record<string, number>
): Promise<HoldingRow[]> {
  const fx = rates ?? (await getEurRates());
  const toBase = (v: ReturnType<typeof d>) => convertFromEurSync(v, baseCurrency, fx);

  const [ledger, assets, txRows] = await Promise.all([
    loadLedgerForUser(userId),
    prisma.asset.findMany({
      where: { userId },
      include: {
        platform: true,
        priceQuote: true,
        // Relations 1:1 : empêchent la fusion d'une position DeFi/NFT avec le
        // solde comptant de même ticker (cf. `mergeKey`), et permettent à
        // l'onglet Cryptos d'isoler le comptant de la DeFi et des NFT sans
        // second aller-retour serveur.
        // `isIgnoredInPortfolio` : une position DeFi/NFT que l'utilisateur a
        // explicitement écartée des agrégats patrimoniaux. Lue ici et non
        // seulement dans l'onglet DeFi/NFT, sinon le patrimoine net
        // contredirait ces vues qui, elles, l'excluent. Distinct de
        // `isHidden`, purement cosmétique, qui continue de compter.
        defiPosition: { select: { id: true, isIgnoredInPortfolio: true } },
        // `status` : un NFT `BORROWED_IN` est détenu sans être possédé — il
        // doit être restitué, donc il ne s'ajoute jamais au patrimoine net
        // (`isNonOwnedStatus`, même règle que `countsInTotals` côté onglet).
        nftItem: { select: { id: true, isIgnoredInPortfolio: true, status: true } },
      },
    }),
    prisma.transaction.findMany({
      where: { userId },
      select: {
        assetId: true,
        type: true,
        fees: true,
        feesEur: true,
        grossAmountEur: true,
        netCashImpactEur: true,
        fxRateToEur: true,
      },
    }),
  ]);

  // Per-asset acquisition fees + passive income (dividends, coupons, rent, interest)
  const feesByAsset = new Map<string, ReturnType<typeof d>>();
  const incomeByAsset = new Map<string, ReturnType<typeof d>>();
  const INCOME = new Set(["DIVIDENDE", "COUPON", "LOYER", "INTERET"]);
  for (const t of txRows) {
    if (!t.assetId) continue;
    const feesEur = t.feesEur
      ? d(t.feesEur.toString())
      : d(t.fees.toString()).times(d(t.fxRateToEur.toString()));
    if (t.type === "ACHAT" || t.type === "VENTE") {
      feesByAsset.set(t.assetId, (feesByAsset.get(t.assetId) || zero()).plus(feesEur));
    }
    if (INCOME.has(t.type)) {
      // Income is positive cash impact in EUR (or gross)
      const inc = d(t.grossAmountEur.toString()).abs();
      incomeByAsset.set(t.assetId, (incomeByAsset.get(t.assetId) || zero()).plus(inc));
    }
  }

  const assetMap = new Map(assets.map((a) => [a.id, a]));
  // Also index platforms for positions whose platform differs from asset.home
  const platformIds = new Set<string>();
  for (const pos of ledger.positions.values()) platformIds.add(pos.platformId);
  const platforms = await prisma.platform.findMany({
    where: { userId, id: { in: [...platformIds] } },
  });
  const platformMap = new Map(platforms.map((p) => [p.id, p]));

  const rows: HoldingRow[] = [];

  for (const pos of ledger.positions.values()) {
    if (pos.quantity.lte(0)) continue;
    const asset = assetMap.get(pos.assetId);
    if (!asset) continue;
    // Position DeFi explicitement exclue du patrimoine : ses écritures restent
    // au journal (l'historique et la fiscalité en dépendent), mais elle ne pèse
    // plus dans aucun total. Une position *fermée* n'a pas besoin de ce test —
    // son dénouement l'a ramenée à zéro, elle est déjà écartée plus haut.
    if (asset.defiPosition?.isIgnoredInPortfolio) continue;
    // Même règle pour les NFT — plus le cas d'un NFT emprunté, présent au
    // journal mais qui n'appartient pas à l'utilisateur.
    if (asset.nftItem?.isIgnoredInPortfolio) continue;
    if (asset.nftItem && isNonOwnedStatus(asset.nftItem.status)) continue;

    const platform =
      platformMap.get(pos.platformId) ||
      (asset.platformId === pos.platformId ? asset.platform : null) ||
      asset.platform;

    let priceEur = zero();
    let priceNative = zero();
    if (asset.priceQuote) {
      priceEur = d(asset.priceQuote.priceEur.toString());
      priceNative = d(asset.priceQuote.priceNative.toString());
    } else if (asset.manualPrice) {
      priceNative = d(asset.manualPrice.toString());
      priceEur = d(convertToEurSync(priceNative, asset.currency || "EUR", fx));
    }

    // If no market price, show cost as value so the line is still visible
    if (priceEur.isZero() && pos.costBasisEur.gt(0) && pos.quantity.gt(0)) {
      priceEur = pos.costBasisEur.div(pos.quantity);
      priceNative = priceEur;
    }

    const marketValue = pos.quantity.times(priceEur);
    const unrealized = marketValue.minus(pos.costBasisEur);
    const pct = pos.costBasisEur.gt(0) ? unrealized.div(pos.costBasisEur).times(100) : zero();
    const avg = pos.quantity.gt(0) ? pos.costBasisEur.div(pos.quantity) : zero();
    const fees = feesByAsset.get(pos.assetId) || zero();
    const income = incomeByAsset.get(pos.assetId) || zero();

    const assetLogo = resolveAssetLogo({
      logoUrl: asset.logoUrl,
      ticker: asset.ticker,
      isin: asset.isin,
      name: asset.name,
      assetClass: asset.assetClass,
    });

    const chainKey = resolveBlockchainKey({
      platformType: platform?.type,
      platformLogoKey: platform?.logoKey,
      platformName: platform?.name,
      platformSubtype: platform?.subtype,
      assetNotes: asset.notes,
      providerSymbol: asset.providerSymbol,
      accountType: asset.accountType,
      assetClass: asset.assetClass,
    });

    const leg: HoldingRow = {
      assetId: pos.assetId,
      name: asset.name,
      ticker: asset.ticker,
      isin: asset.isin ?? null,
      assetClass: asset.assetClass,
      category:
        (asset as { category?: string | null }).category || "UNCLASSIFIED",
      accountType: asAccountType(asset.accountType, "CTO"),
      currency: asset.currency || asset.priceQuote?.nativeCurrency || "EUR",
      platformId: pos.platformId,
      platformIds: [pos.platformId],
      platformName: platform?.name || "—",
      platformLogoUrl: resolvePlatformLogo({
        logoKey: platform?.logoKey,
        logoUrl: platform?.logoUrl,
        name: platform?.name,
      }),
      platformType: platform?.type ?? null,
      platformLogoKey: platform?.logoKey ?? null,
      blockchainKey: chainKey,
      blockchainLabel: blockchainLabel(chainKey),
      assetLogoUrl: assetLogo,
      isDefiPosition: Boolean(
        (asset as { defiPosition?: { id: string } | null }).defiPosition
      ),
      isNftItem: Boolean(
        (asset as { nftItem?: { id: string } | null }).nftItem
      ),
      quantity: qtyS(toFixed(pos.quantity, 8)),
      avgCostEur: eurS(toFixed(avg, 8)),
      costBasisEur: eurS(toFixed(pos.costBasisEur, 8)),
      currentPriceEur: priceS(toFixed(priceEur, 8)),
      currentPriceNative: priceS(
        toFixed(priceNative.gt(0) ? priceNative : priceEur, 8)
      ),
      marketValueEur: eurS(toFixed(marketValue, 8)),
      marketValueBase: baseS(toBase(marketValue)),
      costBasisBase: baseS(toBase(pos.costBasisEur)),
      unrealizedPnlEur: eurS(toFixed(unrealized, 8)),
      unrealizedPnlBase: baseS(toBase(unrealized)),
      unrealizedPnlPct: pctS(toFixed(pct, 4)),
      priceSource: asset.priceQuote?.source ?? (asset.manualPrice ? "manual" : "coût"),
      priceStatus: asset.priceQuote?.status ?? (asset.manualPrice ? "OK" : "OK"),
      lastUpdatedAt: asset.priceQuote?.lastUpdatedAt?.toISOString() ?? null,
      logoUrl: assetLogo,
      priceProvider: asset.priceProvider,
      acquisitionFeesEur: eurS(toFixed(fees, 8)),
      acquisitionFeesBase: baseS(toBase(fees)),
      passiveIncomeEur: eurS(toFixed(income, 8)),
      passiveIncomeBase: baseS(toBase(income)),
      breakEvenEur: eurS(toFixed(avg, 8)),
      breakEvenBase: baseS(toBase(avg)),
      allocationPct: pctS("0"),
      allocationPctOfClass: pctS("0"),
      stopLoss: asset.stopLoss?.toString() ?? null,
      tp1: asset.tp1?.toString() ?? null,
      tp2: asset.tp2?.toString() ?? null,
      tp3: asset.tp3?.toString() ?? null,
      tp4: asset.tp4?.toString() ?? null,
      watchlisted: asset.watchlistedAt != null,
      hasSecondaryLevels: false,
    };
    leg.platformSlices = [sliceFromHoldingLeg(leg)];
    rows.push(leg);
  }

  /** Actifs adossés à une position DeFi — exclus de la fusion par ticker. */
  const defiAssetIds = new Set(
    assets.filter((a) => a.defiPosition).map((a) => a.id)
  );

  // Merge :
  // 1) même assetId multi-plateforme
  // 2) crypto même ticker + enveloppe → une ligne (ETH Base + ETH Revolut)
  function mergeKey(row: HoldingRow): string {
    // Un ETH staké chez Lido n'est pas un ETH en portefeuille : il porte un
    // risque de protocole, un rendement et parfois une durée de déblocage.
    // Les fondre en une ligne rendrait aussi la lecture « comptant + DeFi »
    // trompeuse — le même ETH apparaîtrait dans les deux vues.
    if (defiAssetIds.has(row.assetId)) return `id:${row.assetId}`;

    const tick = (row.ticker || "").trim().toUpperCase();
    const env = (row.accountType || "CTO").toUpperCase();
    const isCrypto =
      row.assetClass === "CRYPTO" || env === "CRYPTO";
    if (isCrypto && tick) return `crypto:${env}:${tick}`;
    return `id:${row.assetId}`;
  }

  const merged = new Map<string, HoldingRow>();
  for (const row of rows) {
    const key = mergeKey(row);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, row);
      continue;
    }
    const qty = d(prev.quantity).plus(d(row.quantity));
    const cost = d(prev.costBasisEur).plus(d(row.costBasisEur));
    const mv = d(prev.marketValueEur).plus(d(row.marketValueEur));
    const mvBase = d(prev.marketValueBase).plus(d(row.marketValueBase));
    const costBase = d(prev.costBasisBase).plus(d(row.costBasisBase));
    const unreal = mv.minus(cost);
    const avg = qty.gt(0) ? cost.div(qty) : zero();
    const pct = cost.gt(0) ? unreal.div(cost).times(100) : zero();
    const platforms =
      prev.platformName === row.platformName
        ? prev.platformName
        : `${prev.platformName}, ${row.platformName}`;
    const fees = d(prev.acquisitionFeesEur).plus(d(row.acquisitionFeesEur));
    const income = d(prev.passiveIncomeEur).plus(d(row.passiveIncomeEur));
    // Prix unitaire : moyenne pondérée par qty (ou cours live le plus frais)
    const px =
      qty.gt(0) && mv.gt(0)
        ? mv.div(qty)
        : d(prev.currentPriceEur).gt(0)
          ? d(prev.currentPriceEur)
          : d(row.currentPriceEur);
    const preferLive =
      (prev.priceSource || "").toLowerCase().includes("coingecko") ||
      (prev.priceSource || "").toLowerCase().includes("zerion")
        ? prev
        : (row.priceSource || "").toLowerCase().includes("coingecko") ||
            (row.priceSource || "").toLowerCase().includes("zerion")
          ? row
          : prev;
    // Principal = plus grosse jambe (détail, logo, filtre par défaut)
    const takeRow = d(row.quantity).gt(d(prev.quantity));
    const prevIds = prev.platformIds?.length
      ? prev.platformIds
      : [prev.platformId];
    const rowIds = row.platformIds?.length
      ? row.platformIds
      : [row.platformId];
    const platformIds = [...new Set([...prevIds, ...rowIds])];
    const prevSlices =
      prev.platformSlices?.length
        ? prev.platformSlices
        : [sliceFromHoldingLeg(prev)];
    const rowSlices =
      row.platformSlices?.length
        ? row.platformSlices
        : [sliceFromHoldingLeg(row)];
    const platformSlices = mergePlatformSlices(prevSlices, rowSlices);
    // SL/TP : jambe principale prioritaire, repli jambe secondaire si absent
    // (au lieu de ne garder que la jambe déterminée par takeRow — perdait les
    // niveaux de la jambe secondaire quand la principale n'en avait pas).
    const principalLeg = takeRow ? row : prev;
    const secondaryLeg = takeRow ? prev : row;
    const pickLevel = (a: string | null, b: string | null): string | null =>
      a ?? b ?? null;
    const stopLoss = pickLevel(principalLeg.stopLoss, secondaryLeg.stopLoss);
    const tp1 = pickLevel(principalLeg.tp1, secondaryLeg.tp1);
    const tp2 = pickLevel(principalLeg.tp2, secondaryLeg.tp2);
    const tp3 = pickLevel(principalLeg.tp3, secondaryLeg.tp3);
    const tp4 = pickLevel(principalLeg.tp4, secondaryLeg.tp4);
    const secondaryHasOwnLevels = [
      secondaryLeg.stopLoss,
      secondaryLeg.tp1,
      secondaryLeg.tp2,
      secondaryLeg.tp3,
      secondaryLeg.tp4,
    ].some((v) => v != null);
    const hasSecondaryLevels =
      prev.hasSecondaryLevels || row.hasSecondaryLevels || secondaryHasOwnLevels;
    merged.set(key, {
      ...prev,
      // assetId principal = plus grosse position (détail + actions)
      assetId: takeRow ? row.assetId : prev.assetId,
      accountType: asAccountType(prev.accountType || row.accountType, "CTO"),
      // Aligner platformId sur la jambe principale (sinon filtre Positions incohérent)
      platformId: takeRow ? row.platformId : prev.platformId,
      platformIds,
      platformSlices,
      platformName: platforms,
      platformLogoUrl: preferLive.platformLogoUrl || prev.platformLogoUrl,
      blockchainKey: prev.blockchainKey || row.blockchainKey,
      blockchainLabel: prev.blockchainLabel || row.blockchainLabel,
      // Une jambe DeFi/NFT ne fusionne jamais avec du comptant (cf. mergeKey) :
      // le OR ne fait que propager le marqueur entre jambes de même nature.
      isDefiPosition: prev.isDefiPosition || row.isDefiPosition,
      isNftItem: prev.isNftItem || row.isNftItem,
      quantity: qtyS(toFixed(qty, 8)),
      costBasisEur: eurS(toFixed(cost, 8)),
      avgCostEur: eurS(toFixed(avg, 8)),
      currentPriceEur: priceS(toFixed(px, 8)),
      currentPriceNative: preferLive.currentPriceNative || prev.currentPriceNative,
      marketValueEur: eurS(toFixed(mv, 8)),
      marketValueBase: baseS(toFixed(mvBase, 8)),
      costBasisBase: baseS(toFixed(costBase, 8)),
      unrealizedPnlEur: eurS(toFixed(unreal, 8)),
      unrealizedPnlBase: baseS(
        toFixed(d(prev.unrealizedPnlBase).plus(d(row.unrealizedPnlBase)), 8)
      ),
      unrealizedPnlPct: pctS(toFixed(pct, 4)),
      priceSource: preferLive.priceSource || prev.priceSource,
      priceProvider: preferLive.priceProvider || prev.priceProvider,
      priceStatus: preferLive.priceStatus || prev.priceStatus,
      lastUpdatedAt: preferLive.lastUpdatedAt || prev.lastUpdatedAt,
      acquisitionFeesEur: eurS(toFixed(fees, 8)),
      acquisitionFeesBase: baseS(toBase(fees)),
      passiveIncomeEur: eurS(toFixed(income, 8)),
      passiveIncomeBase: baseS(toBase(income)),
      breakEvenEur: eurS(toFixed(avg, 8)),
      breakEvenBase: baseS(toBase(avg)),
      // SL/TP : jambe principale prioritaire, repli sur la jambe secondaire
      // si la principale n'a pas le niveau. Ne pas replier perdait les niveaux
      // saisis sur la petite jambe ; `hasSecondaryLevels` trace la provenance
      // pour que l'UI signale explicitement le cas (badge sur la colonne SL).
      stopLoss,
      tp1,
      tp2,
      tp3,
      tp4,
      // Une seule ligne affichée pour deux jambes : elle est suivie dès que
      // l'une l'est, sinon l'étoile s'éteindrait en changeant de dépositaire.
      watchlisted: prev.watchlisted || row.watchlisted,
      hasSecondaryLevels,
    });
  }

  const mergedRows = [...merged.values()];

  // Allocation % vs portfolio total and vs same asset class
  const totalMv = mergedRows.reduce((acc, r) => acc.plus(d(r.marketValueEur)), zero());
  const byClass = new Map<string, ReturnType<typeof d>>();
  for (const r of mergedRows) {
    byClass.set(r.assetClass, (byClass.get(r.assetClass) || zero()).plus(d(r.marketValueEur)));
  }
  for (const r of mergedRows) {
    const mv = d(r.marketValueEur);
    r.allocationPct =
      totalMv.gt(0) ? pctS(toFixed(mv.div(totalMv).times(100), 4)) : pctS("0");
    const classTotal = byClass.get(r.assetClass) || zero();
    r.allocationPctOfClass = classTotal.gt(0)
      ? pctS(toFixed(mv.div(classTotal).times(100), 4))
      : pctS("0");
  }

  mergedRows.sort((a, b) => d(b.marketValueEur).cmp(d(a.marketValueEur)));
  return mergedRows;
}

export async function getPlatformCashBalances(
  userId: string,
  baseCurrency = "EUR",
  rates?: Record<string, number>,
  ledger?: Awaited<ReturnType<typeof loadLedgerForUser>>
) {
  const fx = rates ?? (await getEurRates());
  const { getBankPocketCashByNameEur } = await import("../cash/pockets");
  const { normalizePlatformSearch } = await import("../platforms/presets");
  const [led, platforms, lastTxRows, assetQuotes, bankCashByName] =
    await Promise.all([
      ledger ? Promise.resolve(ledger) : loadLedgerForUser(userId),
      prisma.platform.findMany({ where: { userId }, orderBy: { name: "asc" } }),
      prisma.transaction.findMany({
        where: { userId },
        select: { platformId: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
      }),
      prisma.asset.findMany({
        where: { userId },
        select: {
          id: true,
          currency: true,
          manualPrice: true,
          priceQuote: { select: { priceEur: true } },
        },
      }),
      getBankPocketCashByNameEur(userId, fx),
    ]);

  const lastTxByPlatform = new Map<string, Date>();
  for (const row of lastTxRows) {
    if (!lastTxByPlatform.has(row.platformId)) {
      lastTxByPlatform.set(row.platformId, row.occurredAt);
    }
  }

  const priceEurByAsset = new Map<string, ReturnType<typeof d>>();
  for (const a of assetQuotes) {
    if (a.priceQuote) {
      priceEurByAsset.set(a.id, d(a.priceQuote.priceEur.toString()));
    } else if (a.manualPrice) {
      priceEurByAsset.set(
        a.id,
        d(convertToEurSync(a.manualPrice.toString(), a.currency || "EUR", fx))
      );
    }
  }

  const positionsValueByPlatform = new Map<string, ReturnType<typeof zero>>();
  const costBasisByPlatform = new Map<string, ReturnType<typeof zero>>();
  const openPositionCountByPlatform = new Map<string, number>();
  for (const pos of led.positions.values()) {
    if (pos.quantity.lte(0)) continue;
    const platformId = pos.platformId;
    openPositionCountByPlatform.set(
      platformId,
      (openPositionCountByPlatform.get(platformId) || 0) + 1
    );
    let price = priceEurByAsset.get(pos.assetId) || zero();
    if (price.isZero() && pos.costBasisEur.gt(0) && pos.quantity.gt(0)) {
      price = pos.costBasisEur.div(pos.quantity);
    }
    const mv = pos.quantity.times(price);
    positionsValueByPlatform.set(
      platformId,
      (positionsValueByPlatform.get(platformId) || zero()).plus(mv)
    );
    costBasisByPlatform.set(
      platformId,
      (costBasisByPlatform.get(platformId) || zero()).plus(pos.costBasisEur)
    );
  }

  return platforms.map((p) => {
    // Ledger cash (APPORT/RETRAIT/revenus) + soldes saisis Banques/Livrets
    // rattachés par nom de banque (ex. « Revolut » compte + plateforme Revolut).
    const ledgerCash = led.cashByPlatform.get(p.id) ?? zero();
    const pocketCash =
      bankCashByName.get(normalizePlatformSearch(p.name)) || zero();
    const cashEur = ledgerCash.plus(pocketCash);
    const positionsValueEur = positionsValueByPlatform.get(p.id) || zero();
    const totalValueEur = cashEur.plus(positionsValueEur);
    const lastAt = lastTxByPlatform.get(p.id);
    const costBasisEur = costBasisByPlatform.get(p.id) || zero();
    const unrealizedPnlEur = positionsValueEur.minus(costBasisEur);
    const unrealizedPnlPct = costBasisEur.gt(0)
      ? unrealizedPnlEur.div(costBasisEur).times(100)
      : zero();
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      subtype: p.subtype ?? null,
      notes: p.notes,
      logoKey: p.logoKey,
      logoUrl: resolvePlatformLogo({
        logoKey: p.logoKey,
        logoUrl: p.logoUrl,
        name: p.name,
      }),
      walletAddress: p.walletAddress,
      // Le secret ne quitte jamais le serveur (voir doc du paramètre plus haut) —
      // seule sa présence est exposée, pour préremplir un hint côté UI.
      hasWalletApiKey: Boolean(
        (p as { walletApiKey?: string | null }).walletApiKey
      ),
      cashEur: toFixed(cashEur, 8),
      cashBase: convertFromEurSync(cashEur, baseCurrency, fx),
      /** Cash issu des poches Banques/Livrets uniquement (hors ledger) */
      bankPocketCashEur: toFixed(pocketCash, 8),
      bankPocketCashBase: convertFromEurSync(pocketCash, baseCurrency, fx),
      positionCount: openPositionCountByPlatform.get(p.id) || 0,
      positionsValueEur: toFixed(positionsValueEur, 8),
      positionsValueBase: convertFromEurSync(positionsValueEur, baseCurrency, fx),
      totalValueEur: toFixed(totalValueEur, 8),
      totalValueBase: convertFromEurSync(totalValueEur, baseCurrency, fx),
      /** P&L latent des positions ouvertes (hors cash) — marché vs coût de revient */
      unrealizedPnlEur: toFixed(unrealizedPnlEur, 8),
      unrealizedPnlBase: convertFromEurSync(unrealizedPnlEur, baseCurrency, fx),
      unrealizedPnlPct: toFixed(unrealizedPnlPct, 4),
      lastTransactionAt: lastAt ? lastAt.toISOString() : null,
    };
  });
}

/** FCPE / PEE / PER — valeur = parts × VL, convertie en EUR */
export async function getEmployeeSavingsTotalEur(
  userId: string,
  rates?: Record<string, number>
) {
  const fx = rates ?? (await getEurRates());
  try {
    const rows = await prisma.employeeSavingsLine.findMany({
      where: { userId },
      select: { units: true, nav: true, currency: true },
    });
    let total = zero();
    for (const r of rows) {
      const mv = d(r.units.toString()).times(d(r.nav.toString()));
      total = total.plus(
        d(convertToEurSync(mv.toString(), r.currency || "EUR", fx))
      );
    }
    return total;
  } catch (e) {
    console.error("[portfolio] employee savings total failed:", e);
    return zero();
  }
}

export async function getLiabilitiesTotalEur(
  userId: string,
  rates?: Record<string, number>
) {
  const fx = rates ?? (await getEurRates());
  const items = await prisma.liability.findMany({ where: { userId } });
  let total = zero();
  for (const l of items) {
    total = total.plus(d(convertToEurSync(l.remainingAmount.toString(), l.currency, fx)));
  }
  return total;
}

/** Single-pass summary — no double ledger/holdings loads */
export async function getPortfolioBundle(userId: string, baseCurrency = "EUR") {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const base = baseCurrency || user?.baseCurrency || "EUR";

  // One FX fetch, one ledger, then derive everything
  const rates = await getEurRates();
  const ledger = await loadLedgerForUser(userId);
  const toBase = (v: ReturnType<typeof d>) => convertFromEurSync(v, base, rates);

  const { getExplicitCashTotalEur } = await import("../cash/pockets");
  const { getAlternativesPortfolioSlice } = await import("../alternatives/portfolio");

  const [holdings, platforms, liabilitiesEur, explicitCash, alternatives, esEur] =
    await Promise.all([
      getHoldings(userId, base, rates),
      getPlatformCashBalances(userId, base, rates, ledger),
      getLiabilitiesTotalEur(userId, rates),
      getExplicitCashTotalEur(userId),
      getAlternativesPortfolioSlice(userId, rates).catch((err) => {
        console.error("[portfolio] alternatives slice failed:", err);
        return {
          metalsEur: 0,
          privateEquityEur: 0,
          crowdlendingEur: 0,
          tangiblesEur: 0,
          totalEur: 0,
          slices: [] as { id: string; name: string; value: number }[],
        };
      }),
      getEmployeeSavingsTotalEur(userId, rates),
    ]);

  const marketValue = holdings.reduce((acc, h) => acc.plus(d(h.marketValueEur)), zero());
  const costBasis = totalCostBasis(ledger);
  // Cash pockets: only balances explicitly entered and > 0 (banks, livrets, CTO/PEA/AV)
  const cash = explicitCash.totalEur;
  const alternativesEur = d(String(alternatives?.totalEur ?? 0));
  const employeeSavingsEur = esEur;
  // Sous-totaux informatifs — déjà inclus dans marketValue (holdings), pas
  // additifs au net worth (contrairement à alternatives/ES qui vivent hors holdings).
  const realEstateEur = holdings
    .filter((h) => h.accountType === "IMMOBILIER")
    .reduce((acc, h) => acc.plus(d(h.marketValueEur)), zero());
  const lifeInsuranceEur = holdings
    .filter((h) => h.accountType === "AV")
    .reduce((acc, h) => acc.plus(d(h.marketValueEur)), zero());
  const realized = totalRealizedPnl(ledger);
  const unrealized = marketValue.minus(costBasis);
  const cashIncome = ledger.cashIncomeEur;
  const totalReturn = unrealized.plus(realized).plus(cashIncome);
  // Net worth = cotés + cash + alternatifs + épargne salariale − passifs
  // Note crowdlending: capital ACTIVE/LATE only (see alternatives/portfolio.ts)
  const totalAssets = marketValue
    .plus(cash)
    .plus(alternativesEur)
    .plus(employeeSavingsEur);
  const netWorth = totalAssets.minus(liabilitiesEur);

  const summary = {
    baseCurrency: base,
    totalMarketValueEur: toFixed(marketValue, 8),
    totalCostBasisEur: toFixed(costBasis, 8),
    totalCashEur: toFixed(cash, 8),
    totalAlternativesEur: toFixed(alternativesEur, 8),
    totalAlternativesBase: toBase(alternativesEur),
    totalEmployeeSavingsEur: toFixed(employeeSavingsEur, 8),
    totalEmployeeSavingsBase: toBase(employeeSavingsEur),
    /** Sous-total holdings accountType=IMMOBILIER — déjà dans totalMarketValueEur */
    totalRealEstateEur: toFixed(realEstateEur, 8),
    totalRealEstateBase: toBase(realEstateEur),
    /** Sous-total holdings accountType=AV — déjà dans totalMarketValueEur */
    totalLifeInsuranceEur: toFixed(lifeInsuranceEur, 8),
    totalLifeInsuranceBase: toBase(lifeInsuranceEur),
    /** Actif brut = cotés + cash + alternatifs + ES */
    portfolioPlusCashEur: toFixed(totalAssets, 8),
    totalGrossAssetsEur: toFixed(totalAssets, 8),
    totalGrossAssetsBase: toBase(totalAssets),
    totalLiabilitiesEur: toFixed(liabilitiesEur, 8),
    netWorthEur: toFixed(netWorth, 8),
    unrealizedPnlEur: toFixed(unrealized, 8),
    realizedPnlEur: toFixed(realized, 8),
    cashIncomeEur: toFixed(cashIncome, 8),
    totalReturnEur: toFixed(totalReturn, 8),
    totalMarketValueBase: toBase(marketValue),
    totalCostBasisBase: toBase(costBasis),
    totalCashBase: toBase(cash),
    totalLiabilitiesBase: toBase(liabilitiesEur),
    netWorthBase: toBase(netWorth),
    unrealizedPnlBase: toBase(unrealized),
    realizedPnlBase: toBase(realized),
    cashIncomeBase: toBase(cashIncome),
    totalReturnBase: toBase(totalReturn),
    assetCount: holdings.length,
    holdings,
    alternativesBreakdown: alternatives.slices,
  };

  const byClass: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const byAccountType: Record<string, number> = {};
  for (const h of holdings) {
    const v = Number(h.marketValueBase || h.marketValueEur);
    byClass[h.assetClass] = (byClass[h.assetClass] ?? 0) + v;
    byPlatform[h.platformName] = (byPlatform[h.platformName] ?? 0) + v;
    const at = h.accountType;
    byAccountType[at] = (byAccountType[at] ?? 0) + v;
  }
  // Cash (poches banques + ledger) rattaché aux plateformes pour le camembert « par plateforme »
  for (const p of platforms) {
    const cash = Number(p.cashBase || p.cashEur || 0);
    if (cash > 0) {
      byPlatform[p.name] = (byPlatform[p.name] ?? 0) + cash;
    }
  }
  // Classe CASH = total cash patrimoine (poches Banques/Livrets/enveloppes/AV > 0)
  const cashClassBase = Number(summary.totalCashBase || summary.totalCashEur || 0);
  if (cashClassBase > 0) {
    byClass["CASH"] = (byClass["CASH"] ?? 0) + cashClassBase;
    byAccountType["CASH"] = (byAccountType["CASH"] ?? 0) + cashClassBase;
  }

  return {
    holdings,
    platforms,
    summary,
    allocation: {
      byClass: Object.entries(byClass).map(([name, value]) => ({ name, value })),
      byPlatform: Object.entries(byPlatform).map(([name, value]) => ({ name, value })),
      byAccountType: Object.entries(byAccountType).map(([name, value]) => ({
        name,
        value,
      })),
    },
    baseCurrency: base,
  };
}

export async function getPortfolioSummary(userId: string, baseCurrency = "EUR") {
  const bundle = await getPortfolioBundle(userId, baseCurrency);
  return bundle.summary;
}

/**
 * Persist a portfolio snapshot (positions + cash).
 * At most one snapshot per UTC day is kept and updated in place.
 * Called after price refresh so the evolution chart has data over time.
 */
export async function recordPortfolioSnapshot(userId: string) {
  const bundle = await getPortfolioBundle(userId, "EUR");
  const s = bundle.summary;

  const totalValueEur = d(s.portfolioPlusCashEur);
  const totalCostEur = d(s.totalCostBasisEur);
  const cashTotalEur = d(s.totalCashEur);
  const realizedPnlEur = d(s.realizedPnlEur);
  const unrealizedPnlEur = d(s.unrealizedPnlEur);
  const cashIncomeEur = d(s.cashIncomeEur);
  const assetCount = Number(s.assetCount) || 0;

  /*
    Journée civile **parisienne**, et non UTC.

    Le découpage se faisait à minuit UTC, seul endroit de l'application à le
    faire. En été, un relevé pris entre minuit et 2 h du matin retombait dans
    le seau de la veille et en écrasait la clôture : la journée précédente
    perdait sa valeur de fermeture, remplacée par une valeur d'ouverture.
  */
  const today = parisDayKey(new Date());
  const dayStart = parisDayStart(today);
  const dayEnd = new Date(endOfParisDay(today).getTime() + 1);

  const existing = await prisma.portfolioSnapshot.findFirst({
    where: {
      userId,
      date: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { date: "desc" },
  });

  if (existing) {
    await prisma.portfolioSnapshot.updateMany({
      where: { id: existing.id, userId },
      data: {
        totalValueEur: toFixed(totalValueEur, 8),
        totalCostEur: toFixed(totalCostEur, 8),
        cashTotalEur: toFixed(cashTotalEur, 8),
        realizedPnlEur: toFixed(realizedPnlEur, 8),
        unrealizedPnlEur: toFixed(unrealizedPnlEur, 8),
        cashIncomeEur: toFixed(cashIncomeEur, 8),
        assetCount,
        date: new Date(),
      },
    });
    return prisma.portfolioSnapshot.findFirstOrThrow({
      where: { id: existing.id, userId },
    });
  }

  return prisma.portfolioSnapshot.create({
    data: {
      userId,
      date: new Date(),
      totalValueEur: toFixed(totalValueEur, 8),
      totalCostEur: toFixed(totalCostEur, 8),
      cashTotalEur: toFixed(cashTotalEur, 8),
      realizedPnlEur: toFixed(realizedPnlEur, 8),
      unrealizedPnlEur: toFixed(unrealizedPnlEur, 8),
      cashIncomeEur: toFixed(cashIncomeEur, 8),
      assetCount,
    },
  });
}

export type PortfolioHistoryPoint = {
  date: string;
  label: string;
  totalValueEur: number;
  cashTotalEur: number;
  totalValueBase: number;
  cashTotalBase: number;
  positionsBase?: number;
  realizedPnlBase?: number;
  unrealizedPnlBase?: number;
  cashIncomeBase?: number;
  dividendsBase?: number;
  couponsBase?: number;
  rentsBase?: number;
  totalCostBase?: number;
  isLive?: boolean;

  /** Valeur brute des actifs — la métrique par défaut de la courbe. */
  grossAssetsBase?: number;
  /** `grossAssets - liabilities`. */
  netWorthBase?: number;
  liabilitiesBase?: number;
  /** Capital externe entré (net) ce jour-là — jamais compté en performance. */
  externalFlowsBase?: number;
  /** Résultat du jour, flux neutralisés. */
  investmentPerformanceBase?: number;

  securitiesBase?: number;
  cryptoBase?: number;
  realEstateBase?: number;
  lifeInsuranceBase?: number;
  alternativesBase?: number;
  employeeSavingsBase?: number;
  otherAssetsBase?: number;

  /** `EXACT` | `ESTIMATED` | `MISSING` — cf. moteur historique. */
  status?: HistoricalDataStatus;
  /** Compartiments qui n'étaient pas exacts ce jour-là. */
  estimatedComponents?: ValuationComponent[];
  /**
   * Au moins une position n'avait aucun cours connu ce jour-là et a été
   * retenue à son prix de revient. Le point reste utilisable, il n'est
   * simplement pas exact — à l'UI de le dire plutôt que de le taire.
   */
  estimated?: boolean;
};

/**
 * Cumul des revenus par type (net EUR) jusqu’à chaque date de snapshot.
 * Source : journal (DIVIDENDE / COUPON / LOYER).
 */
function attachIncomeSplit(
  points: PortfolioHistoryPoint[],
  incomeRows: Array<{
    type: string;
    occurredAt: Date;
    netCashImpactEur: { toString(): string };
  }>,
  toBase: (eur: ReturnType<typeof d>) => number
): void {
  if (points.length === 0) return;

  let i = 0;
  let div = d(0);
  let coup = d(0);
  let rent = d(0);

  for (const p of points) {
    const t = Date.parse(p.date);
    while (i < incomeRows.length) {
      const row = incomeRows[i]!;
      if (row.occurredAt.getTime() > t) break;
      const net = d(row.netCashImpactEur.toString());
      if (row.type === "DIVIDENDE") div = div.plus(net);
      else if (row.type === "COUPON") coup = coup.plus(net);
      else if (row.type === "LOYER") rent = rent.plus(net);
      i++;
    }
    p.dividendsBase = toBase(div);
    p.couponsBase = toBase(coup);
    p.rentsBase = toBase(rent);
    // Si le snapshot n’a pas de cashIncome, reconstruire le total split
    if (p.cashIncomeBase == null || p.cashIncomeBase === 0) {
      const sum = toBase(div.plus(coup).plus(rent));
      if (sum > 0) p.cashIncomeBase = sum;
    }
  }
}

/**
 * Nombre de points renvoyés à l'écran. La série est toujours calculée au jour
 * le jour ; seul l'affichage est échantillonné, et jamais en modifiant une
 * valeur (cf. `downsampleSeries`).
 */
const HISTORY_DISPLAY_POINTS = 900;

/**
 * Réduit une série quotidienne pour l'affichage **sans jamais altérer une
 * valeur**.
 *
 * Trois catégories de points sont conservées quoi qu'il arrive : le premier, le
 * dernier, et tous ceux qui portent un mouvement notable — flux externe, saut
 * de valeur. Le reste est échantillonné régulièrement. Un point conservé garde
 * exactement la valeur calculée : l'échantillonnage retire des points, il n'en
 * lisse aucun et n'en invente aucun.
 */
export function downsampleSeries<T extends { grossAssets: number; externalFlows: number }>(
  series: T[],
  maxPoints = HISTORY_DISPLAY_POINTS
): T[] {
  if (series.length <= maxPoints) return series;

  const keep = new Set<number>([0, series.length - 1]);

  /*
    La fenêtre récente reste au jour le jour.

    Les plages courtes — 7J, 1M, 3M, 6M, YTD, 1A — filtrent cette même série :
    si l'échantillonnage y retirait des jours, « 7J » afficherait trois points
    au lieu de sept et la granularité annoncée serait fausse. Seul le passé
    lointain, que l'écran ne montre qu'écrasé sur quelques pixels, est
    échantillonné.
  */
  const DAILY_TAIL_DAYS = 400;
  for (let i = Math.max(0, series.length - DAILY_TAIL_DAYS); i < series.length; i++) {
    keep.add(i);
  }

  // Amplitude de référence : un mouvement compte s'il pèse dans la courbe.
  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    if (p.grossAssets < min) min = p.grossAssets;
    if (p.grossAssets > max) max = p.grossAssets;
  }
  const threshold = Math.max((max - min) * 0.005, 1e-9);

  for (let i = 1; i < series.length; i++) {
    const p = series[i]!;
    if (p.externalFlows !== 0) keep.add(i);
    else if (Math.abs(p.grossAssets - series[i - 1]!.grossAssets) >= threshold) {
      keep.add(i);
      // Garder la veille rend la marche lisible plutôt que rétroactive.
      keep.add(i - 1);
    }
  }

  const step = Math.max(1, Math.ceil(series.length / maxPoints));
  for (let i = 0; i < series.length; i += step) keep.add(i);

  return [...keep].sort((a, b) => a - b).map((i) => series[i]!);
}

/**
 * Rendement pondéré par le temps (TWR) d'une série.
 *
 * Un apport n'est pas une performance : chaîner les rendements période par
 * période, en retirant les flux de chaque période, est la seule façon de mesurer
 * ce que les investissements ont produit indépendamment des versements. C'est
 * la réponse au « +178 % » qui n'était qu'un changement de périmètre.
 *
 * Renvoie `null` tant qu'aucune période n'a de base positive — un patrimoine
 * qui démarre à zéro n'a pas de rendement, il a des versements.
 */
export function timeWeightedReturnPct(
  series: Array<{ grossAssets: number; externalFlows: number }>
): number | null {
  if (series.length < 2) return null;
  let factor = 1;
  let measured = false;

  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!.grossAssets;
    const curr = series[i]!.grossAssets;
    const flow = series[i]!.externalFlows;
    // Le capital exposé sur la période inclut le flux du jour : sans lui, un
    // versement le jour même compterait comme un gain sur la base de la veille.
    const base = prev + flow;
    if (base <= 0) continue;
    factor *= curr / base;
    measured = true;
  }

  return measured ? (factor - 1) * 100 : null;
}

/**
 * Courbe d'évolution du patrimoine — **une seule** source de vérité.
 *
 * Toute la série, point du jour compris, sort du moteur de valorisation
 * historique (`historical/engine.ts`). Il n'y a plus de fusion entre une
 * reconstruction, des snapshots et un point « live » calculé autrement : ces
 * trois définitions produisaient trois valeurs différentes, et la marche entre
 * la dernière et les autres se lisait comme un mouvement de marché.
 *
 * Les `PortfolioSnapshot` ne sont **plus** injectés dans la courbe. Ils restent
 * en base comme points de contrôle — ils ne couvrent que le périmètre
 * « titres » et les mélanger réintroduirait l'incohérence de périmètre que ce
 * chantier corrige.
 */
export async function getPortfolioHistory(
  userId: string,
  baseCurrency = "EUR",
  sinceDate?: Date
): Promise<PortfolioHistoryPoint[]> {
  const [rates, inputs, incomeRows] = await Promise.all([
    getEurRates(),
    loadHistoricalInputs(userId),
    prisma.transaction.findMany({
      where: { userId, type: { in: ["DIVIDENDE", "COUPON", "LOYER"] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { type: true, occurredAt: true, netCashImpactEur: true },
    }),
  ]);

  const toBase = (eur: ReturnType<typeof d>) =>
    Number(convertFromEurSync(eur, baseCurrency, rates));

  const engine = new PortfolioValuationEngine(inputs);
  const earliest = engine.earliestDay();
  if (!earliest) return [];

  const todayParis = parisDayKey(new Date());
  const from =
    sinceDate && parisDayKey(sinceDate) > earliest ? parisDayKey(sinceDate) : earliest;

  const full = engine.buildSeries(from, todayParis);
  if (full.length === 0) return [];

  const shown = downsampleSeries(full);

  /*
    L'horodatage n'est calculé que pour les points réellement rendus.

    `endOfParisDay` et `Intl.DateTimeFormat` passent par la base de fuseaux :
    les appeler sur chaque jour de la série complète coûtait plusieurs secondes
    sur un historique long, pour des points qui n'atteignaient jamais l'écran.
  */
  const labelFmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });

  const points: PortfolioHistoryPoint[] = shown.map((p, i) => {
    const grossBase = toBase(d(p.grossAssets));
    const cashBase = toBase(d(p.cash));
    const at = endOfParisDay(p.day);
    return {
      date: at.toISOString(),
      label: labelFmt.format(at),

      // Champs historiques conservés : la valeur affichée par défaut est la
      // valeur brute des actifs (cf. §3 du chantier).
      totalValueEur: p.grossAssets,
      cashTotalEur: p.cash,
      totalValueBase: grossBase,
      cashTotalBase: cashBase,
      positionsBase: grossBase - cashBase,

      grossAssetsBase: grossBase,
      netWorthBase: toBase(d(p.netWorth)),
      liabilitiesBase: toBase(d(p.liabilities)),
      externalFlowsBase: toBase(d(p.externalFlows)),
      investmentPerformanceBase: toBase(d(p.investmentPerformance)),

      securitiesBase: toBase(d(p.securities)),
      cryptoBase: toBase(d(p.crypto)),
      realEstateBase: toBase(d(p.realEstate)),
      lifeInsuranceBase: toBase(d(p.lifeInsurance)),
      alternativesBase: toBase(d(p.alternatives)),
      employeeSavingsBase: toBase(d(p.employeeSavings)),
      otherAssetsBase: toBase(d(p.otherAssets)),

      status: p.status,
      estimatedComponents: p.estimatedComponents,
      estimated: p.status === "ESTIMATED" || undefined,
      isLive: i === shown.length - 1 && p.day === todayParis ? true : undefined,
    };
  });

  attachIncomeSplit(points, incomeRows, toBase);

  return points;
}

/**
 * Valeur du patrimoine aujourd'hui, par le moteur historique.
 *
 * Le dashboard et le dernier point de la courbe passent tous deux par ici : il
 * n'existe plus de chemin « live » qui additionnerait les compartiments dans un
 * ordre ou un périmètre différents.
 */
export async function getPortfolioValuationToday(
  userId: string
): Promise<PortfolioValuationPoint> {
  const inputs = await loadHistoricalInputs(userId);
  const engine = new PortfolioValuationEngine(inputs);
  return engine.calculateAt(parisDayKey(new Date()));
}

export async function getAssetDetail(userId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId },
    include: {
      platform: true,
      priceQuote: true,
    },
  });
  if (!asset) return null;

  const isCrypto =
    asset.assetClass === "CRYPTO" || asset.accountType === "CRYPTO";
  const tickerNorm = (asset.ticker || "").trim().toUpperCase();

  // Agrégat multi-plateformes : tous les assetIds même ticker + enveloppe (crypto)
  // (getHoldings merge en 1 ligne — on re-query la base pour les siblings)
  let siblingAssets: Array<{
    id: string;
    platformId: string;
    platform: {
      id: string;
      name: string;
      type: string;
      logoKey: string | null;
      logoUrl: string | null;
      subtype: string | null;
    };
  }> = [
    {
      id: asset.id,
      platformId: asset.platformId,
      platform: asset.platform,
    },
  ];

  if (isCrypto && tickerNorm) {
    const rows = await prisma.asset.findMany({
      where: {
        userId,
        accountType: asset.accountType || "CRYPTO",
        assetClass: "CRYPTO",
        ticker: { equals: asset.ticker!, mode: "insensitive" },
      },
      select: {
        id: true,
        platformId: true,
        platform: {
          select: {
            id: true,
            name: true,
            type: true,
            logoKey: true,
            logoUrl: true,
            subtype: true,
          },
        },
      },
    });
    if (rows.length > 0) siblingAssets = rows;
  }

  const siblingIds = siblingAssets.map((s) => s.id);
  const holdings = await getHoldings(userId, "EUR");
  // Ligne agrégée (après merge) ou fallback assetId
  const holding =
    holdings.find((h) => siblingIds.includes(h.assetId)) ??
    holdings.find((h) => h.assetId === assetId) ??
    null;

  // Qtés par assetId via ledger (avant merge UI)
  const ledger = await loadLedgerForUser(userId);
  const priceEur = asset.priceQuote
    ? d(asset.priceQuote.priceEur.toString())
    : asset.manualPrice
      ? d(asset.manualPrice.toString())
      : zero();

  const custodySlices = siblingAssets.map((s) => {
    let qty = zero();
    let cost = zero();
    for (const pos of ledger.positions.values()) {
      if (pos.assetId === s.id && pos.quantity.gt(0)) {
        qty = qty.plus(pos.quantity);
        cost = cost.plus(pos.costBasisEur);
      }
    }
    const mv = qty.times(priceEur.gt(0) ? priceEur : zero());
    const chainKey = resolveBlockchainKey({
      platformType: s.platform.type,
      platformLogoKey: s.platform.logoKey,
      platformName: s.platform.name,
      platformSubtype: s.platform.subtype,
      accountType: asset.accountType,
      assetClass: asset.assetClass,
    });
    return {
      assetId: s.id,
      platformId: s.platformId,
      platformName: s.platform.name,
      platformLogoUrl: resolvePlatformLogo({
        logoKey: s.platform.logoKey,
        logoUrl: s.platform.logoUrl,
        name: s.platform.name,
      }),
      blockchainKey: chainKey,
      quantity: toFixed(qty, 12),
      marketValueEur: toFixed(mv.gt(0) ? mv : cost, 8),
    };
  }).filter((s) => Number(s.quantity) > 0 || siblingAssets.length === 1);

  const custodyDistribution = buildCustodyDistribution(custodySlices);

  const platforms = siblingAssets.map((s) => ({
    id: s.platformId,
    name: s.platform.name,
    logoUrl: resolvePlatformLogo({
      logoKey: s.platform.logoKey,
      logoUrl: s.platform.logoUrl,
      name: s.platform.name,
    }),
    assetId: s.id,
  }));
  // Dédup plateformes (même platformId rare)
  const platformsUnique = [
    ...new Map(platforms.map((p) => [p.id, p])).values(),
  ];

  const allTxs = await prisma.transaction.findMany({
    where: { userId, assetId: { in: siblingIds } },
    include: {
      platform: {
        select: { id: true, name: true, logoKey: true, logoUrl: true },
      },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });

  const chainKey = resolveBlockchainKey({
    platformType: asset.platform.type,
    platformLogoKey: asset.platform.logoKey,
    platformName: asset.platform.name,
    platformSubtype: asset.platform.subtype,
    assetNotes: asset.notes,
    providerSymbol: asset.providerSymbol,
    accountType: asset.accountType,
    assetClass: asset.assetClass,
  });

  return {
    asset: {
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      isin: asset.isin ?? null,
      assetClass: asset.assetClass,
      category:
        (asset as { category?: string | null }).category || "UNCLASSIFIED",
      accountType: asset.accountType,
      currency: asset.currency,
      countryCode: asset.countryCode ?? null,
      withholdingTaxRate: asset.withholdingTaxRate?.toString() ?? null,
      priceProvider: asset.priceProvider,
      providerSymbol: asset.providerSymbol,
      platformId: asset.platformId,
      platformName: asset.platform.name,
      platformLogoUrl: resolvePlatformLogo({
        logoKey: asset.platform.logoKey,
        logoUrl: asset.platform.logoUrl,
        name: asset.platform.name,
      }),
      platformType: asset.platform.type,
      platformLogoKey: asset.platform.logoKey,
      blockchainKey: chainKey,
      blockchainLabel: blockchainLabel(chainKey),
      /** Nb de plateformes distinctes de l’agrégat */
      platformCount: platformsUnique.length,
      siblingAssetIds: siblingIds,
      assetLogoUrl: resolveAssetLogo({
        logoUrl: asset.logoUrl,
        ticker: asset.ticker,
        isin: asset.isin,
        name: asset.name,
        assetClass: asset.assetClass,
      }),
      priceQuote: asset.priceQuote
        ? {
            priceNative: asset.priceQuote.priceNative.toString(),
            priceEur: asset.priceQuote.priceEur.toString(),
            nativeCurrency: asset.priceQuote.nativeCurrency,
            source: asset.priceQuote.source,
            status: asset.priceQuote.status,
            lastUpdatedAt: asset.priceQuote.lastUpdatedAt.toISOString(),
          }
        : null,
    },
    holding,
    custodyDistribution,
    platforms: platformsUnique,
    transactions: allTxs.map((t) => ({
      id: t.id,
      type: t.type,
      occurredAt: t.occurredAt.toISOString(),
      quantity: t.quantity?.toString() ?? null,
      unitPrice: t.unitPrice?.toString() ?? null,
      fees: t.fees.toString(),
      currency: t.currency,
      fxRateToEur: t.fxRateToEur.toString(),
      grossAmountEur: t.grossAmountEur.toString(),
      feesEur: t.feesEur?.toString?.() ?? t.fees.toString(),
      netCashImpactEur: t.netCashImpactEur.toString(),
      withholdingTaxEur: String(
        (t as { withholdingTaxEur?: { toString(): string } }).withholdingTaxEur ??
          0
      ),
      withholdingTaxRate:
        (
          t as { withholdingTaxRate?: { toString(): string } | null }
        ).withholdingTaxRate?.toString() ?? null,
      exDate:
        (t as { exDate?: Date | null }).exDate?.toISOString() ?? null,
      paymentDate:
        (t as { paymentDate?: Date | null }).paymentDate?.toISOString() ?? null,
      notes: t.notes,
      platformId: t.platformId,
      platformName: t.platform?.name ?? null,
      platformLogoUrl: t.platform
        ? resolvePlatformLogo({
            logoKey: t.platform.logoKey,
            logoUrl: t.platform.logoUrl,
            name: t.platform.name,
          })
        : null,
      toPlatformId: t.toPlatformId,
      assetId: t.assetId,
    })),
  };
}
