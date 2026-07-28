/**
 * Métaux précieux — lots détenus et cessions.
 *
 * Deux règles gouvernent ce module :
 *
 * 1. **Le lot est l'unité**, pas le produit. Deux Napoléons achetés à cinq ans
 *    d'intervalle n'ont pas la même fiscalité : les fusionner en une ligne
 *    moyenne rendrait l'abattement pour durée de détention incalculable.
 * 2. **Le poids fin, pas le poids brut.** Un Napoléon de 6,4516 g titre 900 :
 *    il ne contient que 5,806 g d'or. Agréger les poids bruts surévalue
 *    l'avoir en métal de plus de 10 %.
 *
 * Tous les montants transitent en Decimal — les `Number()` de la version
 * précédente ont été retirés.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import { d, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";
import {
  FORMAT_LABELS,
  GRAMS_PER_TROY_OZ,
  isPreciousFormat,
  isPreciousMetal,
  isProductType,
  isWeightUnit,
  METAL_LABELS,
  type PreciousFormat,
  type PreciousMetal,
  type PreciousProductType,
  type WeightUnit,
} from "@/app/lib/precious-metals/constants";
import {
  computeMetalSaleTax,
  summarizeMetalTaxYear,
  type MetalSaleTax,
  type MetalTaxRegime,
} from "@/app/lib/precious-metals/tax";
import type { PreciousMetalDto, PreciousMetalsSummary } from "./types";

export class PreciousMetalInputError extends Error {}

function dec(value: DecimalInput | null | undefined, fallback = "0"): Prisma.Decimal {
  const raw = String(value ?? fallback).trim().replace(",", ".");
  const parsed = Number(raw);
  return new Prisma.Decimal(Number.isFinite(parsed) && raw !== "" ? raw : fallback);
}

/** Poids affiché → grammes. */
export function toGrams(value: DecimalInput, unit: WeightUnit): Decimal {
  return unit === "OZ" ? d(value).times(GRAMS_PER_TROY_OZ) : d(value);
}

/** Grammes → unité d'affichage. */
export function fromGrams(grams: DecimalInput, unit: WeightUnit): Decimal {
  return unit === "OZ" ? d(grams).div(GRAMS_PER_TROY_OZ) : d(grams);
}

type Row = {
  id: string;
  metal: string;
  format: string;
  productType: string;
  denomination: string;
  fineness: Prisma.Decimal;
  quantity: Prisma.Decimal;
  unitWeightG: Prisma.Decimal;
  weightUnit: string;
  purchasePriceUnit: Prisma.Decimal;
  acquisitionFees: Prisma.Decimal;
  acquiredAt: Date | null;
  hasInvoice: boolean;
  currentValue: Prisma.Decimal;
  currency: string;
  storageLocation: string | null;
  notes: string | null;
};

function mapRow(row: Row): PreciousMetalDto {
  const quantity = d(row.quantity.toString());
  const unitPrice = d(row.purchasePriceUnit.toString());
  const fees = d(row.acquisitionFees.toString());
  const current = d(row.currentValue.toString());
  const unitWeightG = d(row.unitWeightG.toString());
  const fineness = d(row.fineness.toString());
  const weightUnit = (isWeightUnit(row.weightUnit) ? row.weightUnit : "GRAM") as WeightUnit;

  // Les frais d'acquisition font partie du prix de revient : les omettre
  // gonflerait la plus-value déclarée au régime réel.
  const costBasis = quantity.times(unitPrice).plus(fees);
  const pnl = current.minus(costBasis);
  const pnlPct = costBasis.gt(0) ? pnl.div(costBasis).times(100) : d(0);
  const grossWeightG = quantity.times(unitWeightG);
  const fineWeightG = grossWeightG.times(fineness).div(1000);

  return {
    id: row.id,
    metal: (isPreciousMetal(row.metal) ? row.metal : "OTHER") as PreciousMetal,
    format: (isPreciousFormat(row.format) ? row.format : "PHYSICAL") as PreciousFormat,
    productType: (isProductType(row.productType)
      ? row.productType
      : "OTHER") as PreciousProductType,
    denomination: row.denomination,
    fineness: row.fineness.toString(),
    quantity: row.quantity.toString(),
    unitWeightG: row.unitWeightG.toString(),
    weightUnit,
    unitWeightDisplay: fromGrams(unitWeightG, weightUnit).toFixed(
      weightUnit === "OZ" ? 4 : 2
    ),
    purchasePriceUnit: row.purchasePriceUnit.toString(),
    acquisitionFees: row.acquisitionFees.toString(),
    acquiredAt: row.acquiredAt ? row.acquiredAt.toISOString() : null,
    hasInvoice: row.hasInvoice,
    currentValue: row.currentValue.toString(),
    currency: row.currency,
    storageLocation: row.storageLocation,
    notes: row.notes,
    costBasis: costBasis.toFixed(2),
    unrealizedPnl: pnl.toFixed(2),
    unrealizedPnlPct: pnlPct.toFixed(2),
    totalWeightG: grossWeightG.toFixed(2),
    fineWeightG: fineWeightG.toFixed(3),
    /** Valeur unitaire courante — base de comparaison au cours du métal. */
    unitValueEur: quantity.gt(0) ? current.div(quantity).toFixed(2) : "0.00",
  };
}

export function summarizePreciousMetals(
  lines: PreciousMetalDto[]
): PreciousMetalsSummary {
  let totalCost = d(0);
  let totalValue = d(0);
  let totalWeightG = d(0);
  let totalFineWeightG = d(0);
  let undatedCount = 0;
  let noInvoiceCount = 0;
  const byFormat = new Map<string, Decimal>();
  const byMetal = new Map<string, { value: Decimal; fineWeightG: Decimal }>();

  for (const line of lines) {
    const cost = d(line.costBasis);
    const value = d(line.currentValue);
    totalCost = totalCost.plus(cost);
    totalValue = totalValue.plus(value);
    totalWeightG = totalWeightG.plus(line.totalWeightG);
    totalFineWeightG = totalFineWeightG.plus(line.fineWeightG);

    // Deux compteurs qui valent un avertissement à l'écran : ce sont les deux
    // conditions de l'option pour le régime réel, et elles se perdent des
    // années avant la vente.
    if (!line.acquiredAt) undatedCount += 1;
    if (line.format === "PHYSICAL" && !line.hasInvoice) noInvoiceCount += 1;

    byFormat.set(line.format, (byFormat.get(line.format) ?? d(0)).plus(value));
    const metal = byMetal.get(line.metal) ?? { value: d(0), fineWeightG: d(0) };
    byMetal.set(line.metal, {
      value: metal.value.plus(value),
      fineWeightG: metal.fineWeightG.plus(line.fineWeightG),
    });
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
    totalWeightG: totalWeightG.toFixed(2),
    totalFineWeightG: totalFineWeightG.toFixed(3),
    lineCount: lines.length,
    undatedCount,
    noInvoiceCount,
    byFormat: [...byFormat.entries()].map(([key, value]) => ({
      name: FORMAT_LABELS[key as PreciousFormat] ?? key,
      value: Number(value.toFixed(2)),
    })),
    byMetal: [...byMetal.entries()].map(([key, agg]) => ({
      metal: key,
      name: METAL_LABELS[key as PreciousMetal] ?? key,
      value: Number(agg.value.toFixed(2)),
      fineWeightG: agg.fineWeightG.toFixed(3),
    })),
  };
}

export async function listPreciousMetals(userId: string) {
  const rows = await prisma.preciousMetalPosition.findMany({
    where: { userId },
    orderBy: [{ metal: "asc" }, { acquiredAt: "asc" }, { denomination: "asc" }],
  });
  const lines = rows.map(mapRow);
  return { lines, summary: summarizePreciousMetals(lines) };
}

export type PreciousMetalInput = {
  metal?: string;
  format?: string;
  productType?: string;
  denomination: string;
  fineness?: string | number;
  quantity?: string | number;
  unitWeight?: string | number;
  weightUnit?: string;
  purchasePriceUnit?: string | number;
  acquisitionFees?: string | number;
  acquiredAt?: string | null;
  hasInvoice?: boolean;
  currentValue?: string | number;
  currency?: string;
  storageLocation?: string | null;
  notes?: string | null;
};

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalize(input: PreciousMetalInput) {
  const rawUnit = String(input.weightUnit ?? "").toUpperCase();
  const weightUnit: WeightUnit = isWeightUnit(rawUnit) ? rawUnit : "GRAM";
  const unitWeightG = toGrams(input.unitWeight ?? 0, weightUnit);
  const metal = String(input.metal ?? "GOLD").toUpperCase();
  const format = String(input.format ?? "PHYSICAL").toUpperCase();
  const productType = String(input.productType ?? "COIN").toUpperCase();
  const fineness = dec(input.fineness, "999");

  if (fineness.lte(0) || fineness.gt(1000)) {
    throw new PreciousMetalInputError(
      "Le titre se saisit en millièmes, entre 1 et 1000 (900 pour un Napoléon)."
    );
  }

  return {
    metal: isPreciousMetal(metal) ? metal : "OTHER",
    format: isPreciousFormat(format) ? format : "PHYSICAL",
    productType: isProductType(productType) ? productType : "OTHER",
    denomination: String(input.denomination ?? "").trim(),
    fineness,
    quantity: dec(input.quantity),
    unitWeightG: new Prisma.Decimal(unitWeightG.toString()),
    weightUnit,
    purchasePriceUnit: dec(input.purchasePriceUnit),
    acquisitionFees: dec(input.acquisitionFees),
    acquiredAt: parseDate(input.acquiredAt),
    hasInvoice: Boolean(input.hasInvoice),
    currentValue: dec(input.currentValue),
    currency: (input.currency ?? "EUR").toUpperCase().slice(0, 3),
    storageLocation: input.storageLocation
      ? String(input.storageLocation).trim()
      : null,
    notes: input.notes ? String(input.notes) : null,
  };
}

export async function createPreciousMetal(userId: string, input: PreciousMetalInput) {
  const data = normalize(input);
  if (!data.denomination) {
    throw new PreciousMetalInputError("Dénomination requise");
  }
  const row = await prisma.preciousMetalPosition.create({ data: { userId, ...data } });
  return mapRow(row);
}

export async function updatePreciousMetal(
  userId: string,
  id: string,
  input: Partial<PreciousMetalInput>
) {
  const existing = await prisma.preciousMetalPosition.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new PreciousMetalInputError("Position introuvable");

  const weightUnit = (
    input.weightUnit !== undefined ? String(input.weightUnit) : existing.weightUnit
  ) as WeightUnit;
  const unitWeight =
    input.unitWeight !== undefined
      ? input.unitWeight
      : fromGrams(
          existing.unitWeightG.toString(),
          isWeightUnit(existing.weightUnit) ? existing.weightUnit : "GRAM"
        ).toString();

  const data = normalize({
    metal: input.metal ?? existing.metal,
    format: input.format ?? existing.format,
    productType: input.productType ?? existing.productType,
    denomination: input.denomination ?? existing.denomination,
    fineness: input.fineness ?? existing.fineness.toString(),
    quantity: input.quantity ?? existing.quantity.toString(),
    unitWeight,
    weightUnit,
    purchasePriceUnit:
      input.purchasePriceUnit ?? existing.purchasePriceUnit.toString(),
    acquisitionFees: input.acquisitionFees ?? existing.acquisitionFees.toString(),
    acquiredAt:
      input.acquiredAt !== undefined
        ? input.acquiredAt
        : (existing.acquiredAt?.toISOString() ?? null),
    hasInvoice: input.hasInvoice ?? existing.hasInvoice,
    currentValue: input.currentValue ?? existing.currentValue.toString(),
    currency: input.currency ?? existing.currency,
    storageLocation:
      input.storageLocation !== undefined
        ? input.storageLocation
        : existing.storageLocation,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });

  const write = await prisma.preciousMetalPosition.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) throw new PreciousMetalInputError("Position introuvable");
  const row = await prisma.preciousMetalPosition.findFirst({ where: { id, userId } });
  if (!row) throw new PreciousMetalInputError("Position introuvable");
  return mapRow(row);
}

export async function deletePreciousMetal(userId: string, id: string) {
  const result = await prisma.preciousMetalPosition.deleteMany({
    where: { id, userId },
  });
  if (result.count === 0) throw new PreciousMetalInputError("Position introuvable");
  return { ok: true };
}

// ─── Cessions ────────────────────────────────────────────────────────────────

export type PreciousMetalSaleInput = {
  positionId?: string | null;
  denomination?: string | null;
  quantity: string | number;
  salePriceEur: string | number;
  saleFeesEur?: string | number;
  soldAt: string;
  regime?: string;
  notes?: string | null;
};

/**
 * Enregistre une cession.
 *
 * Le prix de revient et la date d'acquisition sont **repris du lot**, jamais
 * saisis : les laisser à la main du vendeur produirait une plus-value
 * arbitraire, alors que l'administration exige précisément ces deux éléments.
 * Sur une vente partielle, le prix de revient est proraté à la quantité, frais
 * d'acquisition compris.
 */
export async function createPreciousMetalSale(
  userId: string,
  input: PreciousMetalSaleInput
) {
  const quantity = d(String(input.quantity).replace(",", "."));
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new PreciousMetalInputError("La quantité cédée doit être positive.");
  }
  const soldAt = parseDate(input.soldAt);
  if (!soldAt) throw new PreciousMetalInputError("Date de cession invalide.");

  let costBasis = d(0);
  let acquiredAt: Date | null = null;
  let hasInvoice = false;
  let denomination = (input.denomination ?? "").trim();

  if (input.positionId) {
    const lot = await prisma.preciousMetalPosition.findFirst({
      where: { id: input.positionId, userId },
    });
    if (!lot) throw new PreciousMetalInputError("Lot introuvable");
    const lotQuantity = d(lot.quantity.toString());
    if (lotQuantity.gt(0) && quantity.gt(lotQuantity)) {
      throw new PreciousMetalInputError(
        `Quantité cédée supérieure au lot (${lotQuantity.toString()} unité(s) disponible(s)).`
      );
    }
    const share = lotQuantity.gt(0) ? quantity.div(lotQuantity) : d(0);
    costBasis = quantity
      .times(lot.purchasePriceUnit.toString())
      .plus(d(lot.acquisitionFees.toString()).times(share));
    acquiredAt = lot.acquiredAt;
    hasInvoice = lot.hasInvoice;
    denomination = denomination || lot.denomination;
  }

  if (!denomination) throw new PreciousMetalInputError("Dénomination requise");

  const regime: MetalTaxRegime =
    String(input.regime ?? "").toUpperCase() === "PLUS_VALUE"
      ? "PLUS_VALUE"
      : "FORFAIT";

  const sale = await prisma.preciousMetalSale.create({
    data: {
      userId,
      positionId: input.positionId ?? null,
      denomination,
      quantity: new Prisma.Decimal(quantity.toString()),
      salePriceEur: dec(input.salePriceEur),
      saleFeesEur: dec(input.saleFeesEur),
      costBasisEur: new Prisma.Decimal(costBasis.toString()),
      soldAt,
      acquiredAt,
      regime,
      hasInvoice,
      notes: input.notes ? String(input.notes) : null,
    },
  });

  // Le lot est décrémenté : une vente qui laisserait le stock intact ferait
  // apparaître deux fois le même métal au patrimoine.
  if (input.positionId) await decrementLot(userId, input.positionId, quantity);

  return mapSale(sale);
}

async function decrementLot(userId: string, positionId: string, quantity: Decimal) {
  const lot = await prisma.preciousMetalPosition.findFirst({
    where: { id: positionId, userId },
  });
  if (!lot) return;
  const lotQuantity = d(lot.quantity.toString());
  const remaining = lotQuantity.minus(quantity);
  const kept = remaining.gt(0) ? remaining : d(0);
  // La valeur courante suit la quantité au prorata : elle porte sur la ligne
  // entière, pas sur l'unité.
  const unitValue = lotQuantity.gt(0)
    ? d(lot.currentValue.toString()).div(lotQuantity)
    : d(0);

  await prisma.preciousMetalPosition.updateMany({
    where: { id: positionId, userId },
    data: {
      quantity: new Prisma.Decimal(kept.toString()),
      currentValue: new Prisma.Decimal(unitValue.times(kept).toString()),
    },
  });
}

type SaleRow = {
  id: string;
  positionId: string | null;
  denomination: string;
  quantity: Prisma.Decimal;
  salePriceEur: Prisma.Decimal;
  saleFeesEur: Prisma.Decimal;
  costBasisEur: Prisma.Decimal;
  soldAt: Date;
  acquiredAt: Date | null;
  regime: string;
  hasInvoice: boolean;
  notes: string | null;
};

export type PreciousMetalSaleDto = {
  id: string;
  positionId: string | null;
  denomination: string;
  quantity: string;
  salePriceEur: string;
  saleFeesEur: string;
  costBasisEur: string;
  soldAt: string;
  acquiredAt: string | null;
  regime: MetalTaxRegime;
  hasInvoice: boolean;
  notes: string | null;
  tax: MetalSaleTax;
};

function mapSale(row: SaleRow): PreciousMetalSaleDto {
  return {
    id: row.id,
    positionId: row.positionId,
    denomination: row.denomination,
    quantity: row.quantity.toString(),
    salePriceEur: row.salePriceEur.toString(),
    saleFeesEur: row.saleFeesEur.toString(),
    costBasisEur: row.costBasisEur.toString(),
    soldAt: row.soldAt.toISOString(),
    acquiredAt: row.acquiredAt?.toISOString() ?? null,
    regime: (row.regime === "PLUS_VALUE" ? "PLUS_VALUE" : "FORFAIT") as MetalTaxRegime,
    hasInvoice: row.hasInvoice,
    notes: row.notes,
    // L'impôt n'est jamais stocké : il est recalculé à chaque lecture, comme
    // le P&L du ledger. Une révision des taux corrige donc l'historique.
    tax: computeMetalSaleTax({
      salePriceEur: row.salePriceEur.toString(),
      costBasisEur: row.costBasisEur.toString(),
      saleFeesEur: row.saleFeesEur.toString(),
      acquiredAt: row.acquiredAt,
      soldAt: row.soldAt,
      hasInvoice: row.hasInvoice,
    }),
  };
}

export async function listPreciousMetalSales(userId: string) {
  const rows = await prisma.preciousMetalSale.findMany({
    where: { userId },
    orderBy: [{ soldAt: "desc" }],
  });

  const byYear = new Map<number, SaleRow[]>();
  for (const row of rows) {
    const year = row.soldAt.getUTCFullYear();
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }

  const fiscalYears = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, rowsOfYear]) =>
      summarizeMetalTaxYear(
        year,
        rowsOfYear.map((row) => ({
          salePriceEur: row.salePriceEur.toString(),
          costBasisEur: row.costBasisEur.toString(),
          saleFeesEur: row.saleFeesEur.toString(),
          acquiredAt: row.acquiredAt,
          soldAt: row.soldAt,
          hasInvoice: row.hasInvoice,
          regime: (row.regime === "PLUS_VALUE"
            ? "PLUS_VALUE"
            : "FORFAIT") as MetalTaxRegime,
        }))
      )
    );

  return { sales: rows.map(mapSale), fiscalYears };
}

export async function deletePreciousMetalSale(userId: string, id: string) {
  const result = await prisma.preciousMetalSale.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new PreciousMetalInputError("Cession introuvable");
  return { ok: true };
}
