import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FIN-01 — `costBasis` doit couvrir exactement le même périmètre que
 * `marketValue` : celui de `getHoldings`, positions `isIgnoredInPortfolio`
 * exclues.
 *
 * Deux points corrigés par ce chantier, chacun mesuré ici :
 *
 *  - `getPlatformCashBalances` (`service.ts:658-768`) chargeait le `select`
 *    asset sans `defiPosition`/`nftItem` et itérait `led.positions` sans
 *    exclusion : une position DeFi écartée du patrimoine pesait quand même
 *    dans `positionsValueEur`, `costBasisEur` (implicite dans
 *    `unrealizedPnlEur`), `positionCount` et `envelopes` par plateforme.
 *
 *  - `historical/engine.ts:1282` (`positionsCostBasis`) sommait
 *    `totalCostBasis(state)` sans le filtre `excludedAssetIds` déjà appliqué
 *    à la valorisation (`:949`, `:1103`) — la courbe aurait porté le même
 *    écart que le résumé du jour.
 *
 * Le réalisé (`totalRealizedPnl`) n'est **pas** touché : décision produit
 * explicitement renvoyée, pas tranchée ici (cf. brief FIN-01).
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const { db, fakePrisma, reset } = vi.hoisted(() => {
  const db: { platforms: Row[]; assets: Row[] } = { platforms: [], assets: [] };

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
  const filter = (rows: Row[], where?: Where) => rows.filter((r) => matches(r, where));

  const fakePrisma = {
    platform: {
      findMany: async ({ where }: { where?: Where }) => filter(db.platforms, where),
    },
    asset: {
      findMany: async ({ where }: { where?: Where }) => filter(db.assets, where),
    },
    // Aucune transaction nécessaire : le ledger est fourni directement à
    // `getPlatformCashBalances`, qui ne rejoue rien lui-même.
    transaction: {
      findMany: async () => [] as Row[],
    },
  };

  const reset = () => {
    db.platforms = [];
    db.assets = [];
  };

  return { db, fakePrisma, reset };
});

vi.mock("@/app/lib/prisma", () => ({ prisma: fakePrisma }));

// Pas de compte banque/livret dans ce scénario — court-circuite le module
// plutôt que de fabriquer les tables `bankAccount`/`savingsAccount`.
vi.mock("@/app/lib/cash/pockets", () => ({
  getBankPocketCashByNameEur: async () => new Map(),
}));

import { createEmptyLedger } from "@/app/lib/accounting/ledger";
import { positionKey } from "@/app/lib/accounting/types";
import { d } from "@/app/lib/money/decimal";
import { getPlatformCashBalances } from "@/app/lib/portfolio/service";

const USER = "u-fin01";
const PLATFORM = "p1";
const RATES = { EUR: 1 };

beforeEach(() => {
  reset();
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
  // Position normale : 5 titres à 300 € (marché 1 500 €), payés 1 000 €.
  db.assets.push({
    id: "a1",
    userId: USER,
    currency: "EUR",
    accountType: "CTO",
    manualPrice: null,
    priceQuote: { priceEur: "300" },
    defiPosition: null,
    nftItem: null,
  });
  // Position DeFi écartée du patrimoine : marché 1 200 €, coût 6 000 €.
  db.assets.push({
    id: "defi-1",
    userId: USER,
    currency: "EUR",
    accountType: "CRYPTO",
    manualPrice: null,
    priceQuote: { priceEur: "120" },
    defiPosition: { isIgnoredInPortfolio: true },
    nftItem: null,
  });
});

function ledgerWithBothPositions() {
  const ledger = createEmptyLedger();
  ledger.positions.set(positionKey("a1", PLATFORM), {
    assetId: "a1",
    platformId: PLATFORM,
    quantity: d(5),
    costBasisEur: d(1000),
  });
  ledger.positions.set(positionKey("defi-1", PLATFORM), {
    assetId: "defi-1",
    platformId: PLATFORM,
    quantity: d(10),
    costBasisEur: d(6000),
  });
  return ledger;
}

describe("getPlatformCashBalances — périmètre DeFi ignorée", () => {
  it("exclut la position ignorée de la valeur, du coût et du P&L de la plateforme", async () => {
    const ledger = ledgerWithBothPositions();
    const [plat] = await getPlatformCashBalances(USER, "EUR", RATES, ledger);

    // Avant la correction : positionsValueEur = 1500 + 1200 = 2700,
    // costBasisEur (implicite) = 1000 + 6000 = 7000, unrealizedPnlEur = -4300.
    expect(plat!.positionsValueEur).toBe("1500.00000000");
    expect(plat!.unrealizedPnlEur).toBe("500.00000000");
    expect(plat!.positionCount).toBe(1);
  });

  it("ne ventile la position ignorée dans aucune enveloppe", async () => {
    const ledger = ledgerWithBothPositions();
    const [plat] = await getPlatformCashBalances(USER, "EUR", RATES, ledger);

    expect(plat!.envelopes).toEqual([
      expect.objectContaining({ accountType: "CTO", valueEur: "1500.00000000" }),
    ]);
  });
});
