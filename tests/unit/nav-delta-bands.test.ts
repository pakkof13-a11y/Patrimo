import { describe, expect, it } from "vitest";
import {
  DELTA_BAND_FRACTION,
  navDeltaBandDomains,
} from "@/components/dashboard/portfolio-evolution-charts";

/**
 * Les deux couloirs du graphique d'évolution.
 *
 * La courbe NAV et l'histogramme Δ marché partagent un cadre mais plus un
 * domaine : la NAV occupe le haut, les barres un bandeau bas centré sur zéro.
 * Ce qui est vérifié ici n'est pas une couleur, c'est une géométrie — si le
 * zéro des barres n'est pas là où le calcul le promet, la ligne de repère
 * tracée à `y=0` se pose ailleurs que la base des barres, et l'histogramme
 * annonce des hausses et des baisses autour d'un axe qui n'est pas le sien.
 */

/** Où tombe la valeur `v` dans `[lo, hi]`, en fraction depuis le bas du cadre. */
function fractionFromBottom(domain: [number, number], v: number): number {
  const [lo, hi] = domain;
  return (v - lo) / (hi - lo);
}

const f = DELTA_BAND_FRACTION;

function pts(values: Array<{ total: number; delta: number }>) {
  return values;
}

describe("bandeau des barres", () => {
  const { deltaDomain } = navDeltaBandDomains(
    pts([
      { total: 100, delta: 0 },
      { total: 110, delta: 800 },
      { total: 105, delta: -1_000 },
    ])
  );

  it("le zéro des barres tombe à la moitié du bandeau", () => {
    expect(fractionFromBottom(deltaDomain, 0)).toBeCloseTo(f / 2, 10);
  });

  it("la plus grande hausse atteint le haut du bandeau, pas au-delà", () => {
    // M = 1 000 : c'est la plus grande valeur absolue, hausse ou baisse.
    expect(fractionFromBottom(deltaDomain, 1_000)).toBeCloseTo(f, 10);
  });

  it("la plus grande baisse touche le bas du cadre", () => {
    expect(fractionFromBottom(deltaDomain, -1_000)).toBeCloseTo(0, 10);
  });

  it("aucune barre ne sort du cadre — donc rien à écrêter", () => {
    /*
      Le domaine est calé sur `max(|Δ|)` de la fenêtre : par construction,
      toute barre y tient. C'est ce qui permet de retirer `allowDataOverflow`,
      dont l'effet aurait été de trancher une barre sans le dire.
    */
    for (const v of [800, -1_000, 0, 1_000]) {
      const frac = fractionFromBottom(deltaDomain, v);
      expect(frac).toBeGreaterThanOrEqual(0);
      expect(frac).toBeLessThanOrEqual(f + 1e-12);
    }
  });
});

describe("couloir de la NAV", () => {
  const { navDomain } = navDeltaBandDomains(
    pts([
      { total: 250_000, delta: 10 },
      { total: 290_000, delta: -10 },
    ])
  );

  it("le plus bas de la courbe effleure le haut du bandeau sans y entrer", () => {
    expect(fractionFromBottom(navDomain, 250_000)).toBeCloseTo(f, 10);
  });

  it("le plus haut de la courbe atteint le haut du cadre", () => {
    expect(fractionFromBottom(navDomain, 290_000)).toBeCloseTo(1, 10);
  });

  it("l'axe n'est pas calé à zéro", () => {
    /*
      Un patrimoine de 250 000 € qui varie de 40 000 € doit se lire sur son
      amplitude propre. Repartir de 0 écraserait la courbe en un trait plat
      dans le tiers haut du cadre.
    */
    expect(navDomain[0]).toBeGreaterThan(0);
  });
});

describe("cas limites — un domaine reste toujours traçable", () => {
  it("fenêtre vide", () => {
    const { navDomain, deltaDomain } = navDeltaBandDomains([]);
    for (const v of [...navDomain, ...deltaDomain]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(navDomain[0]).toBeLessThan(navDomain[1]);
    expect(deltaDomain[0]).toBeLessThan(deltaDomain[1]);
  });

  it("marché parfaitement immobile : le bandeau existe, les barres sont nulles", () => {
    const { deltaDomain, deltaMax } = navDeltaBandDomains(
      pts([
        { total: 100, delta: 0 },
        { total: 100, delta: 0 },
      ])
    );
    expect(deltaMax).toBe(0);
    // Le zéro reste au milieu du bandeau : la ligne de repère ne saute pas.
    expect(fractionFromBottom(deltaDomain, 0)).toBeCloseTo(f / 2, 10);
  });

  it("NAV plate : l'axe ne s'effondre pas sur un span nul", () => {
    const { navDomain } = navDeltaBandDomains(
      pts([
        { total: 42_000, delta: 5 },
        { total: 42_000, delta: -5 },
      ])
    );
    expect(navDomain[1]).toBeGreaterThan(navDomain[0]);
    expect(Number.isFinite(navDomain[0])).toBe(true);
  });

  it("des valeurs non finies ne contaminent pas les bornes", () => {
    const { navDomain, deltaDomain } = navDeltaBandDomains(
      pts([
        { total: Number.NaN, delta: Number.NaN },
        { total: 100, delta: 50 },
        { total: 200, delta: -50 },
      ])
    );
    for (const v of [...navDomain, ...deltaDomain]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(fractionFromBottom(deltaDomain, 50)).toBeCloseTo(f, 10);
  });

  it("une fraction absurde retombe sur la valeur de référence", () => {
    const data = pts([
      { total: 100, delta: 10 },
      { total: 200, delta: -10 },
    ]);
    for (const mauvaise of [0, 1, -0.5, 2, Number.NaN]) {
      expect(navDeltaBandDomains(data, mauvaise)).toEqual(
        navDeltaBandDomains(data)
      );
    }
  });
});

describe("le bandeau et le couloir ne se recouvrent pas", () => {
  it("le bas de la NAV et le haut des barres se touchent sans se croiser", () => {
    const data = pts([
      { total: 1_000, delta: 300 },
      { total: 1_800, delta: -420 },
      { total: 1_500, delta: 120 },
    ]);
    const { navDomain, deltaDomain, deltaMax } = navDeltaBandDomains(data);

    const basDeLaCourbe = fractionFromBottom(navDomain, 1_000);
    const hautDesBarres = fractionFromBottom(deltaDomain, deltaMax);

    expect(hautDesBarres).toBeCloseTo(basDeLaCourbe, 10);
    // Et la courbe occupe bien tout ce qui reste au-dessus.
    expect(basDeLaCourbe).toBeCloseTo(f, 10);
  });
});
