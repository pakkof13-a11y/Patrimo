import { describe, expect, it } from "vitest";
import {
  compose,
  cumulativeOverMonths,
  cumulativeOverYears,
  cumulativeSeries,
  cumulativeYearToDate,
  periodOf,
  periodsEndingAt,
  previousPeriod,
  type CpiObservation,
} from "@/app/lib/macro/cpi";

/**
 * L'inflation cumulée, et ce qu'elle refuse de faire.
 *
 * Le défaut historique n'était pas une erreur de calcul mais une absence de
 * calcul : un taux annuel constant de 2 % appliqué au prorata du temps. Ces
 * tests fixent l'arithmétique réelle — composition, jamais addition — et le
 * refus de rendre un cumul quand un mois manque.
 */

const obs = (période: string, taux: number): CpiObservation => ({
  period: période,
  monthlyRate: taux,
});

/** Les six mois de l'exemple du chantier. */
const SIX_MOIS = [
  obs("2026-01", 0.002),
  obs("2026-02", 0.004),
  obs("2026-03", -0.001),
  obs("2026-04", 0.002),
  obs("2026-05", 0.001),
  obs("2026-06", -0.001),
];

describe("composition, jamais addition", () => {
  it("compose exactement les six variations de l'exemple", () => {
    /*
      La somme naïve donnerait 0,7 %. La composition donne 0,70099…%.
      L'écart est petit ici, il ne l'est plus sur cinq ans.
    */
    const attendu =
      1.002 * 1.004 * 0.999 * 1.002 * 1.001 * 0.999 - 1;
    expect(compose(SIX_MOIS.map((o) => o.monthlyRate))).toBeCloseTo(attendu, 12);
    expect(compose(SIX_MOIS.map((o) => o.monthlyRate))).not.toBeCloseTo(0.007, 6);
  });

  it("une liste vide ne compose rien", () => {
    expect(compose([])).toBe(0);
  });

  it("un seul terme se rend lui-même", () => {
    expect(compose([0.002])).toBeCloseTo(0.002, 12);
  });

  it("les variations négatives réduisent bien le cumul", () => {
    expect(compose([0.01, -0.01])).toBeCloseTo(1.01 * 0.99 - 1, 12);
    // Et ce n'est pas zéro : (1,01 × 0,99) = 0,9999.
    expect(compose([0.01, -0.01])).toBeLessThan(0);
  });
});

describe("2 — fenêtre 1 mois : le dernier MoM", () => {
  it("+0,2 % reste +0,2 %, jamais +2 %", () => {
    expect(cumulativeOverMonths([obs("2026-06", 0.002)], 1)).toBeCloseTo(0.002, 12);
  });

  it("8 — un MoM négatif est rendu tel quel", () => {
    expect(cumulativeOverMonths([obs("2026-06", -0.003)], 1)).toBeCloseTo(-0.003, 12);
  });

  it("13 — une inflation nulle réelle vaut zéro, et ce n'est pas une absence", () => {
    expect(cumulativeOverMonths([obs("2026-06", 0)], 1)).toBe(0);
  });
});

describe("3 et 4 — fenêtres 3 et 6 mois", () => {
  it("trois mois composent les trois derniers", () => {
    const attendu = 1.002 * 1.001 * 0.999 - 1;
    expect(cumulativeOverMonths(SIX_MOIS, 3)).toBeCloseTo(attendu, 12);
  });

  it("six mois composent les six", () => {
    const attendu = 1.002 * 1.004 * 0.999 * 1.002 * 1.001 * 0.999 - 1;
    expect(cumulativeOverMonths(SIX_MOIS, 6)).toBeCloseTo(attendu, 12);
  });

  it("10 — un mois manquant au milieu annule le cumul", () => {
    /*
      Rendre une composition amputée d'un mois en la présentant comme « six
      mois » serait faux. Le trou fait disparaître le résultat, il ne le
      dégrade pas.
    */
    const troué = SIX_MOIS.filter((o) => o.period !== "2026-03");
    expect(cumulativeOverMonths(troué, 6)).toBeNull();
  });

  it("une profondeur insuffisante rend null", () => {
    expect(cumulativeOverMonths(SIX_MOIS, 12)).toBeNull();
  });

  it("12 — aucune observation du tout", () => {
    expect(cumulativeOverMonths([], 3)).toBeNull();
  });
});

describe("5 — YTD : l'année civile en cours, pas douze mois glissants", () => {
  const année = [
    obs("2025-11", 0.005),
    obs("2025-12", 0.003),
    obs("2026-01", 0.004),
    obs("2026-02", 0.002),
    obs("2026-03", -0.001),
  ];

  it("cumule de janvier au dernier mois publié", () => {
    const attendu = 1.004 * 1.002 * 0.999 - 1;
    expect(cumulativeYearToDate(année)).toBeCloseTo(attendu, 12);
  });

  it("les mois de l'année précédente n'y entrent pas", () => {
    // Si décembre 2025 était compté, le résultat serait plus élevé.
    const avecDecembre = 1.003 * 1.004 * 1.002 * 0.999 - 1;
    expect(cumulativeYearToDate(année)).not.toBeCloseTo(avecDecembre, 9);
  });

  it("en janvier, l'année n'a pas encore de cumul à montrer", () => {
    expect(cumulativeYearToDate([obs("2026-01", 0.004)])).toBeNull();
  });

  it("un mois manquant dans l'année annule le cumul", () => {
    const troué = année.filter((o) => o.period !== "2026-02");
    expect(cumulativeYearToDate(troué)).toBeNull();
  });
});

describe("7 — cinq ans : composition des glissements annuels", () => {
  const annuels = [
    { period: "2022", yearlyRate: 0.02 },
    { period: "2023", yearlyRate: 0.04 },
    { period: "2024", yearlyRate: -0.005 },
    { period: "2025", yearlyRate: 0.015 },
    { period: "2026", yearlyRate: 0.022 },
  ];

  it("compose les cinq années de l'exemple", () => {
    const attendu = 1.02 * 1.04 * 0.995 * 1.015 * 1.022 - 1;
    expect(cumulativeOverYears(annuels, 5)).toBeCloseTo(attendu, 12);
  });

  it("et ce n'est pas la somme des cinq pourcentages", () => {
    const somme = 0.02 + 0.04 - 0.005 + 0.015 + 0.022;
    expect(cumulativeOverYears(annuels, 5)).not.toBeCloseTo(somme, 6);
  });

  it("l'écart se creuse sur des taux élevés", () => {
    // Cinq années à 4 % : 21,67 %, pas 20 %.
    const cinqFois4 = Array.from({ length: 5 }, (_, i) => ({
      period: String(2022 + i),
      yearlyRate: 0.04,
    }));
    expect(cumulativeOverYears(cinqFois4, 5)).toBeCloseTo(0.2166529024, 9);
  });

  it("9 — une année négative réduit le cumul", () => {
    expect(
      cumulativeOverYears([{ period: "2025", yearlyRate: -0.01 }], 1)
    ).toBeCloseTo(-0.01, 12);
  });

  it("une profondeur insuffisante rend null", () => {
    expect(cumulativeOverYears(annuels, 8)).toBeNull();
  });
});

describe("16 et 17 — série cumulée : départ à 0, aucune interpolation", () => {
  it("le premier point vaut exactement zéro", () => {
    const serie = cumulativeSeries(SIX_MOIS, SIX_MOIS.map((o) => o.period))!;
    expect(serie[0]!.cumulative).toBe(0);
  });

  it("chaque point compose les mois écoulés depuis le départ", () => {
    const serie = cumulativeSeries(SIX_MOIS, SIX_MOIS.map((o) => o.period))!;
    expect(serie[1]!.cumulative).toBeCloseTo(0.004, 12);
    expect(serie[2]!.cumulative).toBeCloseTo(1.004 * 0.999 - 1, 12);
    expect(serie[5]!.cumulative).toBeCloseTo(
      1.004 * 0.999 * 1.002 * 1.001 * 0.999 - 1,
      12
    );
  });

  it("la série ne contient que des mois observés — jamais un pas intermédiaire", () => {
    const serie = cumulativeSeries(SIX_MOIS, SIX_MOIS.map((o) => o.period))!;
    expect(serie).toHaveLength(6);
    expect(serie.map((p) => p.period)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    ]);
  });

  it("un mois manquant annule la série entière", () => {
    const troué = SIX_MOIS.filter((o) => o.period !== "2026-04");
    expect(cumulativeSeries(troué, SIX_MOIS.map((o) => o.period))).toBeNull();
  });

  it("une fenêtre vide ne produit pas de série", () => {
    expect(cumulativeSeries(SIX_MOIS, [])).toBeNull();
  });
});

describe("18 — arithmétique des périodes", () => {
  it("le mois d'une date est celui du calendrier universel", () => {
    expect(periodOf(new Date("2026-08-26T22:30:00Z"))).toBe("2026-08");
  });

  it("le mois précédent traverse l'année", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-08")).toBe("2026-07");
  });

  it("les mois d'une fenêtre sont rendus du plus ancien au plus récent", () => {
    expect(periodsEndingAt("2026-03", 4)).toEqual([
      "2025-12", "2026-01", "2026-02", "2026-03",
    ]);
  });
});
