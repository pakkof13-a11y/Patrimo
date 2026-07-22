import { prisma } from "../prisma";
import { d, toFixed, zero } from "../money/decimal";
import {
  replayTransactions,
  totalCash,
  totalCostBasis,
  totalRealizedPnl,
  type LedgerTx,
  type TxType,
} from "../accounting";
import { convertFromEurSync, convertToEurSync, getEurRates } from "../market/fx";
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

function mapDbTx(row: {
  id: string;
  type: string;
  platformId: string;
  toPlatformId: string | null;
  assetId: string | null;
  quantity: { toString(): string } | null;
  unitPrice: { toString(): string } | null;
  fees: { toString(): string };
  currency: string;
  fxRateToEur: { toString(): string };
  grossAmountEur: { toString(): string };
  occurredAt: Date;
}): LedgerTx {
  const qty = row.quantity ? d(row.quantity.toString()) : null;
  const unit = row.unitPrice ? d(row.unitPrice.toString()) : null;
  const fees = d(row.fees.toString());
  const fx = d(row.fxRateToEur.toString());
  const grossEur = d(row.grossAmountEur.toString());
  // For cash ops without qty/price, recover original amount from EUR / fx
  const cashAmountOriginal =
    qty && unit
      ? qty.times(unit)
      : ["APPORT", "RETRAIT", "FRAIS", "DIVIDENDE", "COUPON", "LOYER", "INTERET", "TRANSFERT_CASH"].includes(
            row.type
          )
        ? fx.isZero()
          ? grossEur
          : grossEur.div(fx)
        : null;

  return {
    id: row.id,
    type: row.type as TxType,
    platformId: row.platformId,
    toPlatformId: row.toPlatformId,
    assetId: row.assetId,
    quantity: qty,
    unitPrice: unit,
    fees,
    currency: row.currency,
    fxRateToEur: fx,
    cashAmountOriginal,
    grossOriginal: qty && unit ? qty.times(unit) : null,
    occurredAt: row.occurredAt,
  };
}

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
      include: { platform: true, priceQuote: true },
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
    };
    leg.platformSlices = [sliceFromHoldingLeg(leg)];
    rows.push(leg);
  }

  // Merge :
  // 1) même assetId multi-plateforme
  // 2) crypto même ticker + enveloppe → une ligne (ETH Base + ETH Revolut)
  function mergeKey(row: HoldingRow): string {
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
      walletApiKey:
        (p as { walletApiKey?: string | null }).walletApiKey ?? null,
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

  // walletApiKey retiré ici : /api/holdings n'en a pas besoin (pas d'UI d'édition
  // de plateforme sur cette page) — évite de faire circuler la clé à chaque
  // rechargement du tableau de bord. /api/platforms (platforms-tab) la garde
  // car l'édition + la sync inline en ont besoin.
  const platformsWithoutApiKey = platforms.map(
    ({ walletApiKey: _walletApiKey, ...rest }) => rest
  );

  return {
    holdings,
    platforms: platformsWithoutApiKey,
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

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

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

/** Jour civil Europe/Paris → clé YYYY-MM-DD */
function parisDayKey(isoOrDate: string | Date): string {
  const iso =
    typeof isoOrDate === "string" ? isoOrDate : isoOrDate.toISOString();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** Liste inclusive des jours civils YYYY-MM-DD (UTC noon step). */
function enumerateDayKeysInclusive(first: string, last: string): string[] {
  if (first > last) return [first];
  const out: string[] = [];
  const [y0, m0, d0] = first.split("-").map(Number);
  const [y1, m1, d1] = last.split("-").map(Number);
  let t = Date.UTC(y0!, m0! - 1, d0!, 12, 0, 0);
  const end = Date.UTC(y1!, m1! - 1, d1!, 12, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  // Garde-fou : max ~15 ans
  const hardCap = 5500;
  while (t <= end && out.length < hardCap) {
    const dt = new Date(t);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    t += dayMs;
  }
  return out;
}

/**
 * Reconstruit des points d’évolution à partir des dates d’opération (`occurredAt`),
 * pas de `createdAt` ni des seuls snapshots post-import.
 *
 * Valorisation historique = coût d’acquisition (CUMP) + cash ledger
 * (sans séries de cours journalières). Le point live du jour utilise le marché.
 *
 * Entre deux jours de transaction, la valeur (au coût) est reportée chaque jour
 * civil pour que les plages 7J / 1M / … reflètent la vraie profondeur temporelle.
 */
export function buildHistoryFromOccurredAt(
  txs: LedgerTx[],
  toBase: (eur: ReturnType<typeof d>) => number,
  opts?: { maxPoints?: number; untilDayKey?: string }
): PortfolioHistoryPoint[] {
  if (txs.length === 0) return [];

  const sorted = [...txs].sort((a, b) => {
    const t = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });

  const firstDay = parisDayKey(sorted[0]!.occurredAt);
  const lastTxDay = parisDayKey(sorted[sorted.length - 1]!.occurredAt);
  const lastDay =
    opts?.untilDayKey && opts.untilDayKey > lastTxDay
      ? opts.untilDayKey
      : lastTxDay;

  // Tous les jours civils du 1er occurredAt → fin (report de valorisation)
  let keys = enumerateDayKeysInclusive(firstDay, lastDay);

  // Échantillonner si trop dense : toujours conserver 1er, dernier, et jours de tx
  const maxPoints = opts?.maxPoints ?? 800;
  if (keys.length > maxPoints) {
    const mustKeep = new Set<string>([firstDay, lastDay]);
    for (const tx of sorted) {
      mustKeep.add(parisDayKey(tx.occurredAt));
    }
    const step = Math.ceil(keys.length / maxPoints);
    keys = keys.filter(
      (k, i) => mustKeep.has(k) || i % step === 0 || i === keys.length - 1
    );
    // Déduplique en gardant l’ordre
    const seenK = new Set<string>();
    keys = keys.filter((k) => {
      if (seenK.has(k)) return false;
      seenK.add(k);
      return true;
    });
  }

  const points: PortfolioHistoryPoint[] = [];
  let cursor = 0;
  const applied: LedgerTx[] = [];

  for (const day of keys) {
    // Inclure toutes les tx du jour (et antérieures non encore appliquées)
    // — tri strict par occurredAt, jamais createdAt
    while (cursor < sorted.length) {
      const tx = sorted[cursor]!;
      const tk = parisDayKey(tx.occurredAt);
      if (tk > day) break;
      applied.push(tx);
      cursor += 1;
    }

    if (applied.length === 0) continue;

    let state;
    try {
      state = replayTransactions(applied);
    } catch {
      state = replayTransactions(applied, {
        allowNegativeCash: true,
        clampOversell: true,
      });
    }

    const costEur = totalCostBasis(state);
    const cashEur = totalCash(state);
    const realizedEur = totalRealizedPnl(state);
    const incomeEur = state.cashIncomeEur;
    // Historique : positions au coût (pas de mark-to-market rétroactif)
    const totalEur = costEur.plus(cashEur);
    const totalBase = toBase(totalEur);
    const cashBase = toBase(cashEur);
    // Date à 12:00 UTC du jour civil pour un ancrage stable
    const [yy, mm, dd] = day.split("-").map(Number);
    const date = new Date(Date.UTC(yy!, mm! - 1, dd!, 12, 0, 0));

    points.push({
      date: date.toISOString(),
      label: new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        day: "2-digit",
        month: "short",
        year: "2-digit",
      }).format(date),
      totalValueEur: totalEur.toNumber(),
      cashTotalEur: cashEur.toNumber(),
      totalValueBase: totalBase,
      cashTotalBase: cashBase,
      positionsBase: totalBase - cashBase,
      realizedPnlBase: toBase(realizedEur),
      // Latent historique non connu sans prix → 0
      unrealizedPnlBase: 0,
      cashIncomeBase: toBase(incomeEur),
      totalCostBase: toBase(costEur),
    });
  }

  return points;
}

/** Snapshots + reconstruction `occurredAt` + point live pour l’Évolution. */
export async function getPortfolioHistory(
  userId: string,
  baseCurrency = "EUR"
): Promise<PortfolioHistoryPoint[]> {
  const [snapshots, rates, live, incomeRows, allTxRows] = await Promise.all([
    prisma.portfolioSnapshot.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 2200,
    }),
    getEurRates(),
    getPortfolioBundle(userId, baseCurrency),
    prisma.transaction.findMany({
      where: {
        userId,
        type: { in: ["DIVIDENDE", "COUPON", "LOYER"] },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        type: true,
        occurredAt: true,
        netCashImpactEur: true,
      },
    }),
    // Toutes les tx pour reconstruire l’historique sur occurredAt (pas createdAt)
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const toBase = (eur: ReturnType<typeof d>) =>
    Number(convertFromEurSync(eur, baseCurrency, rates));

  const ledgerTxs = allTxRows.map(mapDbTx);
  // Jusqu’à aujourd’hui (Paris) : l’historique suit les occurredAt même si
  // l’import a été fait le même jour (createdAt / snapshot bootstrap).
  const todayParis = parisDayKey(new Date());
  const fromTx = buildHistoryFromOccurredAt(ledgerTxs, toBase, {
    untilDayKey: todayParis,
  });

  // Snapshots marché (mark-to-market) — utile pour les jours récents post-import
  const snapshotsAsc = [...snapshots].reverse();
  const fromSnaps: PortfolioHistoryPoint[] = snapshotsAsc.map((s) => {
    const totalEur = d(s.totalValueEur.toString());
    const cashEur = d(s.cashTotalEur.toString());
    const realizedEur = d(s.realizedPnlEur.toString());
    const unrealizedEur = d(s.unrealizedPnlEur.toString());
    const incomeEur = d(s.cashIncomeEur.toString());
    const costEur = d(s.totalCostEur.toString());
    const totalBase = toBase(totalEur);
    const cashBase = toBase(cashEur);
    return {
      date: s.date.toISOString(),
      label: new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        day: "2-digit",
        month: "short",
      }).format(s.date),
      totalValueEur: totalEur.toNumber(),
      cashTotalEur: cashEur.toNumber(),
      totalValueBase: totalBase,
      cashTotalBase: cashBase,
      positionsBase: totalBase - cashBase,
      realizedPnlBase: toBase(realizedEur),
      unrealizedPnlBase: toBase(unrealizedEur),
      cashIncomeBase: toBase(incomeEur),
      totalCostBase: toBase(costEur),
    };
  });

  // Fusion : points ledger (occurredAt) + snapshots (jour civil).
  // Source de vérité temporelle = occurredAt des transactions (jamais createdAt).
  // Snapshots mark-to-market : utiles en fin de courbe, mais ne doivent pas
  // « collapser » l’historique sur la date d’import seule.
  const byDay = new Map<string, PortfolioHistoryPoint>();
  for (const p of fromTx) {
    byDay.set(parisDayKey(p.date), p);
  }
  const firstTxDay = fromTx.length > 0 ? parisDayKey(fromTx[0]!.date) : null;
  for (const p of fromSnaps) {
    const day = parisDayKey(p.date);
    // Ne pas injecter de snapshot antérieur au 1er occurredAt (artefacts)
    if (firstTxDay && day < firstTxDay) continue;
    const existing = byDay.get(day);
    // Sur un jour déjà reconstruit au coût : n’écraser que si le snapshot
    // apporte un mark-to-market (latent ≠ 0) ou cash différent — sinon garder
    // la reconstruction occurredAt (évite courbe plate « jour d’import »).
    if (existing && Math.abs(p.unrealizedPnlBase ?? 0) < 1e-9) {
      // Snapshot purement au coût / bootstrap : conserver fromTx
      continue;
    }
    byDay.set(day, p);
  }

  const points = [...byDay.values()].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date)
  );

  // Always append current live valuation so the chart is never empty / stale
  const liveTotal = d(live.summary.portfolioPlusCashEur);
  const liveCash = d(live.summary.totalCashEur);
  const liveRealized = d(String(live.summary.realizedPnlEur ?? 0));
  const liveUnrealized = d(String(live.summary.unrealizedPnlEur ?? 0));
  const liveIncome = d(String(live.summary.cashIncomeEur ?? 0));
  const liveCost = d(String(live.summary.totalCostBasisEur ?? 0));
  const todayKey = parisDayKey(new Date());
  const last = points[points.length - 1];
  const lastKey = last ? parisDayKey(last.date) : null;

  const liveTotalBase = toBase(liveTotal);
  const liveCashBase = toBase(liveCash);

  const livePoint: PortfolioHistoryPoint = {
    date: new Date().toISOString(),
    label: "Aujourd'hui",
    totalValueEur: liveTotal.toNumber(),
    cashTotalEur: liveCash.toNumber(),
    totalValueBase: liveTotalBase,
    cashTotalBase: liveCashBase,
    positionsBase: liveTotalBase - liveCashBase,
    realizedPnlBase: toBase(liveRealized),
    unrealizedPnlBase: toBase(liveUnrealized),
    cashIncomeBase: toBase(liveIncome),
    totalCostBase: toBase(liveCost),
    isLive: true,
  };

  if (!last || lastKey !== todayKey) {
    points.push(livePoint);
  } else {
    // Replace today's point with freshest live market value
    points[points.length - 1] = {
      ...livePoint,
      label: last.label || "Aujourd'hui",
    };
  }

  attachIncomeSplit(points, incomeRows, toBase);

  return points;
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
