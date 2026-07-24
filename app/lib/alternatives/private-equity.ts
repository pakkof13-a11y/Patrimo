import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "@/app/lib/prisma";
import type { PeType, PrivateEquityDto, PrivateEquitySummary } from "./types";
import { PE_TYPES } from "./types";

function dec(v: string | number | undefined | null, fallback = "0"): Prisma.Decimal {
  const s = String(v ?? fallback).trim().replace(",", ".");
  const n = Number(s);
  return new Prisma.Decimal(Number.isFinite(n) ? s : fallback);
}

function n(v: string | number): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v || !String(v).trim()) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizePeType(raw: string | undefined): PeType {
  const s = String(raw || "DIRECT").toUpperCase();
  if ((PE_TYPES as readonly string[]).includes(s)) return s as PeType;
  return "DIRECT";
}

function mapRow(row: {
  id: string;
  companyName: string;
  sector: string | null;
  peType: string;
  shares: Prisma.Decimal;
  acquisitionPricePerShare: Prisma.Decimal;
  investmentDate: Date | null;
  currentNav: Prisma.Decimal;
  currency: string;
  notes: string | null;
}): PrivateEquityDto {
  const shares = n(row.shares.toString());
  const pru = n(row.acquisitionPricePerShare.toString());
  const nav = n(row.currentNav.toString());
  const invested = shares * pru;
  const moic = invested > 0 ? nav / invested : 0;
  const pnl = nav - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

  return {
    id: row.id,
    companyName: row.companyName,
    sector: row.sector,
    peType: normalizePeType(row.peType),
    shares: row.shares.toString(),
    acquisitionPricePerShare: row.acquisitionPricePerShare.toString(),
    investmentDate: toIsoDate(row.investmentDate),
    currentNav: row.currentNav.toString(),
    currency: row.currency,
    notes: row.notes,
    investedTotal: invested.toFixed(2),
    moic: moic.toFixed(2),
    unrealizedPnl: pnl.toFixed(2),
    unrealizedPnlPct: pnlPct.toFixed(2),
  };
}

export function summarizePrivateEquity(lines: PrivateEquityDto[]): PrivateEquitySummary {
  let totalInvested = 0;
  let totalNav = 0;
  for (const l of lines) {
    totalInvested += n(l.investedTotal);
    totalNav += n(l.currentNav);
  }
  const avgMoic = totalInvested > 0 ? Math.round((totalNav / totalInvested) * 100) / 100 : 0;
  return {
    totalInvested: totalInvested.toFixed(2),
    totalNav: totalNav.toFixed(2),
    totalPnl: (totalNav - totalInvested).toFixed(2),
    avgMoic,
    lineCount: lines.length,
  };
}

export async function listPrivateEquity(userId: string) {
  const rows = await prisma.privateEquityPosition.findMany({
    where: { userId },
    orderBy: [{ companyName: "asc" }],
  });
  const lines = rows.map(mapRow);
  return { lines, summary: summarizePrivateEquity(lines) };
}

export type PrivateEquityInput = {
  companyName: string;
  sector?: string | null;
  peType?: string;
  shares?: string | number;
  acquisitionPricePerShare?: string | number;
  investmentDate?: string | null;
  currentNav?: string | number;
  currency?: string;
  notes?: string | null;
};

function normalize(input: PrivateEquityInput) {
  return {
    companyName: String(input.companyName || "").trim(),
    sector: input.sector ? String(input.sector).trim() : null,
    peType: normalizePeType(input.peType),
    shares: dec(input.shares, "0"),
    acquisitionPricePerShare: dec(input.acquisitionPricePerShare, "0"),
    investmentDate: parseDate(input.investmentDate ?? null),
    currentNav: dec(input.currentNav, "0"),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    notes: input.notes ? String(input.notes) : null,
  };
}

export async function createPrivateEquity(userId: string, input: PrivateEquityInput) {
  const data = normalize(input);
  if (!data.companyName) throw new Error("Nom de la société requis");
  const row = await prisma.privateEquityPosition.create({ data: { userId, ...data } });
  return mapRow(row);
}

export async function updatePrivateEquity(
  userId: string,
  id: string,
  input: Partial<PrivateEquityInput>
) {
  const existing = await prisma.privateEquityPosition.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Position introuvable");
  const data = normalize({
    companyName: input.companyName ?? existing.companyName,
    sector: input.sector !== undefined ? input.sector : existing.sector,
    peType: input.peType ?? existing.peType,
    shares: input.shares ?? existing.shares.toString(),
    acquisitionPricePerShare:
      input.acquisitionPricePerShare ?? existing.acquisitionPricePerShare.toString(),
    investmentDate:
      input.investmentDate !== undefined
        ? input.investmentDate
        : toIsoDate(existing.investmentDate),
    currentNav: input.currentNav ?? existing.currentNav.toString(),
    currency: input.currency ?? existing.currency,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });
  const write = await prisma.privateEquityPosition.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) throw new Error("Position introuvable");
  const row = await prisma.privateEquityPosition.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Position introuvable");
  return mapRow(row);
}

export async function deletePrivateEquity(userId: string, id: string) {
  const result = await prisma.privateEquityPosition.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Position introuvable");
  return { ok: true };
}
