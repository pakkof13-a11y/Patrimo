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
import {
  estimateProperty,
  isDvfCoveredDepartment,
  type EstimateRefinement,
  type EstimateSource,
} from "./estimate";
import { departmentFromCode, geocodeAddress } from "./geocode";
import { isDvfEstimable } from "./constants";
import type { PropertyType } from "./constants";
import type { AdjustmentSubject } from "./valuation-adjustments";

/** Au-delà, l'estimation DVF est considérée périmée et peut être refaite. */
export const VALUATION_REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Source enregistrée dans `PriceHistory`. */
export const VALUATION_SOURCES = {
  DVF: "dvf",
  MANUAL: "manual",
} as const;

export type ValuationOutcome =
  | {
      kind: "updated";
      valueEur: string;
      source: string;
      comparables: number;
      /** Estimation brute DVF, présente même quand la valeur retenue est ajustée. */
      rawEstimateEur?: string;
      /** Détail du scoring et des ajustements — consultatif, toujours renvoyé. */
      refinement?: EstimateRefinement | null;
      /** Palier ayant produit l'estimation — DVF local ou élargi. */
      estimateSource: EstimateSource;
      /** Classe DPE utilisée pour l'ajustement — celle du bien, ou `null`. */
      dpeClass: string | null;
      /** Coefficient appliqué au prix DVF brut selon la classe DPE — 1 si `dpeClass` est `null`. */
      dpeCoefficient: number;
      /** `rawEstimateEur × dpeCoefficient`. */
      adjustedEstimateEur?: string;
    }
  | { kind: "unchanged"; reason: "fresh" | "manual-mode" | "same-value" }
  | { kind: "skipped"; reason: "not-estimable" | "not-geocoded" }
  | {
      kind: "insufficient-data";
      radiusM: number;
      comparables: number;
      /** true si le département n'est de toute façon pas couvert par DVF. */
      departmentUncovered: boolean;
    };

/** Champs de `RealEstateDetail` lus pour estimer et ajuster. */
const VALUATION_DETAIL_SELECT = {
  propertyType: true,
  livingAreaM2: true,
  landAreaM2: true,
  rooms: true,
  latitude: true,
  longitude: true,
  inseeCode: true,
  valuationMode: true,
  lastValuedAt: true,
  // Caractéristiques servant aux ajustements — toutes nullables en base.
  energyRating: true,
  gesRating: true,
  orientation: true,
  viewType: true,
  windowQuality: true,
  floor: true,
  totalFloors: true,
  hasElevator: true,
  hasBalcony: true,
  balconyAreaM2: true,
  hasGarden: true,
  gardenAreaM2: true,
  hasCellar: true,
  parkingSpots: true,
  isCopropriete: true,
  annualCoproChargesEur: true,
} as const;

type ValuationDetail = {
  propertyType: string;
  livingAreaM2: number | null;
  landAreaM2: number | null;
  rooms: number | null;
  latitude: number | null;
  longitude: number | null;
  inseeCode: string | null;
  valuationMode: string;
  lastValuedAt: Date | null;
  energyRating: string | null;
  gesRating: string | null;
  orientation: string | null;
  viewType: string | null;
  windowQuality: string | null;
  floor: number | null;
  totalFloors: number | null;
  hasElevator: boolean | null;
  hasBalcony: boolean | null;
  balconyAreaM2: number | null;
  hasGarden: boolean | null;
  gardenAreaM2: number | null;
  hasCellar: boolean | null;
  parkingSpots: number | null;
  isCopropriete: boolean | null;
  annualCoproChargesEur: Prisma.Decimal | null;
};

type PropertyRow = {
  id: string;
  manualPrice: Prisma.Decimal | null;
  realEstate: ValuationDetail | null;
};

/** Projette la ligne de base sur ce qu'attend le moteur d'ajustement. */
function toAdjustmentSubject(detail: ValuationDetail): AdjustmentSubject {
  return {
    propertyType: detail.propertyType,
    livingAreaM2: detail.livingAreaM2,
    energyRating: detail.energyRating,
    gesRating: detail.gesRating,
    orientation: detail.orientation,
    viewType: detail.viewType,
    windowQuality: detail.windowQuality,
    floor: detail.floor,
    totalFloors: detail.totalFloors,
    hasElevator: detail.hasElevator,
    hasBalcony: detail.hasBalcony,
    balconyAreaM2: detail.balconyAreaM2,
    hasGarden: detail.hasGarden,
    gardenAreaM2: detail.gardenAreaM2,
    hasCellar: detail.hasCellar,
    parkingSpots: detail.parkingSpots,
    isCopropriete: detail.isCopropriete,
    annualCoproChargesEur: detail.annualCoproChargesEur?.toString() ?? null,
  };
}

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
  opts?: {
    now?: Date;
    mode?: "DVF_AUTO" | "MANUAL";
    dvf?: {
      estimate: string;
      confidence: string;
      comparables: number;
      /** Palier ayant produit l'estimation — persisté dans `dvfSource`. */
      source?: EstimateSource;
    };
  }
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
              ...(opts.dvf.source ? { dvfSource: opts.dvf.source } : {}),
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
  opts?: { force?: boolean; now?: Date; apply?: boolean; adjust?: boolean }
): Promise<ValuationOutcome> {
  const now = opts?.now ?? new Date();
  const asset = (await prisma.asset.findFirst({
    where: { id: assetId, userId },
    select: {
      id: true,
      manualPrice: true,
      realEstate: { select: VALUATION_DETAIL_SELECT },
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

  // Alsace-Moselle et Mayotte relèvent d'un autre régime de publicité
  // foncière : DVF n'y trouvera jamais rien, et il n'y a plus de repli
  // au-delà de DVF. `departmentUncovered` sert uniquement à préciser le
  // message rendu à l'utilisateur si l'estimation échoue.
  const department = departmentFromCode(detail.inseeCode);
  const departmentUncovered = department
    ? !isDvfCoveredDepartment(department)
    : false;

  const estimate = await estimateProperty(
    {
      propertyType: detail.propertyType as Extract<PropertyType, "MAISON" | "APPARTEMENT">,
      surfaceM2: detail.livingAreaM2,
      rooms: detail.rooms,
      latitude: coords.latitude,
      longitude: coords.longitude,
      inseeCode: detail.inseeCode,
      landAreaM2: detail.landAreaM2,
      subject: toAdjustmentSubject(detail),
    },
    { now }
  );

  if (estimate.insufficientData || !estimate.estimateEur) {
    return {
      kind: "insufficient-data",
      radiusM: estimate.radiusUsedM,
      comparables: estimate.comparableCount,
      departmentUncovered,
    };
  }

  /**
   * Valeur retenue.
   *
   * L'ajustement DPE n'est appliqué que sur demande explicite (`adjust`). Le
   * rendre automatique ferait bouger, au prochain rafraîchissement, le
   * patrimoine de tous les biens déjà valorisés — sans action de
   * l'utilisateur. Le chiffre ajusté est donc calculé et renvoyé
   * systématiquement, mais stocké seulement s'il a été demandé.
   */
  const retained =
    opts?.adjust && estimate.adjustedEstimateEur
      ? estimate.adjustedEstimateEur
      : estimate.estimateEur;

  // `apply: false` sert le parcours « proposer sans imposer » du formulaire.
  if (opts?.apply === false) {
    return {
      kind: "updated",
      valueEur: retained,
      source: VALUATION_SOURCES.DVF,
      comparables: estimate.comparableCount,
      rawEstimateEur: estimate.estimateEur,
      refinement: estimate.refinement,
      estimateSource: estimate.source,
      dpeClass: estimate.dpeClass,
      dpeCoefficient: estimate.dpeCoefficient,
      adjustedEstimateEur: estimate.adjustedEstimateEur ?? undefined,
    };
  }

  const previous = asset.manualPrice ? d(asset.manualPrice.toString()) : null;
  if (previous && previous.minus(d(retained)).abs().lt(1)) {
    // Écart inférieur à l'euro : historiser produirait une courbe bruitée de
    // points identiques sans rien apprendre.
    return { kind: "unchanged", reason: "same-value" };
  }

  await recordValuation(assetId, retained, VALUATION_SOURCES.DVF, {
    now,
    dvf: {
      // `dvfEstimateEur` garde l'estimation brute même quand la valeur retenue
      // est ajustée : c'est le repère de marché, il doit rester comparable
      // d'un bien à l'autre.
      estimate: estimate.estimateEur,
      confidence: estimate.confidence,
      comparables: estimate.comparableCount,
      source: estimate.source,
    },
  });

  return {
    kind: "updated",
    valueEur: retained,
    source: VALUATION_SOURCES.DVF,
    comparables: estimate.comparableCount,
    rawEstimateEur: estimate.estimateEur,
    refinement: estimate.refinement,
    estimateSource: estimate.source,
    dpeClass: estimate.dpeClass,
    dpeCoefficient: estimate.dpeCoefficient,
    adjustedEstimateEur: estimate.adjustedEstimateEur ?? undefined,
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
