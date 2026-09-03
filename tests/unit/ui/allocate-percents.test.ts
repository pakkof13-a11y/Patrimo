import { describe, expect, it } from "vitest";
import {
  allocatePercents,
  capTinyHoldings,
} from "@/app/lib/ui/allocate-percents";
import { squarify } from "@/app/lib/ui/squarify";

describe("allocatePercents — Hamilton", () => {
  it("somme exactement 100,0 à une décimale", () => {
    // Le cas 100,1 % : 41,25 + 33,45 + 9,15 + 5,75 + 5,35 + 5,05.
    const weights = [41.25, 33.45, 9.15, 5.75, 5.35, 5.05];
    const pcts = allocatePercents(weights, 1);
    const sum = pcts.reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(100, 8);
    expect(pcts.every((p) => Math.round(p * 10) === p * 10)).toBe(true);
  });

  it("n'invente pas de part sur un total nul", () => {
    expect(allocatePercents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(allocatePercents([])).toEqual([]);
  });

  it("attribue le reste aux plus grandes parties fractionnaires", () => {
    // 1/3 + 1/3 + 1/3 = 33,3 + 33,3 + 33,4.
    const pcts = allocatePercents([1, 1, 1], 1);
    expect(pcts.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 8);
    expect(pcts.filter((p) => p === 33.4)).toHaveLength(1);
    expect(pcts.filter((p) => p === 33.3)).toHaveLength(2);
  });
});

describe("capTinyHoldings", () => {
  it("fonde les parts < 1 % dans Autres", () => {
    const out = capTinyHoldings(
      [
        { name: "A", value: 90 },
        { name: "B", value: 9 },
        { name: "C", value: 0.6 },
        { name: "D", value: 0.4 },
      ],
      { minShare: 0.01 }
    );
    expect(out.map((x) => x.name)).toEqual(["A", "B", "Autres"]);
    expect(out.find((x) => x.name === "Autres")!.value).toBeCloseTo(1, 8);
  });

  it("ne produit pas une seconde ligne Autre", () => {
    const out = capTinyHoldings(
      [
        { name: "A", value: 98 },
        { name: "Autre", value: 1.2 },
        { name: "C", value: 0.8 },
      ],
      { minShare: 0.01 }
    );
    expect(out.filter((x) => /Autre/.test(x.name))).toHaveLength(1);
    expect(out.find((x) => x.name === "Autres")!.value).toBeCloseTo(2, 8);
  });
});

describe("squarify", () => {
  it("remplit le carré unité, aire ∝ valeur", () => {
    const tiles = squarify([
      { name: "A", value: 60 },
      { name: "B", value: 40 },
    ]);
    expect(tiles).toHaveLength(2);
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(area).toBeCloseTo(1, 6);
    const a = tiles.find((t) => t.name === "A")!;
    const b = tiles.find((t) => t.name === "B")!;
    expect(a.w * a.h).toBeCloseTo(0.6, 6);
    expect(b.w * b.h).toBeCloseTo(0.4, 6);
  });
});
