import { describe, expect, it } from "vitest";
import {
  computeSchemeReduction,
  isCappedScheme,
  pinelEligibleBase,
  pinelTotalRate,
  summarizeSchemes,
  GLOBAL_TAX_BREAK_CAP,
  PINEL_BASE_CAP_EUR,
} from "@/app/lib/real-estate/tax/schemes";

describe("pinelEligibleBase — double plafond", () => {
  it("retient le prix de revient quand aucun plafond ne mord", () => {
    expect(pinelEligibleBase(200_000, 50).toNumber()).toBe(200_000);
  });

  it("plafonne à 300 000 € un logement cher et grand", () => {
    // 100 m² → plafond surface 550 000, c'est le plafond absolu qui mord.
    expect(pinelEligibleBase(400_000, 100).toNumber()).toBe(300_000);
  });

  it("plafonne à 5 500 €/m² un petit logement cher", () => {
    // 30 m² → 165 000 €, bien en deçà des 300 000 € : c'est le plafond au
    // mètre carré qui s'applique, celui qu'on oublie le plus souvent.
    expect(pinelEligibleBase(250_000, 30).toNumber()).toBe(165_000);
  });

  it("applique le plus contraignant des deux plafonds", () => {
    // 40 m² → 220 000 € par la surface, contre 300 000 € en absolu.
    expect(pinelEligibleBase(500_000, 40).toNumber()).toBe(220_000);
  });

  it("se rabat sur le seul plafond absolu sans surface connue", () => {
    expect(pinelEligibleBase(500_000, null).toNumber()).toBe(300_000);
  });

  it("expose le plafond légal", () => {
    expect(PINEL_BASE_CAP_EUR.toNumber()).toBe(300_000);
  });
});

describe("pinelTotalRate — extinction progressive", () => {
  it("retient les taux pleins jusqu'en 2022", () => {
    expect(pinelTotalRate(2021, 6).toNumber()).toBeCloseTo(0.12, 10);
    expect(pinelTotalRate(2021, 9).toNumber()).toBeCloseTo(0.18, 10);
    expect(pinelTotalRate(2021, 12).toNumber()).toBeCloseTo(0.21, 10);
  });

  it("rabote les taux en 2023", () => {
    expect(pinelTotalRate(2023, 9).toNumber()).toBeCloseTo(0.15, 10);
  });

  it("les rabote encore en 2024", () => {
    expect(pinelTotalRate(2024, 9).toNumber()).toBeCloseTo(0.12, 10);
  });

  it("maintient les taux pleins en Pinel+", () => {
    expect(pinelTotalRate(2024, 9, true).toNumber()).toBeCloseTo(0.18, 10);
  });

  it("rend zéro pour une durée d'engagement non prévue", () => {
    expect(pinelTotalRate(2021, 7).toNumber()).toBe(0);
  });
});

describe("Pinel — réduction", () => {
  it("calcule un 9 ans classique", () => {
    // 200 000 € × 18 % = 36 000 €, soit 4 000 €/an
    const r = computeSchemeReduction({
      scheme: "PINEL",
      startYear: 2021,
      commitmentYears: 9,
      baseEur: 200_000,
      surfaceM2: 60,
      currentYear: 2024,
    });
    expect(r.eligibleBaseEur.toNumber()).toBe(200_000);
    expect(r.totalReductionEur.toNumber()).toBeCloseTo(36_000, 6);
    expect(r.annualReductionEur.toNumber()).toBeCloseTo(4_000, 6);
    expect(r.yearsElapsed).toBe(3);
    expect(r.yearsRemaining).toBe(6);
    expect(r.finished).toBe(false);
  });

  it("étale un 12 ans de façon non uniforme", () => {
    // 300 000 × 21 % = 63 000. Neuf premières années : 18/21 = 54 000 → 6 000/an.
    // Trois dernières : 9 000 → 3 000/an. Diviser par 12 donnerait 5 250, faux.
    const base = {
      scheme: "PINEL",
      startYear: 2020,
      commitmentYears: 12,
      baseEur: 300_000,
      surfaceM2: 100,
    } as const;

    const early = computeSchemeReduction({ ...base, currentYear: 2022 });
    expect(early.totalReductionEur.toNumber()).toBeCloseTo(63_000, 6);
    expect(early.annualReductionEur.toNumber()).toBeCloseTo(6_000, 6);

    const late = computeSchemeReduction({ ...base, currentYear: 2030 });
    expect(late.yearsElapsed).toBe(10);
    expect(late.annualReductionEur.toNumber()).toBeCloseTo(3_000, 6);
  });

  it("cesse toute réduction une fois l'engagement terminé", () => {
    const r = computeSchemeReduction({
      scheme: "PINEL",
      startYear: 2010,
      commitmentYears: 9,
      baseEur: 200_000,
      currentYear: 2026,
    });
    expect(r.finished).toBe(true);
    expect(r.annualReductionEur.toNumber()).toBe(0);
    expect(r.yearsRemaining).toBe(0);
  });

  it("signale une base plafonnée", () => {
    const r = computeSchemeReduction({
      scheme: "PINEL",
      startYear: 2021,
      commitmentYears: 9,
      baseEur: 400_000,
      surfaceM2: 100,
      currentYear: 2022,
    });
    expect(r.baseWasCapped).toBe(true);
    expect(r.eligibleBaseEur.toNumber()).toBe(300_000);
  });

  it("refuse une durée d'engagement invalide", () => {
    const r = computeSchemeReduction({
      scheme: "PINEL",
      startYear: 2021,
      commitmentYears: 7,
      baseEur: 200_000,
    });
    expect(r.totalReductionEur.toNumber()).toBe(0);
    expect(r.note).toContain("6, 9 ou 12");
  });

  it("traite Denormandie comme un Pinel", () => {
    const pinel = computeSchemeReduction({
      scheme: "PINEL", startYear: 2021, commitmentYears: 9,
      baseEur: 200_000, surfaceM2: 60, currentYear: 2023,
    });
    const deno = computeSchemeReduction({
      scheme: "DENORMANDIE", startYear: 2021, commitmentYears: 9,
      baseEur: 200_000, surfaceM2: 60, currentYear: 2023,
    });
    expect(deno.totalReductionEur.toNumber()).toBe(
      pinel.totalReductionEur.toNumber()
    );
  });
});

describe("Malraux", () => {
  it("applique 30 % aux travaux, hors plafond global", () => {
    const r = computeSchemeReduction({
      scheme: "MALRAUX",
      startYear: 2024,
      baseEur: 200_000,
      malrauxRatePct: 30,
      currentYear: 2025,
    });
    expect(r.totalReductionEur.toNumber()).toBeCloseTo(60_000, 6);
    expect(r.subjectToGlobalCap).toBe(false);
  });

  it("plafonne les travaux à 400 000 €", () => {
    const r = computeSchemeReduction({
      scheme: "MALRAUX",
      startYear: 2024,
      baseEur: 600_000,
      malrauxRatePct: 30,
      currentYear: 2025,
    });
    expect(r.eligibleBaseEur.toNumber()).toBe(400_000);
    expect(r.totalReductionEur.toNumber()).toBeCloseTo(120_000, 6);
    expect(r.baseWasCapped).toBe(true);
  });

  it("accepte le taux réduit de 22 %", () => {
    const r = computeSchemeReduction({
      scheme: "MALRAUX", startYear: 2024, baseEur: 100_000,
      malrauxRatePct: 22, currentYear: 2025,
    });
    expect(r.totalReductionEur.toNumber()).toBeCloseTo(22_000, 6);
  });
});

describe("Loc'Avantages", () => {
  it("applique le taux aux recettes brutes", () => {
    const r = computeSchemeReduction({
      scheme: "LOC_AVANTAGES",
      startYear: 2024,
      commitmentYears: 6,
      grossRentEur: 12_000,
      locAvantagesRatePct: 35,
      currentYear: 2025,
    });
    expect(r.annualReductionEur.toNumber()).toBeCloseTo(4_200, 6);
    expect(r.subjectToGlobalCap).toBe(true);
  });

  it("exige des recettes renseignées", () => {
    const r = computeSchemeReduction({
      scheme: "LOC_AVANTAGES", startYear: 2024, locAvantagesRatePct: 35,
    });
    expect(r.totalReductionEur.toNumber()).toBe(0);
    expect(r.note).toContain("Recettes");
  });
});

describe("Censi-Bouvard", () => {
  it("applique 11 % sur neuf ans, plafond 300 000 €", () => {
    const r = computeSchemeReduction({
      scheme: "CENSI_BOUVARD",
      startYear: 2020,
      baseEur: 400_000,
      currentYear: 2023,
    });
    expect(r.eligibleBaseEur.toNumber()).toBe(300_000);
    expect(r.totalReductionEur.toNumber()).toBeCloseTo(33_000, 6);
    expect(r.annualReductionEur.toNumber()).toBeCloseTo(33_000 / 9, 6);
  });
});

describe("Monuments historiques", () => {
  it("ne produit pas de réduction et l'explique", () => {
    const r = computeSchemeReduction({
      scheme: "MONUMENT_HISTORIQUE", startYear: 2024, baseEur: 200_000,
    });
    expect(r.totalReductionEur.toNumber()).toBe(0);
    expect(r.note).toContain("déduction");
  });
});

describe("plafonnement global des niches", () => {
  it("ne rabote rien sous 10 000 €", () => {
    const a = computeSchemeReduction({
      scheme: "PINEL", startYear: 2021, commitmentYears: 9,
      baseEur: 200_000, surfaceM2: 60, currentYear: 2022,
    });
    const s = summarizeSchemes([a]);
    expect(s.cappedAwayEur.toNumber()).toBe(0);
    expect(s.effectiveAnnualEur.toNumber()).toBeCloseTo(4_000, 6);
  });

  it("rabote le cumul de deux Pinel au-delà du plafond", () => {
    // Deux Pinel à 6 000 €/an annoncent 12 000 € ; seuls 10 000 sont imputables.
    const one = computeSchemeReduction({
      scheme: "PINEL", startYear: 2020, commitmentYears: 9,
      baseEur: 300_000, surfaceM2: 100, currentYear: 2022,
    });
    expect(one.annualReductionEur.toNumber()).toBeCloseTo(6_000, 6);

    const s = summarizeSchemes([one, one]);
    expect(s.totalAnnualEur.toNumber()).toBeCloseTo(12_000, 6);
    expect(s.effectiveAnnualEur.toNumber()).toBeCloseTo(10_000, 6);
    expect(s.cappedAwayEur.toNumber()).toBeCloseTo(2_000, 6);
  });

  it("laisse Malraux passer au-delà du plafond", () => {
    const pinel = computeSchemeReduction({
      scheme: "PINEL", startYear: 2020, commitmentYears: 9,
      baseEur: 300_000, surfaceM2: 100, currentYear: 2022,
    });
    const malraux = computeSchemeReduction({
      scheme: "MALRAUX", startYear: 2022, baseEur: 400_000,
      malrauxRatePct: 30, currentYear: 2023,
    });

    const s = summarizeSchemes([pinel, malraux]);
    // Malraux : 120 000 / 4 = 30 000 €/an, hors plafond.
    expect(s.uncappedAnnualEur.toNumber()).toBeCloseTo(30_000, 6);
    expect(s.cappedAnnualEur.toNumber()).toBeCloseTo(6_000, 6);
    expect(s.cappedAwayEur.toNumber()).toBe(0);
    expect(s.effectiveAnnualEur.toNumber()).toBeCloseTo(36_000, 6);
  });

  it("expose le plafond légal", () => {
    expect(GLOBAL_TAX_BREAK_CAP.toNumber()).toBe(10_000);
  });

  it("classe correctement les dispositifs plafonnés", () => {
    expect(isCappedScheme("PINEL")).toBe(true);
    expect(isCappedScheme("DENORMANDIE")).toBe(true);
    expect(isCappedScheme("MALRAUX")).toBe(false);
    expect(isCappedScheme("MONUMENT_HISTORIQUE")).toBe(false);
  });
});
