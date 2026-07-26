import { describe, expect, it } from "vitest";
import {
  compareRentalRegimes,
  evaluateRegime,
  DEFICIT_GLOBAL_CAP,
  MICRO_FONCIER_CEILING,
} from "@/app/lib/real-estate/tax/rental-income";

describe("micro-foncier", () => {
  it("applique 30 % d'abattement sous le plafond", () => {
    const r = evaluateRegime("MICRO_FONCIER", {
      grossRentEur: 12_000,
      marginalTaxRatePct: 30,
    });
    expect(r.eligible).toBe(true);
    expect(r.deductionEur.toNumber()).toBe(3_600);
    expect(r.taxableIncomeEur.toNumber()).toBe(8_400);
    // IR 30 % = 2 520 · PS 17,2 % = 1 444,80
    expect(r.incomeTaxEur.toNumber()).toBeCloseTo(2_520, 6);
    expect(r.socialTaxEur.toNumber()).toBeCloseTo(1_444.8, 6);
    expect(r.totalTaxEur.toNumber()).toBeCloseTo(3_964.8, 6);
  });

  it("devient inéligible au-delà de 15 000 € de recettes", () => {
    const r = evaluateRegime("MICRO_FONCIER", {
      grossRentEur: 15_001,
      marginalTaxRatePct: 30,
    });
    expect(r.eligible).toBe(false);
    expect(r.ineligibilityReason).toContain("plafond micro-foncier");
  });

  it("reste éligible pile au plafond", () => {
    const r = evaluateRegime("MICRO_FONCIER", {
      grossRentEur: MICRO_FONCIER_CEILING,
      marginalTaxRatePct: 30,
    });
    expect(r.eligible).toBe(true);
  });
});

describe("réel foncier", () => {
  it("déduit les charges et les intérêts", () => {
    const r = evaluateRegime("REEL_FONCIER", {
      grossRentEur: 12_000,
      deductibleChargesEur: 3_000,
      loanInterestEur: 2_000,
      marginalTaxRatePct: 30,
    });
    expect(r.deductionEur.toNumber()).toBe(5_000);
    expect(r.taxableIncomeEur.toNumber()).toBe(7_000);
  });

  it("impute sur le revenu global le déficit hors intérêts, plafonné", () => {
    // Charges 25 000 hors intérêts pour 10 000 de loyers :
    // déficit hors intérêts = 15 000, plafonné à 10 700.
    const r = evaluateRegime("REEL_FONCIER", {
      grossRentEur: 10_000,
      deductibleChargesEur: 25_000,
      loanInterestEur: 4_000,
      marginalTaxRatePct: 30,
    });
    expect(r.taxableIncomeEur.toNumber()).toBe(0);
    expect(r.deficitOffsetGlobalEur.toNumber()).toBe(10_700);
    // Déficit total = 29 000 − 10 000 = 19 000 ; reporté = 19 000 − 10 700
    expect(r.deficitCarriedForwardEur.toNumber()).toBeCloseTo(8_300, 6);
  });

  it("n'impute jamais sur le revenu global un déficit dû aux seuls intérêts", () => {
    // Charges hors intérêts (2 000) inférieures aux loyers (10 000) :
    // le déficit vient exclusivement des intérêts → rien sur le revenu global.
    const r = evaluateRegime("REEL_FONCIER", {
      grossRentEur: 10_000,
      deductibleChargesEur: 2_000,
      loanInterestEur: 12_000,
      marginalTaxRatePct: 30,
    });
    expect(r.taxableIncomeEur.toNumber()).toBe(0);
    expect(r.deficitOffsetGlobalEur.toNumber()).toBe(0);
    expect(r.deficitCarriedForwardEur.toNumber()).toBeCloseTo(4_000, 6);
  });

  it("ne taxe pas un résultat déficitaire", () => {
    const r = evaluateRegime("REEL_FONCIER", {
      grossRentEur: 5_000,
      deductibleChargesEur: 9_000,
      marginalTaxRatePct: 41,
    });
    expect(r.totalTaxEur.toNumber()).toBe(0);
  });

  it("expose le plafond légal d'imputation", () => {
    expect(DEFICIT_GLOBAL_CAP.toNumber()).toBe(10_700);
  });
});

describe("meublé", () => {
  it("applique 50 % d'abattement en micro-BIC", () => {
    const r = evaluateRegime("MICRO_BIC", {
      grossRentEur: 20_000,
      marginalTaxRatePct: 30,
    });
    expect(r.deductionEur.toNumber()).toBe(10_000);
    expect(r.taxableIncomeEur.toNumber()).toBe(10_000);
  });

  it("applique l'abattement majoré au meublé de tourisme classé", () => {
    const r = evaluateRegime("MICRO_BIC", {
      grossRentEur: 100_000,
      isClassifiedTourism: true,
      marginalTaxRatePct: 30,
    });
    // 71 % d'abattement, plafond 188 700 €
    expect(r.eligible).toBe(true);
    expect(r.deductionEur.toNumber()).toBeCloseTo(71_000, 6);
  });

  it("refuse le micro-BIC au-delà de 77 700 € hors tourisme classé", () => {
    const r = evaluateRegime("MICRO_BIC", {
      grossRentEur: 80_000,
      marginalTaxRatePct: 30,
    });
    expect(r.eligible).toBe(false);
  });

  it("neutralise l'imposition par l'amortissement au réel BIC", () => {
    const r = evaluateRegime("REEL_BIC", {
      grossRentEur: 20_000,
      deductibleChargesEur: 4_000,
      loanInterestEur: 3_000,
      depreciationEur: 14_000,
      marginalTaxRatePct: 30,
    });
    // 20 000 − 21 000 < 0 → aucun impôt, déficit reporté sur BIC futurs
    expect(r.taxableIncomeEur.toNumber()).toBe(0);
    expect(r.totalTaxEur.toNumber()).toBe(0);
    expect(r.deficitCarriedForwardEur.toNumber()).toBeCloseTo(1_000, 6);
    // Jamais d'imputation sur le revenu global en BIC non professionnel
    expect(r.deficitOffsetGlobalEur.toNumber()).toBe(0);
  });
});

describe("compareRentalRegimes", () => {
  it("préfère le micro-foncier quand les charges sont faibles", () => {
    const c = compareRentalRegimes(
      {
        grossRentEur: 12_000,
        deductibleChargesEur: 1_000,
        marginalTaxRatePct: 30,
      },
      false
    );
    expect(c.best?.regime).toBe("MICRO_FONCIER");
    expect(c.savingVsNextEur.gt(0)).toBe(true);
  });

  it("préfère le réel quand les charges dépassent l'abattement", () => {
    const c = compareRentalRegimes(
      {
        grossRentEur: 12_000,
        deductibleChargesEur: 6_000,
        loanInterestEur: 2_000,
        marginalTaxRatePct: 30,
      },
      false
    );
    expect(c.best?.regime).toBe("REEL_FONCIER");
  });

  it("ne compare que les régimes du mode de location choisi", () => {
    const nu = compareRentalRegimes(
      { grossRentEur: 12_000, marginalTaxRatePct: 30 },
      false
    );
    expect(nu.outcomes.map((o) => o.regime)).toEqual([
      "MICRO_FONCIER",
      "REEL_FONCIER",
    ]);

    const meuble = compareRentalRegimes(
      { grossRentEur: 12_000, marginalTaxRatePct: 30 },
      true
    );
    expect(meuble.outcomes.map((o) => o.regime)).toEqual([
      "MICRO_BIC",
      "REEL_BIC",
    ]);
  });

  it("bascule sur le réel quand le micro devient inéligible", () => {
    const c = compareRentalRegimes(
      {
        grossRentEur: 30_000,
        deductibleChargesEur: 5_000,
        marginalTaxRatePct: 30,
      },
      false
    );
    // Au-delà de 15 000 €, seul le réel reste ouvert.
    expect(c.best?.regime).toBe("REEL_FONCIER");
    expect(c.outcomes.find((o) => o.regime === "MICRO_FONCIER")?.eligible).toBe(
      false
    );
  });

  it("tient compte de la TMI dans l'arbitrage", () => {
    const input = {
      grossRentEur: 12_000,
      deductibleChargesEur: 4_000,
      marginalTaxRatePct: 0,
    };
    const c = compareRentalRegimes(input, false);
    // À TMI nulle il reste les PS : le régime le moins taxé est celui qui
    // minimise l'assiette, donc le réel (8 000 contre 8 400 au micro).
    expect(c.best?.regime).toBe("REEL_FONCIER");
  });
});
