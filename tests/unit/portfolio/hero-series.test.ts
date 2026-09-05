import { describe, expect, it } from "vitest";
import { buildHeroSeries } from "@/app/lib/portfolio/hero-series";
import {
  nearestPointByFraction,
  nearestPointIndex,
  sparklineGeometry,
  sparklineXFractions,
} from "@/app/lib/ui/sparkline-geometry";
import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Ce que la carte de tête raconte au survol.
 *
 * Les cas retenus sont ceux où une erreur ne se verrait pas à l'écran : un
 * écart calculé depuis le mauvais voisin, une décomposition affichée dans le
 * mauvais mode, une valeur reportée présentée comme une mesure. Un survol qui
 * marche « à peu près » raconte une histoire fausse avec l'aplomb d'un chiffre.
 */

function point(over: Partial<HistoryPoint>): HistoryPoint {
  return {
    date: "2026-01-12T22:59:59.999Z",
    label: "12 janv.",
    totalValueEur: 0,
    cashTotalEur: 0,
    totalValueBase: 0,
    cashTotalBase: 0,
    ...over,
  };
}

describe("buildHeroSeries — alignement et écarts", () => {
  const history = [
    point({ date: "2026-01-10T22:59:59.999Z", netWorthBase: 100, grossAssetsBase: 150, liabilitiesBase: 50 }),
    point({ date: "2026-01-11T22:59:59.999Z", netWorthBase: 110, grossAssetsBase: 165, liabilitiesBase: 55 }),
    point({ date: "2026-01-12T22:59:59.999Z", netWorthBase: 99, grossAssetsBase: 154, liabilitiesBase: 55 }),
  ];

  it("l'écart se compte face au point précédent, pas au début de série", () => {
    const series = buildHeroSeries(history, [100, 110, 99], "net");

    // Le dernier point a bien reculé de 11 face à la veille (110), et non
    // progressé de 99 − 100 = −1 face au premier point.
    expect(series[2]!.deltaAbs).toBe(-11);
    expect(series[2]!.deltaPct).toBeCloseTo((-11 / 110) * 100, 10);
  });

  it("le premier point n'a pas d'écart : sans veille, rien n'est comparable", () => {
    const series = buildHeroSeries(history, [100, 110, 99], "net");
    expect(series[0]!.deltaAbs).toBeUndefined();
    expect(series[0]!.deltaPct).toBeUndefined();
  });

  it("une veille à zéro laisse le pourcentage indéfini, jamais infini", () => {
    const series = buildHeroSeries(
      [history[0]!, history[1]!],
      [0, 110],
      "net"
    );
    expect(series[1]!.deltaAbs).toBe(110);
    expect(series[1]!.deltaPct).toBeUndefined();
  });

  it("deux tableaux désalignés ne produisent aucune série", () => {
    /*
      Le cas ne doit jamais arriver — `kpiSeries` rend la même longueur que
      l'historique ou rien — mais s'il arrivait, chaque date surmonterait le
      montant d'un autre jour sans que rien ne le signale.
    */
    expect(buildHeroSeries(history, [100, 110], "net")).toEqual([]);
    expect(buildHeroSeries(history, undefined, "net")).toEqual([]);
  });
});

describe("buildHeroSeries — décomposition selon le mode", () => {
  const history = [
    point({ netWorthBase: 100, grossAssetsBase: 150, liabilitiesBase: 50 }),
    point({ netWorthBase: 110, grossAssetsBase: 165, liabilitiesBase: 55 }),
  ];

  it("en net, actifs et passifs accompagnent le montant", () => {
    const series = buildHeroSeries(history, [100, 110], "net");
    expect(series[1]!.grossAssets).toBe(165);
    expect(series[1]!.liabilities).toBe(55);
  });

  it("en brut, aucune décomposition : la question ne se pose pas", () => {
    const series = buildHeroSeries(history, [150, 165], "brut");
    expect(series[1]!.grossAssets).toBeUndefined();
    expect(series[1]!.liabilities).toBeUndefined();
  });

  it("un historique sans passifs ne les invente pas", () => {
    const sansPassifs = [
      point({ netWorthBase: 100, grossAssetsBase: 150 }),
      point({ netWorthBase: 110, grossAssetsBase: 165 }),
    ];
    const series = buildHeroSeries(sansPassifs, [100, 110], "net");
    expect(series[1]!.grossAssets).toBe(165);
    expect(series[1]!.liabilities).toBeUndefined();
  });
});

describe("buildHeroSeries — valeurs reportées", () => {
  it("un jour estimé renvoie à la dernière valorisation observée", () => {
    const history = [
      point({ date: "2026-01-09T22:59:59.999Z", netWorthBase: 100, status: "EXACT" }),
      point({ date: "2026-01-10T22:59:59.999Z", netWorthBase: 100, status: "ESTIMATED" }),
      point({ date: "2026-01-11T22:59:59.999Z", netWorthBase: 100, status: "ESTIMATED" }),
    ];
    const series = buildHeroSeries(history, [100, 100, 100], "net");

    expect(series[0]!.carried).toBe(false);
    // Les deux jours du week-end reconduisent la valeur du vendredi.
    expect(series[1]!.carried).toBe(true);
    expect(series[1]!.lastObservedDate).toBe("2026-01-09T22:59:59.999Z");
    expect(series[2]!.lastObservedDate).toBe("2026-01-09T22:59:59.999Z");
  });

  it("sans statut publié, rien n'est déclaré reporté", () => {
    /*
      Une réponse d'API qui ne porte pas `status` ne dit pas que la valeur est
      observée : elle ne dit rien. Annoncer « dernière valo » sur cette base
      serait une affirmation sans source.
    */
    const history = [point({ netWorthBase: 100 }), point({ netWorthBase: 110 })];
    const series = buildHeroSeries(history, [100, 110], "net");
    expect(series.every((p) => p.carried === false)).toBe(true);
    expect(series.every((p) => p.lastObservedDate === undefined)).toBe(true);
  });
});

describe("buildHeroSeries — événement du jour", () => {
  it("un flux de transaction non nul est retenu, un flux nul ne l'est pas", () => {
    const history = [
      point({ netWorthBase: 100, transactionFlowBase: 0, externalFlowsBase: 50_000 }),
      point({ netWorthBase: 5100, transactionFlowBase: 5000, externalFlowsBase: 50_000 }),
    ];
    const series = buildHeroSeries(history, [100, 5100], "net");
    expect(series[0]!.externalFlow).toBeUndefined();
    expect(series[1]!.externalFlow).toBe(5000);
  });

  it("un flux externe sans transaction ne pose pas de pastille", () => {
    const history = [
      point({ netWorthBase: 100, externalFlowsBase: 0 }),
      point({ netWorthBase: 980_100, externalFlowsBase: 980_000 }),
    ];
    const series = buildHeroSeries(history, [100, 980_100], "financier");
    expect(series[1]!.externalFlow).toBeUndefined();
  });
});

describe("géométrie et aimantation", () => {
  it("le rang d'origine survit au filtrage des valeurs non finies", () => {
    /*
      La sparkline écarte du tracé ce qui n'est pas fini. Sans `sourceIndex`,
      la croix posée sur le troisième point dessiné désignerait la troisième
      valeur reçue — qui n'est pas la même dès qu'un trou précède.
    */
    const geom = sparklineGeometry([10, Number.NaN, 30, 40], 100, 20, 2);
    expect(geom).not.toBeNull();
    expect(geom!.points.map((p) => p.sourceIndex)).toEqual([0, 2, 3]);
  });

  it("moins de deux points finis : pas de courbe, donc rien à survoler", () => {
    expect(sparklineGeometry([42], 100, 20, 2)).toBeNull();
    expect(sparklineGeometry([Number.NaN, 42], 100, 20, 2)).toBeNull();
  });

  it("une série plate reste traçable au lieu de diviser par zéro", () => {
    const geom = sparklineGeometry([50, 50, 50], 100, 20, 2);
    expect(geom).not.toBeNull();
    expect(geom!.points.every((p) => Number.isFinite(p.y))).toBe(true);
  });

  it("l'aimantation prend le rang le plus proche et reste dans les bornes", () => {
    expect(nearestPointIndex(5, 0)).toBe(0);
    expect(nearestPointIndex(5, 1)).toBe(4);
    // 0,6 × 4 = 2,4 → le rang 2 est le plus proche.
    expect(nearestPointIndex(5, 0.6)).toBe(2);
    // Un pointeur qui déborde pendant un glissement ne sort pas du tableau.
    expect(nearestPointIndex(5, -0.4)).toBe(0);
    expect(nearestPointIndex(5, 1.8)).toBe(4);
    expect(nearestPointIndex(0, 0.5)).toBe(-1);
  });

  it("avec des dates, l'abscisse suit le temps et non le rang", () => {
    const t0 = Date.parse("2026-01-01T00:00:00.000Z");
    const t1 = Date.parse("2026-06-01T00:00:00.000Z");
    const t2 = Date.parse("2026-07-01T00:00:00.000Z");
    const fractions = sparklineXFractions(3, [t0, t1, t2]);
    expect(fractions[0]).toBe(0);
    expect(fractions[2]).toBe(1);
    // Six mois puis un mois : le milieu n'est pas à 0,5.
    expect(fractions[1]!).toBeGreaterThan(0.7);
    expect(fractions[1]!).toBeLessThan(0.9);

    const geom = sparklineGeometry(
      [10, 10, 40],
      100,
      20,
      2,
      [
        "2026-01-01T00:00:00.000Z",
        "2026-06-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      ]
    );
    expect(geom).not.toBeNull();
    expect(geom!.points[1]!.x).toBeCloseTo(fractions[1]! * 100, 5);

    // À 10 % de largeur on est encore sur le palier de six mois, pas au rang 0.
    expect(nearestPointByFraction(fractions, 0.1)).toBe(0);
    expect(nearestPointByFraction(fractions, 0.85)).toBe(1);
  });

  it("sans dates lisibles, le pas d'indice reste le défaut", () => {
    expect(sparklineXFractions(4)).toEqual([0, 1 / 3, 2 / 3, 1]);
    const geom = sparklineGeometry([10, 20, 30], 90, 20, 2);
    expect(geom!.points.map((p) => p.x)).toEqual([0, 45, 90]);
  });
});
