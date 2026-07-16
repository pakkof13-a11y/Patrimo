import { describe, expect, it } from "vitest";
import {
  ASSET_CATEGORY_ORDER,
  assetCategoryLabel,
  groupPositionsByAssetCategory,
  parseAssetCategory,
  parseHoldingsGroupBy,
  suggestCategoryFromAssetClass,
  type GroupableHolding,
} from "@/app/lib/assets/categories";

function h(
  partial: Partial<GroupableHolding> & { assetId: string }
): GroupableHolding {
  return {
    category: "UNCLASSIFIED",
    marketValueBase: "100",
    unrealizedPnlBase: "10",
    ...partial,
  };
}

describe("parseAssetCategory", () => {
  it("maps known codes", () => {
    expect(parseAssetCategory("EQUITY")).toBe("EQUITY");
    expect(parseAssetCategory("ETF")).toBe("ETF");
  });

  it("falls back to UNCLASSIFIED", () => {
    expect(parseAssetCategory(null)).toBe("UNCLASSIFIED");
    expect(parseAssetCategory("")).toBe("UNCLASSIFIED");
    expect(parseAssetCategory("NOPE")).toBe("UNCLASSIFIED");
  });
});

describe("groupPositionsByAssetCategory", () => {
  it("places EQUITY in Actions", () => {
    const groups = groupPositionsByAssetCategory([
      h({ assetId: "1", category: "EQUITY", marketValueBase: "200" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("EQUITY");
    expect(groups[0]!.label).toBe("Actions");
    expect(groups[0]!.count).toBe(1);
  });

  it("places ETF in ETF", () => {
    const groups = groupPositionsByAssetCategory([
      h({ assetId: "1", category: "ETF" }),
    ]);
    expect(groups[0]!.category).toBe("ETF");
    expect(groups[0]!.label).toBe("ETF");
  });

  it("puts missing category in Non classé", () => {
    const groups = groupPositionsByAssetCategory([
      h({ assetId: "1", category: null }),
      h({ assetId: "2", category: undefined }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("UNCLASSIFIED");
    expect(groups[0]!.label).toBe("Non classé");
    expect(groups[0]!.count).toBe(2);
  });

  it("omits empty groups", () => {
    const groups = groupPositionsByAssetCategory([
      h({ assetId: "1", category: "CRYPTO" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["CRYPTO"]);
    expect(groups.find((g) => g.category === "EQUITY")).toBeUndefined();
  });

  it("respects business order", () => {
    const groups = groupPositionsByAssetCategory([
      h({ assetId: "u", category: "UNCLASSIFIED" }),
      h({ assetId: "c", category: "CRYPTO" }),
      h({ assetId: "e", category: "EQUITY" }),
      h({ assetId: "etf", category: "ETF" }),
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      "EQUITY",
      "ETF",
      "CRYPTO",
      "UNCLASSIFIED",
    ]);
    // UNCLASSIFIED is always last among present groups
    expect(groups[groups.length - 1]!.category).toBe("UNCLASSIFIED");
    // Order indices increase
    const idxs = groups.map((g) => ASSET_CATEGORY_ORDER.indexOf(g.category));
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]!).toBeGreaterThan(idxs[i - 1]!);
    }
  });

  it("aggregates market value and unrealized PnL", () => {
    const groups = groupPositionsByAssetCategory([
      h({
        assetId: "1",
        category: "EQUITY",
        marketValueBase: "1000",
        unrealizedPnlBase: "100",
      }),
      h({
        assetId: "2",
        category: "EQUITY",
        marketValueBase: "500.5",
        unrealizedPnlBase: "-50.25",
      }),
      h({
        assetId: "3",
        category: "ETF",
        marketValueBase: "2000",
        unrealizedPnlBase: "200",
      }),
    ]);
    const eq = groups.find((g) => g.category === "EQUITY")!;
    expect(eq.totalMarketValue).toBeCloseTo(1500.5, 5);
    expect(eq.totalUnrealizedPnl).toBeCloseTo(49.75, 5);
    expect(eq.weightPct).toBeCloseTo(42.9, 0); // 1500.5 / 3500.5 ≈ 42.9%
  });

  it("weightPct null when total value is zero", () => {
    const groups = groupPositionsByAssetCategory([
      h({
        assetId: "1",
        category: "EQUITY",
        marketValueBase: "0",
        unrealizedPnlBase: "0",
      }),
    ]);
    expect(groups[0]!.weightPct).toBeNull();
  });

  it("does not mutate input positions", () => {
    const input = [
      h({ assetId: "1", category: "EQUITY", marketValueBase: "10" }),
    ];
    const freeze = JSON.stringify(input);
    groupPositionsByAssetCategory(input);
    expect(JSON.stringify(input)).toBe(freeze);
  });

  it("search-like filter leaves only groups with hits", () => {
    const all = [
      h({ assetId: "1", category: "EQUITY" }),
      h({ assetId: "2", category: "ETF" }),
      h({ assetId: "3", category: "BOND" }),
    ];
    // Simulate search keeping only ETF
    const filtered = all.filter((p) => p.assetId === "2");
    const groups = groupPositionsByAssetCategory(filtered);
    expect(groups.map((g) => g.category)).toEqual(["ETF"]);
  });
});

describe("suggestCategoryFromAssetClass", () => {
  it("maps reliable asset classes only", () => {
    expect(suggestCategoryFromAssetClass("CRYPTO")).toBe("CRYPTO");
    expect(suggestCategoryFromAssetClass("OBLIGATIONS")).toBe("BOND");
    expect(suggestCategoryFromAssetClass("CASH")).toBe("CASH_EQUIVALENT");
    expect(suggestCategoryFromAssetClass("ACTIONS")).toBe("UNCLASSIFIED");
  });
});

describe("misc", () => {
  it("labels are French", () => {
    expect(assetCategoryLabel("EQUITY")).toBe("Actions");
    expect(assetCategoryLabel("UNCLASSIFIED")).toBe("Non classé");
  });

  it("parseHoldingsGroupBy", () => {
    expect(parseHoldingsGroupBy(null)).toBe("none");
    expect(parseHoldingsGroupBy("none")).toBe("none");
    expect(parseHoldingsGroupBy("assetCategory")).toBe("assetCategory");
  });
});
