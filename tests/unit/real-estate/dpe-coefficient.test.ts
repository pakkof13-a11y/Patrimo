import { describe, expect, it } from "vitest";
import {
  DPE_PRICE_COEFFICIENTS,
  dpePriceCoefficient,
} from "@/app/lib/real-estate/estimate";

describe("dpePriceCoefficient", () => {
  it("applique le barème exact pour chaque classe", () => {
    expect(dpePriceCoefficient("A")).toBe(1.1);
    expect(dpePriceCoefficient("B")).toBe(1.06);
    expect(dpePriceCoefficient("C")).toBe(1.02);
    expect(dpePriceCoefficient("D")).toBe(1);
    expect(dpePriceCoefficient("E")).toBe(0.93);
    expect(dpePriceCoefficient("F")).toBe(0.85);
    expect(dpePriceCoefficient("G")).toBe(0.78);
  });

  it("rend 1 (aucun ajustement) sans classe connue", () => {
    expect(dpePriceCoefficient(null)).toBe(1);
    expect(dpePriceCoefficient(undefined)).toBe(1);
    expect(dpePriceCoefficient("")).toBe(1);
  });

  it("rend 1 pour une classe non reconnue plutôt que d'inventer un coefficient", () => {
    expect(dpePriceCoefficient("Z")).toBe(1);
    expect(dpePriceCoefficient("123")).toBe(1);
  });

  it("normalise la casse et les espaces", () => {
    expect(dpePriceCoefficient(" e ")).toBe(0.93);
    expect(dpePriceCoefficient("g")).toBe(0.78);
  });

  it("expose le barème complet", () => {
    expect(Object.keys(DPE_PRICE_COEFFICIENTS).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]);
  });
});
