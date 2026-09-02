import { describe, expect, it } from "vitest";
import {
  annualCouponEur,
  assetClassForKind,
  couponsPerYear,
  isAboveBarrier,
  periodicCouponEur,
  supportKindLabel,
  underlyingPerformancePct,
} from "@/app/lib/life-insurance/constants";

describe("couponsPerYear", () => {
  it("rend le nombre de versements annuels", () => {
    expect(couponsPerYear("MONTHLY")).toBe(12);
    expect(couponsPerYear("QUARTERLY")).toBe(4);
    expect(couponsPerYear("SEMIANNUAL")).toBe(2);
    expect(couponsPerYear("ANNUAL")).toBe(1);
  });

  it("rend 0 pour un versement à l'échéance", () => {
    expect(couponsPerYear("MATURITY")).toBe(0);
  });

  it("rend 0 sur une valeur inconnue plutôt que de deviner", () => {
    expect(couponsPerYear("WEEKLY")).toBe(0);
  });
});

describe("periodicCouponEur", () => {
  it("répartit le taux ANNUEL sur la périodicité", () => {
    // 10 000 € à 8 % annuel, versé trimestriellement → 200 € par trimestre.
    // Le piège serait de verser 800 € chaque trimestre, soit 4× trop.
    expect(
      periodicCouponEur({
        nominalEur: 10_000,
        couponRatePct: 8,
        couponFrequency: "QUARTERLY",
      })
    ).toBeCloseTo(200, 6);
  });

  it("verse le taux entier quand la périodicité est annuelle", () => {
    expect(
      periodicCouponEur({
        nominalEur: 10_000,
        couponRatePct: 8,
        couponFrequency: "ANNUAL",
      })
    ).toBeCloseTo(800, 6);
  });

  it("rend null pour un produit qui ne verse qu'à l'échéance", () => {
    expect(
      periodicCouponEur({
        nominalEur: 10_000,
        couponRatePct: 8,
        couponFrequency: "MATURITY",
      })
    ).toBeNull();
  });

  it("rend null quand nominal ou taux manque", () => {
    expect(
      periodicCouponEur({
        nominalEur: null,
        couponRatePct: 8,
        couponFrequency: "ANNUAL",
      })
    ).toBeNull();
    expect(
      periodicCouponEur({
        nominalEur: 10_000,
        couponRatePct: null,
        couponFrequency: "ANNUAL",
      })
    ).toBeNull();
    expect(
      periodicCouponEur({
        nominalEur: 0,
        couponRatePct: 8,
        couponFrequency: "ANNUAL",
      })
    ).toBeNull();
  });
});

describe("annualCouponEur", () => {
  it("compte le taux annuel même sans versement périodique", () => {
    // Produit capitalisant : rien n'est versé avant le terme, mais le taux court.
    expect(
      annualCouponEur({ nominalEur: 10_000, couponRatePct: 8 })
    ).toBeCloseTo(800, 6);
  });

  it("rend null sans nominal", () => {
    expect(annualCouponEur({ nominalEur: null, couponRatePct: 8 })).toBeNull();
  });
});

describe("isAboveBarrier", () => {
  it("compare au pourcentage du niveau initial, pas en points", () => {
    // Strike 4 000, barrière 70 % → seuil 2 800.
    expect(
      isAboveBarrier({ currentLevel: 3000, strikeLevel: 4000, barrierPct: 70 })
    ).toBe(true);
    expect(
      isAboveBarrier({ currentLevel: 2700, strikeLevel: 4000, barrierPct: 70 })
    ).toBe(false);
  });

  it("considère la barrière atteinte comme franchie (>=)", () => {
    expect(
      isAboveBarrier({ currentLevel: 2800, strikeLevel: 4000, barrierPct: 70 })
    ).toBe(true);
  });

  it("rend null — et non false — quand la comparaison est impossible", () => {
    // false se lirait « barrière enfoncée » et annoncerait une perte en capital
    // qui n'est pas établie.
    expect(
      isAboveBarrier({ currentLevel: null, strikeLevel: 4000, barrierPct: 70 })
    ).toBeNull();
    expect(
      isAboveBarrier({ currentLevel: 3000, strikeLevel: null, barrierPct: 70 })
    ).toBeNull();
    expect(
      isAboveBarrier({ currentLevel: 3000, strikeLevel: 4000, barrierPct: null })
    ).toBeNull();
    expect(
      isAboveBarrier({ currentLevel: 3000, strikeLevel: 0, barrierPct: 70 })
    ).toBeNull();
  });
});

describe("underlyingPerformancePct", () => {
  it("mesure l'écart au niveau initial", () => {
    expect(
      underlyingPerformancePct({ currentLevel: 4400, strikeLevel: 4000 })
    ).toBeCloseTo(10, 6);
    expect(
      underlyingPerformancePct({ currentLevel: 3600, strikeLevel: 4000 })
    ).toBeCloseTo(-10, 6);
  });

  it("rend null sans niveau initial exploitable", () => {
    expect(
      underlyingPerformancePct({ currentLevel: 4400, strikeLevel: null })
    ).toBeNull();
    expect(
      underlyingPerformancePct({ currentLevel: 4400, strikeLevel: 0 })
    ).toBeNull();
  });
});

describe("assetClassForKind", () => {
  it("classe le fonds euro en obligataire", () => {
    expect(assetClassForKind("FONDS_EURO")).toBe("OBLIGATIONS");
  });

  it("ne présume pas actions pour une UC", () => {
    // Une UC peut être obligataire ou monétaire : la classer d'office en
    // actions fausserait l'allocation.
    expect(assetClassForKind("UC")).toBe("AUTRE");
  });

  it("classe un structuré à part", () => {
    expect(assetClassForKind("STRUCTURED")).toBe("AUTRE");
  });
});

describe("supportKindLabel", () => {
  it("traduit les natures connues", () => {
    expect(supportKindLabel("FONDS_EURO")).toBe("Fonds euro");
    expect(supportKindLabel("STRUCTURED")).toBe("Produit structuré");
  });

  it("retombe sur le code brut plutôt que sur du vide", () => {
    expect(supportKindLabel("INCONNU")).toBe("INCONNU");
  });
});
