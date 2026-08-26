import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: { cpiObservation: { findMany: async () => [] } },
}));

import {
  buildCpiSeries,
  MIN_CPI_MONTHS,
  periodsBetween,
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
