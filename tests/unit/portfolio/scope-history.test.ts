import { describe, expect, it } from "vitest";
import { scopeHistory } from "@/app/lib/portfolio/scope-history";
import {
  buildEvolutionSeries,
  benchmarkGapPct,
} from "@/app/lib/portfolio/evolution-aggregate";
import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * La performance suit le périmètre de la valeur.
 *
 * Sélectionner une classe réécrivait le total du point — la valeur de la
 * classe — sans toucher à `investmentPerformanceBase`, qui restait le résultat
 * du **portefeuille entier**. La croissance chaînée valait donc
 * `1 + résultat global / valeur de la classe`, c'est-à-dire la vraie
 * performance multipliée par le rapport des deux périmètres.
 *
 * Cas mesuré : une classe de 10 000 € dans un portefeuille de 100 000 €, en
 * hausse réelle de 2 % — affichée à 20 %.
 *
 * L'erreur ne touchait pas que la comparaison à l'indice : `growth` alimente
 * aussi la série en pourcentage, donc la courbe elle-même.
 */

/** Un point d'historique, réduit à ce que la projection lit. */
function point(opts: {
  date: string;
  total: number;
  crypto: number;
  perfGlobale?: number;
  perfCrypto?: number;
  cryptoPea?: number;
}): HistoryPoint {
  return {
    date: opts.date,
    totalValueBase: opts.total,
    totalValueEur: opts.total,
    netWorthBase: opts.total,
    investmentPerformanceBase: opts.perfGlobale,
    externalFlowsBase: 0,
    byAssetClassBase: { CRYPTO: opts.crypto },
    performanceByAssetClassBase:
      opts.perfCrypto == null ? undefined : { CRYPTO: opts.perfCrypto },
    byAssetClassAndEnvelopeBase:
      opts.cryptoPea == null ? undefined : { CRYPTO: { PEA: opts.cryptoPea } },
  } as unknown as HistoryPoint;
}

/*
  Deux dates éloignées : l'agrégation regroupe par semaine ou par mois selon la
  fenêtre, et deux points voisins retomberaient dans le même seau.
*/
const SERIE = [
  point({ date: "2026-01-15T00:00:00.000Z", total: 100000, crypto: 10000, cryptoPea: 4000 }),
  point({
    date: "2026-03-15T00:00:00.000Z",
    total: 102000,
    crypto: 10200,
    perfGlobale: 2000,
    perfCrypto: 200,
    cryptoPea: 4080,
  }),
];

/** Croissance chaînée telle que la calcule la chaîne d'affichage réelle. */
function croissance(points: HistoryPoint[]): Array<number | undefined> {
  return buildEvolutionSeries(points, "1y", "cumul").points.map((p) => p.growth);
}

const projeter = (over: Partial<Parameters<typeof scopeHistory>[1]>) =>
  scopeHistory(SERIE, {
    scope: "gross",
    assetClass: null,
    envelope: null,
    classMetric: "value",
    ...over,
  });

describe("classe sélectionnée, vue « valeur »", () => {
  it("le total devient celui de la classe", () => {
    const out = projeter({ assetClass: "CRYPTO" });
    expect(out.map((p) => p.totalValueBase)).toEqual([10000, 10200]);
  });

  it("la performance devient celle de la classe, pas celle du portefeuille", () => {
    const out = projeter({ assetClass: "CRYPTO" });
    expect(out[1]!.investmentPerformanceBase).toBe(200);
  });

  it("la croissance vaut 2 %, et non 20 %", () => {
    /*
      Le contrôle numérique du défaut. Avant : 1,2 — la performance globale de
      2 000 € rapportée à une classe de 10 000 €. Après : 1,02.
    */
    const g = croissance(projeter({ assetClass: "CRYPTO" }));
    expect(g[0]).toBe(1);
    expect(g[1]).toBeCloseTo(1.02, 10);
    expect(g[1]).not.toBeCloseTo(1.2, 6);
  });

  it("sans décomposition par classe, la performance est déclarée absente", () => {
    const sansPerf = [
      point({ date: "2026-01-15T00:00:00.000Z", total: 100000, crypto: 10000 }),
      point({ date: "2026-03-15T00:00:00.000Z", total: 102000, crypto: 10200, perfGlobale: 2000 }),
    ];
    const out = scopeHistory(sansPerf, {
      scope: "gross",
      assetClass: "CRYPTO",
      envelope: null,
      classMetric: "value",
    });
    // Jamais la performance globale : une absence vaut mieux qu'un chiffre faux.
    expect(out[1]!.investmentPerformanceBase).toBeUndefined();
  });
});

describe("croisement classe × enveloppe", () => {
  it("le total devient celui du croisement", () => {
    const out = projeter({ assetClass: "CRYPTO", envelope: "PEA" });
    expect(out.map((p) => p.totalValueBase)).toEqual([4000, 4080]);
  });

  it("la performance est absente : le moteur n'en publie pas par enveloppe", () => {
    const out = projeter({ assetClass: "CRYPTO", envelope: "PEA" });
    for (const p of out) expect(p.investmentPerformanceBase).toBeUndefined();
  });

  it("aucune comparaison à l'indice n'est publiée sur ce périmètre", () => {
    /*
      Conséquence voulue : sans croissance, l'écart à l'indice est `null`. La
      courbe se tait au lieu d'annoncer un écart calculé sur deux périmètres
      différents.
    */
    const pts = buildEvolutionSeries(
      projeter({ assetClass: "CRYPTO", envelope: "PEA" }),
      "1y",
      "cumul"
    ).points;
    expect(benchmarkGapPct(pts)).toBeNull();
  });
});

describe("classe sélectionnée, vue « performance »", () => {
  it("le total est un cumul de résultats", () => {
    const out = projeter({ assetClass: "CRYPTO", classMetric: "performance" });
    // Le premier point n'a pas de performance : il est écarté, pas ramené à 0.
    expect(out).toHaveLength(1);
    expect(out[0]!.totalValueBase).toBe(200);
  });

  it("aucune croissance n'est chaînée sur un cumul", () => {
    const out = projeter({ assetClass: "CRYPTO", classMetric: "performance" });
    expect(out[0]!.investmentPerformanceBase).toBeUndefined();
  });
});

describe("ce qui ne change pas", () => {
  it("sans filtre, la série est rendue telle quelle", () => {
    const out = projeter({});
    expect(out).toEqual(SERIE);
  });

  it("le patrimoine net réécrit le total, et lui seul", () => {
    const out = projeter({ scope: "net" });
    expect(out.map((p) => p.totalValueBase)).toEqual([100000, 102000]);
    // La performance globale reste la bonne pour un périmètre global.
    expect(out[1]!.investmentPerformanceBase).toBe(2000);
  });

  it("la croissance du portefeuille entier est inchangée", () => {
    const g = croissance(projeter({}));
    expect(g[1]).toBeCloseTo(1.02, 10);
  });
});
