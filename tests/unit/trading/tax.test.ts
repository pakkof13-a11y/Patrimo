import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  compareTradingTax,
  computeTradingYear,
  LOSS_CARRY_FORWARD_YEARS,
  totalCarryForward,
} from "@/app/lib/trading/tax";

function year(
  y: number,
  gains: number,
  losses: number,
  fees = 0
) {
  return {
    year: y,
    grossGainsEur: d(gains),
    grossLossesEur: d(losses),
    feesEur: d(fees),
  };
}

describe("computeTradingYear — assiette annuelle globale", () => {
  it("compense gains et pertes de l'année : on n'impose pas trade par trade", () => {
    const r = computeTradingYear(year(2026, 50_000, 45_000));
    expect(r.netBeforeCarryEur.toNumber()).toBe(5_000);
    expect(r.taxableEur.toNumber()).toBe(5_000);
  });

  it("les frais viennent en diminution du résultat", () => {
    const r = computeTradingYear(year(2026, 10_000, 2_000, 1_500));
    expect(r.taxableEur.toNumber()).toBe(6_500);
  });

  it("une année perdante ne produit aucune assiette, mais un stock reportable", () => {
    const r = computeTradingYear(year(2026, 10_000, 30_000));
    expect(r.taxableEur.toNumber()).toBe(0);
    expect(r.newLossEur.toNumber()).toBe(20_000);
    expect(r.carryForward).toEqual([
      { year: 2026, remainingEur: expect.anything() },
    ]);
    expect(totalCarryForward(r.carryForward).toNumber()).toBe(20_000);
  });
});

describe("computeTradingYear — imputation du stock", () => {
  it("impute les moins-values antérieures sur un gain", () => {
    const r = computeTradingYear(year(2026, 30_000, 0), [
      { year: 2023, remainingEur: d(12_000) },
    ]);
    expect(r.carryUsedEur.toNumber()).toBe(12_000);
    expect(r.taxableEur.toNumber()).toBe(18_000);
    expect(r.carryForward).toHaveLength(0);
  });

  it("n'impute jamais au-delà du gain — le reliquat reste reportable", () => {
    const r = computeTradingYear(year(2026, 5_000, 0), [
      { year: 2023, remainingEur: d(12_000) },
    ]);
    expect(r.carryUsedEur.toNumber()).toBe(5_000);
    expect(r.taxableEur.toNumber()).toBe(0);
    expect(totalCarryForward(r.carryForward).toNumber()).toBe(7_000);
  });

  it("consomme les moins-values les plus anciennes en premier", () => {
    // Les plus anciennes sont les plus proches de la péremption : les garder
    // en réserve reviendrait à en perdre le bénéfice.
    const r = computeTradingYear(year(2026, 10_000, 0), [
      { year: 2024, remainingEur: d(8_000) },
      { year: 2019, remainingEur: d(6_000) },
    ]);
    expect(r.carryUsedEur.toNumber()).toBe(10_000);
    // 2019 entièrement consommée, 2024 entamée de 4 000.
    expect(r.carryForward).toHaveLength(1);
    expect(r.carryForward[0]!.year).toBe(2024);
    expect(r.carryForward[0]!.remainingEur.toNumber()).toBe(4_000);
  });

  it("une année perdante n'entame pas le stock, elle s'y ajoute", () => {
    const r = computeTradingYear(year(2026, 1_000, 6_000), [
      { year: 2023, remainingEur: d(9_000) },
    ]);
    expect(r.carryUsedEur.toNumber()).toBe(0);
    expect(totalCarryForward(r.carryForward).toNumber()).toBe(14_000);
  });
});

describe("computeTradingYear — péremption à 10 ans", () => {
  it("écarte les moins-values de plus de 10 ans et le signale", () => {
    const r = computeTradingYear(year(2026, 50_000, 0), [
      { year: 2015, remainingEur: d(7_000) }, // 2026 − 10 = 2016 → périmée
      { year: 2016, remainingEur: d(3_000) }, // pile à la limite → utilisable
    ]);
    expect(r.expiredEur.toNumber()).toBe(7_000);
    expect(r.carryUsedEur.toNumber()).toBe(3_000);
    expect(r.taxableEur.toNumber()).toBe(47_000);
  });

  it("la durée de report est bien de 10 ans", () => {
    expect(LOSS_CARRY_FORWARD_YEARS).toBe(10);
  });

  it("un reliquat nul est ignoré plutôt que traîné dans le stock", () => {
    const r = computeTradingYear(year(2026, 1_000, 0), [
      { year: 2024, remainingEur: d(0) },
    ]);
    expect(r.carryForward).toHaveLength(0);
    expect(r.taxableEur.toNumber()).toBe(1_000);
  });
});

describe("compareTradingTax — PFU", () => {
  it("applique 12,8 % d'IR et 18,6 % de PS, soit 31,4 %", () => {
    const c = compareTradingTax(d(10_000));
    expect(c.pfu.incomeTaxEur.toNumber()).toBeCloseTo(1_280, 6);
    expect(c.pfu.socialChargesEur.toNumber()).toBeCloseTo(1_860, 6);
    expect(c.pfu.totalEur.toNumber()).toBeCloseTo(3_140, 6);
    expect(c.pfu.effectiveRatePct.toNumber()).toBeCloseTo(31.4, 6);
  });

  it("une assiette nulle ne produit aucune imposition ni division par zéro", () => {
    const c = compareTradingTax(d(0));
    expect(c.pfu.totalEur.toNumber()).toBe(0);
    expect(c.pfu.effectiveRatePct.toNumber()).toBe(0);
  });

  it("une assiette négative est ramenée à zéro", () => {
    expect(compareTradingTax(d(-5_000)).taxableEur.toNumber()).toBe(0);
  });
});

describe("compareTradingTax — option barème", () => {
  it("sans tranche marginale fournie, aucune comparaison n'est inventée", () => {
    const c = compareTradingTax(d(10_000));
    expect(c.bareme).toBeNull();
    expect(c.cheaper).toBeNull();
  });

  it("les prélèvements sociaux restent dus au barème — seul l'IR change", () => {
    const c = compareTradingTax(d(10_000), 11);
    expect(c.bareme!.socialChargesEur.toNumber()).toBeCloseTo(1_860, 6);
    expect(c.bareme!.incomeTaxEur.toNumber()).toBeCloseTo(1_100, 6);
    expect(c.bareme!.totalEur.toNumber()).toBeCloseTo(2_960, 6);
  });

  it("le barème est plus avantageux sous 12,8 % de tranche marginale", () => {
    expect(compareTradingTax(d(10_000), 11).cheaper).toBe("BAREME");
    expect(compareTradingTax(d(10_000), 0).cheaper).toBe("BAREME");
  });

  it("le PFU l'emporte dès 30 % de tranche marginale", () => {
    expect(compareTradingTax(d(10_000), 30).cheaper).toBe("PFU");
    expect(compareTradingTax(d(10_000), 41).cheaper).toBe("PFU");
  });

  it("à 12,8 % pile, les deux régimes coûtent le même montant", () => {
    expect(compareTradingTax(d(10_000), 12.8).cheaper).toBe("EQUAL");
  });
});

describe("enchaînement pluriannuel", () => {
  it("une perte de 2024 s'impute sur les gains de 2025 puis 2026", () => {
    const y2024 = computeTradingYear(year(2024, 5_000, 25_000));
    expect(totalCarryForward(y2024.carryForward).toNumber()).toBe(20_000);

    const y2025 = computeTradingYear(year(2025, 12_000, 0), y2024.carryForward);
    expect(y2025.taxableEur.toNumber()).toBe(0);
    expect(totalCarryForward(y2025.carryForward).toNumber()).toBe(8_000);

    const y2026 = computeTradingYear(year(2026, 20_000, 0), y2025.carryForward);
    expect(y2026.carryUsedEur.toNumber()).toBe(8_000);
    expect(y2026.taxableEur.toNumber()).toBe(12_000);
    expect(y2026.carryForward).toHaveLength(0);

    // Et seule l'assiette résiduelle est imposée, pas les 20 000 € bruts.
    expect(compareTradingTax(y2026.taxableEur).pfu.totalEur.toNumber()).toBeCloseTo(
      12_000 * 0.314,
      6
    );
  });
});
