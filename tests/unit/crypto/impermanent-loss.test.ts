import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  computeImpermanentLoss,
  type ImpermanentLossLeg,
} from "@/app/lib/crypto/impermanent-loss";

function leg(
  symbol: string,
  entry: string,
  current: string,
  weightPct?: string
): ImpermanentLossLeg {
  return {
    symbol,
    entryPriceEur: d(entry),
    currentPriceEur: d(current),
    weightPct: weightPct != null ? d(weightPct) : null,
  };
}

describe("computeImpermanentLoss", () => {
  it("prix inchangés → IL nul", () => {
    const res = computeImpermanentLoss(
      [leg("ETH", "2000", "2000"), leg("USDC", "1", "1")],
      d(10000)
    );
    expect(res).not.toBeNull();
    expect(res!.pctOfHodl.toNumber()).toBeCloseTo(0, 10);
    expect(res!.amountEur.toNumber()).toBeCloseTo(0, 6);
  });

  it("2 jetons, un seul bouge x4 → IL classique ≈ -20 %", () => {
    // Formule connue : ratio=4 → 2*sqrt(4)/(1+4) - 1 = 4/5 - 1 = -0.2
    const res = computeImpermanentLoss(
      [leg("ETH", "1000", "4000"), leg("USDC", "1", "1")],
      d(10000)
    );
    expect(res!.pctOfHodl.toNumber()).toBeCloseTo(-0.2, 6);
    expect(res!.amountEur.toNumber()).toBeCloseTo(-2000, 2);
  });

  it("prix proportionnels (les deux x2) → IL nul", () => {
    const res = computeImpermanentLoss(
      [leg("ETH", "1000", "2000"), leg("BTC", "20000", "40000")],
      d(5000)
    );
    expect(res!.pctOfHodl.toNumber()).toBeCloseTo(0, 8);
  });

  it("3 jetons poids égaux, un seul bouge → IL toujours négatif", () => {
    const res = computeImpermanentLoss(
      [
        leg("USDC", "1", "1"),
        leg("USDT", "1", "1"),
        leg("DAI", "1", "1.5"),
      ],
      d(3000)
    );
    expect(res).not.toBeNull();
    expect(res!.pctOfHodl.toNumber()).toBeLessThan(0);
  });

  it("poids explicites déséquilibrés (position concentrée)", () => {
    const balanced = computeImpermanentLoss(
      [leg("ETH", "1000", "3000", "50"), leg("USDC", "1", "1", "50")],
      d(10000)
    );
    const skewed = computeImpermanentLoss(
      [leg("ETH", "1000", "3000", "80"), leg("USDC", "1", "1", "20")],
      d(10000)
    );
    // Plus le poids penche vers le jeton qui a bougé, plus l'IL relatif
    // au HODL diffère de la répartition égale — les deux ne doivent pas
    // coïncider.
    expect(skewed!.pctOfHodl.toNumber()).not.toBeCloseTo(
      balanced!.pctOfHodl.toNumber(),
      4
    );
  });

  it("poids omis → répartition égale implicite", () => {
    const explicit = computeImpermanentLoss(
      [leg("ETH", "1000", "4000", "50"), leg("USDC", "1", "1", "50")],
      d(10000)
    );
    const implicit = computeImpermanentLoss(
      [leg("ETH", "1000", "4000"), leg("USDC", "1", "1")],
      d(10000)
    );
    expect(implicit!.pctOfHodl.toNumber()).toBeCloseTo(
      explicit!.pctOfHodl.toNumber(),
      10
    );
  });

  it("moins de 2 jambes exploitables → null", () => {
    expect(computeImpermanentLoss([leg("ETH", "1000", "2000")], d(1000))).toBeNull();
    expect(computeImpermanentLoss([], d(1000))).toBeNull();
  });

  it("prix d'entrée nul ou négatif → jambe ignorée, peut retomber à null", () => {
    const res = computeImpermanentLoss(
      [leg("ETH", "0", "2000"), leg("USDC", "1", "1")],
      d(1000)
    );
    expect(res).toBeNull();
  });

  it("IL en euros suit la valeur déposée", () => {
    const small = computeImpermanentLoss(
      [leg("ETH", "1000", "4000"), leg("USDC", "1", "1")],
      d(1000)
    );
    const big = computeImpermanentLoss(
      [leg("ETH", "1000", "4000"), leg("USDC", "1", "1")],
      d(100000)
    );
    expect(small!.pctOfHodl.toNumber()).toBeCloseTo(
      big!.pctOfHodl.toNumber(),
      10
    );
    expect(big!.amountEur.toNumber()).toBeCloseTo(
      small!.amountEur.toNumber() * 100,
      2
    );
  });
});
