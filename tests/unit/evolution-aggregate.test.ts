import { describe, expect, it } from "vitest";
import {
  buildEvolutionSeries,
  bucketKey,
  evolutionDeltaSummary,
  resolveEvolutionInterval,
  startOfIsoWeekMonday,
  toPercentSeries,
  type EvolutionRange,
  type EvolutionSeriesPoint,
} from "@/app/lib/portfolio/evolution-aggregate";
import type { HistoryPoint } from "@/app/lib/types/ui";

function pt(date: string, total: number, cash = 0): HistoryPoint {
  return {
    date,
    label: date.slice(5, 10),
    totalValueEur: total,
    cashTotalEur: cash,
    totalValueBase: total,
    cashTotalBase: cash,
    positionsBase: total - cash,
    realizedPnlBase: 0,
    unrealizedPnlBase: 0,
    cashIncomeBase: 0,
  };
}

describe("resolveEvolutionInterval", () => {
  const cases: [EvolutionRange, number, string][] = [
    ["7d", 7, "day"],
    ["1m", 30, "week"],
    ["3m", 20, "week"],
    ["6m", 40, "week"],
    ["ytd", 50, "week"],
    ["1y", 50, "biweek"],
    ["1y", 10, "month"],
    ["5y", 60, "month"],
    ["all", 100, "month"],
  ];
  for (const [range, n, expected] of cases) {
    it(`${range} with ${n} pts → ${expected}`, () => {
      expect(resolveEvolutionInterval(range, n)).toBe(expected);
    });
  }
});

describe("ISO week buckets (Mon–Sun)", () => {
  it("groups Wed and next Sun into same ISO week Monday key", () => {
    // 2026-07-15 = Wednesday, 2026-07-19 = Sunday, week starts Mon 13 Jul
    const wed = bucketKey("2026-07-15T10:00:00.000Z", "week");
    const sun = bucketKey("2026-07-19T18:00:00.000Z", "week");
    const mon = bucketKey("2026-07-13T08:00:00.000Z", "week");
    expect(wed).toBe(sun);
    expect(wed).toBe(mon);
  });

  it("startOfIsoWeekMonday returns Monday", () => {
    const mon = startOfIsoWeekMonday(new Date("2026-07-16T12:00:00.000Z"));
    // Thursday 16 Jul → Monday 13 Jul
    expect(mon.toISOString().slice(0, 10)).toBe("2026-07-13");
  });
});

describe("buildEvolutionSeries", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const history: HistoryPoint[] = [];
  for (let i = 40; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    history.push(pt(d.toISOString(), 100_000 + (40 - i) * 100, 10_000));
  }

  it("7d is daily and includes today (live)", () => {
    const { points, interval } = buildEvolutionSeries(
      history,
      "7d",
      "cumul",
      now
    );
    expect(interval).toBe("day");
    // ≤ 7 calendar days (+ possible anchor edge) — typically 7–8
    expect(points.length).toBeGreaterThanOrEqual(6);
    expect(points.length).toBeLessThanOrEqual(8);
    const last = points[points.length - 1]!;
    expect(last.total).toBeCloseTo(104_000, 0);
    expect(last.date.slice(0, 10)).toBe("2026-07-16");
  });

  it("1m aggregates by ISO week", () => {
    const { points, interval } = buildEvolutionSeries(
      history,
      "1m",
      "cumul",
      now
    );
    expect(interval).toBe("week");
    // ~30 days → ~5 weeks
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.length).toBeLessThanOrEqual(7);
    // Labels semaine ISO : S. 13 juil. - 19 juil.
    expect(points[0]!.label).toMatch(/^S\.\s+/);
    expect(points[0]!.label).toMatch(/-/);
  });

  it("3m is weekly", () => {
    const { interval } = buildEvolutionSeries(history, "3m", "cumul", now);
    expect(interval).toBe("week");
  });

  it("period returns deltas", () => {
    const { points } = buildEvolutionSeries(history, "7d", "period", now);
    expect(points.length).toBeGreaterThan(1);
    const mid = points[Math.floor(points.length / 2)]!;
    expect(Math.abs(mid.chartValue - 100)).toBeLessThan(1);
  });
});

describe("toPercentSeries", () => {
  /**
   * Un point de série réduit à ce que `toPercentSeries` lit.
   *
   * `growth` porte la croissance cumulée, flux retirés : c'est elle, et non la
   * valeur, qui donne la courbe du portefeuille depuis que le comparatif ne
   * crédite plus le portefeuille de ses propres apports. Ces décors n'ont aucun
   * flux, la croissance suit donc la valeur.
   */
  function bare(
    total: number,
    benchmark?: number,
    growth = total / 100_000
  ): EvolutionSeriesPoint {
    return {
      date: "2026-01-01T00:00:00.000Z",
      label: "1 janv.",
      periodLabel: "1 janv.",
      total,
      flows: 0,
      cash: 0,
      positions: total,
      realized: 0,
      unrealized: 0,
      income: 0,
      dividends: 0,
      coupons: 0,
      rents: 0,
      chartValue: total,
      pos: total,
      neg: 0,
      dPositions: 0,
      dCash: 0,
      dRealized: 0,
      dUnrealized: 0,
      dIncome: 0,
      dDividends: 0,
      dCoupons: 0,
      dRents: 0,
      benchmark,
      intervalType: "day",
      growth,
    };
  }

  it("both curves start at 0 % on the first point", () => {
    const out = toPercentSeries([bare(100_000, 100_000), bare(110_000, 105_000)]);
    expect(out[0]!.portfolioPct).toBe(0);
    expect(out[0]!.benchmarkPct).toBe(0);
  });

  it("reflects relative performance, not absolute levels", () => {
    const out = toPercentSeries([bare(100_000, 100_000), bare(110_000, 95_000)]);
    expect(out[1]!.portfolioPct).toBeCloseTo(10, 6);
    expect(out[1]!.benchmarkPct).toBeCloseTo(-5, 6);
  });

  it("benchmarkPct is undefined when the source has no benchmark", () => {
    const out = toPercentSeries([bare(100_000), bare(90_000)]);
    expect(out[0]!.benchmarkPct).toBeUndefined();
    expect(out[1]!.benchmarkPct).toBeUndefined();
    expect(out[1]!.portfolioPct).toBeCloseTo(-10, 6);
  });

  it("degrades to 0 rather than dividing by a non-positive base", () => {
    const out = toPercentSeries([bare(0), bare(50_000)]);
    expect(out[0]!.portfolioPct).toBe(0);
    expect(out[1]!.portfolioPct).toBe(0);
  });

  it("empty input yields empty output", () => {
    expect(toPercentSeries([])).toEqual([]);
  });
});

describe("evolutionDeltaSummary — les apports ne sont pas du rendement", () => {
  const pt = (
    date: string,
    total: number,
    flows = 0
  ): EvolutionSeriesPoint => ({
    date,
    label: date.slice(0, 10),
    periodLabel: date.slice(0, 10),
    total,
    flows,
    cash: 0,
    positions: total,
    realized: 0,
    unrealized: 0,
    income: 0,
    dividends: 0,
    coupons: 0,
    rents: 0,
    chartValue: total,
    pos: 0,
    neg: 0,
    dPositions: 0,
    dCash: 0,
    dRealized: 0,
    dIncome: 0,
    dUnrealized: 0,
    dDividends: 0,
    dCoupons: 0,
    dRents: 0,
    intervalType: "day",
  });

  it("un versement fait monter la valeur sans créer de rendement", () => {
    /*
      100 k€ le 1er, +50 k€ versés le 2, 150 k€ le 3 : le patrimoine a gagné
      50 k€ et rapporté 0 %. Le calcul naïf annonçait +50 %.
    */
    const s = evolutionDeltaSummary([
      pt("2026-01-01T00:00:00.000Z", 100_000),
      pt("2026-01-02T00:00:00.000Z", 150_000, 50_000),
      pt("2026-01-03T00:00:00.000Z", 150_000),
    ])!;

    expect(s.delta).toBeCloseTo(50_000, 6);
    expect(s.flows).toBeCloseTo(50_000, 6);
    expect(s.pct).toBeCloseTo(0, 6);
  });

  it("mesure la performance réelle malgré un versement", () => {
    // 100 k€ → +100 k€ versés → 220 k€ : 10 % gagnés sur 200 k€ exposés.
    const s = evolutionDeltaSummary([
      pt("2026-01-01T00:00:00.000Z", 100_000),
      pt("2026-01-02T00:00:00.000Z", 200_000, 100_000),
      pt("2026-01-03T00:00:00.000Z", 220_000),
    ])!;

    expect(s.delta).toBeCloseTo(120_000, 6);
    expect(s.pct).toBeCloseTo(10, 6);
  });

  it("une acquisition massive ne fabrique pas de rendement", () => {
    // Le cas de la capture : un actif alternatif de 2 M€ entre au bilan.
    const s = evolutionDeltaSummary([
      pt("2026-01-01T00:00:00.000Z", 1_000_000),
      pt("2026-01-02T00:00:00.000Z", 3_000_000, 2_000_000),
    ])!;

    expect(s.delta).toBeCloseTo(2_000_000, 6);
    expect(s.pct).toBeCloseTo(0, 6);
  });
});

describe("statut EXACT / ESTIMATED — l'agrégation ne le perd plus", () => {
  /** Un point daté portant un statut de valorisation. */
  function ptStatut(
    date: string,
    total: number,
    status: "EXACT" | "ESTIMATED" | "MISSING"
  ): HistoryPoint {
    return { ...pt(date, total), status };
  }

  it("un point exact reste exact", () => {
    const { points } = buildEvolutionSeries(
      [ptStatut("2026-01-05T12:00:00Z", 100, "EXACT")],
      "all",
      "cumul"
    );
    expect(points.at(-1)?.status).toBe("EXACT");
  });

  it("un point estimé reste estimé", () => {
    const { points } = buildEvolutionSeries(
      [ptStatut("2026-01-05T12:00:00Z", 100, "ESTIMATED")],
      "all",
      "cumul"
    );
    expect(points.at(-1)?.status).toBe("ESTIMATED");
  });

  it("un jour sans donnée n'est jamais présenté comme mesuré", () => {
    // `MISSING` n'a pas de représentation à cette couche : le ranger du côté
    // du « mesuré » serait la seule erreur vraiment coûteuse.
    const { points } = buildEvolutionSeries(
      [ptStatut("2026-01-05T12:00:00Z", 100, "MISSING")],
      "all",
      "cumul"
    );
    expect(points.at(-1)?.status).toBe("ESTIMATED");
  });

  it("un seul jour estimé rend tout le bucket estimé", () => {
    /*
      Un mois dont un jour repose sur une valeur reportée ne peut pas être
      annoncé comme observé : le total du bucket dépend de cette valeur.
    */
    const { points } = buildEvolutionSeries(
      [
        ptStatut("2026-01-05T12:00:00Z", 100, "EXACT"),
        ptStatut("2026-01-12T12:00:00Z", 110, "ESTIMATED"),
        ptStatut("2026-01-19T12:00:00Z", 120, "EXACT"),
      ],
      "all",
      "cumul"
    );
    expect(points.every((p) => p.status === "ESTIMATED")).toBe(true);
  });

  it("un statut absent n'affirme rien", () => {
    // Un appelant qui ne renseigne pas le statut ne doit pas se voir attribuer
    // « exact » par défaut.
    const { points } = buildEvolutionSeries(
      [pt("2026-01-05T12:00:00Z", 100)],
      "all",
      "cumul"
    );
    expect(points.at(-1)?.status).toBeUndefined();
  });
});
