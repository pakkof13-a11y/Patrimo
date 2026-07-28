import { describe, expect, it, beforeEach, vi } from "vitest";
import { d } from "@/app/lib/money/decimal";

const assetFindMany = vi.fn();
const getAssetValuesMock = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: { asset: { findMany: (...a: unknown[]) => assetFindMany(...a) } },
}));

vi.mock("@/app/lib/portfolio/asset-values", () => ({
  getAssetValues: (...a: unknown[]) => getAssetValuesMock(...a),
}));

const { listSecuritiesPositions, summarizePositions } = await import(
  "@/app/lib/securities/positions-service"
);

const USER = "user-1";

function asset(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    securitiesAccountId: null,
    accountType: "PEA",
    name: "Air Liquide",
    ticker: "AI",
    isin: "FR0000120073",
    category: "EQUITY",
    currency: "EUR",
    logoUrl: null,
    platform: { name: "Boursorama" },
    ...over,
  };
}

function value(market: number, cost: number, qty: number, price = 0) {
  return {
    marketValueEur: d(market),
    costBasisEur: d(cost),
    quantity: d(qty),
    priceEur: d(price),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSecuritiesPositions", () => {
  it("ne charge que les enveloppes titres, jamais la crypto ni l'immobilier", async () => {
    assetFindMany.mockResolvedValue([]);
    await listSecuritiesPositions(USER);
    expect(assetFindMany.mock.calls[0]![0].where).toEqual({
      userId: USER,
      accountType: { in: ["CTO", "PEA"] },
    });
  });

  it("sans actif, aucune valorisation n'est demandée", async () => {
    assetFindMany.mockResolvedValue([]);
    await expect(listSecuritiesPositions(USER)).resolves.toEqual([]);
    expect(getAssetValuesMock).not.toHaveBeenCalled();
  });

  it("calcule PRU, plus-value latente et pourcentage", async () => {
    assetFindMany.mockResolvedValue([asset()]);
    getAssetValuesMock.mockResolvedValue(
      new Map([["a1", value(1_200, 1_000, 10, 120)]])
    );
    const [p] = await listSecuritiesPositions(USER);
    expect(p!.unitCostBasisEur!.toNumber()).toBe(100);
    expect(p!.unrealizedPnlEur.toNumber()).toBe(200);
    expect(p!.unrealizedPnlPct!.toNumber()).toBe(20);
  });

  it("écarte une ligne soldée plutôt que de l'afficher à zéro", async () => {
    assetFindMany.mockResolvedValue([asset(), asset({ id: "soldee" })]);
    getAssetValuesMock.mockResolvedValue(
      new Map([
        ["a1", value(1_000, 800, 10)],
        ["soldee", value(0, 0, 0)],
      ])
    );
    const rows = await listSecuritiesPositions(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assetId).toBe("a1");
  });

  it("un prix de revient nul ne produit pas un pourcentage infini", async () => {
    assetFindMany.mockResolvedValue([asset()]);
    getAssetValuesMock.mockResolvedValue(
      new Map([["a1", value(500, 0, 10)]])
    );
    const [p] = await listSecuritiesPositions(USER);
    expect(p!.unrealizedPnlPct).toBeNull();
  });

  it("trie par valeur décroissante — le plus gros engagement d'abord", async () => {
    assetFindMany.mockResolvedValue([
      asset({ id: "petite" }),
      asset({ id: "grosse" }),
    ]);
    getAssetValuesMock.mockResolvedValue(
      new Map([
        ["petite", value(100, 100, 1)],
        ["grosse", value(9_000, 8_000, 20)],
      ])
    );
    const rows = await listSecuritiesPositions(USER);
    expect(rows.map((r) => r.assetId)).toEqual(["grosse", "petite"]);
  });
});

describe("summarizePositions", () => {
  it("agrège valeur, prix de revient et plus-value", async () => {
    assetFindMany.mockResolvedValue([asset(), asset({ id: "a2" })]);
    getAssetValuesMock.mockResolvedValue(
      new Map([
        ["a1", value(1_200, 1_000, 10)],
        ["a2", value(800, 1_000, 5)],
      ])
    );
    const rows = await listSecuritiesPositions(USER);
    const s = summarizePositions(rows);
    expect(s.marketValueEur.toNumber()).toBe(2_000);
    expect(s.costBasisEur.toNumber()).toBe(2_000);
    expect(s.unrealizedPnlEur.toNumber()).toBe(0);
    expect(s.unrealizedPnlPct!.toNumber()).toBe(0);
    expect(s.positionCount).toBe(2);
  });

  it("liste vide : totaux à zéro, pourcentage absent plutôt que 0 %", () => {
    const s = summarizePositions([]);
    expect(s.marketValueEur.toNumber()).toBe(0);
    expect(s.unrealizedPnlPct).toBeNull();
    expect(s.positionCount).toBe(0);
  });
});
