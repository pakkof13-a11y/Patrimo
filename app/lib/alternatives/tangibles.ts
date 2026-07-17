import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  TANGIBLE_CATEGORIES,
  TANGIBLE_CATEGORY_LABELS,
  type TangibleAssetDto,
  type TangibleAssetsSummary,
  type TangibleCategory,
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

function normalizeCategory(raw: string | undefined): TangibleCategory {
  const s = String(raw || "OTHER").toUpperCase();
  if ((TANGIBLE_CATEGORIES as readonly string[]).includes(s)) return s as TangibleCategory;
  return "OTHER";
}

function mapRow(row: {
  id: string;
  category: string;
  brandOrArtist: string;
  modelName: string;
  yearOrVintage: string | null;
  purchasePrice: Prisma.Decimal;
  estimatedValue: Prisma.Decimal;
  currency: string;
  hasCertificate: boolean;
  notes: string | null;
}): TangibleAssetDto {
  const cost = n(row.purchasePrice.toString());
  const val = n(row.estimatedValue.toString());
  const pnl = val - cost;
  const pct = cost > 0 ? (pnl / cost) * 100 : 0;
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
  };
}

export function summarizeTangibles(lines: TangibleAssetDto[]): TangibleAssetsSummary {
  let totalCost = 0;
  let totalValue = 0;
  const byCat = new Map<string, number>();
  for (const l of lines) {
    totalCost += n(l.purchasePrice);
    totalValue += n(l.estimatedValue);
    byCat.set(l.category, (byCat.get(l.category) || 0) + n(l.estimatedValue));
  }
  const totalPnl = totalValue - totalCost;
  return {
    totalCost: totalCost.toFixed(2),
    totalValue: totalValue.toFixed(2),
    totalPnl: totalPnl.toFixed(2),
    totalPnlPct: totalCost > 0 ? Math.round((totalPnl / totalCost) * 1000) / 10 : 0,
    lineCount: lines.length,
    byCategory: [...byCat.entries()].map(([k, value]) => ({
      name: TANGIBLE_CATEGORY_LABELS[k as TangibleCategory] || k,
      value: Math.round(value * 100) / 100,
    })),
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
};

function normalize(input: TangibleInput) {
  return {
    category: normalizeCategory(input.category),
    brandOrArtist: String(input.brandOrArtist || "").trim(),
    modelName: String(input.modelName || "").trim(),
    yearOrVintage: input.yearOrVintage ? String(input.yearOrVintage).trim() : null,
    purchasePrice: dec(input.purchasePrice, "0"),
    estimatedValue: dec(input.estimatedValue, "0"),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    hasCertificate: Boolean(input.hasCertificate),
    notes: input.notes ? String(input.notes) : null,
  };
}

export async function createTangible(userId: string, input: TangibleInput) {
  const data = normalize(input);
  if (!data.brandOrArtist) throw new Error("Marque / artiste requis");
  if (!data.modelName) throw new Error("Modèle / nom requis");
  const row = await prisma.tangibleAsset.create({ data: { userId, ...data } });
  return mapRow(row);
}

export async function updateTangible(
  userId: string,
  id: string,
  input: Partial<TangibleInput>
) {
  const existing = await prisma.tangibleAsset.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Actif introuvable");
  const data = normalize({
    category: input.category ?? existing.category,
    brandOrArtist: input.brandOrArtist ?? existing.brandOrArtist,
    modelName: input.modelName ?? existing.modelName,
    yearOrVintage:
      input.yearOrVintage !== undefined ? input.yearOrVintage : existing.yearOrVintage,
    purchasePrice: input.purchasePrice ?? existing.purchasePrice.toString(),
    estimatedValue: input.estimatedValue ?? existing.estimatedValue.toString(),
    currency: input.currency ?? existing.currency,
    hasCertificate:
      input.hasCertificate !== undefined ? input.hasCertificate : existing.hasCertificate,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });
  const write = await prisma.tangibleAsset.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) throw new Error("Actif introuvable");
  const row = await prisma.tangibleAsset.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Actif introuvable");
  return mapRow(row);
}

export async function deleteTangible(userId: string, id: string) {
  const result = await prisma.tangibleAsset.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Actif introuvable");
  return { ok: true };
}
