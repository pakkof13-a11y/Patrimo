/**
 * Pure business rules for French employee savings (PEE / PER / PERCO).
 */

import {
  type EmployeeSavingsPlanType,
  type EmployeeSavingsUnlockMode,
  type LiquidityStatus,
  PLAN_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  type EmployeeSavingsSource,
  type UnlockTimelineBucket,
} from "./types";

/** PEE default lock period in years */
export const PEE_LOCK_YEARS = 5;

export function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Resolve theoretical unlock date and liquidity status.
 * - PER / PERCO default to retirement lock (unless unlockMode=DATE with a date)
 * - PEE: unlockDate explicit, else contributionDate + 5 years
 */
export function resolveUnlock(input: {
  planType: EmployeeSavingsPlanType | string;
  unlockMode?: EmployeeSavingsUnlockMode | string | null;
  unlockDate?: Date | string | null;
  contributionDate?: Date | string | null;
  now?: Date;
}): {
  unlockDate: Date | null;
  unlockMode: EmployeeSavingsUnlockMode;
  liquidityStatus: LiquidityStatus;
  unlockLabel: string;
} {
  const now = startOfDay(input.now ?? new Date());
  const plan = String(input.planType || "PEE").toUpperCase();
  let mode = String(input.unlockMode || "").toUpperCase() as EmployeeSavingsUnlockMode;

  if (mode !== "DATE" && mode !== "RETIREMENT") {
    mode = plan === "PEE" ? "DATE" : "RETIREMENT";
  }

  const parse = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  let unlockDate = parse(input.unlockDate);
  const contributionDate = parse(input.contributionDate);

  if (mode === "RETIREMENT") {
    return {
      unlockDate: null,
      unlockMode: "RETIREMENT",
      liquidityStatus: "BLOCKED",
      unlockLabel: "Retraite",
    };
  }

  // DATE mode
  if (!unlockDate && contributionDate && plan === "PEE") {
    unlockDate = addYears(contributionDate, PEE_LOCK_YEARS);
  }

  if (!unlockDate) {
    // No date → treat as blocked until known (PER forced to DATE without date)
    return {
      unlockDate: null,
      unlockMode: "DATE",
      liquidityStatus: "BLOCKED",
      unlockLabel: plan === "PEE" ? "À définir (+5 ans)" : "Date à définir",
    };
  }

  const unlockDay = startOfDay(unlockDate);
  const available = unlockDay.getTime() <= now.getTime();
  return {
    unlockDate,
    unlockMode: "DATE",
    liquidityStatus: available ? "AVAILABLE" : "BLOCKED",
    unlockLabel: unlockDay.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
  };
}

export function marketValue(units: number | string, nav: number | string): number {
  const u = Number(units);
  const n = Number(nav);
  if (!Number.isFinite(u) || !Number.isFinite(n)) return 0;
  return u * n;
}

export function planLabel(planType: string): string {
  const k = planType.toUpperCase() as EmployeeSavingsPlanType;
  return PLAN_TYPE_LABELS[k] || planType;
}

export function sourceLabel(sourceType: string): string {
  const k = sourceType.toUpperCase() as EmployeeSavingsSource;
  return SOURCE_TYPE_LABELS[k] || sourceType;
}

/** Group locked amounts by calendar year of unlock (for timeline UI) */
export function buildUnlockTimeline(
  lines: Array<{
    marketValue: number;
    liquidityStatus: LiquidityStatus;
    unlockMode: string;
    unlockDate: Date | null;
  }>
): UnlockTimelineBucket[] {
  let available = 0;
  let availableCount = 0;
  let retirement = 0;
  let retirementCount = 0;
  const byYear = new Map<string, { amount: number; count: number }>();

  for (const line of lines) {
    const v = line.marketValue;
    if (line.liquidityStatus === "AVAILABLE") {
      available += v;
      availableCount += 1;
      continue;
    }
    if (line.unlockMode === "RETIREMENT" || !line.unlockDate) {
      retirement += v;
      retirementCount += 1;
      continue;
    }
    const y = String(line.unlockDate.getFullYear());
    const cur = byYear.get(y) || { amount: 0, count: 0 };
    cur.amount += v;
    cur.count += 1;
    byYear.set(y, cur);
  }

  const buckets: UnlockTimelineBucket[] = [];
  if (available > 0 || availableCount > 0) {
    buckets.push({
      key: "available",
      label: "Déjà disponible",
      amount: available.toFixed(2),
      lineCount: availableCount,
    });
  }
  const years = [...byYear.keys()].sort();
  for (const y of years) {
    const b = byYear.get(y)!;
    buckets.push({
      key: y,
      label: y,
      amount: b.amount.toFixed(2),
      lineCount: b.count,
    });
  }
  if (retirement > 0 || retirementCount > 0) {
    buckets.push({
      key: "retirement",
      label: "Retraite",
      amount: retirement.toFixed(2),
      lineCount: retirementCount,
    });
  }
  return buckets;
}
