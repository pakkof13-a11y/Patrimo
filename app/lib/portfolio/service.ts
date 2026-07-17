import { prisma } from "../prisma";
import { d, toFixed, zero } from "../money/decimal";
import {
  replayTransactions,
  totalCostBasis,
  totalRealizedPnl,
  type LedgerTx,
  type TxType,
} from "../accounting";
import { convertFromEurSync, convertToEurSync, getEurRates } from "../market/fx";
import { resolvePlatformLogo } from "../platforms/presets";
import { resolveAssetLogo } from "../assets/logos";

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
  /// CTO | PEA | AV | CRYPTO | IMMOBILIER
  accountType: string;
  currency: string;
  platformId: string;
  platformName: string;
  platformLogoUrl: string | null;
  assetLogoUrl: string | null;
  quantity: string;
  /** PRU / CUMP (EUR) — break-even unitaire frais inclus */
  avgCostEur: string;
  costBasisEur: string;
  currentPriceEur: string;
  currentPriceNative: string;
  marketValueEur: string;
  marketValueBase: string;
  costBasisBase: string;
  unrealizedPnlEur: string;
  unrealizedPnlBase: string;
  unrealizedPnlPct: string;
  priceSource: string | null;
  priceStatus: string | null;
  lastUpdatedAt: string | null;
  logoUrl: string | null;
  priceProvider: string;
  /** Fees paid on purchases (EUR, cumulative) */
  acquisitionFeesEur: string;
  acquisitionFeesBase: string;
  /** Passive income: dividends, coupons, rent, interest (EUR) */
  passiveIncomeEur: string;
  passiveIncomeBase: string;
  /** Break-even unit price (EUR) = PRU */
  breakEvenEur: string;
  breakEvenBase: string;
  /** % of total portfolio market value */
  allocationPct: string;
  /** % of same asset-class bucket */
  allocationPctOfClass: string;
  /** Exit levels (native currency) — null if unset / already fired */
  stopLoss: string | null;
  tp1: string | null;
  tp2: string | null;
  tp3: string | null;
  tp4: string | null;
};

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

    rows.push({
      assetId: pos.assetId,
      name: asset.name,
      ticker: asset.ticker,
      isin: asset.isin ?? null,
      assetClass: asset.assetClass,
      category:
        (asset as { category?: string | null }).category || "UNCLASSIFIED",
      accountType: asset.accountType || "CTO",
      currency: asset.currency || asset.priceQuote?.nativeCurrency || "EUR",
      platformId: pos.platformId,
      platformName: platform?.name || "—",
      platformLogoUrl: resolvePlatformLogo({
        logoKey: platform?.logoKey,
        logoUrl: platform?.logoUrl,
        name: platform?.name,
      }),
      assetLogoUrl: assetLogo,
      quantity: toFixed(pos.quantity, 8),
      avgCostEur: toFixed(avg, 8),
      costBasisEur: toFixed(pos.costBasisEur, 8),
      currentPriceEur: toFixed(priceEur, 8),
      currentPriceNative: toFixed(priceNative.gt(0) ? priceNative : priceEur, 8),
      marketValueEur: toFixed(marketValue, 8),
      marketValueBase: toBase(marketValue),
      costBasisBase: toBase(pos.costBasisEur),
      unrealizedPnlEur: toFixed(unrealized, 8),
      unrealizedPnlBase: toBase(unrealized),
      unrealizedPnlPct: toFixed(pct, 4),
      priceSource: asset.priceQuote?.source ?? (asset.manualPrice ? "manual" : "coût"),
      priceStatus: asset.priceQuote?.status ?? (asset.manualPrice ? "OK" : "OK"),
      lastUpdatedAt: asset.priceQuote?.lastUpdatedAt?.toISOString() ?? null,
      logoUrl: assetLogo,
      priceProvider: asset.priceProvider,
      acquisitionFeesEur: toFixed(fees, 8),
      acquisitionFeesBase: toBase(fees),
      passiveIncomeEur: toFixed(income, 8),
      passiveIncomeBase: toBase(income),
      breakEvenEur: toFixed(avg, 8),
      breakEvenBase: toBase(avg),
      allocationPct: "0",
      allocationPctOfClass: "0",
      stopLoss: asset.stopLoss?.toString() ?? null,
      tp1: asset.tp1?.toString() ?? null,
      tp2: asset.tp2?.toString() ?? null,
      tp3: asset.tp3?.toString() ?? null,
      tp4: asset.tp4?.toString() ?? null,
    });
  }

  // Merge same assetId (multi-platform) into one line so qty always accumulates visibly
  const merged = new Map<string, HoldingRow>();
  for (const row of rows) {
    const prev = merged.get(row.assetId);
    if (!prev) {
      merged.set(row.assetId, row);
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
    merged.set(row.assetId, {
      ...prev,
      accountType: prev.accountType || row.accountType || "CTO",
      platformName: platforms,
      quantity: toFixed(qty, 8),
      costBasisEur: toFixed(cost, 8),
      avgCostEur: toFixed(avg, 8),
      marketValueEur: toFixed(mv, 8),
      marketValueBase: toFixed(mvBase, 8),
      costBasisBase: toFixed(costBase, 8),
      unrealizedPnlEur: toFixed(unreal, 8),
      unrealizedPnlBase: toFixed(
        d(prev.unrealizedPnlBase).plus(d(row.unrealizedPnlBase)),
        8
      ),
      unrealizedPnlPct: toFixed(pct, 4),
      acquisitionFeesEur: toFixed(fees, 8),
      acquisitionFeesBase: toBase(fees),
      passiveIncomeEur: toFixed(income, 8),
      passiveIncomeBase: toBase(income),
      breakEvenEur: toFixed(avg, 8),
      breakEvenBase: toBase(avg),
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
    r.allocationPct = totalMv.gt(0) ? toFixed(mv.div(totalMv).times(100), 4) : "0";
    const classTotal = byClass.get(r.assetClass) || zero();
    r.allocationPctOfClass = classTotal.gt(0)
      ? toFixed(mv.div(classTotal).times(100), 4)
      : "0";
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
  const [led, platforms] = await Promise.all([
    ledger ? Promise.resolve(ledger) : loadLedgerForUser(userId),
    prisma.platform.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);

  return platforms.map((p) => {
    const cashEur = led.cashByPlatform.get(p.id) ?? zero();
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      subtype: p.subtype ?? null,
      notes: p.notes,
      logoKey: p.logoKey,
      logoUrl: resolvePlatformLogo({ logoKey: p.logoKey, logoUrl: p.logoUrl, name: p.name }),
      walletAddress: p.walletAddress,
      cashEur: toFixed(cashEur, 8),
      cashBase: convertFromEurSync(cashEur, baseCurrency, fx),
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
    const at = (h as HoldingRow & { accountType?: string }).accountType || "CTO";
    byAccountType[at] = (byAccountType[at] ?? 0) + v;
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

/** Snapshots + point live pour le module Évolution (historique long). */
export async function getPortfolioHistory(
  userId: string,
  baseCurrency = "EUR"
): Promise<PortfolioHistoryPoint[]> {
  const [snapshots, rates, live, incomeRows] = await Promise.all([
    prisma.portfolioSnapshot.findMany({
      where: { userId },
      // Prendre les plus récents (sinon take coupe l’historique récent)
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
  ]);

  const toBase = (eur: ReturnType<typeof d>) =>
    Number(convertFromEurSync(eur, baseCurrency, rates));

  // Remettre en ordre chronologique croissant pour la courbe
  const snapshotsAsc = [...snapshots].reverse();

  const points: PortfolioHistoryPoint[] = snapshotsAsc.map((s) => {
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

  // Always append current live valuation so the chart is never empty / stale
  const liveTotal = d(live.summary.portfolioPlusCashEur);
  const liveCash = d(live.summary.totalCashEur);
  const liveRealized = d(String(live.summary.realizedPnlEur ?? 0));
  const liveUnrealized = d(String(live.summary.unrealizedPnlEur ?? 0));
  const liveIncome = d(String(live.summary.cashIncomeEur ?? 0));
  const liveCost = d(String(live.summary.totalCostBasisEur ?? 0));
  const todayKey = new Date().toISOString().slice(0, 10);
  const last = points[points.length - 1];
  const lastKey = last ? last.date.slice(0, 10) : null;

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
    // Replace today's snapshot with freshest live value
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
      transactions: {
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      },
    },
  });
  if (!asset) return null;

  const holdings = await getHoldings(userId, "EUR");
  const holding = holdings.find((h) => h.assetId === assetId) ?? null;

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
    transactions: asset.transactions.map((t) => ({
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
      toPlatformId: t.toPlatformId,
      assetId: t.assetId,
    })),
  };
}
