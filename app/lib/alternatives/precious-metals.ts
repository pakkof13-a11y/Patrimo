import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  ASSET_KIND_LABELS,
  FORMAT_LABELS,
  GRAMS_PER_TROY_OZ,
  type PreciousAssetKind,
  type PreciousFormat,
  type PreciousMetalDto,
  type PreciousMetalsSummary,
  type WeightUnit,
} from "./types";

function dec(v: string | number | undefined | null, fallback = "0"): Prisma.Decimal {
  const s = String(v ?? fallback).trim().replace(",", ".");
  const n = Number(s);
  return new Prisma.Decimal(Number.isFinite(n) ? s : fallback);
}

function n(v: string | number): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

/** Convert display weight to grams */
export function toGrams(value: number, unit: WeightUnit): number {
  if (unit === "OZ") return value * GRAMS_PER_TROY_OZ;
  return value;
}

/** Grams → display unit */
export function fromGrams(grams: number, unit: WeightUnit): number {
  if (unit === "OZ") return grams / GRAMS_PER_TROY_OZ;
  return grams;
}

function mapRow(row: {
  id: string;
  assetKind: string;
  format: string;
  denomination: string;
  quantity: Prisma.Decimal;
  unitWeightG: Prisma.Decimal;
  weightUnit: string;
  purchasePriceUnit: Prisma.Decimal;
  currentValue: Prisma.Decimal;
  currency: string;
  storageLocation: string | null;
  notes: string | null;
}): PreciousMetalDto {
  const qty = n(row.quantity.toString());
  const pru = n(row.purchasePriceUnit.toString());
  const current = n(row.currentValue.toString());
  const unitG = n(row.unitWeightG.toString());
  const weightUnit = (row.weightUnit === "OZ" ? "OZ" : "GRAM") as WeightUnit;
  const costBasis = qty * pru;
  const pnl = current - costBasis;
  const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

  return {
    id: row.id,
    assetKind: (row.assetKind === "OTHER" ? "OTHER" : "METAL") as PreciousAssetKind,
    format: (row.format === "PAPER" ? "PAPER" : "PHYSICAL") as PreciousFormat,
    denomination: row.denomination,
    quantity: row.quantity.toString(),
    unitWeightG: row.unitWeightG.toString(),
    weightUnit,
    unitWeightDisplay: fromGrams(unitG, weightUnit).toFixed(weightUnit === "OZ" ? 4 : 2),
    purchasePriceUnit: row.purchasePriceUnit.toString(),
    currentValue: row.currentValue.toString(),
    currency: row.currency,
    storageLocation: row.storageLocation,
    notes: row.notes,
    costBasis: costBasis.toFixed(2),
    unrealizedPnl: pnl.toFixed(2),
    unrealizedPnlPct: pnlPct.toFixed(2),
    totalWeightG: (qty * unitG).toFixed(2),
  };
}

export function summarizePreciousMetals(lines: PreciousMetalDto[]): PreciousMetalsSummary {
  let totalCost = 0;
  let totalValue = 0;
  let totalWeightG = 0;
  const byFormat = new Map<string, number>();
  const byKind = new Map<string, number>();

  for (const l of lines) {
    const cost = n(l.costBasis);
    const val = n(l.currentValue);
    totalCost += cost;
    totalValue += val;
    totalWeightG += n(l.totalWeightG);
    byFormat.set(l.format, (byFormat.get(l.format) || 0) + val);
    byKind.set(l.assetKind, (byKind.get(l.assetKind) || 0) + val);
  }

  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? Math.round((totalPnl / totalCost) * 1000) / 10 : 0;

  return {
    totalCost: totalCost.toFixed(2),
    totalValue: totalValue.toFixed(2),
    totalPnl: totalPnl.toFixed(2),
    totalPnlPct,
    totalWeightG: totalWeightG.toFixed(2),
    lineCount: lines.length,
    byFormat: [...byFormat.entries()].map(([k, value]) => ({
      name: FORMAT_LABELS[k as PreciousFormat] || k,
      value: Math.round(value * 100) / 100,
    })),
    byKind: [...byKind.entries()].map(([k, value]) => ({
      name: ASSET_KIND_LABELS[k as PreciousAssetKind] || k,
      value: Math.round(value * 100) / 100,
    })),
  };
}

export async function listPreciousMetals(userId: string) {
  const rows = await prisma.preciousMetalPosition.findMany({
    where: { userId },
    orderBy: [{ denomination: "asc" }],
  });
  const lines = rows.map(mapRow);
  return { lines, summary: summarizePreciousMetals(lines) };
}

export type PreciousMetalInput = {
  assetKind?: string;
  format?: string;
  denomination: string;
  quantity?: string | number;
  unitWeight?: string | number;
  weightUnit?: string;
  purchasePriceUnit?: string | number;
  currentValue?: string | number;
  currency?: string;
  storageLocation?: string | null;
  notes?: string | null;
};

function normalize(input: PreciousMetalInput) {
  const weightUnit = (String(input.weightUnit || "GRAM").toUpperCase() === "OZ"
    ? "OZ"
    : "GRAM") as WeightUnit;
  const displayW = n(input.unitWeight ?? 0);
  const unitWeightG = toGrams(displayW, weightUnit);

  return {
    assetKind: String(input.assetKind || "METAL").toUpperCase() === "OTHER" ? "OTHER" : "METAL",
    format: String(input.format || "PHYSICAL").toUpperCase() === "PAPER" ? "PAPER" : "PHYSICAL",
    denomination: String(input.denomination || "").trim(),
    quantity: dec(input.quantity, "0"),
    unitWeightG: new Prisma.Decimal(unitWeightG),
    weightUnit,
    purchasePriceUnit: dec(input.purchasePriceUnit, "0"),
    currentValue: dec(input.currentValue, "0"),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    storageLocation: input.storageLocation ? String(input.storageLocation).trim() : null,
    notes: input.notes ? String(input.notes) : null,
  };
}

export async function createPreciousMetal(userId: string, input: PreciousMetalInput) {
  const data = normalize(input);
  if (!data.denomination) throw new Error("Dénomination requise");
  const row = await prisma.preciousMetalPosition.create({
    data: { userId, ...data },
  });
  return mapRow(row);
}

export async function updatePreciousMetal(
  userId: string,
  id: string,
  input: Partial<PreciousMetalInput>
) {
  const existing = await prisma.preciousMetalPosition.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Position introuvable");

  const weightUnit =
    input.weightUnit !== undefined
      ? String(input.weightUnit)
      : existing.weightUnit;
  const unitWeight =
    input.unitWeight !== undefined
      ? input.unitWeight
      : fromGrams(n(existing.unitWeightG.toString()), existing.weightUnit === "OZ" ? "OZ" : "GRAM");

  const data = normalize({
    assetKind: input.assetKind ?? existing.assetKind,
    format: input.format ?? existing.format,
    denomination: input.denomination ?? existing.denomination,
    quantity: input.quantity ?? existing.quantity.toString(),
    unitWeight,
    weightUnit,
    purchasePriceUnit: input.purchasePriceUnit ?? existing.purchasePriceUnit.toString(),
    currentValue: input.currentValue ?? existing.currentValue.toString(),
    currency: input.currency ?? existing.currency,
    storageLocation:
      input.storageLocation !== undefined ? input.storageLocation : existing.storageLocation,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });

  const row = await prisma.preciousMetalPosition.update({ where: { id }, data });
  return mapRow(row);
}

export async function deletePreciousMetal(userId: string, id: string) {
  const existing = await prisma.preciousMetalPosition.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Position introuvable");
  await prisma.preciousMetalPosition.delete({ where: { id } });
  return { ok: true };
}
