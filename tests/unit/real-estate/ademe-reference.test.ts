import { describe, expect, it } from "vitest";
import {
  ADEME_ALL_ENERGY_RATINGS,
  estimateFromAdemeReference,
  type AdemeReferenceRow,
} from "@/app/lib/real-estate/ademe-reference";

describe("ADEME_ALL_ENERGY_RATINGS", () => {
  it("est une sentinelle textuelle, pas null", () => {
    // Deux NULL sont distincts dans un index unique composite Postgres — un
    // vrai littéral est nécessaire pour que la contrainte protège vraiment.
    expect(ADEME_ALL_ENERGY_RATINGS).toBe("ALL");
    expect(typeof ADEME_ALL_ENERGY_RATINGS).toBe("string");
  });
});

describe("estimateFromAdemeReference", () => {
  const commune_dpe: AdemeReferenceRow = {
    medianPricePerM2: "3200.00",
    sampleSize: 42,
    scope: "COMMUNE_DPE",
  };

  it("multiplie la médiane par la surface", () => {
    const out = estimateFromAdemeReference(65, commune_dpe);
    expect(out).toEqual({
      estimateEur: "208000.00",
      medianPricePerM2: "3200.00",
      sampleSize: 42,
      scope: "COMMUNE_DPE",
    });
  });

  it("rend null sans ligne de référence", () => {
    expect(estimateFromAdemeReference(65, null)).toBeNull();
  });

  it("rend null sur une surface invalide", () => {
    expect(estimateFromAdemeReference(0, commune_dpe)).toBeNull();
    expect(estimateFromAdemeReference(-10, commune_dpe)).toBeNull();
    expect(estimateFromAdemeReference(NaN, commune_dpe)).toBeNull();
  });

  it("préserve le scope COMMUNE (repli toutes classes confondues)", () => {
    const coarse: AdemeReferenceRow = {
      medianPricePerM2: "2500.00",
      sampleSize: 8,
      scope: "COMMUNE",
    };
    const out = estimateFromAdemeReference(50, coarse);
    expect(out?.scope).toBe("COMMUNE");
    expect(out?.estimateEur).toBe("125000.00");
  });

  it("arrondit le montant à deux décimales", () => {
    const ref: AdemeReferenceRow = {
      medianPricePerM2: "3333.33",
      sampleSize: 10,
      scope: "COMMUNE_DPE",
    };
    const out = estimateFromAdemeReference(33, ref);
    // 3333.33 × 33 = 109999.89
    expect(out?.estimateEur).toBe("109999.89");
  });
});
