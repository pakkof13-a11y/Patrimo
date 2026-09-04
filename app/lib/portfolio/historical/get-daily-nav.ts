/**
 * T-05 — `getDailyNav({ scope, from, to })`.
 *
 * Une série **dense** : exactement un point par jour civil Paris, bornes
 * incluses. Pas d'échantillonnage (l'écran peut réduire une copie ; ce
 * contrat, lui, ne retire aucun jour). Les scopes lisent le contrat T-01
 * (`computePatrimonyMetrics`) via les champs que le moteur publie déjà à
 * chaque date — aucune seconde formule.
 *
 * Lecture pure : le cache `AssetDailyClose` n'est pas complété ici. T-04
 * (cron / POST utilisateur) alimente les clôtures ; sans elles, une position
 * cotée reste au coût et le point se déclare estimé. Jamais de padding à 0.
 */

import { parisDayKey } from "../../dates/paris";
import {
  PATRIMONY_ASSET_POCKETS,
  type PatrimonyAssetPocket,
} from "../patrimony-metrics";
import { loadHistoricalInputs } from "./load";
import { PortfolioValuationEngine } from "./engine";
import type {
  DayKey,
  HistoricalDataStatus,
  PortfolioValuationPoint,
} from "./types";

export const DAILY_NAV_SCOPES = [
  "financier",
  "brut",
  "net",
  ...PATRIMONY_ASSET_POCKETS,
] as const;

export type DailyNavScope = (typeof DAILY_NAV_SCOPES)[number];

const SCOPE_SET = new Set<string>(DAILY_NAV_SCOPES);

export function isDailyNavScope(value: string): value is DailyNavScope {
  return SCOPE_SET.has(value);
}

export type DailyNavPoint = {
  day: DayKey;
  nav: number;
  status: HistoricalDataStatus;
  /** Capital externe du jour (apports / retraits / achats hors cash explicite). */
  externalFlows: number;
  listed: number;
  financier: number;
  brut: number;
  net: number;
};

export type DailyNavResult = {
  scope: DailyNavScope;
  from: DayKey;
  to: DayKey;
  /** Un point par jour civil, `from` → `to` inclus. */
  points: DailyNavPoint[];
};

/**
 * Valeur du scope à une date — lecture du contrat T-01, pas un recalcul.
 *
 * `financier` / `listed` / `brut` / `net` / poches viennent de
 * `computePatrimonyMetrics` au même instant.
 */
export function navAtScope(
  p: PortfolioValuationPoint,
  scope: DailyNavScope
): number {
  switch (scope) {
    case "financier":
      return p.financier;
    case "brut":
      return p.brut;
    case "net":
      return p.net;
    default: {
      const pocket: PatrimonyAssetPocket = scope;
      return p.pockets[pocket];
    }
  }
}

export function dailyNavFromSeries(
  series: PortfolioValuationPoint[],
  scope: DailyNavScope
): DailyNavPoint[] {
  return series.map((p) => ({
    day: p.day,
    nav: navAtScope(p, scope),
    status: p.status,
    externalFlows: p.externalFlows,
    listed: p.listed,
    financier: p.financier,
    brut: p.brut,
    net: p.net,
  }));
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDayKey(raw: string | null | undefined): DayKey | null {
  if (!raw || !DAY_KEY_RE.test(raw)) return null;
  return raw;
}

export function defaultDailyNavWindow(now = new Date()): {
  from: DayKey;
  to: DayKey;
} {
  const to = parisDayKey(now);
  const from = parisDayKey(new Date(now.getTime() - 365 * 86_400_000));
  return { from, to };
}

/** Pocket scopes already sketched by PatrimonyMetrics (hors passifs). */
export type DailyNavPocketScope = PatrimonyAssetPocket;

export async function getDailyNav(opts: {
  userId: string;
  scope: DailyNavScope;
  from: DayKey;
  to: DayKey;
}): Promise<DailyNavResult> {
  const from = opts.from <= opts.to ? opts.from : opts.to;
  const to = opts.from <= opts.to ? opts.to : opts.from;

  const inputs = await loadHistoricalInputs(opts.userId);
  const engine = new PortfolioValuationEngine(inputs);
  const series = engine.buildSeries(from, to);

  return {
    scope: opts.scope,
    from,
    to,
    points: dailyNavFromSeries(series, opts.scope),
  };
}
