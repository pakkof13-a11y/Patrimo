/**
 * Période d’affichage du P&L latent (KPI global) — préférence UI.
 */

import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";

export const LATENT_PNL_RANGES = [
  "1d",
  "7d",
  "1m",
  "3m",
  "6m",
  "ytd",
  "1y",
  "5y",
  "all",
] as const;

export type LatentPnlRange = (typeof LATENT_PNL_RANGES)[number];

export const LATENT_PNL_RANGE_LABELS: Record<LatentPnlRange, string> = {
  "1d": "1J",
  "7d": "7J",
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  ytd: "YTD",
  "1y": "1A",
  "5y": "5A",
  all: "Tout",
};

const KEY = "latentPnlRange";

export function loadLatentPnlRange(): LatentPnlRange {
  const v = loadUiPref<string>(KEY, "all");
  if ((LATENT_PNL_RANGES as readonly string[]).includes(v)) {
    return v as LatentPnlRange;
  }
  return "all";
}

export function saveLatentPnlRange(range: LatentPnlRange): void {
  saveUiPref(KEY, range);
}

/** Date de début (UTC approx.) pour une période, null = ALL / sans borne. */
export function latentRangeStart(
  range: LatentPnlRange,
  now = new Date()
): Date | null {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "1d":
      return new Date(now.getTime() - 1 * day);
    case "7d":
      return new Date(now.getTime() - 7 * day);
    case "1m":
      return new Date(now.getTime() - 30 * day);
    case "3m":
      return new Date(now.getTime() - 93 * day);
    case "6m":
      return new Date(now.getTime() - 183 * day);
    case "ytd":
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    case "1y":
      return new Date(now.getTime() - 365 * day);
    case "5y":
      return new Date(now.getTime() - 5 * 365 * day);
    case "all":
    default:
      return null;
  }
}

/**
 * P&L « de période » : variation de valeur des positions (positionsBase)
 * entre le 1er point ≥ start et le dernier point (live).
 * Si ALL ou historique insuffisant → null (utiliser latent total).
 */
export function computePeriodLatentFromHistory(
  points: Array<{
    date: string;
    positionsBase?: number;
    unrealizedPnlBase?: number;
    totalValueBase?: number;
  }>,
  range: LatentPnlRange
): number | null {
  if (range === "all" || points.length < 2) return null;
  const start = latentRangeStart(range);
  if (!start) return null;
  const startMs = start.getTime();
  const inRange = points.filter((p) => Date.parse(p.date) >= startMs - 12 * 3600_000);
  if (inRange.length < 2) return null;
  const first = inRange[0]!;
  const last = inRange[inRange.length - 1]!;
  // Préférer variation de P&L latent si présent
  if (
    first.unrealizedPnlBase != null &&
    last.unrealizedPnlBase != null &&
    Number.isFinite(first.unrealizedPnlBase) &&
    Number.isFinite(last.unrealizedPnlBase)
  ) {
    return last.unrealizedPnlBase - first.unrealizedPnlBase;
  }
  const a = first.positionsBase ?? first.totalValueBase ?? 0;
  const b = last.positionsBase ?? last.totalValueBase ?? 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}
