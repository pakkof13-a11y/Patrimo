import { describe, expect, it } from "vitest";
import {
  buildEvolutionSeries,
  bucketKey,
  resolveEvolutionInterval,
  startOfIsoWeekMonday,
  type EvolutionRange,
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
