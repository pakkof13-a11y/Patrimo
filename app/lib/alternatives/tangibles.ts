/**
 * Actifs tangibles — objets de collection et biens meubles.
 *
 * Le module ne se contente plus d'un libellé et d'un prix : chaque ligne porte
 * sa date d'achat, son justificatif et, selon la catégorie, ce qui fait
 * réellement sa valeur — le traitement et le titre d'une pierre, la référence
 * et les papiers d'une montre, l'appellation et le format d'un vin.
 *
 * ## La fiscalité est calculée, jamais stockée
 *
 * Chaque ligne expose une simulation de cession **à la valeur estimée**, via
 * le moteur partagé de l'article 150 VI. C'est une projection : rien n'est dû
 * tant que le bien n'est pas vendu. Deux règles y sont décisives et absentes
 * de la plupart des simulateurs :
 *
 * - **En dessous de 5 000 € de prix de cession, aucun impôt** — ni forfaitaire,
 *   ni sur la plus-value. C'est le cas de la majorité d'une collection.
 * - **Les meubles meublants et les automobiles sont exonérés par nature**,
 *   sauf qualification d'objet de collection.
 *
 * Tous les montants transitent en Decimal.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import { d, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";
import {
  fiscalNature,
  isTangibleCategory,
  TANGIBLE_CATEGORY_LABELS,
  type TangibleCategory,
} from "@/app/lib/tangibles/constants";
import { computeMovableSaleTax } from "@/app/lib/tax/movable-assets";
import {
  annualCostOfOwnership,
  netCarryYield,
  ownershipAlerts,
  STORAGE_TYPES,
} from "@/app/lib/tangibles/ownership";
import type {
  TangibleAssetDto,
  TangibleAssetsSummary,
  TangibleOwnership,
  TangibleTaxPreview,
} from "./types";

export class TangibleInputError extends Error {}

function dec(value: DecimalInput | null | undefined, fallback = "0"): Prisma.Decimal {
  const raw = String(value ?? fallback).trim().replace(",", ".");
  const parsed = Number(raw);
  return new Prisma.Decimal(Number.isFinite(parsed) && raw !== "" ? raw : fallback);
}

/** Decimal optionnel : `null` reste `null`, il ne devient pas zéro. */
function optDec(value: DecimalInput | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  return dec(value);
}

function optInt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function optText(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function optBool(value: boolean | null | undefined): boolean | null {
  return value === null || value === undefined ? null : Boolean(value);
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStorageType(raw: string | undefined | null): string | null {
  const value = String(raw ?? "").toUpperCase();
  return (STORAGE_TYPES as readonly string[]).includes(value) ? value : null;
}

function normalizeCategory(raw: string | undefined | null): TangibleCategory {
  const value = String(raw ?? "OTHER").toUpperCase();
  return isTangibleCategory(value) ? value : "OTHER";
}

type Row = Prisma.TangibleAssetGetPayload<Record<string, never>>;

/**
 * Simule la cession de la ligne à sa valeur estimée.
 *
 * Le prix de revient retenu est le prix d'achat : les frais d'acquisition ne
 * sont pas saisis pour les tangibles, l'omission majore donc la plus-value —
 * elle est prudente sur l'impôt annoncé, jamais optimiste.
 */
function taxPreview(row: Row): TangibleTaxPreview {
  const nature = fiscalNature(row.category, row.isCollectible);
  const computed = computeMovableSaleTax({
    nature,
    salePriceEur: row.estimatedValue.toString(),
    costBasisEur: row.purchasePrice.toString(),
    acquiredAt: row.purchaseDate,
    soldAt: new Date(),
    // Le certificat n'est pas une facture d'achat, mais c'est le seul
    // justificatif que le module capture ; combiné à la date d'achat, il vaut
    // preuve raisonnable de l'antériorité et du prix.
    hasInvoice: row.purchaseDate !== null && row.hasCertificate,
  });

  const chosen =
    computed.recommended === "FORFAIT" ? computed.flat : computed.capitalGain;

  return {
    holdingYears: row.purchaseDate ? computed.holdingYears : null,
    exempt: computed.exempt,
    exemptionReason: computed.exemptionReason,
    flatTaxEur: computed.flat.taxEur,
    capitalGainTaxEur: computed.capitalGain.taxEur,
    recommendedRegime: computed.recommended,
    taxDueEur: chosen.taxEur,
    netProceedsEur: chosen.netProceedsEur,
    optionAvailable: computed.capitalGain.available,
    rationale: computed.rationale,
  };
}

/**
 * Coût de détention de la ligne.
 *
 * Ce bloc ne touche jamais à `taxPreview` : les frais de garde et les primes
 * d'assurance ne sont pas déductibles de la plus-value imposable au titre de
 * l'article 150 VI. Les additionner donnerait un impôt sous-évalué.
 */
function ownershipView(row: Row, holdingYears: number | null): TangibleOwnership {
  const annualCost = annualCostOfOwnership({
    insurancePremiumAnnual: row.insurancePremiumAnnual?.toString() ?? null,
    storageCostAnnual: row.storageCostAnnual?.toString() ?? null,
  });

  const carry = netCarryYield({
    estimatedValue: row.estimatedValue.toString(),
    purchasePrice: row.purchasePrice.toString(),
    holdingYears,
    annualCost,
  });

  return {
    annualCostEur: annualCost.toFixed(2),
    totalCarryCostEur: carry.totalCarryCostEur,
    netPnlEur: carry.netPnlEur,
    netPnlPct: carry.netPnlPct,
    carryDragPct: carry.carryDragPct,
    alerts: ownershipAlerts({
      estimatedValue: row.estimatedValue.toString(),
      storageCostAnnual: row.storageCostAnnual?.toString() ?? null,
      insurancePremiumAnnual: row.insurancePremiumAnnual?.toString() ?? null,
      storageType: row.storageType,
      storageRenewalDate: row.storageRenewalDate,
      totalCarryCostEur: carry.totalCarryCostEur,
      grossPnlEur: carry.grossPnlEur,
    }),
  };
}

function mapRow(row: Row): TangibleAssetDto {
  const cost = d(row.purchasePrice.toString());
  const value = d(row.estimatedValue.toString());
  const pnl = value.minus(cost);
  const pct = cost.gt(0) ? pnl.div(cost).times(100) : d(0);
  // La durée de détention vient du calcul fiscal : une seule source pour deux
  // usages, sinon les deux blocs pourraient annoncer des durées différentes.
  const tax = taxPreview(row);

  return {
    id: row.id,
    category: normalizeCategory(row.category),
    brandOrArtist: row.brandOrArtist,
    modelName: row.modelName,
    yearOrVintage: row.yearOrVintage,
    purchasePrice: row.purchasePrice.toString(),
    estimatedValue: row.estimatedValue.toString(),
    currency: row.currency,
    hasCertificate: row.hasCertificate,
    notes: row.notes,
    unrealizedPnl: pnl.toFixed(2),
    unrealizedPnlPct: pct.toFixed(2),

    purchaseDate: row.purchaseDate?.toISOString() ?? null,
    purchaseSource: row.purchaseSource,
    certificateRef: row.certificateRef,
    certificateIssuer: row.certificateIssuer,

    appraisalValue: row.appraisalValue?.toString() ?? null,
    appraisalDate: row.appraisalDate?.toISOString() ?? null,
    insuranceValue: row.insuranceValue?.toString() ?? null,
    storageLocation: row.storageLocation,
    isCollectible: row.isCollectible,

    gemType: row.gemType,
    caratWeight: row.caratWeight?.toString() ?? null,
    gemClarity: row.gemClarity,
    gemColor: row.gemColor,
    gemCut: row.gemCut,
    gemTreatment: row.gemTreatment,
    gemOrigin: row.gemOrigin,
    jewelryType: row.jewelryType,
    metalBase: row.metalBase,
    metalWeightG: row.metalWeightG?.toString() ?? null,
    hasPunchmarks: row.hasPunchmarks,
    watchMovement: row.watchMovement,
    watchDiameterMm: row.watchDiameterMm?.toString() ?? null,
    watchReference: row.watchReference,
    watchBoxPapers: row.watchBoxPapers,
    wineAppellation: row.wineAppellation,
    wineBottleCount: row.wineBottleCount,
    wineBottleFormat: row.wineBottleFormat,
    wineStorageType: row.wineStorageType,
    autoMileageKm: row.autoMileageKm,
    autoRegistration: row.autoRegistration,
    autoInspectionOk: row.autoInspectionOk,
    autoPreviousOwners: row.autoPreviousOwners,

    insurancePremiumAnnual: row.insurancePremiumAnnual?.toString() ?? null,
    insuranceProvider: row.insuranceProvider,
    insurancePolicyRef: row.insurancePolicyRef,
    storageType: row.storageType,
    storageCostAnnual: row.storageCostAnnual?.toString() ?? null,
    storageProvider: row.storageProvider,
    storageContractRef: row.storageContractRef,
    storageRenewalDate: row.storageRenewalDate?.toISOString() ?? null,

    includeInEstate: row.includeInEstate,
    estateNote: row.estateNote,

    tax,
    ownership: ownershipView(row, tax.holdingYears),
  };
}

export function summarizeTangibles(
  lines: TangibleAssetDto[]
): TangibleAssetsSummary {
  let totalCost = d(0);
  let totalValue = d(0);
  let totalInsured = d(0);
  let taxBurden = d(0);
  let exemptCount = 0;
  let withCertificateCount = 0;
  let withAppraisalCount = 0;
  let undatedCount = 0;
  let custodyCost = d(0);
  let ownershipCost = d(0);
  let highCustodyCostCount = 0;
  let ownershipAlertCount = 0;
  let excludedFromEstate = d(0);
  const byCategory = new Map<string, Decimal>();

  for (const line of lines) {
    totalCost = totalCost.plus(line.purchasePrice);
    totalValue = totalValue.plus(line.estimatedValue);
    totalInsured = totalInsured.plus(line.insuranceValue ?? 0);
    taxBurden = taxBurden.plus(line.tax.taxDueEur);
    if (line.tax.exempt) exemptCount += 1;
    if (line.hasCertificate) withCertificateCount += 1;
    if (line.appraisalValue !== null) withAppraisalCount += 1;
    if (!line.purchaseDate) undatedCount += 1;
    custodyCost = custodyCost.plus(line.storageCostAnnual ?? 0);
    ownershipCost = ownershipCost.plus(line.ownership.annualCostEur);
    ownershipAlertCount += line.ownership.alerts.length;
    if (line.ownership.alerts.some((a) => a.code === "HIGH_CUSTODY_COST")) {
      highCustodyCostCount += 1;
    }
    if (!line.includeInEstate) {
      excludedFromEstate = excludedFromEstate.plus(line.estimatedValue);
    }
    byCategory.set(
      line.category,
      (byCategory.get(line.category) ?? d(0)).plus(line.estimatedValue)
    );
  }

  const totalPnl = totalValue.minus(totalCost);
  const totalPnlPct = totalCost.gt(0)
    ? totalPnl.div(totalCost).times(100).toNumber()
    : 0;

  return {
    totalCost: totalCost.toFixed(2),
    totalValue: totalValue.toFixed(2),
    totalPnl: totalPnl.toFixed(2),
    totalPnlPct: Math.round(totalPnlPct * 10) / 10,
    lineCount: lines.length,
    byCategory: [...byCategory.entries()].map(([key, value]) => ({
      name: TANGIBLE_CATEGORY_LABELS[key as TangibleCategory] ?? key,
      value: Number(value.toFixed(2)),
    })),
    totalInsuredValue: totalInsured.toFixed(2),
    estimatedTaxBurden: taxBurden.toFixed(2),
    exemptCount,
    withCertificateCount,
    withAppraisalCount,
    undatedCount,
    totalAnnualCustodyCost: custodyCost.toFixed(2),
    totalAnnualOwnershipCost: ownershipCost.toFixed(2),
    highCustodyCostCount,
    ownershipAlertCount,
    excludedFromEstateEur: excludedFromEstate.toFixed(2),
  };
}

export async function listTangibles(userId: string) {
  const rows = await prisma.tangibleAsset.findMany({
    where: { userId },
    orderBy: [{ category: "asc" }, { brandOrArtist: "asc" }],
  });
  const lines = rows.map(mapRow);
  return { lines, summary: summarizeTangibles(lines) };
}

export type TangibleInput = {
  category?: string;
  brandOrArtist: string;
  modelName: string;
  yearOrVintage?: string | null;
  purchasePrice?: string | number;
  estimatedValue?: string | number;
  currency?: string;
  hasCertificate?: boolean;
  notes?: string | null;

  purchaseDate?: string | null;
  purchaseSource?: string | null;
  certificateRef?: string | null;
  certificateIssuer?: string | null;

  appraisalValue?: string | number | null;
  appraisalDate?: string | null;
  insuranceValue?: string | number | null;
  storageLocation?: string | null;
  isCollectible?: boolean;

  insurancePremiumAnnual?: string | number | null;
  insuranceProvider?: string | null;
  insurancePolicyRef?: string | null;
  storageType?: string | null;
  storageCostAnnual?: string | number | null;
  storageProvider?: string | null;
  storageContractRef?: string | null;
  storageRenewalDate?: string | null;

  includeInEstate?: boolean;
  estateNote?: string | null;

  gemType?: string | null;
  caratWeight?: string | number | null;
  gemClarity?: string | null;
  gemColor?: string | null;
  gemCut?: string | null;
  gemTreatment?: string | null;
  gemOrigin?: string | null;
  jewelryType?: string | null;
  metalBase?: string | null;
  metalWeightG?: string | number | null;
  hasPunchmarks?: boolean | null;
  watchMovement?: string | null;
  watchDiameterMm?: string | number | null;
  watchReference?: string | null;
  watchBoxPapers?: boolean | null;
  wineAppellation?: string | null;
  wineBottleCount?: number | string | null;
  wineBottleFormat?: string | null;
  wineStorageType?: string | null;
  autoMileageKm?: number | string | null;
  autoRegistration?: string | null;
  autoInspectionOk?: boolean | null;
  autoPreviousOwners?: number | string | null;
};

function normalize(input: TangibleInput) {
  return {
    category: normalizeCategory(input.category),
    brandOrArtist: String(input.brandOrArtist ?? "").trim(),
    modelName: String(input.modelName ?? "").trim(),
    yearOrVintage: optText(input.yearOrVintage),
    purchasePrice: dec(input.purchasePrice),
    estimatedValue: dec(input.estimatedValue),
    currency: (input.currency ?? "EUR").toUpperCase().slice(0, 3),
    hasCertificate: Boolean(input.hasCertificate),
    notes: optText(input.notes),

    purchaseDate: parseDate(input.purchaseDate),
    purchaseSource: optText(input.purchaseSource),
    certificateRef: optText(input.certificateRef),
    certificateIssuer: optText(input.certificateIssuer),

    appraisalValue: optDec(input.appraisalValue),
    appraisalDate: parseDate(input.appraisalDate),
    insuranceValue: optDec(input.insuranceValue),
    storageLocation: optText(input.storageLocation),
    isCollectible: Boolean(input.isCollectible),

    insurancePremiumAnnual: optDec(input.insurancePremiumAnnual),
    insuranceProvider: optText(input.insuranceProvider),
    insurancePolicyRef: optText(input.insurancePolicyRef),
    storageType: normalizeStorageType(input.storageType),
    storageCostAnnual: optDec(input.storageCostAnnual),
    storageProvider: optText(input.storageProvider),
    storageContractRef: optText(input.storageContractRef),
    storageRenewalDate: parseDate(input.storageRenewalDate),

    // Par défaut inclus dans l'assiette : c'est le cas général, et l'exclusion
    // est une décision explicite (donation déjà réalisée, bien démembré…).
    includeInEstate: input.includeInEstate ?? true,
    estateNote: optText(input.estateNote),

    gemType: optText(input.gemType),
    caratWeight: optDec(input.caratWeight),
    gemClarity: optText(input.gemClarity),
    gemColor: optText(input.gemColor),
    gemCut: optText(input.gemCut),
    gemTreatment: optText(input.gemTreatment),
    gemOrigin: optText(input.gemOrigin),
    jewelryType: optText(input.jewelryType),
    metalBase: optText(input.metalBase),
    metalWeightG: optDec(input.metalWeightG),
    hasPunchmarks: optBool(input.hasPunchmarks),
    watchMovement: optText(input.watchMovement),
    watchDiameterMm: optDec(input.watchDiameterMm),
    watchReference: optText(input.watchReference),
    watchBoxPapers: optBool(input.watchBoxPapers),
    wineAppellation: optText(input.wineAppellation),
    wineBottleCount: optInt(input.wineBottleCount),
    wineBottleFormat: optText(input.wineBottleFormat),
    wineStorageType: optText(input.wineStorageType),
    autoMileageKm: optInt(input.autoMileageKm),
    autoRegistration: optText(input.autoRegistration),
    autoInspectionOk: optBool(input.autoInspectionOk),
    autoPreviousOwners: optInt(input.autoPreviousOwners),
  };
}

export async function createTangible(userId: string, input: TangibleInput) {
  const data = normalize(input);
  if (!data.brandOrArtist) throw new TangibleInputError("Marque / artiste requis");
  if (!data.modelName) throw new TangibleInputError("Modèle / nom requis");
  const row = await prisma.tangibleAsset.create({ data: { userId, ...data } });
  return mapRow(row);
}

export async function updateTangible(
  userId: string,
  id: string,
  input: Partial<TangibleInput>
) {
  const existing = await prisma.tangibleAsset.findFirst({ where: { id, userId } });
  if (!existing) throw new TangibleInputError("Actif introuvable");

  /**
   * Un champ absent du patch garde sa valeur ; `null` explicite l'efface.
   *
   * Le formulaire n'envoie que ce que la catégorie affiche : sans cette règle,
   * passer une bague en montre effacerait le carat au lieu de le conserver —
   * et le rétablir après coup serait impossible.
   */
  function keep<K extends keyof TangibleInput>(
    key: K,
    current: unknown
  ): TangibleInput[K] {
    return (input[key] !== undefined ? input[key] : current) as TangibleInput[K];
  }

  const data = normalize({
    category: keep("category", existing.category),
    brandOrArtist: keep("brandOrArtist", existing.brandOrArtist) as string,
    modelName: keep("modelName", existing.modelName) as string,
    yearOrVintage: keep("yearOrVintage", existing.yearOrVintage),
    purchasePrice: keep("purchasePrice", existing.purchasePrice.toString()),
    estimatedValue: keep("estimatedValue", existing.estimatedValue.toString()),
    currency: keep("currency", existing.currency),
    hasCertificate: keep("hasCertificate", existing.hasCertificate),
    notes: keep("notes", existing.notes),

    purchaseDate: keep("purchaseDate", existing.purchaseDate?.toISOString() ?? null),
    purchaseSource: keep("purchaseSource", existing.purchaseSource),
    certificateRef: keep("certificateRef", existing.certificateRef),
    certificateIssuer: keep("certificateIssuer", existing.certificateIssuer),

    appraisalValue: keep("appraisalValue", existing.appraisalValue?.toString() ?? null),
    appraisalDate: keep("appraisalDate", existing.appraisalDate?.toISOString() ?? null),
    insuranceValue: keep("insuranceValue", existing.insuranceValue?.toString() ?? null),
    storageLocation: keep("storageLocation", existing.storageLocation),
    isCollectible: keep("isCollectible", existing.isCollectible),

    insurancePremiumAnnual: keep(
      "insurancePremiumAnnual",
      existing.insurancePremiumAnnual?.toString() ?? null
    ),
    insuranceProvider: keep("insuranceProvider", existing.insuranceProvider),
    insurancePolicyRef: keep("insurancePolicyRef", existing.insurancePolicyRef),
    storageType: keep("storageType", existing.storageType),
    storageCostAnnual: keep(
      "storageCostAnnual",
      existing.storageCostAnnual?.toString() ?? null
    ),
    storageProvider: keep("storageProvider", existing.storageProvider),
    storageContractRef: keep("storageContractRef", existing.storageContractRef),
    storageRenewalDate: keep(
      "storageRenewalDate",
      existing.storageRenewalDate?.toISOString() ?? null
    ),

    includeInEstate: keep("includeInEstate", existing.includeInEstate),
    estateNote: keep("estateNote", existing.estateNote),

    gemType: keep("gemType", existing.gemType),
    caratWeight: keep("caratWeight", existing.caratWeight?.toString() ?? null),
    gemClarity: keep("gemClarity", existing.gemClarity),
    gemColor: keep("gemColor", existing.gemColor),
    gemCut: keep("gemCut", existing.gemCut),
    gemTreatment: keep("gemTreatment", existing.gemTreatment),
    gemOrigin: keep("gemOrigin", existing.gemOrigin),
    jewelryType: keep("jewelryType", existing.jewelryType),
    metalBase: keep("metalBase", existing.metalBase),
    metalWeightG: keep("metalWeightG", existing.metalWeightG?.toString() ?? null),
    hasPunchmarks: keep("hasPunchmarks", existing.hasPunchmarks),
    watchMovement: keep("watchMovement", existing.watchMovement),
    watchDiameterMm: keep(
      "watchDiameterMm",
      existing.watchDiameterMm?.toString() ?? null
    ),
    watchReference: keep("watchReference", existing.watchReference),
    watchBoxPapers: keep("watchBoxPapers", existing.watchBoxPapers),
    wineAppellation: keep("wineAppellation", existing.wineAppellation),
    wineBottleCount: keep("wineBottleCount", existing.wineBottleCount),
    wineBottleFormat: keep("wineBottleFormat", existing.wineBottleFormat),
    wineStorageType: keep("wineStorageType", existing.wineStorageType),
    autoMileageKm: keep("autoMileageKm", existing.autoMileageKm),
    autoRegistration: keep("autoRegistration", existing.autoRegistration),
    autoInspectionOk: keep("autoInspectionOk", existing.autoInspectionOk),
    autoPreviousOwners: keep("autoPreviousOwners", existing.autoPreviousOwners),
  });

  const write = await prisma.tangibleAsset.updateMany({ where: { id, userId }, data });
  if (write.count === 0) throw new TangibleInputError("Actif introuvable");
  const row = await prisma.tangibleAsset.findFirst({ where: { id, userId } });
  if (!row) throw new TangibleInputError("Actif introuvable");
  return mapRow(row);
}

export async function deleteTangible(userId: string, id: string) {
  const result = await prisma.tangibleAsset.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new TangibleInputError("Actif introuvable");
  return { ok: true };
}
