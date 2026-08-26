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

describe("evolution prefs v5", () => {
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

  it("seeds versus from the Préférences default benchmark on first load", () => {
    saveDefaultBenchmark("inflation");
    expect(loadEvolutionPrefs().versus).toBe("inflation");
  });

  it("round-trips valid prefs", () => {
    const next = {
      ...DEFAULT_EVOLUTION_PREFS,
      range: "1y" as const,
      versus: "index" as const,
      indexKey: "sp500" as const,
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
      flows: 0,
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
      flows: 0,
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

  it("sans observation d'IPC, aucune courbe d'inflation n'est tracée", () => {
    /*
      Ce test affirmait l'inverse : que l'inflation « croît d'environ 1 % sur
      six mois ». C'était vrai d'une constante annuelle de 2 % appliquée au
      prorata du temps — pas d'un IPC. Sans observation réelle, il n'y a rien à
      tracer, et une ligne plausible vaut moins qu'une absence assumée.
    */
    const out = withBenchmarkSeries(base, "inflation");
    expect(out[0]!.benchmark).toBeUndefined();
    expect(out[1]!.benchmark).toBeUndefined();
  });

  it("avec des observations réelles, la courbe suit le cumul publié", () => {
    const out = withBenchmarkSeries(base, "inflation", {
      cpiCumulative: [
        { period: "2026-01", cumulative: 0 },
        { period: "2026-07", cumulative: 0.012 },
      ],
    });
    // Base rebasée sur le premier total du portefeuille…
    expect(out[0]!.benchmark).toBeCloseTo(100_000, 6);
    // …puis +1,2 % au mois observé, exactement.
    expect(out[1]!.benchmark).toBeCloseTo(101_200, 6);
  });

  it("l'escalier ne bouge qu'aux mois observés", () => {
    /*
      Entre deux publications, le cumul ne varie pas : l'IPC est mensuel, et
      lisser sa variation en taux journalier fabriquerait des valeurs que
      personne n'a publiées.
    */
    const points = [
      { ...base[0]!, date: "2026-01-15T00:00:00.000Z" },
      { ...base[0]!, date: "2026-01-28T00:00:00.000Z" },
      { ...base[1]!, date: "2026-02-10T00:00:00.000Z" },
    ];
    const out = withBenchmarkSeries(points, "inflation", {
      cpiCumulative: [
        { period: "2026-01", cumulative: 0 },
        { period: "2026-02", cumulative: 0.004 },
      ],
    });
    expect(out[0]!.benchmark).toBeCloseTo(out[1]!.benchmark!, 9);
    expect(out[2]!.benchmark).toBeGreaterThan(out[1]!.benchmark!);
  });


  it("20 — activer l'inflation ne touche pas la courbe du portefeuille", () => {
    /*
      La régression à empêcher : que la seconde courbe modifie la première. Le
      benchmark n'ajoute qu'un champ ; totaux, flux et performance doivent
      rester au centime ce qu'ils étaient.
    */
    const sans = withBenchmarkSeries(base, "none");
    const avec = withBenchmarkSeries(base, "inflation", {
      cpiCumulative: [
        { period: "2026-01", cumulative: 0 },
        { period: "2026-07", cumulative: 0.004 },
      ],
    });

    for (let i = 0; i < base.length; i++) {
      expect(avec[i]!.total).toBe(sans[i]!.total);
      expect(avec[i]!.flows).toBe(sans[i]!.flows);
      expect(avec[i]!.cash).toBe(sans[i]!.cash);
      expect(avec[i]!.positions).toBe(sans[i]!.positions);
      expect(avec[i]!.date).toBe(sans[i]!.date);
    }

    // Seule la série comparative apparaît.
    expect(sans[1]!.benchmark).toBeUndefined();
    expect(avec[1]!.benchmark).toBeCloseTo(100_400, 6);
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
