/**
 * Valorisation d'un bien immobilier.
 *
 * Trois chemins possibles, un seul stockage : `Asset.manualPrice` porte la
 * valeur du **bien entier**, et `PriceHistory` en garde la trace datée avec sa
 * source. La courbe d'évolution d'un bien se lit donc exactement comme un cours
 * de bourse, sans modèle supplémentaire.
 *
 * 1. **DVF** — estimation par comparaison, rafraîchie périodiquement
 * 2. **Correction** — l'utilisateur ajuste l'estimation proposée
 * 3. **Valeur forcée** — estimation notaire, agence, expertise
 *
 * Règle qui prime sur tout le reste : **une valeur saisie n'est jamais
 * écrasée**. Passer en mode manuel gèle la valeur jusqu'à ce que l'utilisateur
 * décide lui-même de repasser en automatique. Une réévaluation surprise du
 * patrimoine, sans action de sa part, serait le pire défaut possible ici.
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { estimateProperty, isDvfCoveredDepartment } from "./estimate";
import { departmentFromCode, geocodeAddress } from "./geocode";
import { isDvfEstimable } from "./constants";
import type { PropertyType } from "./constants";

/** Au-delà, l'estimation DVF est considérée périmée et peut être refaite. */
export const VALUATION_REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Source enregistrée dans `PriceHistory`. */
export const VALUATION_SOURCES = {
  DVF: "dvf",
  MANUAL: "manual",
} as const;

export type ValuationOutcome =
  | { kind: "updated"; valueEur: string; source: string; comparables: number }
  | { kind: "unchanged"; reason: "fresh" | "manual-mode" | "same-value" }
  | { kind: "skipped"; reason: "not-estimable" | "not-geocoded" | "department-uncovered" }
  | { kind: "insufficient-data"; radiusM: number; comparables: number };

type PropertyRow = {
  id: string;
  manualPrice: Prisma.Decimal | null;
  realEstate: {
    propertyType: string;
    livingAreaM2: number | null;
    rooms: number | null;
    latitude: number | null;
    longitude: number | null;
    inseeCode: string | null;
    valuationMode: string;
    lastValuedAt: Date | null;
  } | null;
};

/**
 * Enregistre une valeur et l'historise.
 *
 * `manualPrice` porte la valeur du bien entier ; la position la multiplie par
 * la quote-part détenue. La ligne `PriceHistory` est ce qui rend l'évolution
 * traçable — sans elle, on ne saurait plus dire quand ni pourquoi la valeur a
 * bougé.
 */
export async function recordValuation(
  assetId: string,
  valueEur: string,
  source: string,
  opts?: { now?: Date; mode?: "DVF_AUTO" | "MANUAL"; dvf?: { estimate: string; confidence: string; comparables: number } }
): Promise<void> {
  const now = opts?.now ?? new Date();
  const value = new Prisma.Decimal(d(valueEur).toFixed(12));

  await prisma.$transaction([
    prisma.asset.update({
      where: { id: assetId },
      data: { manualPrice: value },
    }),
    prisma.priceHistory.create({
      data: { assetId, priceEur: value, source },
    }),
    prisma.realEstateDetail.update({
      where: { assetId },
      data: {
        lastValuedAt: now,
        ...(opts?.mode ? { valuationMode: opts.mode } : {}),
        ...(opts?.dvf
          ? {
              dvfEstimateEur: new Prisma.Decimal(opts.dvf.estimate),
              dvfConfidence: opts.dvf.confidence,
              dvfComparables: opts.dvf.comparables,
            }
          : {}),
      },
    }),
  ]);

  // Le cache de cotation porte le prix servi aux positions : le laisser périmé
  // ferait afficher l'ancienne valeur jusqu'au prochain rafraîchissement.
  await prisma.priceQuote.deleteMany({ where: { assetId } });
}

/**
 * Fixe une valeur choisie par l'utilisateur et bascule le bien en mode manuel.
 *
 * La bascule est automatique et voulue : accepter une correction tout en
 * laissant le mode automatique actif reviendrait à promettre que la saisie sera
 * écrasée au prochain passage.
 */
export async function setManualValuation(
  userId: string,
  assetId: string,
  valueEur: string,
  opts?: { now?: Date }
): Promise<void> {
  const owned = await prisma.asset.findFirst({
    where: { id: assetId, userId },
    select: { id: true },
  });
  if (!owned) throw new Error("Actif introuvable");
  if (d(valueEur).lte(0)) throw new Error("La valeur doit être strictement positive");

  await recordValuation(assetId, valueEur, VALUATION_SOURCES.MANUAL, {
    now: opts?.now,
    mode: "MANUAL",
  });
}

/** Complète les coordonnées d'un bien depuis son adresse, si besoin. */
export async function ensureGeocoded(
  userId: string,
  assetId: string
): Promise<{ latitude: number; longitude: number } | null> {
  const detail = await prisma.realEstateDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: {
      latitude: true,
      longitude: true,
      addressLine: true,
      postalCode: true,
      city: true,
    },
  });
  if (!detail) return null;
  if (detail.latitude != null && detail.longitude != null) {
    return { latitude: detail.latitude, longitude: detail.longitude };
  }

  const outcome = await geocodeAddress(detail);
  if (outcome.kind !== "ok") return null;

  await prisma.realEstateDetail.update({
    where: { assetId },
    data: {
      latitude: outcome.result.latitude,
      longitude: outcome.result.longitude,
      inseeCode: outcome.result.inseeCode,
      geocodedAt: new Date(),
    },
  });
  return {
    latitude: outcome.result.latitude,
    longitude: outcome.result.longitude,
  };
}

/**
 * Réévalue un bien depuis DVF.
 *
 * Ne fait rien en mode manuel — c'est l'engagement central. `force` permet à
 * l'utilisateur de demander explicitement une estimation, sans pour autant
 * l'appliquer : le résultat lui est présenté, la décision reste la sienne.
 */
export async function revalueFromDvf(
  userId: string,
  assetId: string,
  opts?: { force?: boolean; now?: Date; apply?: boolean }
): Promise<ValuationOutcome> {
  const now = opts?.now ?? new Date();
  const asset = (await prisma.asset.findFirst({
    where: { id: assetId, userId },
    select: {
      id: true,
      manualPrice: true,
      realEstate: {
        select: {
          propertyType: true,
          livingAreaM2: true,
          rooms: true,
          latitude: true,
          longitude: true,
          inseeCode: true,
          valuationMode: true,
          lastValuedAt: true,
        },
      },
    },
  })) as PropertyRow | null;

  const detail = asset?.realEstate;
  if (!asset || !detail) {
    return { kind: "skipped", reason: "not-estimable" };
  }

  if (!isDvfEstimable(detail.propertyType) || !detail.livingAreaM2) {
    // Parkings, terrains et locaux ne se valorisent pas au m² habitable.
    return { kind: "skipped", reason: "not-estimable" };
  }

  if (detail.valuationMode !== "DVF_AUTO" && !opts?.force) {
    return { kind: "unchanged", reason: "manual-mode" };
  }

  if (!opts?.force && detail.lastValuedAt) {
    const age = now.getTime() - detail.lastValuedAt.getTime();
    if (age < VALUATION_REFRESH_AFTER_MS) {
      // Un bien ne bouge pas au jour le jour et DVF paraît par millésimes :
      // réinterroger plus souvent coûterait sans rien apprendre.
      return { kind: "unchanged", reason: "fresh" };
    }
  }

  const coords = await ensureGeocoded(userId, assetId);
  if (!coords) {
    return { kind: "skipped", reason: "not-geocoded" };
  }

  const department = departmentFromCode(detail.inseeCode);
  if (department && !isDvfCoveredDepartment(department)) {
    // Alsace-Moselle et Mayotte relèvent d'un autre régime de publicité
    // foncière : aucune vente n'y sera jamais trouvée. Le dire vaut mieux que
    // laisser croire à un secteur sans transactions.
    return { kind: "skipped", reason: "department-uncovered" };
  }

  const estimate = await estimateProperty({
    propertyType: detail.propertyType as Extract<PropertyType, "MAISON" | "APPARTEMENT">,
    surfaceM2: detail.livingAreaM2,
    rooms: detail.rooms,
    latitude: coords.latitude,
    longitude: coords.longitude,
  });

  if (estimate.insufficientData || !estimate.estimateEur) {
    return {
      kind: "insufficient-data",
      radiusM: estimate.radiusUsedM,
      comparables: estimate.comparableCount,
    };
  }

  // `apply: false` sert le parcours « proposer sans imposer » du formulaire.
  if (opts?.apply === false) {
    return {
      kind: "updated",
      valueEur: estimate.estimateEur,
      source: VALUATION_SOURCES.DVF,
      comparables: estimate.comparableCount,
    };
  }

  const previous = asset.manualPrice ? d(asset.manualPrice.toString()) : null;
  if (previous && previous.minus(d(estimate.estimateEur)).abs().lt(1)) {
    // Écart inférieur à l'euro : historiser produirait une courbe bruitée de
    // points identiques sans rien apprendre.
    return { kind: "unchanged", reason: "same-value" };
  }

  await recordValuation(assetId, estimate.estimateEur, VALUATION_SOURCES.DVF, {
    now,
    dvf: {
      estimate: estimate.estimateEur,
      confidence: estimate.confidence,
      comparables: estimate.comparableCount,
    },
  });

  return {
    kind: "updated",
    valueEur: estimate.estimateEur,
    source: VALUATION_SOURCES.DVF,
    comparables: estimate.comparableCount,
  };
}

/**
 * Réévalue tous les biens d'un utilisateur en mode automatique.
 *
 * Best effort : l'échec d'un bien n'empêche pas les autres. Une valorisation
 * est un enrichissement de l'affichage, jamais une donnée comptable.
 */
export async function revalueAllProperties(
  userId: string,
  opts?: { now?: Date }
): Promise<{ updated: number; unchanged: number; skipped: number; failed: number }> {
  const properties = await prisma.realEstateDetail.findMany({
    where: { valuationMode: "DVF_AUTO", asset: { is: { userId } } },
    select: { assetId: true },
  });

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of properties) {
    try {
      const out = await revalueFromDvf(userId, p.assetId, { now: opts?.now });
      if (out.kind === "updated") updated++;
      else if (out.kind === "unchanged") unchanged++;
      else skipped++;
    } catch (e) {
      failed++;
      console.error(`[real-estate] réévaluation impossible pour ${p.assetId}:`, e);
    }
  }

  return { updated, unchanged, skipped, failed };
}

/** Historique de valorisation d'un bien, du plus ancien au plus récent. */
export async function getValuationHistory(
  userId: string,
  assetId: string
): Promise<Array<{ date: string; valueEur: string; source: string }>> {
  const rows = await prisma.priceHistory.findMany({
    where: { assetId, asset: { is: { userId } } },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, priceEur: true, source: true },
  });
  return rows.map((r) => ({
    date: r.capturedAt.toISOString(),
    valueEur: r.priceEur.toString(),
    source: r.source,
  }));
}
