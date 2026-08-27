import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: { cpiObservation: { findMany: async () => [] } },
}));

import {
  buildCpiSeries,
  clipTrailingUnpublished,
  MIN_CPI_MONTHS,
  periodsBetween,
  ruleForRange,
} from "@/app/lib/macro/cpi-repository";
import type { CpiObservation } from "@/app/lib/macro/cpi";

/**
 * Le dépôt d'IPC : ce qu'il sert, et ce qu'il refuse de servir.
 *
 * Une lecture n'appelle aucun institut statistique. Ce qui manque au cache
 * manque à la réponse, et l'absence est nommée plutôt que comblée.
 */

const t = (iso: string) => new Date(iso);
const obs = (period: string, monthlyRate: number): CpiObservation => ({
  period,
  monthlyRate,
});

const SERIE = [
  obs("2026-01", 0.004),
  obs("2026-02", 0.002),
  obs("2026-03", -0.001),
  obs("2026-04", 0.003),
];

describe("mois couverts par une fenêtre", () => {
  it("borne haute et basse comprises", () => {
    expect(periodsBetween(t("2026-01-15T00:00:00Z"), t("2026-04-02T00:00:00Z")))
      .toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("une fenêtre dans un seul mois ne rend qu'un mois", () => {
    expect(periodsBetween(t("2026-03-02T00:00:00Z"), t("2026-03-28T00:00:00Z")))
      .toEqual(["2026-03"]);
  });

  it("une fenêtre traverse l'année", () => {
    expect(periodsBetween(t("2025-11-20T00:00:00Z"), t("2026-01-05T00:00:00Z")))
      .toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("1 — sept jours : trop court pour l'IPC", () => {
  it("une fenêtre d'un seul mois est refusée, avec sa raison", async () => {
    const r = await buildCpiSeries({
      from: t("2026-03-18T00:00:00Z"),
      to: t("2026-03-25T00:00:00Z"),
      deps: { read: async () => SERIE },
    });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe("window-too-short");
  });

  it("le minimum est de deux mois : un de référence, un de variation", () => {
    expect(MIN_CPI_MONTHS).toBe(2);
  });
});

describe("11 et 12 — absence de données", () => {
  it("aucune observation : refus nommé, jamais zéro", async () => {
    const r = await buildCpiSeries({
      from: t("2026-01-10T00:00:00Z"),
      to: t("2026-04-10T00:00:00Z"),
      deps: { read: async () => [] },
    });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe("no-data");
  });

  it("10 — un mois manquant dans la fenêtre : refus, pas d'approximation", async () => {
    const troué = SERIE.filter((o) => o.period !== "2026-02");
    const r = await buildCpiSeries({
      from: t("2026-01-10T00:00:00Z"),
      to: t("2026-04-10T00:00:00Z"),
      deps: { read: async () => troué },
    });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe("incomplete");
  });
});

describe("16 — série disponible : départ à 0 %", () => {
  it("le premier mois pose la référence", async () => {
    const r = await buildCpiSeries({
      from: t("2026-01-10T00:00:00Z"),
      to: t("2026-04-10T00:00:00Z"),
      deps: { read: async () => SERIE },
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.points[0]!.cumulative).toBe(0);
    expect(r.points[0]!.period).toBe("2026-01");
  });

  it("les mois suivants composent, sans compter le mois de départ", async () => {
    const r = await buildCpiSeries({
      from: t("2026-01-10T00:00:00Z"),
      to: t("2026-04-10T00:00:00Z"),
      deps: { read: async () => SERIE },
    });
    if (!r.available) throw new Error("série attendue");
    expect(r.points[1]!.cumulative).toBeCloseTo(0.002, 12);
    expect(r.points[3]!.cumulative).toBeCloseTo(1.002 * 0.999 * 1.003 - 1, 12);
    // L'inflation de janvier n'est pas comptée : la fenêtre commence là.
    expect(r.points[3]!.cumulative).not.toBeCloseTo(
      1.004 * 1.002 * 0.999 * 1.003 - 1,
      9
    );
  });

  it("la source est nommée dans la réponse", async () => {
    const r = await buildCpiSeries({
      from: t("2026-01-10T00:00:00Z"),
      to: t("2026-04-10T00:00:00Z"),
      deps: { read: async () => SERIE },
    });
    if (!r.available) throw new Error("série attendue");
    expect(r.source).toBeTruthy();
  });
});

describe("19 — la lecture ne contacte personne", () => {
  it("le service n'a besoin que d'une fonction de lecture", async () => {
    /*
      Les dépendances injectées ne contiennent ni client HTTP ni prisma réel :
      le service ne peut structurellement pas appeler l'INSEE pendant un
      rendu. Les trous se comblent par une collecte, jamais par l'affichage.
    */
    let lectures = 0;
    await buildCpiSeries({
      from: t("2026-01-10T00:00:00Z"),
      to: t("2026-04-10T00:00:00Z"),
      deps: {
        read: async () => {
          lectures++;
          return SERIE;
        },
      },
    });
    expect(lectures).toBe(1);
  });
});

describe("10, 11 et 12 — fenêtres longues : les glissements annuels font foi", () => {
  /** Cinq années publiées, plus des mensuels qui donneraient un autre chiffre. */
  const ANNUELS = [
    { period: "2022-12", yearlyRate: 0.02 },
    { period: "2023-12", yearlyRate: 0.04 },
    { period: "2024-12", yearlyRate: -0.005 },
    { period: "2025-12", yearlyRate: 0.015 },
    { period: "2026-06", yearlyRate: 0.022 },
  ];

  it("11 — 5 A compose les cinq derniers glissements annuels", async () => {
    const r = await buildCpiSeries({
      from: t("2021-08-01T00:00:00Z"),
      to: t("2026-08-01T00:00:00Z"),
      range: "5y",
      deps: { readYearly: async () => ANNUELS },
    });
    expect(r.available).toBe(true);
    if (!r.available) return;

    const attendu = 1.02 * 1.04 * 0.995 * 1.015 * 1.022 - 1;
    expect(r.points[r.points.length - 1]!.cumulative).toBeCloseTo(attendu, 12);
    // Six points : la référence, puis cinq années.
    expect(r.points).toHaveLength(6);
    expect(r.points[0]!.cumulative).toBe(0);
  });

  it("12 — le résultat est celui des YoY, ni leur somme ni les MoM", async () => {
    /*
      Les trois calculs donnent trois nombres différents. La règle du chantier
      désigne le premier ; ce test interdit les deux autres de revenir par
      inadvertance.
    */
    const r = await buildCpiSeries({
      from: t("2021-08-01T00:00:00Z"),
      to: t("2026-08-01T00:00:00Z"),
      range: "5y",
      deps: { readYearly: async () => ANNUELS },
    });
    if (!r.available) throw new Error("série attendue");
    const obtenu = r.points[r.points.length - 1]!.cumulative;

    const compositionYoY = 1.02 * 1.04 * 0.995 * 1.015 * 1.022 - 1;
    const sommeYoY = 0.02 + 0.04 - 0.005 + 0.015 + 0.022;
    // Soixante mensuels à 0,15 % : une autre grandeur encore.
    const compositionMoM = Math.pow(1.0015, 60) - 1;

    expect(obtenu).toBeCloseTo(compositionYoY, 12);
    expect(obtenu).not.toBeCloseTo(sommeYoY, 6);
    expect(obtenu).not.toBeCloseTo(compositionMoM, 6);
  });

  it("10 — 1 A retient le dernier glissement annuel publié", async () => {
    const r = await buildCpiSeries({
      from: t("2025-08-01T00:00:00Z"),
      to: t("2026-08-01T00:00:00Z"),
      range: "1y",
      deps: { readYearly: async () => ANNUELS },
    });
    if (!r.available) throw new Error("série attendue");
    expect(r.points[r.points.length - 1]!.cumulative).toBeCloseTo(0.022, 12);
  });

  it("un seul glissement annuel par année civile est retenu", async () => {
    /*
      L'INSEE publie un glissement annuel chaque mois. Les composer tous
      reviendrait à compter douze fois la même année.
    */
    const mensuels = [
      { period: "2025-10", yearlyRate: 0.013 },
      { period: "2025-11", yearlyRate: 0.014 },
      { period: "2025-12", yearlyRate: 0.015 },
      { period: "2026-06", yearlyRate: 0.022 },
    ];
    const r = await buildCpiSeries({
      from: t("2024-08-01T00:00:00Z"),
      to: t("2026-08-01T00:00:00Z"),
      range: "5y",
      deps: { readYearly: async () => mensuels },
    });
    // Deux années seulement : la profondeur de cinq ans manque.
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe("incomplete");
  });

  it("sans glissement annuel, la fenêtre longue est indisponible", async () => {
    const r = await buildCpiSeries({
      from: t("2021-08-01T00:00:00Z"),
      to: t("2026-08-01T00:00:00Z"),
      range: "5y",
      deps: { readYearly: async () => [] },
    });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe("no-data");
  });

  it("13 — 7 J reste sans benchmark, quelle que soit la donnée", async () => {
    const r = await buildCpiSeries({
      from: t("2026-08-19T00:00:00Z"),
      to: t("2026-08-26T00:00:00Z"),
      range: "7d",
      deps: { readYearly: async () => ANNUELS, read: async () => SERIE },
    });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toBe("window-too-short");
  });
});

describe("règle par période", () => {
  it("chaque fenêtre appelle le bon calcul", () => {
    expect(ruleForRange("7d")).toBe("none");
    expect(ruleForRange("1m")).toBe("last-month");
    expect(ruleForRange("3m")).toBe("monthly");
    expect(ruleForRange("6m")).toBe("monthly");
    expect(ruleForRange("ytd")).toBe("monthly");
    expect(ruleForRange("1y")).toBe("yearly");
    expect(ruleForRange("5y")).toBe("yearly");
  });

  it("le mois civil en cours, non publié, n'est pas exigé", () => {
    expect(
      clipTrailingUnpublished(
        ["2026-05", "2026-06", "2026-07", "2026-08"],
        "2026-07"
      )
    ).toEqual(["2026-05", "2026-06", "2026-07"]);
  });
});

describe("mois non encore publié — la courbe reste constructible", () => {
  it("3 M : le mois en cours manquant n'invalide pas les mois publiés", async () => {
    const r = await buildCpiSeries({
      from: t("2026-01-10T00:00:00Z"),
      to: t("2026-05-10T00:00:00Z"),
      range: "3m",
      deps: { read: async () => SERIE },
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.points.map((p) => p.period)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("1 M : le dernier MoM publié, rebasé à 0 le mois précédent", async () => {
    const r = await buildCpiSeries({
      from: t("2026-04-01T00:00:00Z"),
      to: t("2026-05-10T00:00:00Z"),
      range: "1m",
      deps: { read: async () => SERIE },
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.points).toHaveLength(2);
    expect(r.points[0]!.cumulative).toBe(0);
    expect(r.points[1]!.period).toBe("2026-04");
    expect(r.points[1]!.cumulative).toBeCloseTo(0.003, 12);
  });
});
