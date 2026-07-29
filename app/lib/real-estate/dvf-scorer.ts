/**
 * Notation des ventes DVF retenues comme comparables.
 *
 * `findComparables` ramène tout ce qui tombe dans le rayon et la tolérance de
 * surface, puis `priceDistribution` en prend la médiane. Toutes les ventes y
 * pèsent donc autant : celle d'en face compte comme celle à 1,8 km, celle du
 * mois dernier comme celle d'il y a deux ans. Ce module hiérarchise ce jeu de
 * comparables pour qu'un sous-ensemble réellement pertinent puisse être isolé.
 *
 * ## Ce que ce module peut noter, et ce qu'il ne peut pas
 *
 * DVF décrit une **mutation**, pas un logement : on y trouve la date, le prix,
 * la surface bâtie, le nombre de pièces, la commune et les coordonnées. Rien
 * d'autre. Ni DPE, ni étage, ni orientation, ni état — ces colonnes n'existent
 * pas dans les fichiers Etalab et aucune jointure ne les apporterait.
 *
 * Pénaliser un comparable sur son étage ou son DPE supposerait donc d'inventer
 * la donnée, et le score en sortie mesurerait la fiction plutôt que la
 * comparabilité. Ces dimensions relèvent du **bien à estimer**, pas des ventes
 * de référence : elles sont traitées dans `valuation-adjustments.ts`, où elles
 * ajustent le prix au m² du marché au lieu de trier les ventes qui l'ont formé.
 *
 * Module volontairement pur : ni Prisma, ni réseau, ni horloge implicite (`now`
 * est toujours injectable). Testable sans base.
 */

import { haversineMeters, type LatLon } from "./geo";

/** Seuil de rétention par défaut — en deçà, la vente n'éclaire pas le bien. */
export const MIN_COMPARABLE_SCORE = 50;

/**
 * Distance en deçà de laquelle aucune pénalité n'est appliquée.
 *
 * 200 m, c'est le pâté de maisons : même rue, même desserte, même réputation.
 */
export const FREE_DISTANCE_M = 200;

/**
 * Distance à laquelle la pénalité de distance est maximale.
 *
 * Au-delà de 2 km en ville, on a changé de quartier — donc de marché. La
 * pénalité sature là plutôt que de croître indéfiniment : une vente à 8 km
 * n'est pas « deux fois moins comparable » qu'une vente à 4 km, elle est
 * simplement hors sujet, et d'autres critères doivent pouvoir la départager.
 */
export const MAX_DISTANCE_PENALTY_M = 2000;

/** Ancienneté de vente tolérée sans pénalité, en mois. */
export const FREE_AGE_MONTHS = 6;

/** Poids maximal de chaque critère, en points retirés de 100. */
export const PENALTY_WEIGHTS = {
  /** Le critère dominant : la localisation fait le prix. */
  DISTANCE: 40,
  SURFACE: 25,
  ANCIENNETE: 20,
  PIECES: 10,
  COMMUNE: 8,
  TERRAIN: 10,
} as const;

export type PenaltyCode = keyof typeof PENALTY_WEIGHTS;

export type ComparablePenalty = {
  code: PenaltyCode;
  /** Libellé lisible, destiné à être affiché tel quel. */
  label: string;
  /** Points retirés du score, toujours positifs. */
  points: number;
};

export type ComparableScore = {
  /** Note finale, bornée à [0, 100]. */
  score: number;
  penalties: ComparablePenalty[];
  /** `null` quand ni distance pré-calculée ni coordonnées ne sont fournies. */
  distanceM: number | null;
  /** Ancienneté de la vente en mois pleins, jamais négative. */
  ageMonths: number;
};

/** Le bien à estimer — le référentiel auquel les ventes sont comparées. */
export type ScoringReference = {
  latitude: number;
  longitude: number;
  surfaceM2: number;
  rooms?: number | null;
  /** MAISON | APPARTEMENT — conditionne la pertinence du terrain. */
  propertyType?: string | null;
  inseeCode?: string | null;
  landAreaM2?: number | null;
};

/**
 * Une vente DVF agrégée, telle que la base la stocke.
 *
 * Coordonnées et distance pré-calculée sont toutes deux optionnelles, mais
 * l'une des deux est nécessaire pour situer la vente : à défaut, la pénalité
 * de distance est appliquée au maximum plutôt qu'ignorée — une vente qu'on ne
 * sait pas placer ne doit pas se retrouver en tête du classement.
 */
export type ScorableSale = {
  latitude?: number | null;
  longitude?: number | null;
  builtAreaM2: number;
  rooms?: number | null;
  soldOn: Date | string;
  inseeCode?: string | null;
  landAreaM2?: number | null;
  /**
   * Distance déjà calculée par la requête SQL. Fournie, elle est reprise telle
   * quelle : recalculer un Haversine que Postgres vient de faire coûterait sans
   * rien changer, et introduirait un risque d'écart entre le filtre et le score.
   */
  distanceM?: number | null;
};

export type ScoredComparable<T extends ScorableSale = ScorableSale> = {
  sale: T;
  score: ComparableScore;
};

/**
 * Arrondi au dixième, symétrique autour de zéro — évite un score à 17
 * décimales. Même convention que `valuation-adjustments.ts`.
 */
function round1(n: number): number {
  const r = Math.round(Math.abs(n) * 10) / 10;
  return n < 0 ? -r : r;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Mois pleins écoulés entre une vente et `now`, jamais négatif.
 *
 * Une date de vente postérieure à `now` ne devrait pas exister ; si elle
 * survient (import d'un millésime en avance, horloge décalée), elle est traitée
 * comme une vente du jour plutôt que de créditer un bonus d'ancienneté négatif.
 */
export function saleAgeMonths(soldOn: Date | string, now = new Date()): number {
  const sold = soldOn instanceof Date ? soldOn : new Date(soldOn);
  if (Number.isNaN(sold.getTime())) return 0;
  const years = now.getFullYear() - sold.getFullYear();
  const months = now.getMonth() - sold.getMonth();
  let total = years * 12 + months;
  if (now.getDate() < sold.getDate()) total -= 1;
  return Math.max(0, total);
}

/** Distance de la vente au bien : celle du SQL si fournie, sinon Haversine. */
function distanceOf(ref: ScoringReference, sale: ScorableSale): number | null {
  if (sale.distanceM != null && Number.isFinite(sale.distanceM)) {
    return Math.max(0, sale.distanceM);
  }
  if (
    sale.latitude == null ||
    sale.longitude == null ||
    !Number.isFinite(sale.latitude) ||
    !Number.isFinite(sale.longitude)
  ) {
    return null;
  }
  const a: LatLon = { latitude: ref.latitude, longitude: ref.longitude };
  const b: LatLon = { latitude: sale.latitude, longitude: sale.longitude };
  return haversineMeters(a, b);
}

/**
 * Note une vente DVF comme comparable du bien de référence.
 *
 * Part de 100 et retranche des pénalités indépendantes. Le score n'est pas une
 * probabilité ni un prix : c'est un rang de pertinence, destiné à trier et à
 * couper. Les pénalités sont rendues avec lui pour que le choix reste
 * explicable — un comparable écarté doit pouvoir dire pourquoi.
 */
export function scoreComparable(
  ref: ScoringReference,
  sale: ScorableSale,
  opts?: { now?: Date }
): ComparableScore {
  const penalties: ComparablePenalty[] = [];
  const distanceM = distanceOf(ref, sale);
  const ageMonths = saleAgeMonths(sale.soldOn, opts?.now);

  // ── Distance ────────────────────────────────────────────────────────────
  if (distanceM == null) {
    penalties.push({
      code: "DISTANCE",
      label: "Distance inconnue",
      points: PENALTY_WEIGHTS.DISTANCE,
    });
  } else if (distanceM > FREE_DISTANCE_M) {
    const span = MAX_DISTANCE_PENALTY_M - FREE_DISTANCE_M;
    const ratio = clamp((distanceM - FREE_DISTANCE_M) / span, 0, 1);
    const points = round1(ratio * PENALTY_WEIGHTS.DISTANCE);
    if (points > 0) {
      penalties.push({
        code: "DISTANCE",
        label: `À ${Math.round(distanceM)} m du bien`,
        points,
      });
    }
  }

  // ── Surface ─────────────────────────────────────────────────────────────
  // Écart relatif : 10 m² séparant deux studios ne pèsent pas comme 10 m²
  // séparant deux maisons de 200 m².
  if (ref.surfaceM2 > 0 && sale.builtAreaM2 > 0) {
    const gap = Math.abs(sale.builtAreaM2 - ref.surfaceM2) / ref.surfaceM2;
    const points = round1(Math.min(PENALTY_WEIGHTS.SURFACE, gap * 100));
    if (points > 0) {
      penalties.push({
        code: "SURFACE",
        label: `${sale.builtAreaM2} m² contre ${Math.round(ref.surfaceM2)} m²`,
        points,
      });
    }
  }

  // ── Ancienneté de la vente ──────────────────────────────────────────────
  // Le marché bouge : une vente de 2022 s'est formée à un autre point du cycle
  // de taux, donc à un autre prix, sans que le bien ait changé.
  if (ageMonths > FREE_AGE_MONTHS) {
    const points = round1(
      Math.min(PENALTY_WEIGHTS.ANCIENNETE, (ageMonths - FREE_AGE_MONTHS) * 1.5)
    );
    if (points > 0) {
      penalties.push({
        code: "ANCIENNETE",
        label: `Vendu il y a ${ageMonths} mois`,
        points,
      });
    }
  }

  // ── Nombre de pièces ────────────────────────────────────────────────────
  // À surface égale, un T2 et un T3 ne s'adressent pas au même acheteur.
  if (ref.rooms != null && ref.rooms > 0 && sale.rooms != null && sale.rooms > 0) {
    const gap = Math.abs(sale.rooms - ref.rooms);
    const points = round1(Math.min(PENALTY_WEIGHTS.PIECES, gap * 5));
    if (points > 0) {
      penalties.push({
        code: "PIECES",
        label: `${sale.rooms} pièces contre ${ref.rooms}`,
        points,
      });
    }
  }

  // ── Commune ─────────────────────────────────────────────────────────────
  // Une limite communale est souvent une limite de marché : carte scolaire,
  // taux de taxe foncière et réputation changent d'un côté à l'autre.
  if (ref.inseeCode && sale.inseeCode && ref.inseeCode !== sale.inseeCode) {
    penalties.push({
      code: "COMMUNE",
      label: "Commune différente",
      points: PENALTY_WEIGHTS.COMMUNE,
    });
  }

  // ── Terrain (maisons seulement) ─────────────────────────────────────────
  // Le terrain fait une part du prix d'une maison ; pour un appartement, la
  // surface de terrain de la mutation ne décrit rien d'attribuable au lot.
  if (
    ref.propertyType === "MAISON" &&
    ref.landAreaM2 != null &&
    ref.landAreaM2 > 0 &&
    sale.landAreaM2 != null &&
    sale.landAreaM2 > 0
  ) {
    const gap = Math.abs(sale.landAreaM2 - ref.landAreaM2) / ref.landAreaM2;
    const points = round1(Math.min(PENALTY_WEIGHTS.TERRAIN, gap * 20));
    if (points > 0) {
      penalties.push({
        code: "TERRAIN",
        label: `Terrain de ${sale.landAreaM2} m² contre ${ref.landAreaM2} m²`,
        points,
      });
    }
  }

  const deducted = penalties.reduce((sum, p) => sum + p.points, 0);
  return {
    score: round1(clamp(100 - deducted, 0, 100)),
    penalties,
    distanceM: distanceM == null ? null : Math.round(distanceM),
    ageMonths,
  };
}

/**
 * Note puis retient les meilleurs comparables.
 *
 * Le tri secondaire par distance rend l'ordre déterministe : deux ventes de
 * même score sortiraient sinon dans l'ordre de la base, et un même appel
 * pourrait produire deux échantillons différents.
 */
export function selectComparables<T extends ScorableSale>(
  ref: ScoringReference,
  sales: T[],
  opts?: { minScore?: number; limit?: number; now?: Date }
): ScoredComparable<T>[] {
  const minScore = opts?.minScore ?? MIN_COMPARABLE_SCORE;
  const scored = sales
    .map((sale) => ({ sale, score: scoreComparable(ref, sale, { now: opts?.now }) }))
    .filter((s) => s.score.score > minScore)
    .sort((a, b) => {
      if (b.score.score !== a.score.score) return b.score.score - a.score.score;
      // Distance inconnue en dernier : à score égal, une vente qu'on sait
      // placer vaut mieux qu'une vente qu'on ne sait pas placer.
      const da = a.score.distanceM ?? Number.POSITIVE_INFINITY;
      const db = b.score.distanceM ?? Number.POSITIVE_INFINITY;
      return da - db;
    });

  return opts?.limit != null ? scored.slice(0, opts.limit) : scored;
}
