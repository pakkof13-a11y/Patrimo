import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  buildUnlockTimeline,
  marketValue,
  planLabel,
  resolveUnlock,
  sourceLabel,
} from "./logic";
import type {
  EmployeeSavingsLineDto,
  EmployeeSavingsPlanType,
  EmployeeSavingsSource,
  EmployeeSavingsSummary,
  EmployeeSavingsUnlockMode,
} from "./types";

function dec(v: string | number | undefined | null, fallback = "0"): Prisma.Decimal {
  const s = String(v ?? fallback).trim().replace(",", ".");
  const n = Number(s);
  return new Prisma.Decimal(Number.isFinite(n) ? s : fallback);
}

function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function mapLine(row: {
  id: string;
  planType: string;
  manager: string;
  fundName: string;
  isin: string | null;
  units: Prisma.Decimal;
  nav: Prisma.Decimal;
  currency: string;
  sourceType: string;
  contributionDate: Date | null;
  unlockDate: Date | null;
  unlockMode: string;
  notes: string | null;
}): EmployeeSavingsLineDto {
  const unlock = resolveUnlock({
    planType: row.planType,
    unlockMode: row.unlockMode,
    unlockDate: row.unlockDate,
    contributionDate: row.contributionDate,
  });
  const units = row.units.toString();
  const nav = row.nav.toString();
  const mv = marketValue(units, nav);

  return {
    id: row.id,
    planType: row.planType as EmployeeSavingsPlanType,
    manager: row.manager,
    fundName: row.fundName,
    isin: row.isin,
    units,
    nav,
    currency: row.currency,
    sourceType: row.sourceType as EmployeeSavingsSource,
    contributionDate: toIsoDate(row.contributionDate),
    unlockDate: unlock.unlockDate ? toIsoDate(unlock.unlockDate) : toIsoDate(row.unlockDate),
    unlockMode: unlock.unlockMode,
    notes: row.notes,
    marketValue: mv.toFixed(2),
    liquidityStatus: unlock.liquidityStatus,
    unlockLabel: unlock.unlockLabel,
  };
}

export async function listEmployeeSavings(userId: string): Promise<{
  lines: EmployeeSavingsLineDto[];
  summary: EmployeeSavingsSummary;
}> {
  const rows = await prisma.employeeSavingsLine.findMany({
    where: { userId },
    orderBy: [{ planType: "asc" }, { manager: "asc" }, { fundName: "asc" }],
  });
  const lines = rows.map(mapLine);
  return { lines, summary: summarizeLines(lines) };
}

export function summarizeLines(lines: EmployeeSavingsLineDto[]): EmployeeSavingsSummary {
  let total = 0;
  let available = 0;
  let blocked = 0;
  const byPlan = new Map<string, number>();
  const byManager = new Map<string, number>();
  const bySource = new Map<string, number>();

  const timelineInput: Array<{
    marketValue: number;
    liquidityStatus: "AVAILABLE" | "BLOCKED";
    unlockMode: string;
    unlockDate: Date | null;
  }> = [];

  for (const l of lines) {
    const v = Number(l.marketValue) || 0;
    total += v;
    if (l.liquidityStatus === "AVAILABLE") available += v;
    else blocked += v;

    byPlan.set(l.planType, (byPlan.get(l.planType) || 0) + v);
    byManager.set(l.manager, (byManager.get(l.manager) || 0) + v);
    bySource.set(l.sourceType, (bySource.get(l.sourceType) || 0) + v);

    timelineInput.push({
      marketValue: v,
      liquidityStatus: l.liquidityStatus,
      unlockMode: l.unlockMode,
      unlockDate: l.unlockDate ? new Date(l.unlockDate) : null,
    });
  }

  const pct = (part: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

  return {
    totalValue: total.toFixed(2),
    availableValue: available.toFixed(2),
    blockedValue: blocked.toFixed(2),
    availablePct: pct(available),
    blockedPct: pct(blocked),
    byPlanType: [...byPlan.entries()]
      .map(([planType, value]) => ({
        planType,
        name: planLabel(planType),
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value),
    byManager: [...byManager.entries()]
      .map(([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value),
    bySource: [...bySource.entries()]
      .map(([sourceType, value]) => ({
        sourceType,
        name: sourceLabel(sourceType),
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value),
    unlockTimeline: buildUnlockTimeline(timelineInput),
    lineCount: lines.length,
  };
}

export type CreateEmployeeSavingsInput = {
  planType: string;
  manager: string;
  fundName: string;
  isin?: string | null;
  units?: string | number;
  nav?: string | number;
  currency?: string;
  sourceType?: string;
  contributionDate?: string | null;
  unlockDate?: string | null;
  unlockMode?: string | null;
  notes?: string | null;
};

function parseOptionalDate(v: string | null | undefined): Date | null {
  if (!v || !String(v).trim()) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeCreate(input: CreateEmployeeSavingsInput) {
  const planType = String(input.planType || "PEE").toUpperCase();
  let unlockMode = String(input.unlockMode || "").toUpperCase();
  if (unlockMode !== "DATE" && unlockMode !== "RETIREMENT") {
    unlockMode = planType === "PEE" ? "DATE" : "RETIREMENT";
  }
  const contributionDate = parseOptionalDate(input.contributionDate ?? null);
  let unlockDate = parseOptionalDate(input.unlockDate ?? null);

  // Auto PEE unlock if missing
  if (unlockMode === "DATE" && !unlockDate && contributionDate && planType === "PEE") {
    unlockDate = new Date(contributionDate);
    unlockDate.setFullYear(unlockDate.getFullYear() + 5);
  }
  if (unlockMode === "RETIREMENT") {
    unlockDate = null;
  }

  return {
    planType,
    manager: String(input.manager || "").trim(),
    fundName: String(input.fundName || "").trim(),
    isin: input.isin ? String(input.isin).trim().toUpperCase() || null : null,
    units: dec(input.units, "0"),
    nav: dec(input.nav, "0"),
    currency: (input.currency || "EUR").toUpperCase().slice(0, 3),
    sourceType: String(input.sourceType || "VOLUNTARY").toUpperCase(),
    contributionDate,
    unlockDate,
    unlockMode: unlockMode as EmployeeSavingsUnlockMode,
    notes: input.notes ? String(input.notes) : null,
  };
}

export async function createEmployeeSavingsLine(userId: string, input: CreateEmployeeSavingsInput) {
  const data = normalizeCreate(input);
  if (!data.manager) throw new Error("Gestionnaire requis");
  if (!data.fundName) throw new Error("Nom du fonds requis");
  const row = await prisma.employeeSavingsLine.create({
    data: { userId, ...data },
  });
  return mapLine(row);
}

export async function updateEmployeeSavingsLine(
  userId: string,
  id: string,
  input: Partial<CreateEmployeeSavingsInput>
) {
  const existing = await prisma.employeeSavingsLine.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Ligne introuvable");

  const merged: CreateEmployeeSavingsInput = {
    planType: input.planType ?? existing.planType,
    manager: input.manager ?? existing.manager,
    fundName: input.fundName ?? existing.fundName,
    isin: input.isin !== undefined ? input.isin : existing.isin,
    units: input.units !== undefined ? input.units : existing.units.toString(),
    nav: input.nav !== undefined ? input.nav : existing.nav.toString(),
    currency: input.currency ?? existing.currency,
    sourceType: input.sourceType ?? existing.sourceType,
    contributionDate:
      input.contributionDate !== undefined
        ? input.contributionDate
        : toIsoDate(existing.contributionDate),
    unlockDate:
      input.unlockDate !== undefined ? input.unlockDate : toIsoDate(existing.unlockDate),
    unlockMode: input.unlockMode ?? existing.unlockMode,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  };

  const data = normalizeCreate(merged);
  const row = await prisma.employeeSavingsLine.update({
    where: { id },
    data,
  });
  return mapLine(row);
}

export async function deleteEmployeeSavingsLine(userId: string, id: string) {
  const existing = await prisma.employeeSavingsLine.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Ligne introuvable");
  await prisma.employeeSavingsLine.delete({ where: { id } });
  return { ok: true };
}

/** Upsert-ish bulk import: create each row (no silent merge by ISIN to avoid wrong merges) */
export async function importEmployeeSavingsLines(
  userId: string,
  rows: CreateEmployeeSavingsInput[]
) {
  let created = 0;
  const errors: Array<{ line: number; message: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      await createEmployeeSavingsLine(userId, rows[i]);
      created += 1;
    } catch (e) {
      errors.push({
        line: i + 1,
        message: e instanceof Error ? e.message : "Erreur",
      });
    }
  }
  return { created, errors };
}
