import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_EVOLUTION_PREFS,
  loadEvolutionPrefs,
  normalizeEnvelopeFor,
  saveEvolutionPrefs,
  EVOLUTION_PREFS_KEY,
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
    saveDefaultBenchmark("index");
    expect(loadEvolutionPrefs().versus).toBe("index");
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
    saveDefaultBenchmark("index");
    expect(loadDefaultBenchmark()).toBe("index");
    expect(localStorage.getItem(`patrimo.ui.${DEFAULT_BENCHMARK_KEY}`)).toBe(
      JSON.stringify("index")
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
      // Aucun flux dans ce décor : la croissance suit donc la valeur.
      growth: 1,
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
      growth: 1.1,
    },
  ];

  it("cash mode is removed → migrated to none (no benchmark)", () => {
    // @ts-expect-error "cash" n'est plus un mode valide
    const out = withBenchmarkSeries(base, "cash");
    // Mode inconnu traité comme index sans données → pas de courbe
    expect(out[0]!.benchmark).toBeUndefined();
  });





  it("20 — activer le comparatif ne touche pas la courbe du portefeuille", () => {
    /*
      La régression à empêcher : que la seconde courbe modifie la première. Le
      benchmark n'ajoute qu'un champ ; totaux, flux et performance doivent
      rester au centime ce qu'ils étaient.
    */
    const sans = withBenchmarkSeries(base, "none");
    const avec = withBenchmarkSeries(base, "index", {
      indexCloses: [
        { date: "2026-01-01T00:00:00.000Z", close: 100 },
        { date: "2026-07-01T00:00:00.000Z", close: 104 },
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
    expect(avec[1]!.benchmark).toBeCloseTo(104_000, 6);
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

/**
 * Accord entre le compte choisi et l'enveloppe.
 *
 * L'enveloppe est subordonnée au compte : elle précise « où », dans un « quoi »
 * déjà fixé. Une combinaison qui n'a pas de sens ne doit ni être stockée, ni
 * survivre à un rechargement — sans quoi la courbe se retrouve filtrée sur un
 * critère qu'aucun contrôle n'affiche plus, et paraît vide sans raison.
 */
describe("compte et enveloppe restent accordés", () => {
  // Même stub que le bloc précédent : `loadUiPref` lit `window.localStorage`.
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

  it("Titres accepte les deux enveloppes", () => {
    expect(normalizeEnvelopeFor("TITRES", "PEA")).toBe("PEA");
    expect(normalizeEnvelopeFor("TITRES", "CTO")).toBe("CTO");
    expect(normalizeEnvelopeFor("TITRES", null)).toBeNull();
  });

  it("aucun compte hors Titres n'accepte d'enveloppe", () => {
    for (const acc of [
      "ASSURANCE_VIE",
      "CRYPTO",
      "IMMOBILIER",
      "ALTERNATIFS",
      "EPARGNE_SALARIALE",
      "CASH",
    ] as const) {
      expect(normalizeEnvelopeFor(acc, "PEA")).toBeNull();
      expect(normalizeEnvelopeFor(acc, "CTO")).toBeNull();
    }
  });

  it("sans compte, aucune enveloppe ne s'applique", () => {
    // « Tout » ne porte pas de filtre d'enveloppe : la question est par compte.
    expect(normalizeEnvelopeFor(null, "PEA")).toBeNull();
    expect(normalizeEnvelopeFor(undefined, "CTO")).toBeNull();
  });

  it("une combinaison invalide n'atteint jamais le stockage", () => {
    saveEvolutionPrefs({
      ...DEFAULT_EVOLUTION_PREFS,
      account: "CRYPTO",
      envelope: "PEA",
    });
    const relu = loadEvolutionPrefs();
    // Le compte est conservé — c'est le filtre principal — l'enveloppe tombe.
    expect(relu.account).toBe("CRYPTO");
    expect(relu.envelope).toBeNull();
  });

  /*
    Migration D18 : le sélecteur de classe d'actif (`assetClass`) devient un
    sélecteur de compte (`account`). Une préférence `v5` enregistrée avant ce
    chantier porte `assetClass` mais pas `account` : ce champ inconnu est
    ignoré, jamais rejeté, et `account` retombe sur `null` — « Tout », le
    comportement le plus sûr. L'ancienne valeur (« IMMOBILIER ») ne migre pas
    vers le nouveau compte du même nom : la taxonomie a changé de nature, et
    la reconstruire à la volée inventerait un choix que l'utilisateur n'a
    jamais fait dans ce nouvel écran.
  */
  it("une préférence v5 antérieure (assetClass) retombe sur « Tout »", () => {
    // `loadUiPref` préfixe ses clés — écrire sans le préfixe ne serait pas relu.
    localStorage.setItem(
      `patrimo.ui.${EVOLUTION_PREFS_KEY}`,
      JSON.stringify({
        v: 5,
        range: "3m",
        versus: "none",
        indexKey: "cac40",
        scope: "gross",
        assetClass: "IMMOBILIER",
        classMetric: "value",
        envelope: "CTO",
      })
    );
    const relu = loadEvolutionPrefs();
    expect(relu.account).toBeNull();
    // L'enveloppe hérite du même sort : sans compte Titres, elle ne s'accorde
    // avec rien et ne doit pas survivre à la lecture.
    expect(relu.envelope).toBeNull();
  });

  it("passer de Titres en PEA à la crypto abandonne l'enveloppe", () => {
    // Le parcours du §12 du chantier, joué sur le normaliseur.
    expect(normalizeEnvelopeFor("TITRES", "PEA")).toBe("PEA");
    expect(normalizeEnvelopeFor("CRYPTO", "PEA")).toBeNull();
    // Et revenir à Titres ne ressuscite pas le filtre abandonné.
    expect(normalizeEnvelopeFor("TITRES", null)).toBeNull();
  });
});
