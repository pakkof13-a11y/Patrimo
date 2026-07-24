import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_EVOLUTION_PREFS,
  loadEvolutionPrefs,
  saveEvolutionPrefs,
} from "@/app/lib/portfolio/evolution-prefs";
import {
  DEFAULT_BENCHMARK_KEY,
  loadDefaultBenchmark,
  saveDefaultBenchmark,
} from "@/app/lib/portfolio/benchmark-prefs";
import {
  withBenchmarkSeries,
  benchmarkGapPct,
} from "@/app/lib/portfolio/evolution-aggregate";
import type {
  EvolutionSeriesPoint,
  IndexClosePoint,
} from "@/app/lib/portfolio/evolution-aggregate";

describe("evolution prefs v4", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ls,
    });
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.localStorage;
    // @ts-expect-error cleanup
    delete globalThis.window;
  });

  it("returns defaults when empty", () => {
    expect(loadEvolutionPrefs()).toEqual(DEFAULT_EVOLUTION_PREFS);
  });

  it("round-trips valid prefs with default benchmark inheritance", () => {
    const next = {
      ...DEFAULT_EVOLUTION_PREFS,
      range: "1y" as const,
      metric: "period" as const,
      view: "decomposed" as const,
      benchmark: "default" as const,
      advancedOpen: true,
    };
    saveEvolutionPrefs(next);
    expect(loadEvolutionPrefs()).toEqual(next);
  });

  it("persists default benchmark prefs", () => {
    expect(loadDefaultBenchmark()).toBe("none");
    saveDefaultBenchmark("inflation");
    expect(loadDefaultBenchmark()).toBe("inflation");
    expect(localStorage.getItem(`patrimo.ui.${DEFAULT_BENCHMARK_KEY}`)).toBe(
      JSON.stringify("inflation")
    );
  });
});

describe("withBenchmarkSeries", () => {
  const base: EvolutionSeriesPoint[] = [
    {
      date: "2026-01-01T12:00:00.000Z",
      label: "1 janv.",
      periodLabel: "1 janv.",
      total: 100_000,
      cash: 10_000,
      positions: 90_000,
      realized: 0,
      unrealized: 0,
      income: 0,
      dividends: 0,
      coupons: 0,
      rents: 0,
      chartValue: 100_000,
      pos: 100_000,
      neg: 0,
      dPositions: 0,
      dCash: 0,
      dRealized: 0,
      dUnrealized: 0,
      dIncome: 0,
      dDividends: 0,
      dCoupons: 0,
      dRents: 0,
      intervalType: "day",
    },
    {
      date: "2026-07-01T12:00:00.000Z",
      label: "1 juil.",
      periodLabel: "1 juil.",
      total: 110_000,
      cash: 12_000,
      positions: 98_000,
      realized: 0,
      unrealized: 0,
      income: 0,
      dividends: 0,
      coupons: 0,
      rents: 0,
      chartValue: 110_000,
      pos: 110_000,
      neg: 0,
      dPositions: 0,
      dCash: 0,
      dRealized: 0,
      dUnrealized: 0,
      dIncome: 0,
      dDividends: 0,
      dCoupons: 0,
      dRents: 0,
      intervalType: "day",
    },
  ];

  it("cash mode is removed → migrated to none (no benchmark)", () => {
    // @ts-expect-error "cash" n'est plus un mode valide
    const out = withBenchmarkSeries(base, "cash");
    // Mode inconnu traité comme index sans données → pas de courbe
    expect(out[0]!.benchmark).toBeUndefined();
  });

  it("inflation grows ~1% over half year (IPC France)", () => {
    const out = withBenchmarkSeries(base, "inflation");
    expect(out[0]!.benchmark).toBeCloseTo(100_000, 0);
    // 0.5y at 2% ≈ 0.995% growth
    expect(out[1]!.benchmark!).toBeGreaterThan(100_000);
    expect(out[1]!.benchmark!).toBeLessThan(102_000);
  });

  it("index rebases real closes onto the first portfolio total", () => {
    const closes: IndexClosePoint[] = [
      { date: "2026-01-01T00:00:00.000Z", close: 7000 },
      { date: "2026-07-01T00:00:00.000Z", close: 7700 }, // +10%
    ];
    const idx = withBenchmarkSeries(base, "index", { indexCloses: closes });
    expect(idx[0]!.benchmark).toBeCloseTo(100_000, 0);
    // +10% de l'indice rebasé sur 100 000 → 110 000
    expect(idx[1]!.benchmark!).toBeCloseTo(110_000, 0);
  });

  it("index without closes yields no benchmark curve", () => {
    const idx = withBenchmarkSeries(base, "index");
    expect(idx[0]!.benchmark).toBeUndefined();
  });

  it("benchmarkGapPct = portfolio perf − benchmark perf (points de %)", () => {
    const closes: IndexClosePoint[] = [
      { date: "2026-01-01T00:00:00.000Z", close: 7000 },
      { date: "2026-07-01T00:00:00.000Z", close: 7700 }, // +10%
    ];
    const idx = withBenchmarkSeries(base, "index", { indexCloses: closes });
    const gap = benchmarkGapPct(idx);
    expect(gap).not.toBeNull();
    // Portefeuille +10% (100k→110k), indice +10% → écart ~0
    expect(gap!.portfolioPct).toBeCloseTo(10, 4);
    expect(gap!.benchmarkPct).toBeCloseTo(10, 4);
    expect(gap!.gapPct).toBeCloseTo(0, 4);
  });
});
