/**
 * Estimation immobilière par comparaison, à partir du référentiel DVF.
 *
 * **Outil consultatif.** Ce service ne modifie aucun actif et n'écrit nulle
 * part : le patrimoine net continue de reposer sur les valeurs saisies et sur
 * le principe « transactions = source de vérité ». Une médiane statistique sur
 * quelques dizaines de ventes n'a pas à faire bouger un patrimoine sans acte
 * réel.
 *
 * La recherche procède en deux temps (cf. `geo.ts`) : boîte englobante servie
 * par l'index, puis distance réelle sur le résidu.
 *
 * ## Orchestration à deux paliers
 *
 * `estimateProperty` essaie, dans l'ordre, jusqu'au premier succès :
 *
 * 1. **DVF local** (`STRICT_RADIUS_STEPS_M`, ≤ 2 km) — le marché immédiat.
 * 2. **DVF élargi** (`WIDE_RADIUS_STEPS_M`, jusqu'à 10 km) — même méthode,
 *    rayon plus large, seulement si le local n'a pas atteint `MIN_COMPARABLES`.
 *
 * Sous `MIN_COMPARABLES` au rayon le plus large, aucun montant n'est renvoyé
 * (`estimateEur: null`, `source: "INDISPONIBLE"`) : jamais un chiffre de
 * complaisance, mieux vaut le dire que l'inventer. Il n'y a plus de repli
 * au-delà de DVF (l'ancien repli par médiane ADEME a été retiré — décision
 * produit : DVF seul, plus simple à expliquer et à auditer).
 *
 * `source` (`EstimateSource`) indique lequel a produit le résultat — c'est ce
 * que l'UI affiche (« DVF local » / « DVF élargi » / « indisponible »).
 *
 * ## Ajustement DPE
 *
 * Une fois l'estimation DVF obtenue, un coefficient simple selon la classe
 * DPE du bien (`dpePriceCoefficient`) donne `adjustedEstimateEur` — une
 * « valeur verte » approximative, pas une nouvelle source de données : le
 * prix brut (`estimateEur`) reste la médiane DVF, l'ajustement est appliqué
 * à côté et exposé séparément (`dpeClass`, `dpeCoefficient`).
 *
 * ## Limites connues
 *
 * - **Alsace-Moselle et Mayotte** : DVF n'y couvre rien (livre foncier, régime
 *   de publicité foncière distinct — voir `isDvfCoveredDepartment` plus bas).
 *   Sans repli, l'estimation y est simplement indisponible.
 * - **Secteurs ruraux** : une commune à faible activité notariale peut ne
 *   jamais atteindre `MIN_COMPARABLES`, même à 10 km — l'estimation est alors
 *   indisponible plutôt qu'approximée.
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { d, toFixed } from "../money/decimal";
import { boundingBox, isValidLatLon, type LatLon } from "./geo";
import {
  estimateConfidence,
  priceDistribution,
  type EstimateConfidence,
  type PriceDistribution,
} from "./stats";
import {
  MIN_COMPARABLE_SCORE,
  selectComparables,
  type ComparablePenalty,
  type ScoringReference,
} from "./dvf-scorer";
import {
  applyAdjustments,
  type AdjustmentResult,
  type AdjustmentSubject,
} from "./valuation-adjustments";
import type { PropertyType } from "./dvf-aggregate";

/**
 * Coefficient de décote/surcote DPE — « valeur verte » simplifiée.
 *
 * Barème volontairement grossier et assumé comme tel : une seule table, un
 * facteur unique par classe, appliqué au prix DVF déjà estimé. Remplace le
 * repli ADEME (retiré) — ce n'est pas une source de comparables
 * supplémentaire, seulement une correction de lecture sur le chiffre DVF.
 */
export const DPE_PRICE_COEFFICIENTS: Record<string, number> = {
  A: 1.1,
  B: 1.06,
  C: 1.02,
  D: 1.0,
  E: 0.93,
  F: 0.85,
  G: 0.78,
};

/** 1.00 (aucun ajustement) pour une classe DPE absente ou non reconnue. */
export function dpePriceCoefficient(
  dpeClass: string | null | undefined
): number {
  if (!dpeClass) return 1;
  return DPE_PRICE_COEFFICIENTS[dpeClass.trim().toUpperCase()] ?? 1;
}

/**
 * Paliers d'élargissement DVF, en mètres — deux groupes.
 *
 * On commence serré pour rester dans le même marché, et on n'élargit que par
 * nécessité. `STRICT` reste dans le quartier ; `WIDE` sort du quartier mais
 * reste dans un bassin cohérent. Le rayon finalement retenu est renvoyé :
 * c'est une information de fiabilité pour l'utilisateur, pas un détail
 * d'implémentation. Une estimation trouvée à 10 km ne se lit pas comme une
 * estimation trouvée à 500 m — d'où `classifyRadiusSource`, qui traduit le
 * rayon retenu en étiquette affichable (« DVF local » / « DVF élargi »).
 */
export const STRICT_RADIUS_STEPS_M = [1000, 2000] as const;
export const WIDE_RADIUS_STEPS_M = [5000, 10000] as const;
export const RADIUS_STEPS_M = [
  ...STRICT_RADIUS_STEPS_M,
  ...WIDE_RADIUS_STEPS_M,
] as const;

const MAX_STRICT_RADIUS_M =
  STRICT_RADIUS_STEPS_M[STRICT_RADIUS_STEPS_M.length - 1];

/**
 * Palier ayant produit l'estimation — orchestration à deux niveaux :
 * DVF strict → DVF élargi → indisponible. Le second n'est tenté que si le
 * premier a échoué.
 */
export type EstimateSource = "DVF_LOCAL" | "DVF_ELARGI" | "INDISPONIBLE";

/** Classe un rayon DVF retenu en palier « local » ou « élargi ». */
export function classifyRadiusSource(
  radiusM: number
): Extract<EstimateSource, "DVF_LOCAL" | "DVF_ELARGI"> {
  return radiusM <= MAX_STRICT_RADIUS_M ? "DVF_LOCAL" : "DVF_ELARGI";
}

/** En dessous, la médiane n'est pas assez stable pour être affichée. */
export const MIN_COMPARABLES = 15;

/**
 * Tolérance de surface, en proportion.
 *
 * Le prix au m² décroît nettement avec la surface : comparer un studio de
 * 25 m² à une maison de 200 m² produirait un chiffre sans rapport avec l'un ni
 * l'autre. ±30 % garde un voisinage de gabarit tout en laissant assez de
 * comparables dans un secteur peu dense.
 */
export const SURFACE_TOLERANCE = 0.3;

/** Fenêtre temporelle par défaut, en mois. */
export const DEFAULT_MONTHS_BACK = 24;

/**
 * Plafond de comparables ramenés de la base.
 *
 * Les quantiles sont calculés en TypeScript plutôt qu'en SQL, pour rester
 * testables sans base et indépendants du dialecte. Cela suppose de rapatrier
 * les lignes : le plafond borne la mémoire, et les plus proches étant retenues
 * en premier, le tronquage ne retire que les ventes les moins pertinentes.
 */
const MAX_COMPARABLES = 500;

export type EstimateInput = {
  propertyType: PropertyType;
  surfaceM2: number;
  rooms?: number | null;
  latitude: number;
  longitude: number;
  /** Force un rayon unique au lieu de l'élargissement progressif. */
  radiusM?: number | null;
  monthsBack?: number | null;
  /** Commune du bien — sert à pénaliser les comparables hors commune. */
  inseeCode?: string | null;
  /** Terrain du bien — comparé entre maisons seulement. */
  landAreaM2?: number | null;
  /**
   * Caractéristiques du bien (DPE, étage, vue…). Fournies, elles déclenchent
   * l'ajustement du prix au m² ; absentes, l'affinage se limite au tri des
   * comparables. Dans les deux cas `estimateEur` reste la médiane DVF brute.
   */
  subject?: AdjustmentSubject | null;
};

export type Comparable = {
  mutationId: string;
  soldOn: string;
  valueEur: string;
  builtAreaM2: number;
  rooms: number;
  pricePerM2: string;
  communeName: string;
  distanceM: number;
};

/** Comparable retenu par le scorer, avec sa note et le détail des pénalités. */
export type ScoredSample = Comparable & {
  score: number;
  penalties: ComparablePenalty[];
};

/**
 * En dessous, le sous-ensemble noté est trop maigre pour porter une médiane —
 * on retombe alors sur le jeu complet plutôt que sur trois ventes bien notées.
 */
export const MIN_REFINED_COMPARABLES = 8;

/**
 * Couche d'affinage, ajoutée à l'estimation brute sans la remplacer.
 *
 * `estimateEur` du résultat principal reste la médiane DVF sur tous les
 * comparables du rayon : c'est le chiffre historique, celui qui a déjà été
 * stocké et historisé. L'affinage vit à côté, avec sa propre base et son propre
 * montant, pour que la comparaison entre les deux reste possible.
 */
export type EstimateRefinement = {
  /** Comparables retenus après notation (score strictement supérieur au seuil). */
  comparableCount: number;
  minScore: number;
  /** Distribution du prix au m² sur le seul sous-ensemble retenu. */
  distribution: PriceDistribution | null;
  /** Jeu ayant servi de base : sous-ensemble noté, ou jeu complet par repli. */
  basis: "REFINED" | "RAW";
  /** Prix au m² retenu avant ajustement. */
  basePricePerM2: string | null;
  /** null quand les caractéristiques du bien n'ont pas été fournies. */
  adjustment: AdjustmentResult | null;
  /** Valeur du bien entier après affinage et ajustement. */
  estimateEur: string | null;
  /** Meilleurs comparables notés — de quoi justifier le chiffre ligne à ligne. */
  samples: ScoredSample[];
};

export type EstimateResult = {
  /** null si les comparables manquent — jamais un chiffre de complaisance. */
  estimateEur: string | null;
  distribution: PriceDistribution | null;
  comparableCount: number;
  /** Rayon auquel les comparables ont finalement été trouvés. */
  radiusUsedM: number;
  monthsUsed: number;
  confidence: EstimateConfidence;
  insufficientData: boolean;
  /** Quelques ventes les plus proches, pour que l'utilisateur juge sur pièces. */
  samples: Comparable[];
  /** null quand l'effectif ne permet même pas une estimation brute. */
  refinement: EstimateRefinement | null;
  /** Palier ayant produit `estimateEur` — voir `EstimateSource`. */
  source: EstimateSource;
  /** Classe DPE utilisée pour l'ajustement — celle du bien, ou `null`. */
  dpeClass: string | null;
  /** Coefficient appliqué (voir `DPE_PRICE_COEFFICIENTS`) — 1 si `dpeClass` est `null`. */
  dpeCoefficient: number;
  /** `estimateEur × dpeCoefficient` — `null` quand `estimateEur` l'est aussi. */
  adjustedEstimateEur: string | null;
};

type ComparableRow = {
  mutationId: string;
  soldOn: Date;
  valueEur: Prisma.Decimal;
  builtAreaM2: number;
  rooms: number;
  pricePerM2: Prisma.Decimal;
  communeName: string;
  inseeCode: string;
  landAreaM2: number | null;
  distance_m: number;
};

/**
 * Ventes comparables dans un rayon, triées par proximité.
 *
 * Requête brute : Prisma ne sait pas exprimer le Haversine. Toutes les valeurs
 * passent par des paramètres liés — jamais d'interpolation de chaîne, y compris
 * pour des nombres déjà validés.
 */
export async function findComparables(
  center: LatLon,
  input: {
    propertyType: PropertyType;
    surfaceM2: number;
    rooms?: number | null;
    radiusM: number;
    since: Date;
  }
): Promise<ComparableRow[]> {
  const box = boundingBox(center, input.radiusM);
  const minSurface = Math.floor(input.surfaceM2 * (1 - SURFACE_TOLERANCE));
  const maxSurface = Math.ceil(input.surfaceM2 * (1 + SURFACE_TOLERANCE));

  // Le filtre sur les pièces reste optionnel : l'imposer sur un secteur peu
  // dense ferait chuter l'effectif sous le seuil pour un gain de comparabilité
  // marginal une fois la surface déjà contrainte.
  const roomsFilter =
    input.rooms != null && input.rooms > 0
      ? Prisma.sql`AND "rooms" BETWEEN ${input.rooms - 1} AND ${input.rooms + 1}`
      : Prisma.empty;

  return prisma.$queryRaw<ComparableRow[]>`
    SELECT
      "mutationId",
      "soldOn",
      "valueEur",
      "builtAreaM2",
      "rooms",
      "pricePerM2",
      "communeName",
      "inseeCode",
      "landAreaM2",
      (2 * 6371008.8 * asin(sqrt(
        power(sin(radians(${center.latitude} - "latitude") / 2), 2) +
        cos(radians("latitude")) * cos(radians(${center.latitude})) *
        power(sin(radians(${center.longitude} - "longitude") / 2), 2)
      ))) AS distance_m
    FROM "DvfSale"
    WHERE "propertyType" = ${input.propertyType}
      AND "latitude" BETWEEN ${box.minLat} AND ${box.maxLat}
      AND "longitude" BETWEEN ${box.minLon} AND ${box.maxLon}
      AND "soldOn" >= ${input.since}
      AND "builtAreaM2" BETWEEN ${minSurface} AND ${maxSurface}
      ${roomsFilter}
      AND (2 * 6371008.8 * asin(sqrt(
        power(sin(radians(${center.latitude} - "latitude") / 2), 2) +
        cos(radians("latitude")) * cos(radians(${center.latitude})) *
        power(sin(radians(${center.longitude} - "longitude") / 2), 2)
      ))) <= ${input.radiusM}
    ORDER BY distance_m ASC
    LIMIT ${MAX_COMPARABLES}
  `;
}

function toComparable(row: ComparableRow): Comparable {
  return {
    mutationId: row.mutationId,
    soldOn: row.soldOn.toISOString(),
    valueEur: row.valueEur.toString(),
    builtAreaM2: row.builtAreaM2,
    rooms: row.rooms,
    pricePerM2: row.pricePerM2.toString(),
    communeName: row.communeName,
    distanceM: Math.round(row.distance_m),
  };
}

/**
 * Construit la couche d'affinage à partir des comparables déjà ramenés.
 *
 * Isolée et exportée pour être testable sans base : elle ne fait que trier,
 * agréger et ajuster des lignes déjà lues.
 */
export function buildRefinement(
  input: EstimateInput,
  rows: ComparableRow[],
  rawDistribution: PriceDistribution | null,
  opts?: { now?: Date; minScore?: number }
): EstimateRefinement {
  const minScore = opts?.minScore ?? MIN_COMPARABLE_SCORE;
  const ref: ScoringReference = {
    latitude: input.latitude,
    longitude: input.longitude,
    surfaceM2: input.surfaceM2,
    rooms: input.rooms,
    propertyType: input.propertyType,
    inseeCode: input.inseeCode,
    landAreaM2: input.landAreaM2,
  };

  const scored = selectComparables(
    ref,
    rows.map((r) => ({
      row: r,
      builtAreaM2: r.builtAreaM2,
      rooms: r.rooms,
      soldOn: r.soldOn,
      inseeCode: r.inseeCode,
      landAreaM2: r.landAreaM2,
      distanceM: r.distance_m,
    })),
    { minScore, now: opts?.now }
  );

  const distribution = priceDistribution(
    scored.map((s) => s.sale.row.pricePerM2.toString())
  );

  // Repli assumé : un sous-ensemble trop maigre porterait une médiane plus
  // fragile que celle du jeu complet, malgré des comparables mieux notés.
  const useRefined =
    scored.length >= MIN_REFINED_COMPARABLES && distribution != null;
  const basis: "REFINED" | "RAW" = useRefined ? "REFINED" : "RAW";
  const basePricePerM2 = useRefined
    ? distribution!.median
    : (rawDistribution?.median ?? null);

  const adjustment =
    input.subject && basePricePerM2
      ? applyAdjustments(basePricePerM2, input.subject)
      : null;

  const finalPricePerM2 = adjustment?.adjustedPricePerM2 ?? basePricePerM2;
  const estimateEur = finalPricePerM2
    ? toFixed(d(finalPricePerM2).times(input.surfaceM2), 2)
    : null;

  return {
    comparableCount: scored.length,
    minScore,
    distribution,
    basis,
    basePricePerM2,
    adjustment,
    estimateEur,
    samples: scored.slice(0, 10).map((s) => ({
      ...toComparable(s.sale.row),
      score: s.score.score,
      penalties: s.score.penalties,
    })),
  };
}

/** Date de début de fenêtre, `months` mois avant `now`. */
export function windowStart(months: number, now = new Date()): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - months);
  return start;
}

export class EstimateInputError extends Error {}

/**
 * Estime un bien par comparaison DVF. Voir l'orchestration à deux paliers
 * documentée en tête de fichier.
 *
 * Sous `MIN_COMPARABLES` au plus large rayon, aucun montant n'est renvoyé :
 * une médiane sur trois ventes serait un chiffre habillé en estimation, et
 * l'utilisateur n'aurait aucun moyen de savoir qu'il ne vaut rien.
 */
export async function estimateProperty(
  input: EstimateInput,
  opts?: { now?: Date }
): Promise<EstimateResult> {
  const center: LatLon = {
    latitude: input.latitude,
    longitude: input.longitude,
  };
  if (!isValidLatLon(center)) {
    throw new EstimateInputError("Coordonnées invalides");
  }
  if (!Number.isFinite(input.surfaceM2) || input.surfaceM2 <= 0) {
    throw new EstimateInputError("Surface invalide");
  }

  const monthsUsed = input.monthsBack ?? DEFAULT_MONTHS_BACK;
  const since = windowStart(monthsUsed, opts?.now);

  const steps =
    input.radiusM != null && input.radiusM > 0
      ? [input.radiusM]
      : [...RADIUS_STEPS_M];

  let rows: ComparableRow[] = [];
  let radiusUsedM = steps[steps.length - 1]!;

  for (const radiusM of steps) {
    rows = await findComparables(center, {
      propertyType: input.propertyType,
      surfaceM2: input.surfaceM2,
      rooms: input.rooms,
      radiusM,
      since,
    });
    radiusUsedM = radiusM;
    if (rows.length >= MIN_COMPARABLES) break;
  }

  const distribution = priceDistribution(
    rows.map((r) => r.pricePerM2.toString())
  );
  const samples = rows.slice(0, 10).map(toComparable);

  // Le coefficient DPE s'applique quel que soit le résultat DVF : la classe
  // du bien est connue indépendamment de la recherche de comparables. Sans
  // classe, le coefficient vaut 1 (aucun ajustement) plutôt que d'être omis.
  const dpeClass = input.subject?.energyRating?.trim().toUpperCase() || null;
  const dpeCoefficient = dpePriceCoefficient(dpeClass);

  if (!distribution || rows.length < MIN_COMPARABLES) {
    // Pas d'affinage sur un jeu déjà jugé insuffisant : mieux noter trois
    // ventes n'en fait pas une estimation. Aucun repli au-delà de DVF.
    return {
      estimateEur: null,
      distribution,
      comparableCount: rows.length,
      radiusUsedM,
      monthsUsed,
      confidence: "LOW",
      insufficientData: true,
      samples,
      refinement: null,
      source: "INDISPONIBLE",
      dpeClass,
      dpeCoefficient,
      adjustedEstimateEur: null,
    };
  }

  const estimateEur = toFixed(
    d(distribution.median).times(input.surfaceM2),
    2
  );
  const adjustedEstimateEur = toFixed(d(estimateEur).times(dpeCoefficient), 2);

  return {
    estimateEur,
    distribution,
    comparableCount: rows.length,
    radiusUsedM,
    monthsUsed,
    confidence: estimateConfidence({
      count: rows.length,
      radiusM: radiusUsedM,
      median: distribution.median,
      iqr: distribution.iqr,
    }),
    insufficientData: false,
    samples,
    refinement: buildRefinement(input, rows, distribution, { now: opts?.now }),
    source: classifyRadiusSource(radiusUsedM),
    dpeClass,
    dpeCoefficient,
    adjustedEstimateEur,
  };
}

/**
 * Départements sans données DVF.
 *
 * L'Alsace-Moselle relève du livre foncier, régime de publicité foncière
 * distinct hérité du droit local, et Mayotte n'est pas couverte. Aucune vente
 * n'y sera jamais trouvée : mieux vaut le dire que laisser croire à un secteur
 * sans transactions.
 */
export const DVF_UNCOVERED_DEPARTMENTS = new Set(["57", "67", "68", "976"]);

export function isDvfCoveredDepartment(department: string): boolean {
  return !DVF_UNCOVERED_DEPARTMENTS.has(department.trim());
}
