/**
 * Portfolio fictif multi-onglets pour un utilisateur (admin ou demo).
 * ~30 positions, ~100–120 transactions sur ~3 ans, cash, dettes, AV,
 * épargne salariale, alternatives (métaux, PE, crowdlending, tangibles).
 */
import { Prisma, PrismaClient } from "@/app/lib/prisma-client/client";

const D = (v: string | number) => new Prisma.Decimal(v);

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10 + (n % 7), n % 50, 0, 0);
  return d;
}

const moneyN = (n: number) => Math.round(n * 100) / 100;
const roundQty = (n: number, dec = 4) => {
  const f = 10 ** dec;
  return Math.max(1 / f, Math.round(n * f) / f);
};

const THREE_YEARS = 1095;

type AssetSeed = {
  name: string;
  ticker: string;
  isin?: string;
  assetClass: string;
  category?:
    | "EQUITY"
    | "ETF"
    | "BOND"
    | "FUND"
    | "CRYPTO"
    | "SCPI"
    | "REAL_ESTATE_DIRECT"
    | "DERIVATIVE"
    | "COMMODITY"
    | "OTHER"
    | "UNCLASSIFIED";
  accountType: string;
  platformId: string;
  currency: string;
  priceProvider: string;
  providerSymbol?: string;
  qty: number;
  buyPrice: number;
  marketPrice: number;
  openDaysAgo: number;
  fees?: number;
  countryCode?: string;
  stopLoss?: number;
  tp1?: number;
};

/**
 * Seed complet du patrimoine d’un userId déjà existant (données wipe en amont).
 */
export async function seedUserPortfolio(
  prisma: PrismaClient,
  userId: string,
  tag: string
): Promise<{ platforms: number; assets: number; transactions: number }> {
  const note = (s: string) => `[${tag} seed] ${s}`;

  // ── Platforms ──────────────────────────────────────────────────────────────
  const boursorama = await prisma.platform.create({
    data: {
      userId,
      name: "Boursorama",
      type: "COURTIER",
      logoKey: "boursorama",
    },
  });
  const fortuneo = await prisma.platform.create({
    data: {
      userId,
      name: "Fortuneo",
      type: "COURTIER",
      logoKey: "fortuneo",
    },
  });
  const binance = await prisma.platform.create({
    data: {
      userId,
      name: "Binance",
      type: "EXCHANGE_CRYPTO",
      logoKey: "binance",
    },
  });
  const ibkr = await prisma.platform.create({
    data: {
      userId,
      name: "Interactive Brokers",
      type: "BROKER_CFD",
      logoKey: "interactive_brokers",
    },
  });
  const notaire = await prisma.platform.create({
    data: {
      userId,
      name: "Notaire Immobilier",
      type: "NOTAIRE_IMMOBILIER",
    },
  });
  const avPlatform = await prisma.platform.create({
    data: {
      userId,
      name: "Linxea Spirit 2",
      type: "ASSURANCE_VIE",
      logoKey: "linxea",
    },
  });

  const assetSeeds: AssetSeed[] = [
    {
      name: "LVMH",
      ticker: "MC.PA",
      isin: "FR0000121014",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "MC.PA",
      qty: 12,
      buyPrice: 720,
      marketPrice: 785,
      openDaysAgo: 980,
      fees: 9.9,
      countryCode: "FR",
      stopLoss: 650,
      tp1: 850,
    },
    {
      name: "TotalEnergies",
      ticker: "TTE.PA",
      isin: "FR0000120271",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "TTE.PA",
      qty: 80,
      buyPrice: 58.5,
      marketPrice: 61.2,
      openDaysAgo: 870,
      fees: 4.9,
      countryCode: "FR",
    },
    {
      name: "Apple",
      ticker: "AAPL",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "USD",
      priceProvider: "YAHOO",
      providerSymbol: "AAPL",
      qty: 25,
      buyPrice: 175,
      marketPrice: 198,
      openDaysAgo: 1050,
      fees: 1.5,
      countryCode: "US",
    },
    {
      name: "Microsoft",
      ticker: "MSFT",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "USD",
      priceProvider: "YAHOO",
      providerSymbol: "MSFT",
      qty: 18,
      buyPrice: 340,
      marketPrice: 415,
      openDaysAgo: 760,
      fees: 1.2,
      countryCode: "US",
    },
    {
      name: "ASML",
      ticker: "ASML.AS",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "ASML.AS",
      qty: 6,
      buyPrice: 620,
      marketPrice: 710,
      openDaysAgo: 640,
      countryCode: "NL",
    },
    {
      name: "Nestlé",
      ticker: "NESN.SW",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "CHF",
      priceProvider: "YAHOO",
      providerSymbol: "NESN.SW",
      qty: 30,
      buyPrice: 92,
      marketPrice: 88,
      openDaysAgo: 720,
      countryCode: "CH",
    },
    {
      name: "iShares Core MSCI World",
      ticker: "IWDA.AS",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "IWDA.AS",
      qty: 90,
      buyPrice: 78,
      marketPrice: 92,
      openDaysAgo: 1000,
    },
    {
      name: "OAT 2030",
      ticker: "FR0013313582",
      assetClass: "OBLIGATIONS",
      category: "BOND",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 10,
      buyPrice: 98.5,
      marketPrice: 99.2,
      openDaysAgo: 550,
    },
    {
      name: "Airbus",
      ticker: "AIR.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "AIR.PA",
      qty: 40,
      buyPrice: 128,
      marketPrice: 152,
      openDaysAgo: 920,
      countryCode: "FR",
      tp1: 165,
    },
    {
      name: "L'Oréal",
      ticker: "OR.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "OR.PA",
      qty: 15,
      buyPrice: 390,
      marketPrice: 412,
      openDaysAgo: 680,
      countryCode: "FR",
    },
    {
      name: "Schneider Electric",
      ticker: "SU.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "SU.PA",
      qty: 20,
      buyPrice: 210,
      marketPrice: 245,
      openDaysAgo: 800,
      countryCode: "FR",
    },
    {
      name: "Sanofi",
      ticker: "SAN.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "SAN.PA",
      qty: 50,
      buyPrice: 88,
      marketPrice: 95,
      openDaysAgo: 850,
      countryCode: "FR",
    },
    {
      name: "Hermès",
      ticker: "RMS.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "RMS.PA",
      qty: 3,
      buyPrice: 1850,
      marketPrice: 2200,
      openDaysAgo: 900,
      countryCode: "FR",
    },
    {
      name: "Lyxor CAC 40",
      ticker: "CAC.PA",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "CAC.PA",
      qty: 120,
      buyPrice: 68,
      marketPrice: 74,
      openDaysAgo: 610,
    },
    {
      name: "Bitcoin",
      ticker: "BTC",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "bitcoin",
      qty: 0.35,
      buyPrice: 42000,
      marketPrice: 62000,
      openDaysAgo: 1040,
      fees: 12,
      stopLoss: 48000,
      tp1: 75000,
    },
    {
      name: "Ethereum",
      ticker: "ETH",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "ethereum",
      qty: 4.2,
      buyPrice: 2100,
      marketPrice: 3200,
      openDaysAgo: 990,
      fees: 8,
    },
    {
      name: "Solana",
      ticker: "SOL",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "solana",
      qty: 45,
      buyPrice: 95,
      marketPrice: 148,
      openDaysAgo: 520,
    },
    {
      name: "Chainlink",
      ticker: "LINK",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "USD",
      priceProvider: "COINGECKO",
      providerSymbol: "chainlink",
      qty: 200,
      buyPrice: 12.5,
      marketPrice: 14.8,
      openDaysAgo: 400,
    },
    {
      name: "NASDAQ 100 CFD",
      ticker: "US100",
      assetClass: "ACTIONS",
      category: "DERIVATIVE",
      accountType: "CFD",
      platformId: ibkr.id,
      currency: "USD",
      priceProvider: "MANUAL",
      qty: 2,
      buyPrice: 18500,
      marketPrice: 19800,
      openDaysAgo: 280,
      fees: 5,
      stopLoss: 17500,
      tp1: 21000,
    },
    {
      name: "Gold CFD",
      ticker: "XAUUSD",
      assetClass: "AUTRE",
      category: "COMMODITY",
      accountType: "CFD",
      platformId: ibkr.id,
      currency: "USD",
      priceProvider: "MANUAL",
      qty: 5,
      buyPrice: 2320,
      marketPrice: 2410,
      openDaysAgo: 210,
    },
    {
      name: "EUR/USD CFD",
      ticker: "EURUSD",
      assetClass: "AUTRE",
      category: "DERIVATIVE",
      accountType: "CFD",
      platformId: ibkr.id,
      currency: "USD",
      priceProvider: "MANUAL",
      qty: 10000,
      buyPrice: 1.08,
      marketPrice: 1.09,
      openDaysAgo: 150,
    },
    {
      name: "SCPI Primovie",
      ticker: "PRIMOVIE",
      assetClass: "IMMOBILIER",
      category: "SCPI",
      accountType: "IMMOBILIER",
      platformId: notaire.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 80,
      buyPrice: 203,
      marketPrice: 208,
      openDaysAgo: THREE_YEARS - 50,
      fees: 160,
    },
    {
      name: "Appartement Locatif Lyon",
      ticker: "IMMO-LYON",
      assetClass: "IMMOBILIER",
      category: "REAL_ESTATE_DIRECT",
      accountType: "IMMOBILIER",
      platformId: notaire.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 1,
      buyPrice: 285000,
      marketPrice: 312000,
      openDaysAgo: THREE_YEARS - 10,
      fees: 12000,
    },
    {
      name: "SCPI Épargne Pierre",
      ticker: "EPARGNE-PIERRE",
      assetClass: "IMMOBILIER",
      category: "SCPI",
      accountType: "IMMOBILIER",
      platformId: notaire.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 40,
      buyPrice: 208,
      marketPrice: 215,
      openDaysAgo: 700,
      fees: 80,
    },
    {
      name: "Amundi MSCI World",
      ticker: "CW8.PA",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "AV",
      platformId: avPlatform.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "CW8.PA",
      qty: 150,
      buyPrice: 420,
      marketPrice: 485,
      openDaysAgo: 880,
    },
    {
      name: "Fonds euro Linxea",
      ticker: "FE-LINXEA",
      assetClass: "OBLIGATIONS",
      category: "FUND",
      accountType: "AV",
      platformId: avPlatform.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 25000,
      buyPrice: 1,
      marketPrice: 1.02,
      openDaysAgo: 950,
    },
    {
      name: "Amundi Euro Stoxx 50",
      ticker: "C50.PA",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "AV",
      platformId: avPlatform.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "C50.PA",
      qty: 80,
      buyPrice: 52,
      marketPrice: 58,
      openDaysAgo: 480,
    },
    {
      name: "Nvidia",
      ticker: "NVDA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "USD",
      priceProvider: "YAHOO",
      providerSymbol: "NVDA",
      qty: 10,
      buyPrice: 420,
      marketPrice: 880,
      openDaysAgo: 600,
      countryCode: "US",
    },
    {
      name: "Air Liquide",
      ticker: "AI.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "AI.PA",
      qty: 25,
      buyPrice: 155,
      marketPrice: 168,
      openDaysAgo: 740,
      countryCode: "FR",
    },
    {
      name: "Avalanche",
      ticker: "AVAX",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "avalanche-2",
      qty: 80,
      buyPrice: 28,
      marketPrice: 35,
      openDaysAgo: 320,
    },
  ];

  type Pos = AssetSeed & { id: string };
  const positions: Pos[] = [];

  for (const s of assetSeeds) {
    const asset = await prisma.asset.create({
      data: {
        userId,
        platformId: s.platformId,
        name: s.name,
        ticker: s.ticker,
        isin: s.isin ?? null,
        assetClass: s.assetClass,
        category: s.category ?? "UNCLASSIFIED",
        accountType: s.accountType,
        currency: s.currency,
        countryCode: s.countryCode ?? null,
        priceProvider: s.priceProvider,
        providerSymbol: s.providerSymbol ?? s.ticker,
        manualPrice: s.priceProvider === "MANUAL" ? D(s.marketPrice) : null,
        stopLoss: s.stopLoss != null ? D(s.stopLoss) : null,
        tp1: s.tp1 != null ? D(s.tp1) : null,
        acquisitionDate: daysAgo(s.openDaysAgo),
      },
    });
    positions.push({ ...s, id: asset.id });
  }

  // ── Transactions (~100–120 sur 3 ans) ─────────────────────────────────────
  type TxRow = {
    userId: string;
    type: string;
    platformId: string;
    toPlatformId: string | null;
    assetId: string | null;
    quantity: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    fees: Prisma.Decimal;
    currency: string;
    fxRateToEur: Prisma.Decimal;
    grossAmountEur: Prisma.Decimal;
    feesEur: Prisma.Decimal;
    netCashImpactEur: Prisma.Decimal;
    withholdingTaxEur: Prisma.Decimal;
    withholdingTaxRate: Prisma.Decimal | null;
    occurredAt: Date;
    notes: string | null;
  };

  const txs: TxRow[] = [];
  const allPlatforms = [
    boursorama,
    fortuneo,
    binance,
    ibkr,
    notaire,
    avPlatform,
  ];
  const fxNum = (cur: string) =>
    cur === "USD" ? 0.92 : cur === "CHF" ? 1.05 : 1;

  function pushTx(partial: {
    type: string;
    platformId: string;
    assetId?: string | null;
    quantity?: number | null;
    unitPrice?: number | null;
    fees?: number;
    currency?: string;
    cashAmount?: number | null;
    occurredAt: Date;
    notes: string;
    whtRate?: number;
  }) {
    const currency = (partial.currency || "EUR").toUpperCase();
    const fx = fxNum(currency);
    const fees = partial.fees ?? 0;
    const feesEur = moneyN(fees * fx);
    let grossEur = 0;
    let net = 0;
    const type = partial.type;
    if (type === "ACHAT" || type === "VENTE") {
      const q = partial.quantity ?? 0;
      const u = partial.unitPrice ?? 0;
      grossEur = moneyN(q * u * fx);
      net = 0;
    } else if (type === "APPORT") {
      grossEur = moneyN((partial.cashAmount ?? 0) * fx);
      net = grossEur;
    } else if (type === "RETRAIT" || type === "FRAIS") {
      grossEur = moneyN((partial.cashAmount ?? 0) * fx);
      net = -moneyN(grossEur + feesEur);
    } else if (
      type === "DIVIDENDE" ||
      type === "COUPON" ||
      type === "LOYER" ||
      type === "INTERET"
    ) {
      grossEur = moneyN((partial.cashAmount ?? 0) * fx);
      const wht = partial.whtRate ? moneyN(grossEur * partial.whtRate) : 0;
      net = moneyN(grossEur - feesEur - wht);
    }
    const whtRate = partial.whtRate ?? null;
    const whtEur =
      whtRate &&
      ["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(type)
        ? moneyN(grossEur * whtRate)
        : 0;

    txs.push({
      userId,
      type,
      platformId: partial.platformId,
      toPlatformId: null,
      assetId: partial.assetId ?? null,
      quantity:
        partial.quantity != null ? D(String(partial.quantity)) : null,
      unitPrice:
        partial.unitPrice != null ? D(String(partial.unitPrice)) : null,
      fees: D(String(fees)),
      currency,
      fxRateToEur: D(String(fx)),
      grossAmountEur: D(String(grossEur)),
      feesEur: D(String(feesEur)),
      netCashImpactEur: D(String(net)),
      withholdingTaxEur: D(String(whtEur)),
      withholdingTaxRate: whtRate != null ? D(String(whtRate)) : null,
      occurredAt: partial.occurredAt,
      notes: partial.notes,
    });
  }

  // Apports initiaux (~3 ans)
  for (const p of allPlatforms) {
    pushTx({
      type: "APPORT",
      platformId: p.id,
      cashAmount:
        p.id === ibkr.id ? 45000 : p.id === notaire.id ? 120000 : 35000,
      currency: p.id === ibkr.id ? "USD" : "EUR",
      occurredAt: daysAgo(THREE_YEARS - 5),
      notes: note(`Apport initial ${p.name}`),
    });
  }
  // Apports annuels
  for (const year of [1, 2]) {
    pushTx({
      type: "APPORT",
      platformId: boursorama.id,
      cashAmount: 8000 + year * 1500,
      currency: "EUR",
      occurredAt: daysAgo(THREE_YEARS - year * 365),
      notes: note(`Apport annuel CTO Y${year}`),
    });
    pushTx({
      type: "APPORT",
      platformId: fortuneo.id,
      cashAmount: 4000 + year * 500,
      currency: "EUR",
      occurredAt: daysAgo(THREE_YEARS - year * 365 - 30),
      notes: note(`Apport PEA Y${year}`),
    });
  }

  const TARGET_TX = 115;
  const qtyLive = new Map<string, number>();

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    qtyLive.set(p.id, p.qty);
    pushTx({
      type: "ACHAT",
      platformId: p.platformId,
      assetId: p.id,
      quantity: p.qty,
      unitPrice: p.buyPrice,
      fees: p.fees ?? moneyN(1 + (i % 5) * 0.5),
      currency: p.currency,
      occurredAt: daysAgo(p.openDaysAgo),
      notes: note(`Ouverture ${p.name}`),
    });
  }

  const lastDay = new Map(positions.map((p) => [p.id, p.openDaysAgo]));
  const activityPlan: Array<() => void> = [];

  for (const p of positions.filter((_, i) => i % 2 === 0).slice(0, 15)) {
    activityPlan.push(() => {
      const prev = lastDay.get(p.id) ?? 100;
      const day = Math.max(30, Math.floor(prev * 0.55));
      lastDay.set(p.id, day);
      const q =
        p.assetClass === "CRYPTO"
          ? roundQty(p.qty * 0.15, 6)
          : p.assetClass === "IMMOBILIER" && p.qty === 1
            ? 0
            : roundQty(Math.max(1, p.qty * 0.2), 2);
      if (q <= 0) return;
      pushTx({
        type: "ACHAT",
        platformId: p.platformId,
        assetId: p.id,
        quantity: q,
        unitPrice: moneyN(p.buyPrice * (0.95 + (day % 10) * 0.01)),
        fees: moneyN(2 + (day % 7)),
        currency: p.currency,
        occurredAt: daysAgo(day),
        notes: note(`Renfort ${p.name}`),
      });
      qtyLive.set(p.id, (qtyLive.get(p.id) ?? 0) + q);
    });
  }

  for (const p of positions
    .filter((x) => x.qty > 2 && x.accountType !== "IMMOBILIER")
    .slice(0, 12)) {
    activityPlan.push(() => {
      const prev = lastDay.get(p.id) ?? 80;
      const day = Math.max(20, Math.floor(prev * 0.35));
      lastDay.set(p.id, day);
      const live = qtyLive.get(p.id) ?? p.qty;
      const sellQ = roundQty(Math.min(live * 0.25, live - 0.5), 4);
      if (sellQ <= 0 || sellQ >= live) return;
      pushTx({
        type: "VENTE",
        platformId: p.platformId,
        assetId: p.id,
        quantity: sellQ,
        unitPrice: moneyN(p.marketPrice * 0.98),
        fees: moneyN(1.5 + (day % 5)),
        currency: p.currency,
        occurredAt: daysAgo(day),
        notes: note(`Vente partielle ${p.name}`),
      });
      qtyLive.set(p.id, live - sellQ);
    });
  }

  // Dividendes trimestriels ~3 ans
  const divCandidates = positions.filter(
    (p) => p.assetClass === "ACTIONS" && p.accountType !== "CFD"
  );
  for (let q = 0; q < 12; q++) {
    const p = divCandidates[q % divCandidates.length]!;
    const day = 40 + q * 90;
    if (day > THREE_YEARS - 10) continue;
    activityPlan.push(() => {
      pushTx({
        type: "DIVIDENDE",
        platformId: p.platformId,
        assetId: p.id,
        cashAmount: moneyN(25 + (q % 8) * 12.5 + p.qty * 0.3),
        currency: p.currency,
        occurredAt: daysAgo(day),
        notes: note(`Dividende T${(q % 4) + 1} ${p.name}`),
        whtRate:
          p.countryCode === "US" ? 0.15 : p.countryCode === "CH" ? 0.35 : 0,
      });
    });
  }

  for (const p of positions.filter((x) => x.assetClass === "OBLIGATIONS")) {
    for (const day of [90, 270, 450, 630, 810]) {
      activityPlan.push(() => {
        pushTx({
          type: "COUPON",
          platformId: p.platformId,
          assetId: p.id,
          cashAmount: moneyN(p.qty * 0.02 * p.buyPrice),
          currency: p.currency,
          occurredAt: daysAgo(day),
          notes: note(`Coupon ${p.name}`),
        });
      });
    }
  }

  for (const p of positions.filter((x) => x.assetClass === "IMMOBILIER")) {
    for (let m = 0; m < 24; m++) {
      const day = 30 + m * 45;
      if (day > THREE_YEARS) break;
      activityPlan.push(() => {
        pushTx({
          type: "LOYER",
          platformId: p.platformId,
          assetId: p.id,
          cashAmount:
            p.ticker === "IMMO-LYON" ? 980 : moneyN(p.qty * 0.35),
          currency: "EUR",
          occurredAt: daysAgo(day),
          notes: note(`Loyer ${p.name}`),
        });
      });
    }
  }

  for (let i = 0; i < 8; i++) {
    const p = allPlatforms[i % allPlatforms.length]!;
    activityPlan.push(() => {
      pushTx({
        type: "INTERET",
        platformId: p.id,
        cashAmount: moneyN(8 + i * 3.5),
        currency: "EUR",
        occurredAt: daysAgo(20 + i * 120),
        notes: note(`Intérêts cash ${p.name}`),
      });
    });
    activityPlan.push(() => {
      pushTx({
        type: "FRAIS",
        platformId: p.id,
        cashAmount: moneyN(4 + i * 2),
        currency: "EUR",
        occurredAt: daysAgo(15 + i * 110),
        notes: note(`Frais de garde ${p.name}`),
      });
    });
  }

  for (const day of [900, 600, 300, 90]) {
    activityPlan.push(() => {
      pushTx({
        type: "RETRAIT",
        platformId: boursorama.id,
        cashAmount: 1200 + (day % 500),
        currency: "EUR",
        occurredAt: daysAgo(day),
        notes: note("Retrait CTO → banque"),
      });
    });
  }
  activityPlan.push(() => {
    pushTx({
      type: "RETRAIT",
      platformId: binance.id,
      cashAmount: 800,
      currency: "EUR",
      occurredAt: daysAgo(45),
      notes: note("Retrait crypto → banque"),
    });
  });

  for (const run of activityPlan) {
    if (txs.length >= TARGET_TX) break;
    run();
  }

  let fill = 0;
  while (txs.length < TARGET_TX && fill < 50) {
    fill++;
    const p = positions[fill % positions.length]!;
    pushTx({
      type: fill % 3 === 0 ? "FRAIS" : "DIVIDENDE",
      platformId: p.platformId,
      assetId: fill % 3 === 0 ? null : p.id,
      cashAmount: moneyN(5 + fill * 1.7),
      currency: p.currency === "USD" ? "USD" : "EUR",
      occurredAt: daysAgo(Math.min(THREE_YEARS - 20, 5 + fill * 18)),
      notes: note(`Activité #${fill} ${p.name}`),
    });
  }

  txs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const BATCH = 50;
  for (let i = 0; i < txs.length; i += BATCH) {
    await prisma.transaction.createMany({ data: txs.slice(i, i + BATCH) });
  }

  // ── Cours ──────────────────────────────────────────────────────────────────
  const now = new Date();
  await prisma.priceQuote.createMany({
    data: positions.map((p) => {
      const fx = fxNum(p.currency);
      return {
        assetId: p.id,
        priceNative: D(String(p.marketPrice)),
        nativeCurrency: p.currency,
        priceEur: D(String(moneyN(p.marketPrice * fx))),
        source: "seed",
        status: "OK",
        lastUpdatedAt: now,
      };
    }),
  });

  // ── Cash / banques / livrets ────────────────────────────────────────────────
  await prisma.envelopeCash.createMany({
    data: [
      { userId, envelope: "CTO", balance: D("2450.50"), currency: "EUR" },
      { userId, envelope: "PEA", balance: D("890.00"), currency: "EUR" },
      { userId, envelope: "AV", balance: D("5200.00"), currency: "EUR" },
    ],
  });
  await prisma.bankAccount.createMany({
    data: [
      {
        userId,
        bankName: "BoursoBank",
        balance: D("8420.35"),
        currency: "EUR",
        notes: note("Compte courant"),
      },
      {
        userId,
        bankName: "Crédit Agricole",
        balance: D("2150.00"),
        currency: "EUR",
        notes: note("Compte joint"),
      },
      {
        userId,
        bankName: "Revolut",
        balance: D("1250.40"),
        currency: "EUR",
        notes: note("Compte EUR"),
      },
    ],
  });
  await prisma.savingsAccount.createMany({
    data: [
      {
        userId,
        name: "Livret A",
        balance: D("22950"),
        apyPercent: D("2.4"),
        rateType: "APY",
        payoutFrequency: "YEARLY",
        payoutMonth: 1,
        payoutDayOfMonth: 1,
        currency: "EUR",
        notes: note("Livret A"),
      },
      {
        userId,
        name: "LDDS",
        balance: D("12000"),
        apyPercent: D("2.4"),
        rateType: "APY",
        payoutFrequency: "YEARLY",
        payoutMonth: 1,
        payoutDayOfMonth: 1,
        currency: "EUR",
        notes: note("LDDS"),
      },
      {
        userId,
        name: "PEL",
        balance: D("18500"),
        apyPercent: D("2.25"),
        rateType: "APY",
        payoutFrequency: "YEARLY",
        payoutMonth: 12,
        payoutDayOfMonth: 31,
        currency: "EUR",
        notes: note("PEL ancien"),
      },
    ],
  });

  // ── Assurance-vie (onglet AV dédié) ─────────────────────────────────────────
  await prisma.lifeInsurance.create({
    data: {
      userId,
      insurer: "Spirica / Linxea Spirit 2",
      openDate: daysAgo(950),
      cashEuro: D("15200"),
      currency: "EUR",
      notes: note("Contrat multi-supports"),
      products: {
        create: [
          {
            name: "Fonds euro Spirica",
            currentValue: D("15200"),
            currency: "EUR",
          },
          {
            name: "UC Amundi MSCI World",
            currentValue: D("28500"),
            currency: "EUR",
          },
          {
            name: "UC Carmignac Patrimoine",
            currentValue: D("8400"),
            currency: "EUR",
          },
        ],
      },
    },
  });
  await prisma.lifeInsurance.create({
    data: {
      userId,
      insurer: "Generali / Boursorama Vie",
      openDate: daysAgo(700),
      cashEuro: D("5000"),
      currency: "EUR",
      notes: note("Second contrat"),
      products: {
        create: [
          {
            name: "Fonds euro Generali",
            currentValue: D("5000"),
            currency: "EUR",
          },
          {
            name: "ETF World tracker",
            currentValue: D("9200"),
            currency: "EUR",
          },
        ],
      },
    },
  });

  // ── Passifs / crédits ──────────────────────────────────────────────────────
  const mortgage = await prisma.liability.create({
    data: {
      userId,
      name: "Crédit immo Lyon",
      initialAmount: D("220000"),
      remainingAmount: D("178500"),
      currency: "EUR",
      interestRate: D("2.15"),
      monthlyPayment: D("980"),
      startDate: daysAgo(THREE_YEARS - 20),
      endDate: daysAgo(-(25 * 365)),
      paymentDay: 5,
      bankName: "Crédit Agricole",
      notes: note("Prêt 25 ans"),
    },
  });
  for (let m = 0; m < 12; m++) {
    await prisma.liabilityEvent.create({
      data: {
        liabilityId: mortgage.id,
        type: "MONTHLY_DEBIT",
        amount: D("980"),
        remainingAfter: D(String(178500 + (12 - m) * 420)),
        eventDate: daysAgo(30 + m * 30),
        notes: note(`Mensualité #${m + 1}`),
      },
    });
  }
  await prisma.liability.create({
    data: {
      userId,
      name: "Crédit conso auto",
      initialAmount: D("18000"),
      remainingAmount: D("6200"),
      currency: "EUR",
      interestRate: D("3.9"),
      monthlyPayment: D("320"),
      startDate: daysAgo(700),
      endDate: daysAgo(-200),
      paymentDay: 12,
      bankName: "Cetelem",
      notes: note("Voiture"),
    },
  });

  // ── Épargne salariale ──────────────────────────────────────────────────────
  await prisma.employeeSavingsLine.createMany({
    data: [
      {
        userId,
        planType: "PEE",
        manager: "Amundi",
        fundName: "Amundi Label Actions Euro",
        isin: "FR0010135103",
        units: D("145.5"),
        nav: D("28.40"),
        currency: "EUR",
        sourceType: "PARTICIPATION",
        contributionDate: daysAgo(800),
        unlockDate: daysAgo(800 - 5 * 365),
        unlockMode: "DATE",
        notes: note("PEE participation"),
      },
      {
        userId,
        planType: "PEE",
        manager: "Amundi",
        fundName: "Amundi Monétaire",
        units: D("320"),
        nav: D("12.10"),
        currency: "EUR",
        sourceType: "ABONDEMENT",
        contributionDate: daysAgo(400),
        unlockDate: daysAgo(400 - 5 * 365),
        unlockMode: "DATE",
        notes: note("PEE abondement"),
      },
      {
        userId,
        planType: "PER",
        manager: "Natixis",
        fundName: "Natixis Horizon 2040",
        units: D("88.2"),
        nav: D("42.75"),
        currency: "EUR",
        sourceType: "VOLUNTARY",
        contributionDate: daysAgo(600),
        unlockDate: null,
        unlockMode: "RETIREMENT",
        notes: note("PER volontaire"),
      },
      {
        userId,
        planType: "PERCO",
        manager: "AXA",
        fundName: "AXA Diversifié",
        units: D("55"),
        nav: D("18.90"),
        currency: "EUR",
        sourceType: "INTERESSEMENT",
        contributionDate: daysAgo(500),
        unlockDate: daysAgo(500 - 5 * 365),
        unlockMode: "DATE",
        notes: note("PERCO intéressement"),
      },
    ],
  });

  // ── Alternatives ───────────────────────────────────────────────────────────
  await prisma.preciousMetalPosition.createMany({
    data: [
      {
        userId,
        assetKind: "METAL",
        format: "PHYSICAL",
        denomination: "Napoléon 20F",
        quantity: D("12"),
        unitWeightG: D("5.81"),
        weightUnit: "GRAM",
        purchasePriceUnit: D("320"),
        currentValue: D("4200"),
        currency: "EUR",
        storageLocation: "Coffre banque",
        notes: note("Or physique"),
      },
      {
        userId,
        assetKind: "METAL",
        format: "PHYSICAL",
        denomination: "Lingotin 50g",
        quantity: D("2"),
        unitWeightG: D("50"),
        weightUnit: "GRAM",
        purchasePriceUnit: D("3100"),
        currentValue: D("6800"),
        currency: "EUR",
        storageLocation: "Domicile coffre",
        notes: note("Or"),
      },
      {
        userId,
        assetKind: "METAL",
        format: "PAPER",
        denomination: "ETC Physical Gold",
        quantity: D("15"),
        unitWeightG: D("1"),
        weightUnit: "OZ",
        purchasePriceUnit: D("180"),
        currentValue: D("3100"),
        currency: "EUR",
        storageLocation: "CTO",
        notes: note("Or papier"),
      },
    ],
  });

  await prisma.privateEquityPosition.createMany({
    data: [
      {
        userId,
        companyName: "GreenTech SAS",
        sector: "Cleantech",
        peType: "CROWDEQUITY",
        shares: D("50"),
        acquisitionPricePerShare: D("100"),
        investmentDate: daysAgo(700),
        currentNav: D("6200"),
        currency: "EUR",
        notes: note("Crowdequity"),
      },
      {
        userId,
        companyName: "MedAI Lab",
        sector: "Healthtech",
        peType: "CLUB_DEAL",
        shares: D("10"),
        acquisitionPricePerShare: D("1000"),
        investmentDate: daysAgo(450),
        currentNav: D("12500"),
        currency: "EUR",
        notes: note("Club deal"),
      },
      {
        userId,
        companyName: "Holding Famille",
        sector: "Diversifié",
        peType: "HOLDING",
        shares: D("100"),
        acquisitionPricePerShare: D("50"),
        investmentDate: daysAgo(900),
        currentNav: D("8000"),
        currency: "EUR",
        notes: note("Parts holding"),
      },
    ],
  });

  await prisma.crowdlendingPosition.createMany({
    data: [
      {
        userId,
        projectName: "Résidence senior Nantes",
        platform: "Homunity",
        capitalInvested: D("5000"),
        annualYieldPercent: D("8.5"),
        durationMonths: 24,
        repaymentType: "IN_FINE",
        startDate: daysAgo(400),
        maturityDate: daysAgo(400 - 24 * 30),
        status: "ACTIVE",
        currency: "EUR",
        notes: note("Crowdlending immo"),
      },
      {
        userId,
        projectName: "PME Industrie 4.0",
        platform: "October",
        capitalInvested: D("2500"),
        annualYieldPercent: D("6.2"),
        durationMonths: 36,
        repaymentType: "AMORTIZING",
        startDate: daysAgo(600),
        maturityDate: daysAgo(600 - 36 * 30),
        status: "ACTIVE",
        currency: "EUR",
        notes: note("Dette privée"),
      },
      {
        userId,
        projectName: "Projet soldé Bordeaux",
        platform: "Homunity",
        capitalInvested: D("3000"),
        annualYieldPercent: D("7.0"),
        durationMonths: 18,
        repaymentType: "IN_FINE",
        startDate: daysAgo(800),
        maturityDate: daysAgo(250),
        status: "REPAID",
        currency: "EUR",
        notes: note("Remboursé"),
      },
    ],
  });

  await prisma.tangibleAsset.createMany({
    data: [
      {
        userId,
        category: "WATCHES",
        brandOrArtist: "Rolex",
        modelName: "Submariner Date",
        yearOrVintage: "2019",
        purchasePrice: D("9500"),
        estimatedValue: D("12800"),
        currency: "EUR",
        hasCertificate: true,
        notes: note("Montre"),
      },
      {
        userId,
        category: "WINE",
        brandOrArtist: "Château Margaux",
        modelName: "Grand Vin",
        yearOrVintage: "2015",
        purchasePrice: D("2400"),
        estimatedValue: D("3100"),
        currency: "EUR",
        hasCertificate: false,
        notes: note("Cave 6 bouteilles"),
      },
      {
        userId,
        category: "ART",
        brandOrArtist: "Artiste contemporain FR",
        modelName: "Série Paysages #3",
        yearOrVintage: "2021",
        purchasePrice: D("1800"),
        estimatedValue: D("2200"),
        currency: "EUR",
        hasCertificate: true,
        notes: note("Toile"),
      },
      {
        userId,
        category: "AUTO",
        brandOrArtist: "Porsche",
        modelName: "911 Carrera (collection)",
        yearOrVintage: "1998",
        purchasePrice: D("42000"),
        estimatedValue: D("55000"),
        currency: "EUR",
        hasCertificate: false,
        notes: note("Véhicule de collection"),
      },
    ],
  });

  // ── Snapshots dashboard (~36 mois) ─────────────────────────────────────────
  for (let m = 36; m >= 0; m--) {
    const day = m * 30;
    const base = 320000 + (36 - m) * 2200 + (m % 5) * 400;
    await prisma.portfolioSnapshot.create({
      data: {
        userId,
        date: daysAgo(day),
        totalValueEur: D(base.toFixed(2)),
        totalCostEur: D("340000"),
        cashTotalEur: D(String(28000 + (36 - m) * 200)),
        realizedPnlEur: D(String(2000 + (36 - m) * 80)),
        unrealizedPnlEur: D((base - 340000).toFixed(2)),
        cashIncomeEur: D(String(800 + (36 - m) * 40)),
        assetCount: positions.length,
      },
    });
  }

  return {
    platforms: allPlatforms.length,
    assets: positions.length,
    transactions: txs.length,
  };
}
