/**
 * Adaptateur UI de `getDailyNav`.
 *
 * Hero, KPI et évolution lisent **la même** série dense : un point par jour
 * civil Paris, sans spline ni seau hebdo. Changer de période ne change que
 * la fenêtre ; cliquer Brut / Net / Financier ne change que le champ lu.
 *
 * Aucune valeur n'est calculée ici qui ne soit déjà sur le point T-05.
 */

import { endOfParisDay, parisDayKey } from "../dates/paris";
import {
  startOfRange,
  type EvolutionRange,
} from "./evolution-aggregate";
import type { DailyNavPoint, DailyNavScope } from "./historical/get-daily-nav";
import type { HistoryPoint } from "../types/ui";

/** Scopes tracés par les trois cartes Finary — ordre d'affichage. */
export const HERO_NAV_SCOPES = ["brut", "net", "financier"] as const;
export type HeroNavScope = (typeof HERO_NAV_SCOPES)[number];

export function isHeroNavScope(v: unknown): v is HeroNavScope {
  return (
    typeof v === "string" &&
    (HERO_NAV_SCOPES as readonly string[]).includes(v)
  );
}

export const HERO_NAV_SCOPE_LABEL: Record<HeroNavScope, string> = {
  financier: "Financier",
  brut: "Brut",
  net: "Net",
};

export const HERO_NAV_SCOPE_TITLE: Record<HeroNavScope, string> = {
  financier: "Titres, cash, fonds euro et épargne salariale disponible",
  brut: "Total des actifs, passifs non déduits",
  net: "Actifs moins passifs",
};

export function navOfPoint(p: DailyNavPoint, scope: HeroNavScope): number {
  switch (scope) {
    case "financier":
      return p.financier;
    case "brut":
      return p.brut;
    case "net":
      return p.net;
  }
}

/**
 * Instant de référence du fenêtrage : dernier jour de la série, pas l'horloge.
 */
export function dailyNavReferenceDay(
  points: DailyNavPoint[],
  fallback = new Date()
): string {
  const last = points[points.length - 1]?.day;
  return last ?? parisDayKey(fallback);
}

/**
 * Fenêtre dense d'une série quotidienne.
 *
 * Compare des `YYYY-MM-DD` parisiennes, jamais `Date.parse("YYYY-MM-DD")`
 * (minuit UTC, qui recule d'un jour en soirée d'été). L'ancre — dernier
 * point strictement avant la période — reste en tête pour le Δ.
 */
export function windowDailyNav<T extends { day: string }>(
  points: T[],
  range: EvolutionRange,
  referenceDay: string
): T[] {
  const from = startOfRange(range, endOfParisDay(referenceDay));
  if (!from) return points;
  const fromKey = parisDayKey(from);
  let anchorIdx = -1;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.day < fromKey) anchorIdx = i;
  }
  const inRange = points.filter((p) => p.day >= fromKey);
  if (inRange.length === 0) return points;
  return anchorIdx >= 0 ? [points[anchorIdx]!, ...inRange] : inRange;
}

/**
 * Bornes `from`/`to` pour `GET /api/portfolio/daily-nav`.
 *
 * On demande toujours une série dense (1 pt/jour). La période n'y retire
 * aucun jour : l'écran fenêtrera ensuite. `all` part du premier jour connu
 * (historique ou première tx), pas d'un an glissant.
 */
export function dailyNavQueryWindow(
  range: EvolutionRange,
  referenceDay: string,
  earliestDay?: string | null
): { from: string; to: string } {
  const to = referenceDay;
  if (range === "all") {
    const from = earliestDay && earliestDay <= to ? earliestDay : to;
    return { from, to };
  }
  const fromDate = startOfRange(range, endOfParisDay(referenceDay));
  const from = fromDate ? parisDayKey(fromDate) : to;
  const anchor = previousDayKey(from);
  const start = anchor < from ? anchor : from;
  if (!earliestDay) return { from: start, to };
  return { from: start < earliestDay ? earliestDay : start, to };
}

function previousDayKey(day: string): string {
  const start = endOfParisDay(day).getTime() - 36 * 3600_000;
  return parisDayKey(new Date(start));
}

/**
 * Δ quotidien de la NAV du scope — le premier point (ancre) n'a pas de Δ.
 */
export function dailyNavDeltas(
  points: DailyNavPoint[],
  scope: HeroNavScope
): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      out.push(0);
      continue;
    }
    out.push(navOfPoint(points[i]!, scope) - navOfPoint(points[i - 1]!, scope));
  }
  return out;
}

/**
 * Somme des Δ journaliers **hors ancre** = dernier − premier.
 *
 * C'est l'identité que l'écran affiche : les barres du graphique d'évolution
 * totalisent le Δ d'en-tête, aux arrondis flottants près.
 */
export function sumDailyDeltas(deltas: number[]): number {
  if (deltas.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < deltas.length; i++) s += deltas[i]!;
  return s;
}

export function headerDelta(
  points: DailyNavPoint[],
  scope: HeroNavScope
): number | null {
  if (points.length < 2) return null;
  return (
    navOfPoint(points[points.length - 1]!, scope) - navOfPoint(points[0]!, scope)
  );
}

export type DailyNavChartPoint = {
  date: string;
  t: number;
  day: string;
  periodLabel: string;
  total: number;
  delta: number;
  flows: number;
  transactionFlow: number;
  status: DailyNavPoint["status"];
  carried: boolean;
};

/**
 * Série tracée (NAV + Δ jour) — linéaire, aucun seau, aucun spline.
 *
 * `delta` du premier point vaut 0 : l'ancre borne le Δ d'en-tête, elle n'est
 * pas une barre de la période.
 */
export function toDailyNavChartPoints(
  points: DailyNavPoint[],
  scope: HeroNavScope
): DailyNavChartPoint[] {
  const deltas = dailyNavDeltas(points, scope);
  return points.map((p, i) => {
    const at = endOfParisDay(p.day);
    return {
      date: at.toISOString(),
      t: at.getTime(),
      day: p.day,
      periodLabel: p.day,
      total: navOfPoint(p, scope),
      delta: deltas[i] ?? 0,
      flows: p.externalFlows,
      transactionFlow: p.transactionFlow,
      status: p.status,
      carried:
        p.status === "ESTIMATED" ||
        p.priceOrigins.includes("MARKET_CARRIED"),
    };
  });
}

/**
 * Recompose un `HistoryPoint` par jour, pour réutiliser hero / KPI sans
 * seconde formule. La série reste dense : un point par `day`.
 */
export function dailyNavToHistoryPoints(
  points: DailyNavPoint[]
): HistoryPoint[] {
  return points.map((p) => {
    const at = endOfParisDay(p.day);
    const carried =
      p.status === "ESTIMATED" || p.priceOrigins.includes("MARKET_CARRIED");
    return {
      date: at.toISOString(),
      label: p.day,
      totalValueEur: p.brut,
      cashTotalEur: p.cash,
      totalValueBase: p.brut,
      cashTotalBase: p.cash,
      grossAssetsBase: p.brut,
      netWorthBase: p.net,
      financierBase: p.financier,
      listedBase: p.listed,
      liabilitiesBase: p.passifs,
      alternativesBase: p.alternatifs,
      employeeSavingsBase: p.employeeSavings,
      realEstateBase: p.immobilier,
      lifeInsuranceBase: p.av,
      externalFlowsBase: p.externalFlows,
      transactionFlowBase: p.transactionFlow,
      financierFlowsBase: p.financierFlows,
      unrealizedPnlBase: p.unrealizedPnl,
      realizedPnlBase: p.realizedPnl,
      ledgerCashIncomeBase: p.ledgerCashIncome,
      status: p.status,
      estimated: carried || undefined,
    };
  });
}

export type DailyNavKpiPick =
  | "listed"
  | "cash"
  | "alternatifs"
  | "employeeSavings"
  | "passifs"
  | "unrealizedPnl"
  | "realizedPlusIncome";

export function kpiValueAt(
  p: DailyNavPoint,
  pick: DailyNavKpiPick
): number {
  switch (pick) {
    case "listed":
      return p.listed;
    case "cash":
      return p.cash;
    case "alternatifs":
      return p.alternatifs;
    case "employeeSavings":
      return p.employeeSavings;
    case "passifs":
      return p.passifs;
    case "unrealizedPnl":
      return p.unrealizedPnl;
    case "realizedPlusIncome":
      return p.realizedPnl + p.ledgerCashIncome;
  }
}

export function dailyNavKpiSeries(
  points: DailyNavPoint[],
  pick: DailyNavKpiPick
): number[] | undefined {
  if (points.length < 2) return undefined;
  return points.map((p) => kpiValueAt(p, pick));
}

/** Scope API : les trois cartes + listed pour les sparks « Titres & crypto ». */
export function dailyNavApiScope(
  scope: HeroNavScope
): Extract<DailyNavScope, HeroNavScope> {
  return scope;
}
