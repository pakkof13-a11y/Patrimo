import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_USERNAME,
} from "../app/lib/constants";

const prisma = new PrismaClient();

const D = (v: string | number) => new Prisma.Decimal(v);

function daysAgo(n: number): Date {
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

/** Efface tout le patrimoine d’un utilisateur (multi-tenant). */
async function wipeUserData(userId: string) {
  await prisma.priceHistory.deleteMany({ where: { asset: { userId } } });
  await prisma.priceQuote.deleteMany({ where: { asset: { userId } } });
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.liabilityEvent
    .deleteMany({ where: { liability: { userId } } })
    .catch(() => undefined);
  await prisma.liability.deleteMany({ where: { userId } });
  await prisma.lifeInsuranceProduct.deleteMany({
    where: { lifeInsurance: { userId } },
  });
  await prisma.lifeInsurance.deleteMany({ where: { userId } });
  await prisma.bankAccount.deleteMany({ where: { userId } });
  await prisma.savingsAccount.deleteMany({ where: { userId } });
  await prisma.envelopeCash.deleteMany({ where: { userId } });
  await prisma.employeeSavingsLine
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.preciousMetalPosition
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.privateEquityPosition
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.crowdlendingPosition
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.tangibleAsset
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.asset.deleteMany({ where: { userId } });
  await prisma.platform.deleteMany({ where: { userId } });
  await prisma.portfolioSnapshot.deleteMany({ where: { userId } });
}

/**
 * Seed Patrimo — ~30 positions + ~100 transactions.
 *
 * - Défaut (`npm run db:seed`) : données sur **admin**, compte **demo** vide.
 * - E2E (`SEED_LIGHT=1` / `E2E=1`) : données sur **demo** (Playwright), admin sans portfolio.
 */
async function main() {
  const LIGHT =
    process.env.SEED_LIGHT === "1" ||
    process.env.E2E === "1" ||
    process.env.PLAYWRIGHT === "1";

  console.log(
    LIGHT
      ? "Seeding Patrimo — SEED_LIGHT / e2e → portfolio sur compte demo…"
      : "Seeding Patrimo — données fictives pour ADMIN…"
  );

  // ── SuperUser ADMIN ────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      username: ADMIN_USERNAME,
      passwordHash: adminHash,
      role: "ADMIN",
      name: "SuperUser",
      baseCurrency: "EUR",
    },
    create: {
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      name: "SuperUser",
      passwordHash: adminHash,
      role: "ADMIN",
      baseCurrency: "EUR",
    },
  });
  console.log(`  SuperUser : ${ADMIN_USERNAME} (${admin.id})`);

  // ── Compte démo ────────────────────────────────────────────────────────────
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      passwordHash: demoHash,
      name: "Démo Patrimo",
      baseCurrency: "EUR",
      username: DEMO_USERNAME,
      role: "USER",
    },
    create: {
      email: DEMO_EMAIL,
      username: DEMO_USERNAME,
      name: "Démo Patrimo",
      passwordHash: demoHash,
      role: "USER",
      baseCurrency: "EUR",
    },
  });
  console.log(`  Démo USER : ${DEMO_USERNAME} (${demo.id})`);

  // Cible du portfolio : demo en e2e, admin en usage normal
  await wipeUserData(admin.id);
  await wipeUserData(demo.id);
  const userId = LIGHT ? demo.id : admin.id;
  console.log(
    `  Portfolio seedé sur : ${LIGHT ? DEMO_USERNAME : ADMIN_USERNAME}`
  );

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

  type AssetSeed = {
    name: string;
    ticker: string;
    isin?: string;
    assetClass: string;
    /** Sous-catégorie UI (AssetCategory) */
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

  /** ~30 positions fictives multi-enveloppes */
  const assetSeeds: AssetSeed[] = [
    // CTO
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
      openDaysAgo: 420,
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
      openDaysAgo: 380,
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
      openDaysAgo: 500,
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
      openDaysAgo: 310,
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
      openDaysAgo: 260,
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
      openDaysAgo: 290,
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
      openDaysAgo: 450,
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
      openDaysAgo: 200,
    },
    // PEA
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
      openDaysAgo: 400,
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
      openDaysAgo: 220,
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
      openDaysAgo: 280,
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
      openDaysAgo: 330,
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
      openDaysAgo: 360,
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
      openDaysAgo: 190,
    },
    // Crypto
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
      openDaysAgo: 520,
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
      openDaysAgo: 480,
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
      openDaysAgo: 200,
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
      openDaysAgo: 150,
    },
    // CFD
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
      openDaysAgo: 90,
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
      openDaysAgo: 60,
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
      openDaysAgo: 40,
    },
    // Immobilier
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
      openDaysAgo: 600,
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
      openDaysAgo: 900,
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
      openDaysAgo: 340,
      fees: 80,
    },
    // AV
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
      openDaysAgo: 300,
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
      openDaysAgo: 400,
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
      openDaysAgo: 180,
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
      openDaysAgo: 240,
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
      openDaysAgo: 270,
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
      openDaysAgo: 120,
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
  console.log(`  Positions (actifs) : ${positions.length}`);

  // ── Transactions (~100) ────────────────────────────────────────────────────
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
      const wht = partial.whtRate
        ? moneyN(grossEur * partial.whtRate)
        : 0;
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

  // 1) Apports cash (6 plateformes)
  for (const p of allPlatforms) {
    pushTx({
      type: "APPORT",
      platformId: p.id,
      cashAmount: p.id === ibkr.id ? 45000 : p.id === notaire.id ? 120000 : 35000,
      currency: p.id === ibkr.id ? "USD" : "EUR",
      occurredAt: daysAgo(950),
      notes: `[Admin seed] Apport ${p.name}`,
    });
  }

  // 2) Achat d’ouverture + renforts / ventes / revenus par position
  const TARGET_TX = 100;
  const qtyLive = new Map<string, number>();

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    const openQty = p.qty;
    qtyLive.set(p.id, openQty);
    pushTx({
      type: "ACHAT",
      platformId: p.platformId,
      assetId: p.id,
      quantity: openQty,
      unitPrice: p.buyPrice,
      fees: p.fees ?? moneyN(1 + (i % 5) * 0.5),
      currency: p.currency,
      occurredAt: daysAgo(p.openDaysAgo),
      notes: `[Admin seed] Ouverture ${p.name}`,
    });
  }

  // 3) Activité diversifiée pour atteindre ~100 tx (chrono-safe par actif)
  // lastDay décroissant pour chaque actif (événements plus récents)
  const lastDay = new Map(positions.map((p) => [p.id, p.openDaysAgo]));

  const activityPlan: Array<() => void> = [];

  // Renforts d’achat (~15)
  for (const p of positions.filter((_, i) => i % 2 === 0).slice(0, 15)) {
    activityPlan.push(() => {
      const prev = lastDay.get(p.id) ?? 100;
      const day = Math.max(5, Math.floor(prev * 0.55));
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
        notes: `[Admin seed] Renfort ${p.name}`,
      });
      qtyLive.set(p.id, (qtyLive.get(p.id) ?? 0) + q);
    });
  }

  // Ventes partielles (~12)
  for (const p of positions.filter((x) => x.qty > 2 && x.accountType !== "IMMOBILIER").slice(0, 12)) {
    activityPlan.push(() => {
      const prev = lastDay.get(p.id) ?? 80;
      const day = Math.max(3, Math.floor(prev * 0.35));
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
        notes: `[Admin seed] Vente partielle ${p.name}`,
      });
      qtyLive.set(p.id, live - sellQ);
    });
  }

  // Dividendes (~18)
  const divCandidates = positions.filter(
    (p) => p.assetClass === "ACTIONS" && p.accountType !== "CFD"
  );
  for (let i = 0; i < 18; i++) {
    const p = divCandidates[i % divCandidates.length]!;
    activityPlan.push(() => {
      const day = 20 + i * 17;
      pushTx({
        type: "DIVIDENDE",
        platformId: p.platformId,
        assetId: p.id,
        cashAmount: moneyN(25 + (i % 8) * 12.5 + p.qty * 0.3),
        currency: p.currency,
        occurredAt: daysAgo(day),
        notes: `[Admin seed] Dividende ${p.name}`,
        whtRate: p.countryCode === "US" ? 0.15 : p.countryCode === "CH" ? 0.35 : 0,
      });
    });
  }

  // Coupons obligations (~4)
  for (const p of positions.filter((x) => x.assetClass === "OBLIGATIONS")) {
    activityPlan.push(() => {
      pushTx({
        type: "COUPON",
        platformId: p.platformId,
        assetId: p.id,
        cashAmount: moneyN(p.qty * 0.02 * p.buyPrice),
        currency: p.currency,
        occurredAt: daysAgo(45),
        notes: `[Admin seed] Coupon ${p.name}`,
      });
    });
    activityPlan.push(() => {
      pushTx({
        type: "COUPON",
        platformId: p.platformId,
        assetId: p.id,
        cashAmount: moneyN(p.qty * 0.02 * p.buyPrice),
        currency: p.currency,
        occurredAt: daysAgo(210),
        notes: `[Admin seed] Coupon ${p.name} (S-1)`,
      });
    });
  }

  // Loyers immo (~6)
  for (const p of positions.filter((x) => x.assetClass === "IMMOBILIER")) {
    for (const day of [30, 90, 150]) {
      activityPlan.push(() => {
        pushTx({
          type: "LOYER",
          platformId: p.platformId,
          assetId: p.id,
          cashAmount: p.ticker === "IMMO-LYON" ? 980 : moneyN(p.qty * 0.35),
          currency: "EUR",
          occurredAt: daysAgo(day),
          notes: `[Admin seed] Loyer ${p.name}`,
        });
      });
    }
  }

  // Intérêts / frais plateforme (~10)
  for (let i = 0; i < 5; i++) {
    const p = allPlatforms[i % allPlatforms.length]!;
    activityPlan.push(() => {
      pushTx({
        type: "INTERET",
        platformId: p.id,
        cashAmount: moneyN(8 + i * 3.5),
        currency: "EUR",
        occurredAt: daysAgo(15 + i * 40),
        notes: `[Admin seed] Intérêts cash ${p.name}`,
      });
    });
    activityPlan.push(() => {
      pushTx({
        type: "FRAIS",
        platformId: p.id,
        cashAmount: moneyN(4 + i * 2),
        currency: "EUR",
        occurredAt: daysAgo(10 + i * 35),
        notes: `[Admin seed] Frais de garde ${p.name}`,
      });
    });
  }

  // Apports / retraits complémentaires
  activityPlan.push(() => {
    pushTx({
      type: "APPORT",
      platformId: boursorama.id,
      cashAmount: 5000,
      currency: "EUR",
      occurredAt: daysAgo(120),
      notes: "[Admin seed] Apport complémentaire Boursorama",
    });
  });
  activityPlan.push(() => {
    pushTx({
      type: "APPORT",
      platformId: fortuneo.id,
      cashAmount: 2500,
      currency: "EUR",
      occurredAt: daysAgo(75),
      notes: "[Admin seed] Apport PEA",
    });
  });
  activityPlan.push(() => {
    pushTx({
      type: "RETRAIT",
      platformId: binance.id,
      cashAmount: 800,
      currency: "EUR",
      occurredAt: daysAgo(25),
      notes: "[Admin seed] Retrait crypto → banque",
    });
  });
  activityPlan.push(() => {
    pushTx({
      type: "RETRAIT",
      platformId: boursorama.id,
      cashAmount: 1500,
      currency: "EUR",
      occurredAt: daysAgo(14),
      notes: "[Admin seed] Retrait CTO",
    });
  });

  for (const run of activityPlan) {
    if (txs.length >= TARGET_TX) break;
    run();
  }

  // Compléter jusqu’à 100 si besoin (dividendes / frais légers)
  let fill = 0;
  while (txs.length < TARGET_TX && fill < 40) {
    fill++;
    const p = positions[fill % positions.length]!;
    pushTx({
      type: fill % 3 === 0 ? "FRAIS" : "DIVIDENDE",
      platformId: p.platformId,
      assetId: fill % 3 === 0 ? null : p.id,
      cashAmount: moneyN(5 + fill * 1.7),
      currency: p.currency === "USD" ? "USD" : "EUR",
      occurredAt: daysAgo(2 + fill * 3),
      notes: `[Admin seed] Activité #${fill} ${p.name}`,
    });
  }

  txs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  console.log(`  Insertion de ${txs.length} transactions…`);
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

  // ── Cash enveloppes + banque (contexte admin) ──────────────────────────────
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
        notes: "[Admin seed] Compte courant",
      },
      {
        userId,
        bankName: "Crédit Agricole",
        balance: D("2150.00"),
        currency: "EUR",
        notes: "[Admin seed] Compte joint",
      },
    ],
  });
  await prisma.savingsAccount.create({
    data: {
      userId,
      name: "Livret A",
      balance: D("22950"),
      apyPercent: D("2.4"),
      rateType: "APY",
      payoutFrequency: "YEARLY",
      payoutMonth: 1,
      payoutDayOfMonth: 1,
      currency: "EUR",
      notes: "[Admin seed] Livret A",
    },
  });

  // Snapshots dashboard
  for (const n of [90, 60, 30, 14, 7, 1, 0]) {
    const base = 380000 + (90 - n) * 900;
    await prisma.portfolioSnapshot.create({
      data: {
        userId,
        date: daysAgo(n),
        totalValueEur: D(base.toFixed(2)),
        totalCostEur: D("340000"),
        cashTotalEur: D("38000"),
        realizedPnlEur: D("5200"),
        unrealizedPnlEur: D((base - 340000).toFixed(2)),
        cashIncomeEur: D("2100"),
        assetCount: positions.length,
      },
    });
  }

  const finalTx = await prisma.transaction.count({ where: { userId } });
  const finalAssets = await prisma.asset.count({ where: { userId } });
  const adminTx = await prisma.transaction.count({ where: { userId: admin.id } });
  const demoTx = await prisma.transaction.count({ where: { userId: demo.id } });

  console.log("────────────────────────────────────────");
  console.log(LIGHT ? "Seed e2e (demo) terminé." : "Seed ADMIN terminé.");
  console.log(`  Plateformes : ${allPlatforms.length}`);
  console.log(`  Positions   : ${finalAssets}`);
  console.log(`  Transactions: ${finalTx}`);
  console.log(`  admin tx    : ${adminTx}`);
  console.log(`  demo tx     : ${demoTx}`);
  console.log(`Login admin   : ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log(`Login démo    : ${DEMO_USERNAME} / ${DEMO_PASSWORD}`);
  console.log("────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
