/**
 * T-4.F — filtres de poche (Actions / Immo / Cash / …) sur la série daily-nav.
 *
 * Le hero demande déjà `from`/`to` ; `getDailyNav` ramène `from` à
 * `earliestDayForScope`. Les filtres doivent **la même fenêtre**, le même
 * clamp, et ne dire « Période trop courte » que s'il reste moins de deux
 * points **après** ce clamp.
 *
 * Immo / cash / alternatifs (classe AUTRE) se dessinent en marches : une
 * expertise vaut jusqu'à la suivante. Interpoler entre deux constats
 * inventerait des valeurs que le moteur s'interdit.
 */

import { endOfParisDay } from "../dates/paris";
import type { EvolutionAssetClass } from "./evolution-prefs";
import type { EvolutionSeriesPoint } from "./evolution-aggregate";
import {
  windowDailyNav,
  type DailyNavChartPoint,
} from "./daily-nav-view";
import type { EvolutionRange } from "./evolution-aggregate";
import type {
  DailyNavPoint,
  DailyNavScope,
} from "./historical/get-daily-nav";
import type {
  EnvelopeCapableClass,
  ValuationAssetClass,
} from "./historical/types";

/** Moins de deux points après clamp : rien à tracer, pas une courbe plate. */
export const MIN_POCKET_SERIES_POINTS = 2;

/**
 * Classes illiquides : le moteur reconduit la dernière expertise (LOCF).
 * Un trait linéaire entre deux constats éloignés interpolerait.
 */
export const ILLIQUID_POCKET_CLASSES = new Set<EvolutionAssetClass>([
  "IMMOBILIER",
  "CASH",
  "AUTRE",
]);

export function isIlliquidPocketClass(
  assetClass: EvolutionAssetClass | null | undefined
): boolean {
  return assetClass != null && ILLIQUID_POCKET_CLASSES.has(assetClass);
}

export function pocketChartLineType(
  assetClass: EvolutionAssetClass | null | undefined
): "linear" | "stepAfter" {
  return isIlliquidPocketClass(assetClass) ? "stepAfter" : "linear";
}

/**
 * Scope `getDailyNav` dont `earliestDayForScope` borne le filtre.
 *
 * Actions / obligations / crypto partagent la poche `listed`. AUTRE agrège
 * alternatifs, épargne salariale et le résidu `autre` : on demande `brut`
 * pour ne pas tronquer « Tout » à la première de ces trois sources.
 */
export function dailyNavScopeForClass(
  assetClass: EvolutionAssetClass
): DailyNavScope {
  switch (assetClass) {
    case "IMMOBILIER":
      return "immobilier";
    case "CASH":
      return "cash";
    case "ACTIONS":
    case "OBLIGATIONS":
    case "CRYPTO":
      return "listed";
    case "AUTRE":
      return "brut";
  }
}

/**
 * Si la fenêtre demandée précède la première observation du scope, on la
 * ramène à cette borne — jamais une série fantôme avant, jamais un écran
 * vide sous prétexte que `from` est trop ancien.
 */
export function clampRequestedFrom(
  requestedFrom: string,
  earliestDayForScope: string | null
): string | null {
  if (earliestDayForScope == null) return null;
  return requestedFrom < earliestDayForScope
    ? earliestDayForScope
    : requestedFrom;
}

export function pocketSeriesTooShort(
  points: readonly unknown[]
): boolean {
  return points.length < MIN_POCKET_SERIES_POINTS;
}

/**
 * Fenêtre UI (6M, Tout, …) sur une série déjà clampée par `getDailyNav`.
 *
 * `servedFrom` est la borne **servie**, pas celle demandée : un « Tout »
 * financier ne doit pas réintroduire les jours d'avant la poche.
 */
export function windowPocketDailyNav(
  points: DailyNavPoint[],
  range: EvolutionRange,
  referenceDay: string,
  servedFrom?: string | null
): DailyNavPoint[] {
  const windowed = windowDailyNav(points, range, referenceDay);
  if (!servedFrom) return windowed;
  return windowed.filter((p) => p.day >= servedFrom);
}

export function pocketValueAt(
  point: DailyNavPoint,
  assetClass: EvolutionAssetClass,
  envelope?: "PEA" | "CTO" | null
): number | null {
  if (envelope) {
    const crossed =
      point.byAssetClassAndEnvelope?.[assetClass as EnvelopeCapableClass]?.[
        envelope
      ];
    if (crossed == null) return null;
    return crossed;
  }
  const published = point.byAssetClass?.[assetClass as ValuationAssetClass];
  if (published != null && Number.isFinite(published)) return published;
  switch (assetClass) {
    case "IMMOBILIER":
      return point.immobilier;
    case "CASH":
      return point.cash;
    case "AUTRE":
      return point.alternatifs + point.employeeSavings;
    case "ACTIONS":
    case "OBLIGATIONS":
    case "CRYPTO":
      return null;
  }
}

function emptyStockFields(total: number): Omit<
  EvolutionSeriesPoint,
  | "date"
  | "t"
  | "label"
  | "periodLabel"
  | "total"
  | "flows"
  | "chartValue"
  | "intervalType"
  | "status"
> {
  return {
    cash: 0,
    positions: total,
    realized: 0,
    unrealized: 0,
    income: 0,
    dividends: 0,
    coupons: 0,
    rents: 0,
    pos: 0,
    neg: 0,
    dPositions: 0,
    dCash: 0,
    dRealized: 0,
    dUnrealized: 0,
    dIncome: 0,
    dDividends: 0,
    dCoupons: 0,
    dRents: 0,
  };
}

/**
 * Série tracée pour un filtre de poche — les valeurs du moteur, sans
 * interpolation. Le type de trait (`stepAfter` / `linear`) est une décision
 * d'écran, pas une fabrication de points intermédiaires.
 */
export function toPocketEvolutionPoints(
  points: DailyNavPoint[],
  assetClass: EvolutionAssetClass,
  envelope?: "PEA" | "CTO" | null
): EvolutionSeriesPoint[] {
  const out: EvolutionSeriesPoint[] = [];
  for (const p of points) {
    const total = pocketValueAt(p, assetClass, envelope);
    if (total == null) continue;
    const at = endOfParisDay(p.day);
    const flows = envelope
      ? 0
      : (p.flowsByAssetClass?.[assetClass as ValuationAssetClass] ?? 0);
    out.push({
      date: at.toISOString(),
      t: at.getTime(),
      label: p.day,
      periodLabel: p.day,
      total,
      flows,
      chartValue: total,
      intervalType: "day",
      status: p.status === "EXACT" ? "EXACT" : "ESTIMATED",
      ...emptyStockFields(total),
    });
  }
  return out;
}

/** Points au format du graphique de valeur, pour les tests de marches. */
export function toPocketChartPoints(
  points: DailyNavPoint[],
  assetClass: EvolutionAssetClass,
  envelope?: "PEA" | "CTO" | null
): Array<Pick<DailyNavChartPoint, "day" | "t" | "periodLabel" | "total">> {
  return toPocketEvolutionPoints(points, assetClass, envelope).map((p) => ({
    day: p.label,
    t: p.t ?? 0,
    periodLabel: p.periodLabel,
    total: p.total,
  }));
}
