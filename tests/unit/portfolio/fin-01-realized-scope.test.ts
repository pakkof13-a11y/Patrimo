import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FIN-01 (suite) — une ligne ecartee du patrimoine sort *partout* : valeur de
 * marche, cout de revient, P&L latent **et** realise.
 *
 * Le premier passage n'avait aligne que `costBasis` sur le perimetre de
 * `marketValue`. Restait `totalRealizedPnl(ledger)`, qui sommait tous les lots
 * sans filtre : le gain realise d'une position DeFi/NFT marquee
 * `isIgnoredInPortfolio` continuait d'alimenter `realizedPnlEur` et
 * `totalReturnEur`, alors que ni sa valeur ni son cout ne figuraient plus au
 * bilan. Le total recyclait une ligne « hors patrimoine ».
 *
 * Le cas mesure ici est le plus traitre : une position ignoree **soldee**. Elle
 * est absente de `getHoldings` (quantite nulle), donc invisible du cote
 * valeur/cout — son seul reste au journal est precisement le lot realise. C'est
 * pourquoi le perimetre ne peut pas se deduire des lignes detenues et se lit en
 * base (`loadIgnoredAssetIds`).
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const { db, fakePrisma, reset } = vi.hoisted(() => {
  const db: {
    users: Row[];
    platforms: Row[];
    assets: Row[];
    transactions: Row[];
  } = { users: [], platforms: [], assets: [], transactions: [] };

  const matches = (row: Row, where: Where = {}): boolean => {
    for (const [key, expected] of Object.entries(where)) {
      if (expected === undefined) continue;
      if (expected !== null && typeof expected === "object" && "in" in (expected as Row)) {
        if (!(expected as { in: unknown[] }).in.includes(row[key])) return false;
      } else if (row[key] !== expected) return false;
    }
    return true;
  };
  const filter = (rows: Row[], where?: Where) => rows.filter((r) => matches(r, where));

  const fakePrisma = {
    user: {
      findUnique: async ({ where }: { where?: Where }) =>
        filter(db.users, where)[0] ?? null,
    },
    platform: {
      findMany: async ({ where }: { where?: Where }) => filter(db.platforms, where),
    },
    asset: {
      findMany: async ({ where }: { where?: Where }) => filter(db.assets, where),
    },
    transaction: {
      findMany: async ({ where }: { where?: Where }) => filter(db.transactions, where),
      count: async ({ where }: { where?: Where }) => filter(db.transactions, where).length,
      findFirst: async ({ where }: { where?: Where }) =>
        filter(db.transactions, where).at(-1) ?? null,
    },
    employeeSavingsLine: { findMany: async () => [] as Row[] },
    realEstateDetail: { findMany: async () => [] as Row[] },
    indirectRealEstateDetail: { findMany: async () => [] as Row[] },
    lifeInsuranceSupport: { findMany: async () => [] as Row[] },
    liability: { findMany: async () => [] as Row[] },
    // Aucune clôture de la veille : `dayChangePct` reste `null` (UNKNOWN),
    // ce qui n'entre pas dans le périmètre de ce test (réalisé, pas séance).
    assetDailyClose: { findMany: async () => [] as Row[] },
  };

  const reset = () => {
    db.users = [];
    db.platforms = [];
    db.assets = [];
    db.transactions = [];
  };

  return { db, fakePrisma, reset };
});

vi.mock("@/app/lib/prisma", () => ({ prisma: fakePrisma }));

vi.mock("@/app/lib/cash/pockets", () => ({
  getBankPocketCashByNameEur: async () => new Map(),
  getExplicitCashTotalEur: async () => ({ totalEur: 0 }),
}));

vi.mock("@/app/lib/alternatives/portfolio", () => ({
  getAlternativesPortfolioSlice: async () => ({ totalEur: 0 }),
}));

// Table de taux fixe : une lecture ne frappe jamais le reseau (T-04). Les
// conversions restent les vraies — seule la collecte est court-circuitee.
vi.mock("@/app/lib/market/fx", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEurRates: async () => ({ EUR: 1 }),
}));

vi.mock("@/app/lib/market/last-close-as-of", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readLastClosesAsOf: async () => new Map(),
}));

import { getPortfolioBundle } from "@/app/lib/portfolio/service";

const USER = "u-fin01-realized";
const PLATFORM = "p1";

function asset(id: string, over: Row = {}): Row {
  return {
    id,
    userId: USER,
    name: id,
    ticker: id.toUpperCase(),
    isin: null,
    assetClass: "ACTIONS",
    category: null,
    accountType: "CTO",
    currency: "EUR",
    platformId: PLATFORM,
    manualPrice: null,
    logoUrl: null,
    notes: null,
    providerSymbol: null,
    priceProvider: "manual",
    stopLoss: null,
    tp1: null,
    tp2: null,
    tp3: null,
    tp4: null,
    watchlistedAt: null,
    platform: null,
    priceQuote: null,
    defiPosition: null,
    nftItem: null,
    ...over,
  };
}

function tx(over: Row): Row {
  return {
    userId: USER,
    platformId: PLATFORM,
    toPlatformId: null,
    fees: "0",
    feesEur: "0",
    currency: "EUR",
    fxRateToEur: "1",
    netCashImpactEur: "0",
    withholdingTaxEur: null,
    withholdingTaxRate: null,
    ...over,
  };
}

const trade = (
  id: string,
  type: "ACHAT" | "VENTE",
  assetId: string,
  day: string,
  qty: number,
  unit: number
) =>
  tx({
    id,
    type,
    assetId,
    quantity: String(qty),
    unitPrice: String(unit),
    grossAmountEur: String(qty * unit),
    occurredAt: new Date(day + "T10:00:00.000Z"),
  });

beforeEach(() => {
  reset();
  db.users.push({ id: USER, baseCurrency: "EUR" });
  db.platforms.push({
    id: PLATFORM,
    userId: USER,
    name: "Plateforme Test",
    type: "CTO",
    subtype: null,
    notes: null,
    logoKey: null,
    logoUrl: null,
    walletAddress: null,
    walletApiKey: null,
    lastSyncedAt: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
  });

  /*
    a1 — ligne ordinaire : 10 titres a 100, 5 revendus a 140.
    Realise 5 x 40 = 200. Reste 5 titres (cout 500), cotes 120 : valeur 600,
    latent 100.
  */
  db.assets.push(asset("a1", { priceQuote: { priceEur: "120", priceNative: "120" } }));
  db.transactions.push(trade("t1", "ACHAT", "a1", "2024-01-10", 10, 100));
  db.transactions.push(trade("t2", "VENTE", "a1", "2024-02-01", 5, 140));

  /*
    defi-1 — position DeFi ecartee du patrimoine, entierement soldee :
    10 unites a 100, revendues a 300. Realise 2 000, quantite nulle. Elle ne
    figure ni dans la valeur ni dans le cout — seul son lot realise subsiste.
  */
  db.assets.push(
    asset("defi-1", {
      assetClass: "CRYPTO",
      accountType: "CRYPTO",
      defiPosition: { id: "dp-1", isIgnoredInPortfolio: true },
    })
  );
  db.transactions.push(trade("t3", "ACHAT", "defi-1", "2024-01-10", 10, 100));
  db.transactions.push(trade("t4", "VENTE", "defi-1", "2024-02-01", 10, 300));
});

describe("getPortfolioBundle — le realise suit le perimetre de la valeur", () => {
  it("n'expose que le realise des lignes du patrimoine", async () => {
    const { summary } = await getPortfolioBundle(USER, "EUR");

    // Avant la correction : 2 200 (200 de a1 + 2 000 de la DeFi ignoree).
    expect(Number(summary.realizedPnlEur)).toBeCloseTo(200, 6);
    expect(Number(summary.realizedPnlBase)).toBeCloseTo(200, 6);
  });

  it("le rendement total ne recycle plus la ligne hors patrimoine", async () => {
    const { summary } = await getPortfolioBundle(USER, "EUR");

    // Valeur et cout excluaient deja la ligne DeFi soldee...
    expect(Number(summary.totalMarketValueEur)).toBeCloseTo(600, 6);
    expect(Number(summary.totalCostBasisEur)).toBeCloseTo(500, 6);
    expect(Number(summary.unrealizedPnlEur)).toBeCloseTo(100, 6);
    // ...et le total leur est desormais coherent : 100 + 200 + 0.
    // Avant la correction : 2 300.
    expect(Number(summary.totalReturnEur)).toBeCloseTo(300, 6);
  });

  it("une ligne DeFi non ignoree continue de peser dans le realise", async () => {
    // Controle negatif : le filtre ne retire pas la DeFi en general, seulement
    // ce que l'utilisateur a explicitement ecarte du patrimoine.
    db.assets.find((a) => a.id === "defi-1")!.defiPosition = {
      id: "dp-1",
      isIgnoredInPortfolio: false,
    };

    const { summary } = await getPortfolioBundle(USER, "EUR");
    expect(Number(summary.realizedPnlEur)).toBeCloseTo(2_200, 6);
  });
});
