import { describe, expect, it } from "vitest";
import {
  allocationLegendForScope,
  allocationSliceLabel,
  allocationSlicesForScope,
  immobilierSliceValue,
  listedSlicesFromHoldings,
} from "@/app/lib/portfolio/allocation-scope";
import { allocatePercents } from "@/app/lib/ui/allocate-percents";

/**
 * Camembert aligné sur la carte active.
 *
 * Ce qui est vérifié ici n'est pas un rendu, mais que le dénominateur du
 * donut est le même chiffre que le titre : 41 % d'immobilier sous 295 k€
 * de Financier était le défaut à corriger.
 */

const HOLDINGS = [
  {
    assetClass: "ACTIONS",
    accountType: "PEA",
    marketValueBase: 120_000,
  },
  {
    assetClass: "OBLIGATIONS",
    accountType: "CTO",
    marketValueBase: 10_000,
  },
  {
    assetClass: "CRYPTO",
    accountType: "CRYPTO",
    marketValueBase: 15_000,
  },
  {
    assetClass: "ACTIONS",
    accountType: "AV",
    marketValueBase: 72_750,
  },
  {
    assetClass: "OBLIGATIONS",
    accountType: "AV",
    marketValueBase: 25_500,
  },
  {
    assetClass: "IMMOBILIER",
    accountType: "IMMOBILIER",
    marketValueBase: 204_590,
  },
];

const BY_CLASS = [
  { name: "ACTIONS", value: 192_750 },
  { name: "OBLIGATIONS", value: 35_500 },
  { name: "CRYPTO", value: 15_000 },
  { name: "IMMOBILIER", value: 204_590 },
  { name: "CASH", value: 50_000 },
];

const FINANCIER_INPUT = {
  byClass: BY_CLASS,
  holdings: HOLDINGS,
  cashInvestissement: 50_000,
  fondsEuro: 25_500,
  esLiquid: 8_200,
};

describe("allocationSlicesForScope — Financier", () => {
  it("ne porte aucune part immobilier", () => {
    const slices = allocationSlicesForScope("financier", FINANCIER_INPUT);
    expect(immobilierSliceValue(slices)).toBe(0);
    expect(slices.some((s) => /immo/i.test(s.name))).toBe(false);
    expect(slices.some((s) => /immo/i.test(allocationSliceLabel(s.name)))).toBe(
      false
    );
  });

  it("somme listed + cashInvest + fondsEuro + esLiquid — pas les UC d'AV", () => {
    const slices = allocationSlicesForScope("financier", FINANCIER_INPUT);
    const listed = listedSlicesFromHoldings(HOLDINGS);
    expect(listed.map((s) => s.name).sort()).toEqual(
      ["ACTIONS", "CRYPTO", "OBLIGATIONS"].sort()
    );
    expect(listed.find((s) => s.name === "ACTIONS")!.value).toBe(120_000);
    const total = slices.reduce((s, x) => s + x.value, 0);
    expect(total).toBe(120_000 + 10_000 + 15_000 + 50_000 + 25_500 + 8_200);
    expect(slices.find((s) => s.name === "FONDS_EURO")!.value).toBe(25_500);
    expect(slices.find((s) => s.name === "ES_LIQUID")!.value).toBe(8_200);
  });

  it("Hamilton répartit 100,0 % sur le Financier, pas sur le brut", () => {
    const slices = allocationSlicesForScope("financier", FINANCIER_INPUT);
    const pcts = allocatePercents(
      slices.map((s) => s.value),
      1
    );
    expect(pcts.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 8);
    const immoShareOfBrut = 204_590 / 497_840;
    expect(immoShareOfBrut).toBeCloseTo(0.41, 2);
    expect(pcts.every((p) => p !== 41)).toBe(true);
  });
});

describe("allocationSlicesForScope — Brut / Net", () => {
  it("Brut conserve l'immobilier : byClass.IMMOBILIER === poche", () => {
    const slices = allocationSlicesForScope("brut", FINANCIER_INPUT);
    expect(immobilierSliceValue(slices)).toBe(204_590);
    const total = slices.reduce((s, x) => s + x.value, 0);
    const immoPct = (204_590 / total) * 100;
    expect(immoPct).toBeCloseTo(41.1, 1);
    const pcts = allocatePercents(
      slices.map((s) => s.value),
      1
    );
    expect(pcts.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 8);
    const immoIdx = slices.findIndex((s) => s.name === "IMMOBILIER");
    expect(pcts[immoIdx]).toBeCloseTo(41.1, 1);
  });

  it("Net reprend la même ventilation, légende hors passifs", () => {
    const brut = allocationSlicesForScope("brut", FINANCIER_INPUT);
    const net = allocationSlicesForScope("net", FINANCIER_INPUT);
    expect(net).toEqual(brut);
    expect(allocationLegendForScope("net")).toBe("hors passifs");
    expect(allocationLegendForScope("brut")).toBeUndefined();
    expect(allocationLegendForScope("financier")).toBeUndefined();
  });
});
