import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  CL_REPAYMENT_TYPES,
  CL_STATUSES,
  CL_STATUS_LABELS,
  type ClRepaymentType,
  type ClStatus,
  type CrowdlendingDto,
  type CrowdlendingSummary,
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

function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v || !String(v).trim()) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeStatus(raw: string | undefined): ClStatus {
  const s = String(raw || "ACTIVE").toUpperCase();
  if ((CL_STATUSES as readonly string[]).includes(s)) return s as ClStatus;
  return "ACTIVE";
}

function normalizeRepayment(raw: string | undefined): ClRepaymentType {
  const s = String(raw || "IN_FINE").toUpperCase();
  if ((CL_REPAYMENT_TYPES as readonly string[]).includes(s)) return s as ClRepaymentType;
  return "IN_FINE";
}

/** Months between now and maturity (can be negative if past) */
export function monthsUntil(maturity: Date | null, now = new Date()): number | null {
  if (!maturity) return null;
  const y = maturity.getFullYear() - now.getFullYear();
  const m = maturity.getMonth() - now.getMonth();
  let months = y * 12 + m;
  if (maturity.getDate() < now.getDate()) months -= 1;
  return months;
}

export function loanProgressPct(
  start: Date | null,
  maturity: Date | null,
  now = new Date()
): number | null {
  if (!start || !maturity) return null;
  const t0 = start.getTime();
  const t1 = maturity.getTime();
  if (t1 <= t0) return 100;
  const p = ((now.getTime() - t0) / (t1 - t0)) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

function mapRow(row: {
  id: string;
  projectName: string;
  platform: string | null;
  capitalInvested: Prisma.Decimal;
  annualYieldPercent: Prisma.Decimal;
  durationMonths: number;
  repaymentType: string;
  startDate: Date | null;
  maturityDate: Date | null;
  status: string;
  currency: string;
  notes: string | null;
}): CrowdlendingDto {
  return {
    id: row.id,
    projectName: row.projectName,
    platform: row.platform,
    capitalInvested: row.capitalInvested.toString(),
    annualYieldPercent: row.annualYieldPercent.toString(),
    durationMonths: row.durationMonths,
    repaymentType: normalizeRepayment(row.repaymentType),
    startDate: toIsoDate(row.startDate),
    maturityDate: toIsoDate(row.maturityDate),
    status: normalizeStatus(row.status),
    currency: row.currency,
    notes: row.notes,
    monthsRemaining: monthsUntil(row.maturityDate),
    progressPct: loanProgressPct(row.startDate, row.maturityDate),
  };
}

export function summarizeCrowdlending(lines: CrowdlendingDto[]): CrowdlendingSummary {
  let totalCapital = 0;
  let activeCapital = 0;
  const byStatus = new Map<string, { count: number; capital: number }>();

  for (const l of lines) {
    const cap = n(l.capitalInvested);
    totalCapital += cap;
    if (l.status === "ACTIVE" || l.status === "LATE") activeCapital += cap;
    const cur = byStatus.get(l.status) || { count: 0, capital: 0 };
    cur.count += 1;
    cur.capital += cap;
    byStatus.set(l.status, cur);
  }

  return {
    totalCapital: totalCapital.toFixed(2),
    activeCapital: activeCapital.toFixed(2),
    lineCount: lines.length,
    byStatus: [...byStatus.entries()].map(([status, v]) => ({
      status,
      label: CL_STATUS_LABELS[status as ClStatus] || status,
      count: v.count,
      capital: Math.round(v.capital * 100) / 100,
    })),
  };
}

export async function listCrowdlending(userId: string) {
  const rows = await prisma.crowdlendingPosition.findMany({
    where: { userId },
    orderBy: [{ maturityDate: "asc" }, { projectName: "asc" }],
  });
  const lines = rows.map(mapRow);
  return { lines, summary: summarizeCrowdlending(lines) };
}

export type CrowdlendingInput = {
  projectName: string;
  platform?: string | null;
  capitalInvested?: string | number;
  annualYieldPercent?: string | number;
  durationMonths?: string | number;
  repaymentType?: string;
  startDate?: string | null;
  maturityDate?: string | null;
  status?: string;
  currency?: string;
  notes?: string | null;
};

function normalize(input: CrowdlendingInput) {
  const startDate = parseDate(input.startDate ?? null);
  let maturityDate = parseDate(input.maturityDate ?? null);
  const durationMonths = Math.max(
    0,
    Math.floor(Number(input.durationMonths ?? 12) || 12)
  );

  // Auto maturity from start + duration if missing
  if (!maturityDate && startDate && durationMonths > 0) {
    maturityDate = new Date(startDate);
    maturityDate.setMonth(maturityDate.getMonth() + durationMonths);
  }

  return {
    projectName: String(input.projectName || "").trim(),
    platform: input.platform ? String(input.platform).trim() : null,
    capitalInvested: dec(input.capitalInvested, "0"),
    annualYieldPercent: dec(input.annualYieldPercent, "0"),
    durationMonths,
    repaymentType: normalizeRepayment(input.repaymentType),
    startDate,
    maturityDate,
    status: normalizeStatus(input.status),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    notes: input.notes ? String(input.notes) : null,
  };
}

export async function createCrowdlending(userId: string, input: CrowdlendingInput) {
  const data = normalize(input);
  if (!data.projectName) throw new Error("Nom du projet requis");
  const row = await prisma.crowdlendingPosition.create({ data: { userId, ...data } });
  return mapRow(row);
}

export async function updateCrowdlending(
  userId: string,
  id: string,
  input: Partial<CrowdlendingInput>
) {
  const existing = await prisma.crowdlendingPosition.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Position introuvable");
  const data = normalize({
    projectName: input.projectName ?? existing.projectName,
    platform: input.platform !== undefined ? input.platform : existing.platform,
    capitalInvested: input.capitalInvested ?? existing.capitalInvested.toString(),
    annualYieldPercent:
      input.annualYieldPercent ?? existing.annualYieldPercent.toString(),
    durationMonths: input.durationMonths ?? existing.durationMonths,
    repaymentType: input.repaymentType ?? existing.repaymentType,
    startDate:
      input.startDate !== undefined ? input.startDate : toIsoDate(existing.startDate),
    maturityDate:
      input.maturityDate !== undefined
        ? input.maturityDate
        : toIsoDate(existing.maturityDate),
    status: input.status ?? existing.status,
    currency: input.currency ?? existing.currency,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });
  const write = await prisma.crowdlendingPosition.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) throw new Error("Position introuvable");
  const row = await prisma.crowdlendingPosition.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Position introuvable");
  return mapRow(row);
}

export async function deleteCrowdlending(userId: string, id: string) {
  const result = await prisma.crowdlendingPosition.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Position introuvable");
  return { ok: true };
}
