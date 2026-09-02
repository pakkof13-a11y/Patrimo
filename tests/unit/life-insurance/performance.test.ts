import { describe, expect, it } from "vitest";
import {
  annualizedPerformance,
  buildPerformanceSeries,
  performanceBetween,
  performanceYtd,
  rangeStartDay,
  type DailyValuePoint,
} from "@/app/lib/life-insurance/performance";

function pt(day: string, valueEur: number, netFlowEur = 0): DailyValuePoint {
  return { day, valueEur, netFlowEur };
}

describe("buildPerformanceSeries", () => {
  it("neutralise un versement — verser n'est pas gagner", () => {
    // 10 000 € qui deviennent 20 000 € par un versement de 10 000 € : la
    // performance est nulle, pas de +100 %.
    const series = buildPerformanceSeries([
      pt("2026-01-01", 10_000),
      pt("2026-01-02", 20_000, 10_000),
    ]);
    expect(series[1]!.cumulativePct).toBeCloseTo(0, 9);
  });

  it("neutralise un rachat de la même façon", () => {
    const series = buildPerformanceSeries([
      pt("2026-01-01", 10_000),
      pt("2026-01-02", 6_000, -4_000),
    ]);
    expect(series[1]!.cumulativePct).toBeCloseTo(0, 9);
  });

  it("chaîne les rendements journaliers", () => {
    const series = buildPerformanceSeries([
      pt("2026-01-01", 100),
      pt("2026-01-02", 110),
      pt("2026-01-03", 121),
    ]);
    expect(series[2]!.cumulativePct).toBeCloseTo(21, 9);
  });

  it("isole la performance des flux sur une trajectoire mêlée", () => {
    // +10 % le premier jour, versement de 1 000 € le deuxième, +10 % le
    // troisième : 21 % de performance, quel que soit le versement.
    const series = buildPerformanceSeries([
      pt("2026-01-01", 1_000),
      pt("2026-01-02", 1_100),
      pt("2026-01-03", 2_100, 1_000),
      pt("2026-01-04", 2_310),
    ]);
    expect(series[3]!.cumulativePct).toBeCloseTo(21, 6);
  });

  it("part de 100 au premier jour", () => {
    const series = buildPerformanceSeries([pt("2026-01-01", 50_000)]);
    expect(series[0]!.index).toBe(100);
    expect(series[0]!.cumulativePct).toBe(0);
  });

  it("reste plat tant que le contrat est vide", () => {
    // Un contrat à 0 € qui reçoit son premier versement ne « performe » pas :
    // rapporter 5 000 € à 0 € donnerait un infini.
    const series = buildPerformanceSeries([
      pt("2026-01-01", 0),
      pt("2026-01-02", 5_000, 5_000),
      pt("2026-01-03", 5_500),
    ]);
    expect(series[1]!.cumulativePct).toBe(0);
    expect(series[2]!.cumulativePct).toBeCloseTo(10, 9);
  });

  it("trie les points et supporte une série vide", () => {
    const series = buildPerformanceSeries([
      pt("2026-01-03", 121),
      pt("2026-01-01", 100),
      pt("2026-01-02", 110),
    ]);
    expect(series.map((p) => p.day)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(buildPerformanceSeries([])).toEqual([]);
  });

  it("ignore un jour incohérent plutôt que de plonger l'indice", () => {
    // Flux supérieur à la valeur de clôture : le journal est localement faux,
    // ce n'est pas une performance de −200 %.
    const series = buildPerformanceSeries([
      pt("2026-01-01", 1_000),
      pt("2026-01-02", 500, 2_000),
      pt("2026-01-03", 550),
    ]);
    expect(series[1]!.cumulativePct).toBe(0);
  });
});

describe("performanceBetween / performanceYtd", () => {
  const series = buildPerformanceSeries([
    pt("2025-12-30", 100),
    pt("2025-12-31", 100),
    pt("2026-01-01", 100),
    pt("2026-06-30", 103.24),
  ]);

  it("mesure depuis le premier jour de l'année en cours", () => {
    expect(performanceYtd(series)).toBeCloseTo(3.24, 6);
  });

  it("ne rend rien quand la fenêtre n'a pas deux points", () => {
    expect(performanceBetween(series.slice(0, 1))).toBeNull();
    expect(performanceBetween(series, "2027-01-01")).toBeNull();
  });
});

describe("annualizedPerformance", () => {
  it("annualise au-delà d'un an de recul", () => {
    const series = buildPerformanceSeries([
      pt("2024-01-01", 100),
      pt("2026-01-01", 121),
    ]);
    expect(annualizedPerformance(series)).toBeCloseTo(10, 1);
  });

  it("refuse d'annualiser un trimestre — 3 % en trois mois ne font pas 12 % l'an", () => {
    const series = buildPerformanceSeries([
      pt("2026-01-01", 100),
      pt("2026-04-01", 103),
    ]);
    expect(annualizedPerformance(series)).toBeNull();
  });
});

describe("rangeStartDay", () => {
  const now = new Date("2026-07-31T12:00:00Z");

  it("borne chaque fenêtre", () => {
    expect(rangeStartDay("1m", now)).toBe("2026-06-30");
    expect(rangeStartDay("ytd", now)).toBe("2026-01-01");
    expect(rangeStartDay("1y", now)).toBe("2025-07-31");
    expect(rangeStartDay("5y", now)).toBe("2021-07-31");
  });

  it("laisse « Tout » au service, qui seul connaît la première opération", () => {
    expect(rangeStartDay("all", now)).toBeNull();
  });
});
