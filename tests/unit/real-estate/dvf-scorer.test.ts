import { describe, expect, it } from "vitest";
import {
  MIN_COMPARABLE_SCORE,
  PENALTY_WEIGHTS,
  saleAgeMonths,
  scoreComparable,
  selectComparables,
  type ScorableSale,
  type ScoringReference,
} from "@/app/lib/real-estate/dvf-scorer";

/** Référence : un T3 de 70 m² en appartement, commune 13202. */
const REF: ScoringReference = {
  latitude: 43.3,
  longitude: 5.37,
  surfaceM2: 70,
  rooms: 3,
  propertyType: "APPARTEMENT",
  inseeCode: "13202",
};

/** Maintenant fixé — l'ancienneté ne doit pas dépendre du jour du test. */
const NOW = new Date(2026, 6, 15);

/** Vente identique au bien de référence, vendue le mois dernier, à 50 m. */
function perfectSale(over: Partial<ScorableSale> = {}): ScorableSale {
  return {
    builtAreaM2: 70,
    rooms: 3,
    soldOn: new Date(2026, 5, 15),
    inseeCode: "13202",
    distanceM: 50,
    ...over,
  };
}

function pointsOf(sale: ScorableSale, code: string): number {
  const score = scoreComparable(REF, sale, { now: NOW });
  return score.penalties.find((p) => p.code === code)?.points ?? 0;
}

describe("scoreComparable — vente idéale", () => {
  it("note 100 une vente identique, proche et récente", () => {
    const score = scoreComparable(REF, perfectSale(), { now: NOW });
    expect(score.score).toBe(100);
    expect(score.penalties).toEqual([]);
  });

  it("ne pénalise pas une vente dans le même pâté de maisons", () => {
    // 200 m, c'est la même rue : rien à retrancher.
    expect(pointsOf(perfectSale({ distanceM: 200 }), "DISTANCE")).toBe(0);
  });
});

describe("scoreComparable — distance", () => {
  it("applique la pénalité maximale au-delà de 2 km", () => {
    const score = scoreComparable(REF, perfectSale({ distanceM: 2500 }), {
      now: NOW,
    });
    expect(pointsOf(perfectSale({ distanceM: 2500 }), "DISTANCE")).toBe(
      PENALTY_WEIGHTS.DISTANCE
    );
    // Reste tout juste au-dessus du seuil : une vente lointaine mais par
    // ailleurs identique éclaire encore, elle ne doit pas être jetée seule.
    expect(score.score).toBe(60);
  });

  it("sature la pénalité : 8 km ne coûte pas plus que 2 km", () => {
    expect(pointsOf(perfectSale({ distanceM: 8000 }), "DISTANCE")).toBe(
      pointsOf(perfectSale({ distanceM: 2000 }), "DISTANCE")
    );
  });

  it("croît linéairement entre 200 m et 2 km", () => {
    // À mi-parcours (1 100 m), la moitié du poids.
    expect(pointsOf(perfectSale({ distanceM: 1100 }), "DISTANCE")).toBe(20);
  });

  it("combinée à un écart de surface, fait tomber sous le seuil", () => {
    // 2,5 km (−40) + 10 % de surface (−10) = 50, donc pas « > 50 ».
    const sale = perfectSale({ distanceM: 2500, builtAreaM2: 77 });
    const score = scoreComparable(REF, sale, { now: NOW });
    expect(score.score).toBe(50);
    expect(score.score > MIN_COMPARABLE_SCORE).toBe(false);
  });

  it("calcule la distance par Haversine quand le SQL ne l'a pas fournie", () => {
    const sale = perfectSale({
      distanceM: null,
      latitude: 43.3,
      longitude: 5.38,
    });
    const score = scoreComparable(REF, sale, { now: NOW });
    // ~810 m à cette latitude — la valeur exacte importe moins que le fait
    // qu'une distance ait bien été calculée plutôt qu'ignorée.
    expect(score.distanceM).toBeGreaterThan(700);
    expect(score.distanceM).toBeLessThan(900);
  });

  it("pénalise au maximum une vente qu'on ne sait pas situer", () => {
    // Ni distance pré-calculée, ni coordonnées : l'ignorer placerait cette
    // vente en tête du classement, ce qui serait le pire des choix.
    const sale = perfectSale({ distanceM: null, latitude: null, longitude: null });
    const score = scoreComparable(REF, sale, { now: NOW });
    expect(score.distanceM).toBeNull();
    expect(score.penalties).toContainEqual({
      code: "DISTANCE",
      label: "Distance inconnue",
      points: PENALTY_WEIGHTS.DISTANCE,
    });
  });
});

describe("scoreComparable — surface", () => {
  it("pénalise proportionnellement à l'écart relatif", () => {
    // 77 m² contre 70 → 10 % d'écart.
    expect(pointsOf(perfectSale({ builtAreaM2: 77 }), "SURFACE")).toBe(10);
  });

  it("plafonne l'écart de surface", () => {
    expect(pointsOf(perfectSale({ builtAreaM2: 140 }), "SURFACE")).toBe(
      PENALTY_WEIGHTS.SURFACE
    );
  });

  it("juge l'écart en relatif, pas en mètres carrés absolus", () => {
    // 7 m² sur un 70 m² pèsent plus que 7 m² sur un 200 m².
    const grande: ScoringReference = { ...REF, surfaceM2: 200 };
    const petit = scoreComparable(REF, perfectSale({ builtAreaM2: 77 }), { now: NOW });
    const grand = scoreComparable(
      grande,
      perfectSale({ builtAreaM2: 207 }),
      { now: NOW }
    );
    expect(grand.score).toBeGreaterThan(petit.score);
  });
});

describe("scoreComparable — ancienneté", () => {
  it("ne pénalise pas une vente de moins de six mois", () => {
    expect(pointsOf(perfectSale({ soldOn: new Date(2026, 0, 15) }), "ANCIENNETE")).toBe(0);
  });

  it("pénalise au-delà de six mois", () => {
    // Un an → 6 mois au-delà de la franchise → 9 points.
    expect(pointsOf(perfectSale({ soldOn: new Date(2025, 6, 15) }), "ANCIENNETE")).toBe(9);
  });

  it("plafonne l'ancienneté", () => {
    expect(pointsOf(perfectSale({ soldOn: new Date(2023, 0, 15) }), "ANCIENNETE")).toBe(
      PENALTY_WEIGHTS.ANCIENNETE
    );
  });
});

describe("scoreComparable — pièces, commune et terrain", () => {
  it("pénalise une pièce d'écart", () => {
    expect(pointsOf(perfectSale({ rooms: 4 }), "PIECES")).toBe(5);
  });

  it("plafonne à deux pièces d'écart", () => {
    expect(pointsOf(perfectSale({ rooms: 6 }), "PIECES")).toBe(PENALTY_WEIGHTS.PIECES);
  });

  it("pénalise le franchissement d'une limite communale", () => {
    expect(pointsOf(perfectSale({ inseeCode: "13203" }), "COMMUNE")).toBe(
      PENALTY_WEIGHTS.COMMUNE
    );
  });

  it("ignore le terrain pour un appartement", () => {
    // La surface de terrain d'une mutation d'appartement ne décrit rien
    // d'attribuable au lot vendu.
    const sale = perfectSale({ landAreaM2: 900 });
    const refWithLand: ScoringReference = { ...REF, landAreaM2: 100 };
    const score = scoreComparable(refWithLand, sale, { now: NOW });
    expect(score.penalties.find((p) => p.code === "TERRAIN")).toBeUndefined();
  });

  it("compare le terrain entre maisons", () => {
    const maison: ScoringReference = {
      ...REF,
      propertyType: "MAISON",
      landAreaM2: 500,
    };
    const score = scoreComparable(maison, perfectSale({ landAreaM2: 600 }), {
      now: NOW,
    });
    // 20 % d'écart de terrain → 4 points.
    expect(score.penalties.find((p) => p.code === "TERRAIN")?.points).toBe(4);
  });
});

describe("scoreComparable — bornes", () => {
  it("ne descend jamais sous zéro malgré le cumul", () => {
    const pire = perfectSale({
      distanceM: 9000,
      builtAreaM2: 200,
      rooms: 9,
      inseeCode: "75101",
      soldOn: new Date(2020, 0, 1),
    });
    const score = scoreComparable(REF, pire, { now: NOW });
    expect(score.score).toBe(0);
  });
});

describe("saleAgeMonths", () => {
  it("compte les mois pleins", () => {
    expect(saleAgeMonths(new Date(2026, 0, 15), NOW)).toBe(6);
  });

  it("ne compte pas un mois entamé", () => {
    // Vendu le 20, on est le 15 : le mois n'est pas révolu.
    expect(saleAgeMonths(new Date(2026, 0, 20), NOW)).toBe(5);
  });

  it("traite une vente future comme une vente du jour", () => {
    // Millésime importé en avance ou horloge décalée : jamais de bonus négatif.
    expect(saleAgeMonths(new Date(2027, 0, 1), NOW)).toBe(0);
  });

  it("ne casse pas sur une date invalide", () => {
    expect(saleAgeMonths("pas-une-date", NOW)).toBe(0);
  });
});

describe("selectComparables", () => {
  const proche = perfectSale({ distanceM: 50 });
  const moyen = perfectSale({ distanceM: 1100 });
  const loin = perfectSale({ distanceM: 2500, builtAreaM2: 77 });

  it("écarte les ventes au score insuffisant", () => {
    // `loin` note exactement 50 : la sélection est stricte (> seuil).
    const kept = selectComparables(REF, [proche, moyen, loin], { now: NOW });
    expect(kept).toHaveLength(2);
    expect(kept.map((k) => k.sale)).not.toContain(loin);
  });

  it("classe par score décroissant", () => {
    const kept = selectComparables(REF, [moyen, proche], { now: NOW });
    expect(kept[0]!.sale).toBe(proche);
    expect(kept[0]!.score.score).toBeGreaterThan(kept[1]!.score.score);
  });

  it("départage deux scores égaux par la distance, pour rester déterministe", () => {
    const a = perfectSale({ distanceM: 300 });
    const b = perfectSale({ distanceM: 250 });
    const kept = selectComparables(REF, [a, b], { now: NOW });
    expect(kept[0]!.sale).toBe(b);
  });

  it("respecte la limite demandée", () => {
    const kept = selectComparables(REF, [proche, moyen], { now: NOW, limit: 1 });
    expect(kept).toHaveLength(1);
  });

  it("accepte un seuil personnalisé", () => {
    const kept = selectComparables(REF, [loin], { now: NOW, minScore: 40 });
    expect(kept).toHaveLength(1);
  });

  it("rend une liste vide plutôt que d'inventer un comparable", () => {
    expect(selectComparables(REF, [], { now: NOW })).toEqual([]);
  });

  it("expose les pénalités pour que l'écartement reste explicable", () => {
    const kept = selectComparables(REF, [moyen], { now: NOW });
    expect(kept[0]!.score.penalties.map((p) => p.code)).toContain("DISTANCE");
  });
});
