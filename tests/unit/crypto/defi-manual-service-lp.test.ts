import { describe, expect, it } from "vitest";
import {
  DefiInputError,
  validateLpInput,
  type CreateDefiInput,
  type ExtraLpLeg,
} from "@/app/lib/crypto/defi-manual-service";

function baseInput(overrides: Partial<CreateDefiInput> = {}): CreateDefiInput {
  return {
    platformId: "p1",
    assetSymbol: "ETH",
    protocol: "Uniswap",
    positionType: "LP",
    quantity: "1",
    unitPriceEur: "2000",
    openedAt: new Date().toISOString(),
    pairedSymbol: "USDC",
    pairedAmount: "2000",
    pairedEntryPriceEur: "1",
    ...overrides,
  };
}

describe("validateLpInput", () => {
  it("accepte une LP 2 jetons full range valide", () => {
    expect(() => validateLpInput(baseInput(), "ETH", [])).not.toThrow();
  });

  it("rejette une LP sans second jeton", () => {
    expect(() =>
      validateLpInput(baseInput({ pairedSymbol: null }), "ETH", [])
    ).toThrow(DefiInputError);
  });

  it("rejette un prix d'entrée manquant sur le second jeton", () => {
    expect(() =>
      validateLpInput(
        baseInput({ pairedEntryPriceEur: null }),
        "ETH",
        []
      )
    ).toThrow(/prix d'entrée/i);
  });

  it("rejette des jetons dupliqués", () => {
    expect(() =>
      validateLpInput(baseInput({ pairedSymbol: "eth" }), "ETH", [])
    ).toThrow(/distincts/i);
  });

  it("accepte 3 jetons (Curve) et rejette au-delà de 5", () => {
    const threeLegs: ExtraLpLeg[] = [
      { symbol: "DAI", amount: "1000", entryPriceEur: "1" },
    ];
    expect(() => validateLpInput(baseInput(), "ETH", threeLegs)).not.toThrow();

    const fourExtra: ExtraLpLeg[] = [
      { symbol: "DAI", amount: "1", entryPriceEur: "1" },
      { symbol: "FRAX", amount: "1", entryPriceEur: "1" },
      { symbol: "LUSD", amount: "1", entryPriceEur: "1" },
      { symbol: "GUSD", amount: "1", entryPriceEur: "1" },
    ];
    expect(() => validateLpInput(baseInput(), "ETH", fourExtra)).toThrow(
      /5 jetons/i
    );
  });

  it("LP concentrée exige une plage de prix cohérente", () => {
    expect(() =>
      validateLpInput(
        baseInput({ isConcentrated: true }),
        "ETH",
        []
      )
    ).toThrow(/plage de prix/i);

    expect(() =>
      validateLpInput(
        baseInput({
          isConcentrated: true,
          priceRangeMin: "2000",
          priceRangeMax: "1000",
        }),
        "ETH",
        []
      )
    ).toThrow(/minimum doit être inférieur/i);

    expect(() =>
      validateLpInput(
        baseInput({
          isConcentrated: true,
          priceRangeMin: "1000",
          priceRangeMax: "3000",
        }),
        "ETH",
        []
      )
    ).not.toThrow();
  });

  it("répartition : tout ou rien, et doit sommer à 100 %", () => {
    // Un seul champ renseigné → erreur (répartition à moitié saisie)
    expect(() =>
      validateLpInput(
        baseInput({
          isConcentrated: true,
          priceRangeMin: "1000",
          priceRangeMax: "3000",
          token1AllocationPct: "60",
        }),
        "ETH",
        []
      )
    ).toThrow(/tous les jetons/i);

    // Somme ≠ 100
    expect(() =>
      validateLpInput(
        baseInput({
          isConcentrated: true,
          priceRangeMin: "1000",
          priceRangeMax: "3000",
          token1AllocationPct: "60",
          pairedAllocationPct: "50",
        }),
        "ETH",
        []
      )
    ).toThrow(/somme des répartitions/i);

    // Somme = 100 → OK
    expect(() =>
      validateLpInput(
        baseInput({
          isConcentrated: true,
          priceRangeMin: "1000",
          priceRangeMax: "3000",
          token1AllocationPct: "65",
          pairedAllocationPct: "35",
        }),
        "ETH",
        []
      )
    ).not.toThrow();
  });

  it("répartition à 3 jetons : chaque leg doit avoir la sienne", () => {
    const legs: ExtraLpLeg[] = [
      { symbol: "DAI", amount: "500", entryPriceEur: "1", allocationPct: "34" },
    ];
    expect(() =>
      validateLpInput(
        baseInput({
          isConcentrated: true,
          priceRangeMin: "1000",
          priceRangeMax: "3000",
          token1AllocationPct: "33",
          pairedAllocationPct: "33",
        }),
        "ETH",
        legs
      )
    ).not.toThrow(); // 33+33+34 = 100
  });

  it("LP non concentrée n'exige pas de répartition", () => {
    expect(() => validateLpInput(baseInput(), "ETH", [])).not.toThrow();
  });
});
