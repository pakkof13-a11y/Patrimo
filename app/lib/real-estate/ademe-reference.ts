/**
 * Repli grossier d'estimation par médiane commune × DPE.
 *
 * Dernier maillon de l'orchestration DVF strict → DVF élargi → ce repli →
 * indisponible (`estimate.ts`) : quand même le rayon le plus large ne trouve
 * pas assez de ventes DVF (secteur rural, faible activité notariale), une
 * médiane de prix au m² par commune et classe DPE reste une indication —
 * moins précise qu'une comparaison de ventes réelles, mais moins arbitraire
 * qu'un chiffre laissé à zéro.
 *
 * **La table `AdemeCommuneDpeMedian` est créée vide par sa migration.** Aucun
 * import n'est fourni avec ce chantier : sans lignes, `findAdemeReference`
 * rend systématiquement `null`, et l'orchestration retombe sur
 * `INDISPONIBLE` — c'est le comportement correct, pas un bug. Peupler la
 * table est un chantier à part, du même type que `scripts/import-dvf-stream.mjs`
 * pour DVF.
 *
 * Découpage en deux fonctions, comme `geocode.ts` et `georisques.ts` :
 * `findAdemeReference` fait la lecture (impure, Prisma), `estimateFromAdemeReference`
 * fait le calcul (pur, testable sans base).
 */

import { prisma } from "../prisma";
import { d, toFixed } from "../money/decimal";

/** Sentinelle « toutes classes confondues » — jamais `null` (voir modèle Prisma). */
export const ADEME_ALL_ENERGY_RATINGS = "ALL";

export type AdemeReferenceRow = {
  medianPricePerM2: string;
  sampleSize: number;
  /**
   * COMMUNE_DPE : la classe DPE du bien avait sa propre ligne.
   * COMMUNE : repli plus grossier encore, toutes classes confondues.
   */
  scope: "COMMUNE_DPE" | "COMMUNE";
};

/**
 * Cherche une médiane de référence pour une commune, si possible ciblée sur
 * la classe DPE du bien.
 *
 * Deux lectures plutôt qu'une requête combinée : la ligne exacte
 * (commune + DPE) est tentée d'abord, la ligne « toutes classes » seulement
 * si elle manque — la seconde ne doit jamais masquer la première quand les
 * deux existent.
 */
export async function findAdemeReference(
  inseeCode: string | null | undefined,
  energyRating: string | null | undefined
): Promise<AdemeReferenceRow | null> {
  const commune = inseeCode?.trim();
  if (!commune) return null;

  const rating = energyRating?.trim().toUpperCase();
  if (rating && rating !== ADEME_ALL_ENERGY_RATINGS) {
    const exact = await prisma.ademeCommuneDpeMedian.findUnique({
      where: { inseeCode_energyRating: { inseeCode: commune, energyRating: rating } },
    });
    if (exact) {
      return {
        medianPricePerM2: exact.medianPricePerM2.toString(),
        sampleSize: exact.sampleSize,
        scope: "COMMUNE_DPE",
      };
    }
  }

  const coarse = await prisma.ademeCommuneDpeMedian.findUnique({
    where: {
      inseeCode_energyRating: {
        inseeCode: commune,
        energyRating: ADEME_ALL_ENERGY_RATINGS,
      },
    },
  });
  if (!coarse) return null;
  return {
    medianPricePerM2: coarse.medianPricePerM2.toString(),
    sampleSize: coarse.sampleSize,
    scope: "COMMUNE",
  };
}

export type AdemeEstimate = {
  estimateEur: string;
  medianPricePerM2: string;
  sampleSize: number;
  scope: AdemeReferenceRow["scope"];
};

/**
 * Calcule l'estimation à partir d'une ligne de référence déjà lue.
 *
 * Séparée de `findAdemeReference` pour être testée sans base : le calcul
 * (surface × médiane) n'a besoin d'aucune donnée qu'un test ne puisse fournir
 * lui-même.
 */
export function estimateFromAdemeReference(
  surfaceM2: number,
  ref: AdemeReferenceRow | null
): AdemeEstimate | null {
  if (!ref) return null;
  if (!Number.isFinite(surfaceM2) || surfaceM2 <= 0) return null;

  return {
    estimateEur: toFixed(d(ref.medianPricePerM2).times(surfaceM2), 2),
    medianPricePerM2: ref.medianPricePerM2,
    sampleSize: ref.sampleSize,
    scope: ref.scope,
  };
}
