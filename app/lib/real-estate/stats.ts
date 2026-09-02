/**
 * Statistiques d'estimation — médiane et quartiles sur un jeu de comparables.
 *
 * ## Médiane, pas moyenne
 *
 * Le marché immobilier produit des valeurs extrêmes structurelles : biens
 * d'exception, ventes entre proches, lots atypiques. Une moyenne s'y déplace
 * dès qu'une seule vente sort du lot, et donne alors un chiffre que personne ne
 * pourrait obtenir sur le terrain. La médiane décrit le bien du milieu, ce qui
 * est précisément la question posée.
 *
 * ## Pas d'élagage avant le calcul
 *
 * On pourrait retirer les valeurs hors de [Q1 − 1,5·IQR ; Q3 + 1,5·IQR] avant
 * de conclure. Ce serait un double traitement néfaste : la médiane est déjà
 * insensible à ces points, et la fourchette interquartile est justement ce
 * qu'on affiche comme mesure d'incertitude. La rétrécir artificiellement
 * afficherait une précision qui n'existe pas. Les valeurs absurdes sont
 * écartées en amont, à l'import, sur des bornes de vraisemblance explicites.
 *
 * ## Interpolation linéaire
 *
 * Les quantiles suivent la convention d'interpolation linéaire, la même que
 * `percentile_cont` de PostgreSQL et que la plupart des tableurs. Sur un
 * effectif pair, la médiane est donc la moyenne des deux valeurs centrales.
 */

import { d, toFixed, type Decimal } from "../money/decimal";

/**
 * Quantile par interpolation linéaire.
 * `values` doit être trié par ordre croissant et non vide.
 */
export function quantileSorted(values: Decimal[], q: number): Decimal {
  if (values.length === 0) {
    throw new Error("quantileSorted : série vide");
  }
  if (values.length === 1) return values[0]!;
  const clamped = Math.min(1, Math.max(0, q));
  const pos = (values.length - 1) * clamped;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return values[lower]!;
  const weight = pos - lower;
  // v_lo + (v_hi − v_lo) × poids
  return values[lower]!.plus(
    values[upper]!.minus(values[lower]!).times(weight)
  );
}

export type PriceDistribution = {
  /** Médiane du prix au m², en euros. */
  median: string;
  /** Premier quartile — 25 % des ventes sont en dessous. */
  q1: string;
  /** Troisième quartile — 25 % des ventes sont au-dessus. */
  q3: string;
  /** Écart interquartile, mesure de dispersion du marché local. */
  iqr: string;
  min: string;
  max: string;
  count: number;
};

/**
 * Distribution du prix au m² sur un ensemble de comparables.
 * Les valeurs non finies ou négatives sont ignorées : elles ne devraient pas
 * arriver jusqu'ici, mais une seule suffirait à fausser tous les quantiles.
 */
export function priceDistribution(
  pricesPerM2: Array<string | number>
): PriceDistribution | null {
  const values = pricesPerM2
    .map((p) => d(p))
    .filter((v) => v.isFinite() && v.gt(0))
    .sort((a, b) => a.comparedTo(b));

  if (values.length === 0) return null;

  const q1 = quantileSorted(values, 0.25);
  const q3 = quantileSorted(values, 0.75);

  return {
    median: toFixed(quantileSorted(values, 0.5), 2),
    q1: toFixed(q1, 2),
    q3: toFixed(q3, 2),
    iqr: toFixed(q3.minus(q1), 2),
    min: toFixed(values[0]!, 2),
    max: toFixed(values[values.length - 1]!, 2),
    count: values.length,
  };
}

/** Niveau de confiance affiché à l'utilisateur. */
export type EstimateConfidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * Confiance dérivée de l'effectif, du rayon parcouru et de la dispersion.
 *
 * Les trois comptent, et pour des raisons différentes : peu de ventes rend la
 * médiane instable ; un rayon large signifie qu'on a dû aller chercher loin,
 * donc dans un marché possiblement différent ; une dispersion forte indique un
 * secteur hétérogène où un chiffre unique renseigne peu. Une estimation sur
 * 200 ventes à 10 km n'est pas plus fiable qu'une estimation sur 30 ventes à
 * 1 km — l'effectif seul serait un mauvais juge.
 */
export function estimateConfidence(input: {
  count: number;
  radiusM: number;
  median: string;
  iqr: string;
}): EstimateConfidence {
  const median = d(input.median);
  const relativeSpread = median.gt(0)
    ? d(input.iqr).div(median).toNumber()
    : Number.POSITIVE_INFINITY;

  if (input.count >= 40 && input.radiusM <= 2000 && relativeSpread <= 0.5) {
    return "HIGH";
  }
  if (input.count >= 15 && input.radiusM <= 5000 && relativeSpread <= 0.9) {
    return "MEDIUM";
  }
  return "LOW";
}
