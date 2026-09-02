import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  groupByStrategy,
  summarizeStrategy,
  type DefiPositionInput,
} from "@/app/lib/crypto/defi";

function pos(over: Partial<DefiPositionInput> = {}): DefiPositionInput {
  return {
    id: over.id ?? "p1",
    protocol: over.protocol ?? "Lido",
    chain: over.chain ?? "ethereum",
    positionType: over.positionType ?? "LIQUID_STAKING",
    assetSymbol: over.assetSymbol ?? "ETH",
    valueEur: over.valueEur ?? d(1000),
    rewardsValueEur: over.rewardsValueEur ?? null,
    apyPct: over.apyPct ?? null,
    healthFactor: over.healthFactor ?? null,
    ltvPct: over.ltvPct ?? null,
    strategyId: over.strategyId ?? null,
  };
}

describe("groupByStrategy", () => {
  it("regroupe uniquement les positions rattachées à une stratégie", () => {
    const groups = groupByStrategy([
      pos({ id: "a", strategyId: "strat-1", valueEur: d(5000) }),
      pos({
        id: "b",
        protocol: "Aave",
        positionType: "BORROWING",
        assetSymbol: "USDC",
        strategyId: "strat-1",
        valueEur: d(2000),
      }),
      pos({ id: "c", strategyId: null }), // position autonome — exclue
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.strategyId).toBe("strat-1");
    expect(groups[0]!.positions).toHaveLength(2);
  });

  it("le net d'une stratégie retranche la dette, comme summarizeDefi", () => {
    const groups = groupByStrategy([
      pos({ id: "a", strategyId: "s", valueEur: d(5000) }),
      pos({
        id: "b",
        positionType: "BORROWING",
        strategyId: "s",
        valueEur: d(2000),
      }),
    ]);
    expect(groups[0]!.depositedEur.toNumber()).toBe(5000);
    expect(groups[0]!.borrowedEur.toNumber()).toBe(2000);
    expect(groups[0]!.netEur.toNumber()).toBe(3000);
  });

  it("plusieurs stratégies distinctes, triées par |net| décroissant", () => {
    const groups = groupByStrategy([
      pos({ id: "a", strategyId: "small", valueEur: d(100) }),
      pos({ id: "b", strategyId: "big", valueEur: d(10_000) }),
    ]);
    expect(groups.map((g) => g.strategyId)).toEqual(["big", "small"]);
  });

  it("aucune position rattachée → liste vide", () => {
    expect(groupByStrategy([pos({ strategyId: null })])).toEqual([]);
    expect(groupByStrategy([])).toEqual([]);
  });
});

describe("summarizeStrategy", () => {
  it("est un alias direct de summarizeDefi — même calcul, sous-ensemble filtré", () => {
    const positions = [
      pos({ id: "a", strategyId: "s", valueEur: d(3000) }),
      pos({
        id: "b",
        positionType: "BORROWING",
        strategyId: "s",
        valueEur: d(1000),
      }),
      pos({ id: "c", strategyId: null, valueEur: d(50_000) }), // hors stratégie
    ];
    const strategyOnly = positions.filter((p) => p.strategyId === "s");
    const summary = summarizeStrategy(strategyOnly);

    expect(summary.depositedEur.toNumber()).toBe(3000);
    expect(summary.borrowedEur.toNumber()).toBe(1000);
    expect(summary.netEur.toNumber()).toBe(2000);
    // La position hors stratégie ne doit jamais fuiter dans ce total.
    expect(summary.positionCount).toBe(2);
  });
});
