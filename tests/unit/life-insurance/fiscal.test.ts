import { describe, expect, it } from "vitest";
import {
  ANNUAL_ALLOWANCE_COUPLE_EUR,
  ANNUAL_ALLOWANCE_SINGLE_EUR,
  ANTERIORITY_YEARS,
  annualAllowanceEur,
  checkPremiumsSplit,
  contractAge,
  contractAgeLabel,
  exceedsPfuOutstandingThreshold,
  fullMonthsBetween,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  totalLifeInsuranceOutstandingEur,
} from "@/app/lib/life-insurance/fiscal";

const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe("fullMonthsBetween", () => {
  it("compte les mois révolus, pas les mois entamés", () => {
    expect(fullMonthsBetween(at("2020-01-15"), at("2020-02-14"))).toBe(0);
    expect(fullMonthsBetween(at("2020-01-15"), at("2020-02-15"))).toBe(1);
  });

  it("traverse les années", () => {
    expect(fullMonthsBetween(at("2018-03-10"), at("2026-03-10"))).toBe(96);
  });

  it("ne dérive pas sur une année bissextile", () => {
    // De date à date : le 29 février existe en 2024, l'anniversaire est exact.
    expect(fullMonthsBetween(at("2016-02-29"), at("2024-02-29"))).toBe(96);
  });

  it("rend un nombre négatif pour un ordre inversé", () => {
    expect(fullMonthsBetween(at("2026-01-01"), at("2025-01-01"))).toBe(-12);
  });
});

describe("contractAge", () => {
  it("n'accorde pas l'antériorité la veille des huit ans", () => {
    const age = contractAge(at("2018-07-27"), at("2026-07-26"));
    expect(age.hasAnteriority).toBe(false);
    expect(age.monthsToAnteriority).toBe(1);
  });

  it("accorde l'antériorité le jour même des huit ans", () => {
    const age = contractAge(at("2018-07-26"), at("2026-07-26"));
    expect(age.hasAnteriority).toBe(true);
    expect(age.years).toBe(ANTERIORITY_YEARS);
    expect(age.monthsToAnteriority).toBe(0);
  });

  it("reste à zéro pour une date d'ouverture future", () => {
    // Saisie erronée : propager un âge négatif afficherait « antériorité dans
    // -3 mois » dans l'interface.
    const age = contractAge(at("2027-01-01"), at("2026-07-26"));
    expect(age.months).toBe(0);
    expect(age.years).toBe(0);
    expect(age.hasAnteriority).toBe(false);
    expect(age.monthsToAnteriority).toBe(ANTERIORITY_YEARS * 12);
  });
});

describe("contractAgeLabel", () => {
  it("annonce l'antériorité acquise avec l'âge", () => {
    expect(contractAgeLabel("2015-01-10", at("2026-07-26"))).toBe(
      "antériorité acquise (11 ans)"
    );
  });

  it("compte en mois sous un an de seuil", () => {
    // Ouvert il y a 7 ans et 8 mois → 4 mois restants.
    expect(contractAgeLabel("2018-11-26", at("2026-07-26"))).toBe(
      "antériorité dans 4 mois"
    );
  });

  it("compte en années et mois au-delà", () => {
    expect(contractAgeLabel("2023-12-18", at("2026-07-26"))).toBe(
      "antériorité dans 5 ans et 5 mois"
    );
  });

  it("omet les mois quand le reste est nul", () => {
    expect(contractAgeLabel("2020-07-26", at("2026-07-26"))).toBe(
      "antériorité dans 2 ans"
    );
  });

  it("ne dit rien sur une date illisible plutôt que d'inventer", () => {
    expect(contractAgeLabel("pas-une-date", at("2026-07-26"))).toBe("");
  });
});

describe("checkPremiumsSplit", () => {
  it("accepte une répartition dont la somme est le total versé", () => {
    const split = checkPremiumsSplit({
      premiumsBefore2017Eur: "40000",
      premiumsAfter2017Eur: "60000",
      totalPremiumsEur: "100000",
    });
    expect(split.ok).toBe(true);
    expect(split.totalPremiumsEur).toBe("100000");
    expect(split.premiumsBefore2017Eur).toBe("40000");
    expect(split.premiumsAfter2017Eur).toBe("60000");
    expect(split.beforeShare).toBeCloseTo(0.4, 8);
    expect(split.afterShare).toBeCloseTo(0.6, 8);
    // Critère d'acceptation : avant + après = total, sans recalcul manuel.
    expect(
      Number(split.premiumsBefore2017Eur) + Number(split.premiumsAfter2017Eur)
    ).toBeCloseTo(Number(split.totalPremiumsEur), 6);
  });

  it("déduit le total quand il n'est pas déclaré", () => {
    const split = checkPremiumsSplit({
      premiumsBefore2017Eur: "25000.50",
      premiumsAfter2017Eur: "10000,50",
    });
    expect(split.ok).toBe(true);
    expect(Number(split.totalPremiumsEur)).toBeCloseTo(35001, 6);
  });

  it("refuse un total déclaré qui ne correspond pas à la somme", () => {
    const split = checkPremiumsSplit({
      premiumsBefore2017Eur: "10000",
      premiumsAfter2017Eur: "5000",
      totalPremiumsEur: "20000",
    });
    expect(split.ok).toBe(false);
    expect(split.error).toMatch(/ne correspond pas au total déclaré/i);
  });

  it("refuse les montants négatifs", () => {
    const split = checkPremiumsSplit({
      premiumsBefore2017Eur: "-1",
      premiumsAfter2017Eur: "10",
    });
    expect(split.ok).toBe(false);
    expect(split.error).toMatch(/négatifs/i);
  });

  it("partage à zéro quand aucun versement n'est saisi", () => {
    const split = checkPremiumsSplit({
      premiumsBefore2017Eur: "0",
      premiumsAfter2017Eur: "0",
    });
    expect(split.ok).toBe(true);
    expect(split.totalPremiumsEur).toBe("0");
    expect(split.beforeShare).toBe(0);
    expect(split.afterShare).toBe(0);
  });
});

describe("annualAllowanceEur / encours global", () => {
  it("choisit l'abattement selon le foyer", () => {
    expect(annualAllowanceEur("SINGLE")).toBe(ANNUAL_ALLOWANCE_SINGLE_EUR);
    expect(annualAllowanceEur("COUPLE")).toBe(ANNUAL_ALLOWANCE_COUPLE_EUR);
  });

  it("somme les encours de tous les contrats", () => {
    expect(
      totalLifeInsuranceOutstandingEur(["80000", "70000.5", "0"])
    ).toBe("150000.5");
  });

  it("détecte le dépassement du seuil de 150 000 €", () => {
    expect(exceedsPfuOutstandingThreshold(PFU_OUTSTANDING_THRESHOLD_EUR)).toBe(
      false
    );
    expect(
      exceedsPfuOutstandingThreshold(PFU_OUTSTANDING_THRESHOLD_EUR + 0.01)
    ).toBe(true);
  });
});
