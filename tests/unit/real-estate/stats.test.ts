import { describe, expect, it } from "vitest";
import {
  estimateConfidence,
  priceDistribution,
  quantileSorted,
} from "@/app/lib/real-estate/stats";
import { d } from "@/app/lib/money/decimal";

const sorted = (nums: number[]) => nums.map((n) => d(n));

describe("quantileSorted", () => {
  it("rend la valeur centrale sur un effectif impair", () => {
    expect(quantileSorted(sorted([1, 2, 3]), 0.5).toNumber()).toBe(2);
  });

  it("interpole entre les deux valeurs centrales sur un effectif pair", () => {
    expect(quantileSorted(sorted([1, 2, 3, 4]), 0.5).toNumber()).toBe(2.5);
  });

  it("rend les extrêmes pour q=0 et q=1", () => {
    const v = sorted([10, 20, 30]);
    expect(quantileSorted(v, 0).toNumber()).toBe(10);
    expect(quantileSorted(v, 1).toNumber()).toBe(30);
  });

  it("suit la convention percentile_cont de PostgreSQL", () => {
    // Sur [1,2,3,4] : Q1 = 1,75 et Q3 = 3,25 en interpolation linéaire
    const v = sorted([1, 2, 3, 4]);
    expect(quantileSorted(v, 0.25).toNumber()).toBeCloseTo(1.75, 10);
    expect(quantileSorted(v, 0.75).toNumber()).toBeCloseTo(3.25, 10);
  });

  it("gère une série d'un seul élément", () => {
    expect(quantileSorted(sorted([42]), 0.25).toNumber()).toBe(42);
  });

  it("refuse une série vide plutôt que de rendre NaN", () => {
    expect(() => quantileSorted([], 0.5)).toThrow();
  });
});

describe("priceDistribution", () => {
  it("calcule médiane, quartiles et dispersion", () => {
    const out = priceDistribution([1000, 2000, 3000, 4000, 5000])!;
    expect(out.median).toBe("3000.00");
    expect(out.q1).toBe("2000.00");
    expect(out.q3).toBe("4000.00");
    expect(out.iqr).toBe("2000.00");
    expect(out.min).toBe("1000.00");
    expect(out.max).toBe("5000.00");
    expect(out.count).toBe(5);
  });

  it("trie avant de calculer — l'ordre d'arrivée ne doit rien changer", () => {
    const a = priceDistribution([5000, 1000, 3000, 2000, 4000])!;
    const b = priceDistribution([1000, 2000, 3000, 4000, 5000])!;
    expect(a).toEqual(b);
  });

  it("résiste à une vente d'exception là où une moyenne dérapterait", () => {
    const prices = [3000, 3100, 3200, 3300, 50_000];
    const out = priceDistribution(prices)!;
    const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
    expect(out.median).toBe("3200.00");
    // La moyenne est propulsée à plus du double de la médiane
    expect(mean).toBeGreaterThan(12_000);
  });

  it("accepte indifféremment nombres et chaînes", () => {
    expect(priceDistribution(["1000", 2000, "3000"])!.median).toBe("2000.00");
  });

  it("ignore les valeurs impossibles plutôt que de fausser les quantiles", () => {
    const out = priceDistribution([1000, 0, -500, 3000, NaN])!;
    expect(out.count).toBe(2);
    expect(out.median).toBe("2000.00");
  });

  it("rend null quand il ne reste rien d'exploitable", () => {
    expect(priceDistribution([])).toBeNull();
    expect(priceDistribution([0, -1])).toBeNull();
  });

  it("gère un comparable unique sans dispersion", () => {
    const out = priceDistribution([4200])!;
    expect(out.median).toBe("4200.00");
    expect(out.iqr).toBe("0.00");
    expect(out.count).toBe(1);
  });
});

describe("estimateConfidence", () => {
  it("est haute sur un secteur dense, proche et homogène", () => {
    expect(
      estimateConfidence({
        count: 60,
        radiusM: 1000,
        median: "3000.00",
        iqr: "900.00",
      })
    ).toBe("HIGH");
  });

  it("retombe à moyenne quand il a fallu élargir le rayon", () => {
    expect(
      estimateConfidence({
        count: 60,
        radiusM: 5000,
        median: "3000.00",
        iqr: "900.00",
      })
    ).toBe("MEDIUM");
  });

  it("retombe à moyenne sur un effectif mince", () => {
    expect(
      estimateConfidence({
        count: 16,
        radiusM: 1000,
        median: "3000.00",
        iqr: "600.00",
      })
    ).toBe("MEDIUM");
  });

  it("reste basse sur un marché hétérogène, même avec beaucoup de ventes", () => {
    // 200 ventes ne valent rien si les prix vont du simple au triple.
    expect(
      estimateConfidence({
        count: 200,
        radiusM: 1000,
        median: "3000.00",
        iqr: "3000.00",
      })
    ).toBe("LOW");
  });

  it("est basse quand les comparables sont trop peu nombreux", () => {
    expect(
      estimateConfidence({
        count: 5,
        radiusM: 1000,
        median: "3000.00",
        iqr: "100.00",
      })
    ).toBe("LOW");
  });

  it("ne divise jamais par une médiane nulle", () => {
    expect(
      estimateConfidence({
        count: 100,
        radiusM: 500,
        median: "0.00",
        iqr: "0.00",
      })
    ).toBe("LOW");
  });
});
