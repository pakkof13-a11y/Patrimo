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
import type { PropertyType } from "./dvf-aggregate";

/**
 * Paliers d'élargissement, en mètres.
 *
 * On commence serré pour rester dans le même marché, et on n'élargit que par
 * nécessité. Le rayon finalement retenu est renvoyé : c'est une information de
 * fiabilité pour l'utilisateur, pas un détail d'implémentation. Une estimation
 * trouvée à 10 km ne se lit pas comme une estimation trouvée à 500 m.
 */
export const RADIUS_STEPS_M = [1000, 2000, 5000, 10000] as const;

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
};

type ComparableRow = {
  mutationId: string;
  soldOn: Date;
  valueEur: Prisma.Decimal;
  builtAreaM2: number;
  rooms: number;
  pricePerM2: Prisma.Decimal;
  communeName: string;
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

/** Date de début de fenêtre, `months` mois avant `now`. */
export function windowStart(months: number, now = new Date()): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - months);
  return start;
}

export class EstimateInputError extends Error {}

/**
 * Estime un bien par comparaison avec les ventes DVF alentour.
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

  if (!distribution || rows.length < MIN_COMPARABLES) {
    return {
      estimateEur: null,
      distribution,
      comparableCount: rows.length,
      radiusUsedM,
      monthsUsed,
      confidence: "LOW",
      insufficientData: true,
      samples,
    };
  }

  const estimateEur = toFixed(
    d(distribution.median).times(input.surfaceM2),
    2
  );

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
