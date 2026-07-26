import { describe, expect, it } from "vitest";
import {
  ANTERIORITY_YEARS,
  contractAge,
  contractAgeLabel,
  fullMonthsBetween,
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
