import { describe, expect, it } from "vitest";
import {
  ceilingProgressPct,
  isRateSuspicious,
  REGULATED_PRODUCT_INFO,
} from "@/app/lib/cash/regulated-products";

describe("REGULATED_PRODUCT_INFO", () => {
  it("plafonds connus", () => {
    expect(REGULATED_PRODUCT_INFO.LIVRET_A?.ceilingAmount).toBe("22950");
    expect(REGULATED_PRODUCT_INFO.LDDS?.ceilingAmount).toBe("12000");
    expect(REGULATED_PRODUCT_INFO.LEP?.ceilingAmount).toBe("10000");
    expect(REGULATED_PRODUCT_INFO.PEL?.ceilingAmount).toBe("61200");
  });

  it("CEL et AUTRE n'ont pas de plafond pré-rempli", () => {
    expect(REGULATED_PRODUCT_INFO.CEL).toBeUndefined();
    expect(REGULATED_PRODUCT_INFO.AUTRE).toBeUndefined();
  });
});

describe("ceilingProgressPct", () => {
  it("calcule le pourcentage du plafond atteint", () => {
    expect(ceilingProgressPct("11475", "22950")).toBeCloseTo(50, 6);
  });

  it("ne plafonne pas à 100 — un dépassement doit rester visible", () => {
    expect(ceilingProgressPct("25000", "22950")).toBeGreaterThan(100);
  });

  it("null si pas de plafond défini", () => {
    expect(ceilingProgressPct("1000", null)).toBeNull();
    expect(ceilingProgressPct("1000", undefined)).toBeNull();
    expect(ceilingProgressPct("1000", "0")).toBeNull();
  });
});

describe("isRateSuspicious", () => {
  it("taux proche du taux réglementé → pas suspect", () => {
    expect(isRateSuspicious("LIVRET_A", "2.4")).toBe(false);
    expect(isRateSuspicious("LIVRET_A", "2.9")).toBe(false);
  });

  it("taux aberrant → suspect", () => {
    expect(isRateSuspicious("LIVRET_A", "35")).toBe(true);
  });

  it("produit sans taux de référence connu → jamais suspect", () => {
    expect(isRateSuspicious("LEP", "35")).toBe(false);
    expect(isRateSuspicious("AUTRE", "35")).toBe(false);
  });
});
