import { describe, expect, it } from "vitest";
import {
  benchmarkGapPct,
  buildEvolutionSeries,
  toPercentSeries,
  withBenchmarkSeries,
  type IndexClosePoint,
} from "@/app/lib/portfolio/evolution-aggregate";
import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Le comparatif avec l'indice doit comparer deux grandeurs de même nature.
 *
 * Un indice ne reçoit jamais d'apport : sa progression est du rendement pur.
 * Le portefeuille, lui, encaisse des versements et des retraits. Comparer la
 * variation de sa **valeur** à la progression de l'indice revenait donc à lui
 * créditer ses propres dépôts — sur le compte de démonstration, +8,71 % annoncés
 * là où les investissements avaient produit +1,96 %.
 *
 * La grandeur retenue est le rendement chaîné, jour par jour, sur le résultat
 * d'investissement du moteur. Ces tests partent volontairement de points
 * d'historique bruts plutôt que de séries déjà agrégées : c'est toute la chaîne
 * — transport du résultat, chaînage, agrégation, comparaison — qui doit tenir.
 */

/**
 * Un jour d'historique.
 *
 * `perf` est le résultat d'investissement du moteur, soit
 * `valeur(D) − valeur(D−1) − flux(D)`. Les fixtures le posent explicitement
 * plutôt que de le déduire, pour que chaque scénario dise ce qu'il veut dire.
 */
function jour(
  date: string,
  valeur: number,
  opts: { flux?: number; perf?: number } = {}
): HistoryPoint {
  return {
    date,
    label: date.slice(0, 10),
    totalValueEur: valeur,
    totalValueBase: valeur,
    cashTotalEur: 0,
    cashTotalBase: 0,
    grossAssetsBase: valeur,
    externalFlowsBase: opts.flux ?? 0,
    investmentPerformanceBase: opts.perf ?? 0,
  } as unknown as HistoryPoint;
}

/**
 * Série de points espacés d'un mois.
 *
 * Un point par mois, et non par jour : la plage « Tout » agrège au mois, et une
 * série quotidienne s'y replierait en un seul bucket — le test ne mesurerait
 * plus rien. Le chaînage du rendement, lui, parcourt tous les points quels que
 * soient leurs intervalles.
 */
function jours(
  specs: Array<{ valeur: number; flux?: number; perf?: number }>
): HistoryPoint[] {
  return specs.map((sp, i) => {
    const d = new Date(Date.UTC(2026, i, 15, 12));
    return jour(d.toISOString(), sp.valeur, sp);
  });
}

/** Clôtures d'indice alignées sur les mêmes dates. */
function indice(niveaux: number[]): IndexClosePoint[] {
  return niveaux.map((close, i) => ({
    date: new Date(Date.UTC(2026, i, 15, 12)).toISOString(),
    close,
  }));
}

/**
 * Écart portefeuille − indice sur toute la série.
 *
 * `range: "all"` pour que la fenêtre porte tous les points et que le test
 * mesure ce qu'il pose, sans dépendre de la date du jour.
 */
function ecart(points: HistoryPoint[], niveaux: number[]) {
  const { points: serie } = buildEvolutionSeries(points, "all", "cumul");
  const avecIndice = withBenchmarkSeries(serie, "index", {
    indexCloses: indice(niveaux),
  });
  return benchmarkGapPct(avecIndice);
}

describe("un flux n'est jamais de la performance", () => {
  it("sans aucun flux, la comparaison reste celle d'avant", () => {
    /*
      Cas 1. Le portefeuille gagne 10 % par le seul effet du marché, l'indice
      aussi : l'écart est nul. C'est le décor où variation de valeur et
      rendement coïncident, et où la correction ne devait rien changer.
    */
    const g = ecart(
      jours([
        { valeur: 100_000 },
        { valeur: 105_000, perf: 5_000 },
        { valeur: 110_000, perf: 5_000 },
      ]),
      [1_000, 1_050, 1_100]
    );
    expect(g).not.toBeNull();
    expect(g!.portfolioPct).toBeCloseTo(10, 4);
    expect(g!.benchmarkPct).toBeCloseTo(10, 4);
    expect(g!.gapPct).toBeCloseTo(0, 4);
  });

  it("un apport n'est pas lu comme de la performance", () => {
    /*
      Cas 2 et 5. La valeur double, mais rien n'a été investi avec profit : le
      portefeuille a reçu 100 000 €. Sa performance est nulle.

      C'est le cas qui produisait le défaut : la variation de valeur valait
      +100 %, et l'écran l'annonçait comme une surperformance de cent points.
    */
    const g = ecart(
      jours([
        { valeur: 100_000 },
        { valeur: 200_000, flux: 100_000, perf: 0 },
        { valeur: 200_000, perf: 0 },
      ]),
      [1_000, 1_000, 1_000]
    );
    expect(g).not.toBeNull();
    expect(g!.portfolioPct).toBeCloseTo(0, 6);
    expect(g!.gapPct).toBeCloseTo(0, 6);
  });

  it("un portefeuille qui double par apport n'a pas fait +100 %", () => {
    // Cas 6, énoncé tel quel dans le chantier.
    const g = ecart(
      jours([
        { valeur: 50_000 },
        { valeur: 100_000, flux: 50_000, perf: 0 },
      ]),
      [1_000, 1_000]
    );
    expect(g!.portfolioPct).toBeCloseTo(0, 6);
    expect(g!.portfolioPct).not.toBeCloseTo(100, 0);
  });

  it("un retrait n'est pas lu comme une sous-performance", () => {
    /*
      Cas 3, symétrique. La valeur fond de moitié parce que l'argent est sorti,
      pas parce que le marché a baissé.
    */
    const g = ecart(
      jours([
        { valeur: 100_000 },
        { valeur: 50_000, flux: -50_000, perf: 0 },
      ]),
      [1_000, 1_000]
    );
    expect(g!.portfolioPct).toBeCloseTo(0, 6);
    expect(g!.gapPct).toBeCloseTo(0, 6);
  });

  it("plusieurs flux successifs restent neutres", () => {
    /*
      Cas 4. Deux apports et un retrait, avec un vrai gain de marché au milieu.

      Le rendement attendu se chaîne : +2 % le deuxième jour sur une base de
      100 000, puis +1 % le cinquième sur une base de 152 000. Soit
      1,02 × 1,01 − 1 = 3,02 %. Le calculer autrement — somme des résultats
      divisée par la mise initiale — donnerait 3,52 %, parce que les 1 520 € du
      cinquième jour ont été produits sur un capital augmenté entre-temps.
    */
    const g = ecart(
      jours([
        { valeur: 100_000 },
        { valeur: 102_000, perf: 2_000 },
        { valeur: 152_000, flux: 50_000, perf: 0 },
        { valeur: 132_000, flux: -20_000, perf: 0 },
        { valeur: 133_320, perf: 1_320 },
      ]),
      [1_000, 1_000, 1_000, 1_000, 1_000]
    );
    expect(g).not.toBeNull();
    // 1,02 × 1,01 − 1 = 3,02 %
    expect(g!.portfolioPct).toBeCloseTo(3.02, 4);
    expect(g!.gapPct).toBeCloseTo(3.02, 4);
  });

  it("indice inchangé et portefeuille sans performance : écart nul", () => {
    // Cas 7.
    const g = ecart(
      jours([{ valeur: 100_000 }, { valeur: 100_000, perf: 0 }]),
      [1_000, 1_000]
    );
    expect(g!.portfolioPct).toBeCloseTo(0, 6);
    expect(g!.benchmarkPct).toBeCloseTo(0, 6);
    expect(g!.gapPct).toBeCloseTo(0, 6);
  });

  it("indice en hausse et portefeuille immobile : sous-performance", () => {
    /*
      Cas 8. L'indice gagne 8 %, le portefeuille ne produit rien : l'écart vaut
      exactement −8 points, et ce même si le portefeuille a reçu un apport.
    */
    const g = ecart(
      jours([
        { valeur: 100_000 },
        { valeur: 130_000, flux: 30_000, perf: 0 },
      ]),
      [1_000, 1_080]
    );
    expect(g!.portfolioPct).toBeCloseTo(0, 6);
    expect(g!.benchmarkPct).toBeCloseTo(8, 4);
    expect(g!.gapPct).toBeCloseTo(-8, 4);
  });

  it("une perte reste une perte, apport ou non", () => {
    // Le sens du signe ne doit pas dépendre des mouvements de capitaux.
    const g = ecart(
      jours([
        { valeur: 100_000 },
        { valeur: 145_000, flux: 50_000, perf: -5_000 },
      ]),
      [1_000, 1_000]
    );
    expect(g!.portfolioPct).toBeCloseTo(-5, 4);
    expect(g!.gapPct).toBeCloseTo(-5, 4);
  });
});

describe("fenêtres courtes et données manquantes", () => {
  it("un seul point ne produit aucun écart", () => {
    // Cas 9. Sans veille, aucun rendement n'est mesurable.
    expect(ecart(jours([{ valeur: 100_000 }]), [1_000])).toBeNull();
  });

  it("sans clôture d'indice, aucun écart n'est annoncé", () => {
    const { points: serie } = buildEvolutionSeries(
      jours([{ valeur: 100_000 }, { valeur: 110_000, perf: 10_000 }]),
      "all",
      "cumul"
    );
    const sansIndice = withBenchmarkSeries(serie, "index", { indexCloses: [] });
    expect(benchmarkGapPct(sansIndice)).toBeNull();
  });

  it("sans résultat d'investissement, la comparaison est tue et non approximée", () => {
    /*
      Le cas du croisement classe × enveloppe, dont aucun flux historique n'est
      attribuable. Mieux vaut ne rien annoncer qu'un chiffre dont on sait qu'il
      contiendrait les apports.
    */
    const bruts = jours([{ valeur: 100_000 }, { valeur: 200_000 }]).map((p) => ({
      ...p,
      investmentPerformanceBase: undefined,
    })) as HistoryPoint[];
    const { points: serie } = buildEvolutionSeries(bruts, "all", "cumul");
    const avecIndice = withBenchmarkSeries(serie, "index", {
      indexCloses: indice([1_000, 1_000]),
    });
    expect(benchmarkGapPct(avecIndice)).toBeNull();
  });

  it("une base nulle ne fabrique pas de rendement", () => {
    /*
      Un portefeuille parti de zéro. Diviser par cette base produirait un
      rendement infini le jour du premier versement ; le chaînage reporte la
      croissance telle quelle et n'attribue de rendement qu'à partir du moment
      où il y a un capital sur lequel en produire.

      Le test s'arrête au chaînage plutôt qu'à l'écart : l'indice ne peut pas
      être rebasé sur une valeur initiale nulle, et la comparaison n'existe donc
      pas dans ce décor — un garde-fou antérieur à ce chantier.
    */
    const { points } = buildEvolutionSeries(
      jours([
        { valeur: 0 },
        { valeur: 10_000, flux: 10_000, perf: 0 },
        { valeur: 10_500, perf: 500 },
      ]),
      "all",
      "cumul"
    );
    expect(points).toHaveLength(3);
    for (const p of points) {
      expect(Number.isFinite(p.growth!)).toBe(true);
    }
    // Rien produit tant qu'il n'y a pas de capital…
    expect(points[1]!.growth).toBeCloseTo(1, 9);
    // …puis 500 € sur une base de 10 000, soit +5 %.
    expect(points[2]!.growth! / points[0]!.growth! - 1).toBeCloseTo(0.05, 9);
  });
});

describe("la courbe en pourcentage suit la même règle que l'écart", () => {
  it("les deux courbes partent de zéro et le portefeuille ignore l'apport", () => {
    /*
      Cas 10, côté courbe : ce que l'œil lit doit dire la même chose que le
      chiffre affiché sous le graphique.
    */
    const { points: serie } = buildEvolutionSeries(
      jours([
        { valeur: 100_000 },
        { valeur: 200_000, flux: 100_000, perf: 0 },
        { valeur: 210_000, perf: 10_000 },
      ]),
      "all",
      "cumul"
    );
    const avecIndice = withBenchmarkSeries(serie, "index", {
      indexCloses: indice([1_000, 1_000, 1_020]),
    });
    const pct = toPercentSeries(avecIndice);

    expect(pct[0]!.portfolioPct).toBeCloseTo(0, 6);
    expect(pct[0]!.benchmarkPct).toBeCloseTo(0, 6);
    // L'apport du deuxième jour ne déplace pas la courbe du portefeuille.
    expect(pct[1]!.portfolioPct).toBeCloseTo(0, 6);
    // Le gain du troisième, lui, la déplace : 10 000 sur une base de 200 000.
    expect(pct[2]!.portfolioPct).toBeCloseTo(5, 4);
    expect(pct[2]!.benchmarkPct).toBeCloseTo(2, 4);
  });
});
