/**
 * T-4.E — Vs indice : base 100 à l'ancre servie.
 *
 * Fenêtre = `servedFrom…to` de `getDailyNav` (jamais la borne demandée si
 * le moteur a clampé). NAV et indice partagent **la même ancre** : le
 * premier jour de cette fenêtre.
 *
 *   base100(t) = 100 × niveau(t) / niveau(ancre)
 *
 * Les deux valent 100 à l'ancre. On ne compare jamais une NAV en euros à
 * un indice déjà en %. Pas de seconde formule Δ — `dailyNavDeltas` /
 * flux restent hors de ce module.
 *
 * Indice : pas d'interpolation. Week-end = LOCF last-close. Aucune close
 * ≤ ancre → overlay absent (`undefined`), jamais 0 ni 100 inventé.
 * Réseau down / 429 / vide → même règle : overlay off, NAV intacte.
 */

import { endOfParisDay, parisDayKey } from "../dates/paris";
import type { EvolutionPercentPoint, EvolutionRange } from "./evolution-aggregate";
import {
  navOfPoint,
  windowDailyNav,
  type HeroNavScope,
} from "./daily-nav-view";
import type { DailyNavPoint } from "./historical/get-daily-nav";

/** Niveau brut — NAV € ou clôture d'indice, jamais un pourcentage. */
export type VsIndexLevel = {
  /** Jour civil `YYYY-MM-DD`, ou ISO (normalisé en jour Paris). */
  day: string;
  value: number;
};

export type VsIndexBase100Point = {
  day: string;
  date: string;
  t: number;
  /** 100 × NAV(t) / NAV(ancre). */
  portfolioBase100: number;
  /** 100 × close(t) / close(ancre) — absent si overlay off. */
  indexBase100?: number;
  /** `portfolioBase100 − 100` — 0 % à l'ancre. */
  portfolioPct: number;
  /** `indexBase100 − 100` — même origine, ou absent. */
  benchmarkPct?: number;
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function vsIndexDayKey(dayOrIso: string): string {
  if (DAY_KEY.test(dayOrIso)) return dayOrIso;
  return parisDayKey(dayOrIso);
}

function usableLevels(levels: readonly VsIndexLevel[]): VsIndexLevel[] {
  const out: VsIndexLevel[] = [];
  for (const l of levels) {
    const day = vsIndexDayKey(l.day);
    if (!day || !Number.isFinite(l.value) || !(l.value > 0)) continue;
    out.push({ day, value: l.value });
  }
  out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return out;
}

/**
 * Dernier niveau d'indice ≤ `day` (LOCF).
 *
 * Le CAC n'a pas de clôture le week-end : un samedi de NAV reprend le
 * vendredi, sans inventer de cours. `null` s'il n'existe aucune close
 * à cette date ou avant — l'overlay doit alors rester absent.
 */
export function makeIndexLevelAt(
  index: readonly VsIndexLevel[]
): (day: string) => number | null {
  const sorted = usableLevels(index);
  return (day: string): number | null => {
    const key = vsIndexDayKey(day);
    if (!key) return null;
    let best: number | null = null;
    for (const l of sorted) {
      if (l.day <= key) best = l.value;
      else break;
    }
    return best;
  };
}

/**
 * Fenêtre Versus : même `windowDailyNav` que le hero, puis plancher
 * `servedFrom` — jamais la borne demandée si `getDailyNav` a clampé.
 */
export function windowVsIndexNav(
  points: DailyNavPoint[],
  range: EvolutionRange,
  referenceDay: string,
  servedFrom?: string | null
): DailyNavPoint[] {
  const windowed = windowDailyNav(points, range, referenceDay);
  if (!servedFrom) return windowed;
  return windowed.filter((p) => p.day >= servedFrom);
}

export function dailyNavToVsIndexLevels(
  points: readonly DailyNavPoint[],
  scope: HeroNavScope
): VsIndexLevel[] {
  return points.map((p) => ({
    day: p.day,
    value: navOfPoint(p, scope),
  }));
}

/**
 * Ancre = premier jour NAV de la fenêtre servie.
 *
 * Ce n'est pas « le premier jour où les deux existent » : décaler l'ancre
 * pour attendre le CAC inventerait une origine que le hero n'a pas.
 */
export function vsIndexAnchorDay(
  portfolio: readonly VsIndexLevel[]
): string | null {
  return usableLevels(portfolio)[0]?.day ?? null;
}

/**
 * Close d'indice à l'ancre (LOCF). `null` → overlay off.
 */
export function indexCloseAtAnchor(
  anchorDay: string,
  index: readonly VsIndexLevel[]
): number | null {
  const close = makeIndexLevelAt(index)(anchorDay);
  return close != null && close > 0 ? close : null;
}

/**
 * Rebase à 100 à l'ancre NAV (premier jour de la fenêtre).
 *
 * Overlay seulement si une close existe ≤ ancre. Sinon les points NAV
 * restent, `indexBase100` / `benchmarkPct` restent `undefined` — jamais
 * 0 ni 100 inventés pour l'indice.
 */
export function rebaseToCommonBase100(
  portfolio: readonly VsIndexLevel[],
  index: readonly VsIndexLevel[] = []
): VsIndexBase100Point[] {
  const navs = usableLevels(portfolio);
  if (navs.length === 0) return [];

  const navByDay = new Map<string, number>();
  for (const p of navs) navByDay.set(p.day, p.value);
  const days = [...navByDay.keys()].sort();

  const baseDay = days[0]!;
  const nav0 = navByDay.get(baseDay);
  if (nav0 == null || !(nav0 > 0)) return [];

  const indexAt = makeIndexLevelAt(index);
  const idx0 = indexCloseAtAnchor(baseDay, index);

  const out: VsIndexBase100Point[] = [];
  for (const day of days) {
    const nav = navByDay.get(day);
    if (nav == null || !(nav > 0)) continue;
    const at = endOfParisDay(day);
    const portfolioBase100 = (100 * nav) / nav0;
    const point: VsIndexBase100Point = {
      day,
      date: at.toISOString(),
      t: at.getTime(),
      portfolioBase100,
      portfolioPct: portfolioBase100 - 100,
    };
    if (idx0 != null) {
      const idx = indexAt(day);
      if (idx != null && idx > 0) {
        point.indexBase100 = (100 * idx) / idx0;
        point.benchmarkPct = point.indexBase100 - 100;
      }
    }
    out.push(point);
  }
  return out;
}

export function vsIndexGapPct(
  points: readonly VsIndexBase100Point[]
): { portfolioPct: number; benchmarkPct: number; gapPct: number } | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.benchmarkPct == null || last.benchmarkPct == null) return null;
  const portfolioPct = last.portfolioPct - first.portfolioPct;
  const benchmarkPct = last.benchmarkPct - first.benchmarkPct;
  return {
    portfolioPct,
    benchmarkPct,
    gapPct: portfolioPct - benchmarkPct,
  };
}

export function toVsIndexPercentPoints(
  points: readonly VsIndexBase100Point[]
): EvolutionPercentPoint[] {
  return points.map((p) => ({
    date: p.date,
    t: p.t,
    label: p.day,
    periodLabel: p.day,
    portfolioPct: p.portfolioPct,
    benchmarkPct: p.benchmarkPct,
  }));
}

/**
 * Ce que l'écran Versus a le droit de dessiner.
 *
 * Un 403 / réseau down ne dessine **pas** une courbe portefeuille à +0 %
 * (l'ancien `toPercentSeries` sans `growth`). Overlay off ; la NAV en
 * euros reste, seule. Versus éteint → NAV seulement, jamais un graphe %
 * fantôme.
 */
export type VsIndexChartKind = "percent" | "nav" | "index-unavailable";

export const INDEX_UNAVAILABLE_TITLE = "Indice indisponible";

export function vsIndexHasOverlay(
  points: readonly { benchmarkPct?: number | null }[]
): boolean {
  return points.some((p) => p.benchmarkPct != null);
}

export function vsIndexChartKind(input: {
  versus: "none" | "index" | string;
  indexError: boolean;
  hasOverlay: boolean;
}): VsIndexChartKind {
  if (input.versus !== "index") return "nav";
  if (input.indexError) return "index-unavailable";
  if (!input.hasOverlay) return "nav";
  return "percent";
}
