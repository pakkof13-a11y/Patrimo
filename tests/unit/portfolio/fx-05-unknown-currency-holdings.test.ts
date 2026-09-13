import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FX-05 — une devise hors table + Frankfurter en panne ne doit plus faire
 * planter tout le portefeuille.
 *
 * `getHoldings` (`portfolio/service.ts`) convertit chaque position vers l'euro
 * dans une seule boucle sur TOUS les actifs de l'utilisateur. Avant ce
 * correctif, `convertToEurSync` levait `FxRateUnknownError` dès la première
 * ligne dans une devise que ni Frankfurter (en panne ici) ni la table de
 * repli ne fondent (ex. SEK) — l'exception sortait de la boucle et
 * `GET /api/portfolio`/`GET /api/holdings` rendaient un 500 pour la totalité
 * du portefeuille, y compris les lignes en devises parfaitement connues.
 *
 * Ce test verrouille le contrat : la ligne à devise inconnue devient UNKNOWN
 * (repli sur le coût de revient, jamais 0 € implicite) et les autres lignes
 * du même appel continuent de se calculer normalement.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const { db, fakePrisma, reset } = vi.hoisted(() => {
  const db: { platforms: Row[]; assets: Row[]; transactions: Row[] } = {
    platforms: [],
    assets: [],
    transactions: [],
  };

  const matches = (row: Row, where: Where = {}): boolean => {
    for (const [key, expected] of Object.entries(where)) {
      if (expected === undefined) continue;
      if (
        expected !== null &&
        typeof expected === "object" &&
        "in" in (expected as Row)
      ) {
        if (!(expected as { in: unknown[] }).in.includes(row[key])) return false;
      } else if (row[key] !== expected) return false;
    }
    return true;
  };

  const find = (rows: Row[], where?: Where) =>
    rows.find((r) => matches(r, where)) ?? null;
  const filter = (rows: Row[], where?: Where) =>
    rows.filter((r) => matches(r, where));

  const withRelations = (a: Row) => ({
    priceQuote: null,
    defiPosition: null,
    nftItem: null,
    ...a,
    platform: db.platforms.find((p) => p.id === a.platformId) ?? null,
  });

  const fakePrisma = {
    platform: {
      findMany: async ({ where }: { where?: Where }) =>
        filter(db.platforms, where),
    },
    asset: {
      findFirst: async ({ where }: { where?: Where }) => {
        const row = find(db.assets, where);
        return row ? withRelations(row) : null;
      },
      findMany: async ({ where }: { where?: Where }) =>
        filter(db.assets, where).map(withRelations),
    },
    transaction: {
      count: async ({ where }: { where?: Where }) =>
        filter(db.transactions, where).length,
      findFirst: async ({ where }: { where?: Where }) => {
        const rows = filter(db.transactions, where);
        return rows[rows.length - 1] ?? null;
      },
      findMany: async ({ where }: { where?: Where }) =>
        filter(db.transactions, where).map((t) => ({
          ...t,
          platform: db.platforms.find((p) => p.id === t.platformId) ?? null,
        })),
    },
    assetDailyClose: {
      groupBy: async () => [] as Row[],
      findMany: async () => [] as Row[],
    },
  };

  const reset = () => {
    db.platforms = [];
    db.assets = [];
    db.transactions = [];
  };

  return { db, fakePrisma, reset };
});

vi.mock("@/app/lib/prisma", () => ({ prisma: fakePrisma }));

const getEurRates = vi.fn();

/*
  Frankfurter en panne : `getEurRates()` rend la table de repli (EUR, USD,
  CHF, GBP, JPY) — SEK n'y figure pas, comme en production quand le
  fournisseur est indisponible et que la devise n'est pas l'une des cinq
  déclarées.
*/
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...actual, getEurRates: (...a: unknown[]) => getEurRates(...a) };
});

import { getHoldings } from "@/app/lib/portfolio/service";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";

const USER = "u-fx05";
const PLAT = "plat-1";
const ASSET_USD = "asset-usd";
const ASSET_SEK = "asset-sek";

const FALLBACK_RATES: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  CHF: 0.96,
  GBP: 0.85,
  JPY: 160,
};

function seedAsset(opts: {
  id: string;
  currency: string;
  manualPrice: string;
  unitPriceNative: string;
}) {
  db.assets.push({
    id: opts.id,
    userId: USER,
    name: `Actif ${opts.id}`,
    ticker: null,
    isin: null,
    assetClass: "AUTRE",
    category: "UNCLASSIFIED",
    accountType: "CTO",
    currency: opts.currency,
    countryCode: null,
    withholdingTaxRate: null,
    priceProvider: "MANUAL",
    providerSymbol: null,
    notes: null,
    logoUrl: null,
    platformId: PLAT,
    manualPrice: opts.manualPrice,
    priceQuote: null,
  });
  db.transactions.push({
    id: `tx-${opts.id}`,
    userId: USER,
    type: "ACHAT",
    platformId: PLAT,
    toPlatformId: null,
    assetId: opts.id,
    quantity: "1",
    unitPrice: opts.unitPriceNative,
    fees: "0",
    feesEur: "0",
    currency: opts.currency,
    fxRateToEur: "1",
    grossAmountEur: "1000",
    netCashImpactEur: "-1000",
    withholdingTaxEur: "0",
    withholdingTaxRate: null,
    notes: null,
    occurredAt: new Date("2026-06-01T09:00:00.000Z"),
  });
}

beforeEach(() => {
  reset();
  invalidateLedgerCache(USER);
  db.platforms.push({
    id: PLAT,
    userId: USER,
    name: "Plateforme test",
    type: "COURTIER",
    logoKey: null,
    logoUrl: null,
    subtype: null,
  });
  getEurRates.mockReset().mockResolvedValue(FALLBACK_RATES);
});

describe("getHoldings — devise hors table + Frankfurter en panne", () => {
  it("ne lève pas et rend toujours les lignes en devise connue", async () => {
    seedAsset({
      id: ASSET_USD,
      currency: "USD",
      manualPrice: "108",
      unitPriceNative: "1000",
    });
    seedAsset({
      id: ASSET_SEK,
      currency: "SEK",
      manualPrice: "1000",
      unitPriceNative: "1000",
    });

    // Le discriminant du défaut : avant garde, cet appel rejetait avec
    // FxRateUnknownError("SEK") et perdait la ligne USD au passage.
    const rows = await getHoldings(USER, "EUR", FALLBACK_RATES);

    expect(rows).toHaveLength(2);
    const usd = rows.find((r) => r.assetId === ASSET_USD);
    expect(usd).toBeDefined();
    expect(Number(usd!.currentPriceEur)).toBeCloseTo(108 / 1.08, 6);
  });

  it("la ligne en devise inconnue devient UNKNOWN — coût de revient, jamais 0 € implicite", async () => {
    seedAsset({
      id: ASSET_SEK,
      currency: "SEK",
      manualPrice: "1000",
      unitPriceNative: "1000",
    });

    const rows = await getHoldings(USER, "EUR", FALLBACK_RATES);
    const sek = rows.find((r) => r.assetId === ASSET_SEK);
    expect(sek).toBeDefined();

    // Le coût de revient (achat de 1000 SEK à `fxRateToEur: 1`, donc
    // grossAmountEur "1000") tient lieu de valeur — jamais un prix à 0.
    expect(Number(sek!.currentPriceEur)).toBeGreaterThan(0);
    expect(Number(sek!.marketValueEur)).toBeGreaterThan(0);
  });

  it("appelée directement (rates non fournies), la panne Frankfurter ne fait toujours pas planter la boucle", async () => {
    seedAsset({
      id: ASSET_USD,
      currency: "USD",
      manualPrice: "108",
      unitPriceNative: "1000",
    });
    seedAsset({
      id: ASSET_SEK,
      currency: "SEK",
      manualPrice: "1000",
      unitPriceNative: "1000",
    });

    await expect(getHoldings(USER, "EUR")).resolves.toHaveLength(2);
  });
});
