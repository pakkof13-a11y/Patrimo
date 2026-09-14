import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getAssetDetail` : le prix manuel est un prix **en devise de l'actif**.
 *
 * ## Le defaut mesure
 *
 * Quatre sites lisent `Asset.manualPrice` et le convertissent
 * (`portfolio/service.ts:338-340`, `:697-700`, `portfolio/asset-values.ts:67-73`,
 * `historical/load.ts:299-300`). Le cinquieme, `getAssetDetail`
 * (`portfolio/service.ts:1732-1736`, servi par `GET /api/assets/[id]`), le
 * lisait comme des euros :
 *
 *     priceEur = d(asset.manualPrice.toString())
 *
 * Sur un support d'assurance-vie en dollars valorise 10 000 EUR -- donc
 * `manualPrice = 10 800 USD` au taux 1,08 --, les tranches de detention de la
 * fiche annoncaient **10 800 EUR** la ou le tableau Positions, lui, affichait
 * 10 000 EUR. Deux chiffres pour la meme ligne, tous deux libelles en euros.
 *
 * Le defaut preexistait pour tout actif a prix manuel en devise (DeFi, non
 * cote) ; il devient atteignable sur l'AV depuis que `createSupport` ecrit un
 * `manualPrice` en devise de l'actif et non plus en euros.
 *
 * ## Ce que ce fichier interdit
 *
 * - **le taux 1** : le taux injecte est 1,08, sans quoi le test passerait avant
 *   comme apres la correction ;
 * - **la conversion mockee** : `convertToEurSync` et le rejeu du journal sont
 *   ceux de production. Seul `getEurRates` est remplace -- pas de reseau, et
 *   l'ecriture et la lecture partagent le meme releve de taux ;
 * - **la double conversion** : `manualPrice` n'est retenu que faute de
 *   cotation. Un cas ou `priceQuote` prime verifie que la conversion ne
 *   s'applique pas deux fois a un prix deja en euros ;
 * - **le deplacement d'un montant en euros** : un actif en euros doit rendre
 *   exactement la meme valeur qu'avant. `manualPrice` est un
 *   `Decimal(28, 12)` et `convertToEurSync` arrondit a douze decimales sur la
 *   branche EUR : l'egalite est exacte, pas approchee.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const { db, fakePrisma, reset } = vi.hoisted(() => {
  const db: { platforms: Row[]; assets: Row[]; transactions: Row[] } = {
    platforms: [],
    assets: [],
    transactions: [],
  };

  /** `where` plat : egalite stricte, plus la forme `{ in: [...] }`. */
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

  /** L'actif tel que le rendrait Prisma : relations resolues, jamais absentes. */
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
    // Aucune cloture collectee : la valorisation reste sur le prix retenu.
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
  Mock partiel et minimal : seul l'accès sortant est remplacé. Les conversions
  mesurées sont celles de production — T-04, aucune lecture ne touche au
  réseau, et le test ne réimplémente pas la règle qu'il vérifie.
*/
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...actual, getEurRates: (...a: unknown[]) => getEurRates(...a) };
});

import { d } from "@/app/lib/money/decimal";
import { getAssetDetail } from "@/app/lib/portfolio/service";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";

const USER = "u-detail";
const PLAT = "plat-1";
const ASSET = "asset-1";

/** 1 EUR = X devise, le même relevé pour l'écriture et la lecture. */
const RATES: Record<string, number> = { EUR: 1, USD: 1.08 };

function seed(opts: {
  currency: string;
  /** Prix manuel, en devise de l'actif — comme l'écrit `createSupport`. */
  manualPrice: string;
  /** Prix unitaire de l'achat, dans la même devise. */
  unitPriceNative: string;
  priceQuote?: { priceEur: string; priceNative: string } | null;
}) {
  db.platforms.push({
    id: PLAT,
    userId: USER,
    name: "Linxea",
    type: "ASSURANCE_VIE",
    logoKey: null,
    logoUrl: null,
    subtype: null,
  });
  db.assets.push({
    id: ASSET,
    userId: USER,
    name: "UC Amundi S&P 500",
    ticker: null,
    isin: null,
    assetClass: "ACTIONS",
    category: "UNCLASSIFIED",
    accountType: "AV",
    currency: opts.currency,
    countryCode: null,
    withholdingTaxRate: null,
    priceProvider: "NONE",
    providerSymbol: null,
    notes: null,
    logoUrl: null,
    platformId: PLAT,
    manualPrice: opts.manualPrice,
    priceQuote: opts.priceQuote
      ? {
          assetId: ASSET,
          priceEur: opts.priceQuote.priceEur,
          priceNative: opts.priceQuote.priceNative,
          nativeCurrency: opts.currency,
          source: "test",
          status: "OK",
          lastUpdatedAt: new Date("2026-09-09T10:00:00.000Z"),
        }
      : null,
  });
  /*
    Un achat d'une seule unité : la quantité du journal vaut exactement 1, si
    bien que la valeur de la tranche est le prix retenu lui-même — aucun
    facteur d'échelle ne peut masquer un écart de conversion.
  */
  const fxToEur = d(1).div(RATES[opts.currency]!).toFixed(10);
  db.transactions.push({
    id: "tx-1",
    userId: USER,
    type: "ACHAT",
    platformId: PLAT,
    toPlatformId: null,
    assetId: ASSET,
    quantity: "1",
    unitPrice: opts.unitPriceNative,
    fees: "0",
    feesEur: "0",
    currency: opts.currency,
    fxRateToEur: fxToEur,
    grossAmountEur: "10000",
    netCashImpactEur: "-10000",
    withholdingTaxEur: "0",
    withholdingTaxRate: null,
    notes: null,
    occurredAt: new Date("2026-09-01T09:00:00.000Z"),
  });
}

/** La tranche de détention unique de la fiche. */
async function tranche() {
  const detail = await getAssetDetail(USER, ASSET, "EUR");
  if (!detail) throw new Error("fiche introuvable");
  const slice = detail.custodyDistribution[0];
  if (!slice) throw new Error("aucune tranche de détention");
  return slice;
}

beforeEach(() => {
  reset();
  invalidateLedgerCache(USER);
  getEurRates.mockReset().mockResolvedValue(RATES);
});

describe("getAssetDetail — prix manuel en devise", () => {
  it("un support en dollars vaut 10 000 €, pas 10 800 €", async () => {
    seed({ currency: "USD", manualPrice: "10800", unitPriceNative: "10800" });

    const slice = await tranche();

    expect(slice.quantity).toBe(1);
    // Le discriminant : l'état fautif rendait 10 800, le prix natif servi
    // comme un montant en euros — 8 % de trop, exactement le taux.
    expect(slice.marketValueEur).toBe(10_000);
    expect(slice.marketValueEur).not.toBe(10_800);
  });

  it("la fiche et le tableau Positions publient le même montant", async () => {
    seed({ currency: "USD", manualPrice: "10800", unitPriceNative: "10800" });

    const detail = await getAssetDetail(USER, ASSET, "EUR");
    const slice = detail!.custodyDistribution[0]!;

    // `holding` vient de `getHoldings`, qui convertissait déjà correctement :
    // c'est l'écart entre les deux vues que la correction supprime.
    expect(d(detail!.holding!.marketValueEur).toFixed(8)).toBe(
      "10000.00000000"
    );
    expect(d(slice.marketValueEur).toFixed(8)).toBe(
      d(detail!.holding!.marketValueEur).toFixed(8)
    );
  });

  it("un actif en euros est inchangé, à la précision que la fiche publie", async () => {
    /*
      Une correction de devise qui déplacerait un montant en euros serait le
      vrai défaut. Le prix porte ici huit décimales significatives : c'est la
      précision que `custodyDistribution` publie (`toFixed(mv, 8)`), donc la
      dernière que la mesure peut voir — au-delà, ce serait la fiche qui
      arrondit, pas la conversion.
    */
    seed({
      currency: "EUR",
      manualPrice: "10000.12345678",
      unitPriceNative: "10000",
    });

    const slice = await tranche();

    expect(d(slice.marketValueEur).toFixed(8)).toBe("10000.12345678");
  });

  it("la branche EUR de la conversion est l'identité sur l'échelle de la colonne", async () => {
    /*
      La raison pour laquelle la correction ne peut pas déplacer un montant en
      euros, mesurée là où elle vit : `convertToEurSync` sur EUR est un
      `toFixed(·, 12)`, et `Asset.manualPrice` est un `Decimal(28, 12)`. Sur
      tout le domaine de la colonne, la conversion rend la chaîne inchangée —
      c'est ce que la fiche ne peut plus montrer une fois arrondie à huit
      décimales.
    */
    const { convertToEurSync } = await import("@/app/lib/market/fx");
    for (const prix of [
      "10000",
      "10000.000000000001",
      "0.000000000001",
      "1234567890123456.123456789012",
    ]) {
      expect(d(convertToEurSync(prix, "EUR", RATES)).eq(d(prix))).toBe(true);
    }
    // Et le discriminant : sur une devise, elle ne l'est pas.
    expect(d(convertToEurSync("10800", "USD", RATES)).toFixed(8)).toBe(
      "10000.00000000"
    );
  });

  it("ne convertit pas deux fois un prix qui vient d'une cotation", async () => {
    /*
      Le cache de cotation prime sur `manualPrice`, et `PriceQuote.priceEur`
      est déjà en euros. La correction ne touche que la branche du prix
      manuel : reconvertir celle de la cotation rendrait 8 333,33 €.
    */
    seed({
      currency: "USD",
      manualPrice: "10800",
      unitPriceNative: "10800",
      priceQuote: { priceEur: "9000", priceNative: "9720" },
    });

    const slice = await tranche();

    expect(slice.marketValueEur).toBe(9_000);
  });
});
