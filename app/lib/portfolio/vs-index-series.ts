/**
 * T-4.E — Vs indice : base 100 commune.
 *
 * Les deux séries (NAV du périmètre hero / daily-nav, clôtures d'indice)
 * sont ramenées à 100 au **premier jour COMMUN** de la fenêtre — le même
 * `from`/`to` que `getDailyNav` et la carte de tête.
 *
 * On ne compare jamais une NAV en euros à un indice déjà exprimé en % :
 * chaque série est un niveau (NAV €, clôture d'indice), et la seule
 * transformation partagée est `100 × niveau(t) / niveau(jour commun)`.
 * La courbe affiche `base100 − 100` (0 % au jour commun) : même écart
 * relatif, même unité.
 *
 * Un portefeuille plat à +0 % pendant que le CAC bouge est un échec :
 * soit la NAV n'a pas été rebasée, soit on a mélangé les unités.
 */

import { endOfParisDay, parisDayKey } from "../dates/paris";
import type { EvolutionPercentPoint } from "./evolution-aggregate";

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
  /** 100 × NAV(t) / NAV(jour commun). */
  portfolioBase100: number;
  /** 100 × close(t) / close(jour commun) — absent si l'indice manque. */
  indexBase100?: number;
  /** `portfolioBase100 − 100` — 0 % au jour commun. */
  portfolioPct: number;
  /** `indexBase100 − 100` — même origine que le portefeuille. */
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
 * vendredi, sans inventer de cours.
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
 * Premier jour de la fenêtre où les deux niveaux sont connus et > 0.
 *
 * L'indice peut précéder le jour (LOCF) : un lundi de NAV est commun avec
 * le vendredi si le lundi n'est pas encore coté, et un portefeuille qui
 * commence avant la première clôture attend cette clôture.
 */
export function firstCommonDay(
  portfolio: readonly VsIndexLevel[],
  index: readonly VsIndexLevel[]
): string | null {
  const indexAt = makeIndexLevelAt(index);
  for (const p of usableLevels(portfolio)) {
    const idx = indexAt(p.day);
    if (idx != null && idx > 0) return p.day;
  }
  return null;
}

/**
 * Rebase les deux séries à 100 au premier jour commun.
 *
 * Sans indice, le portefeuille part tout de même à 100 à son premier jour
 * (pas de courbe plate à 0 % faute de CAC). Dès que l'indice est là, les
 * jours antérieurs au commun sont retirés : les deux courbes naissent
 * ensemble.
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

  const common = firstCommonDay(navs, index);
  const baseDay = common ?? days[0]!;
  const nav0 = navByDay.get(baseDay);
  if (nav0 == null || !(nav0 > 0)) return [];

  const indexAt = makeIndexLevelAt(index);
  const idx0 = indexAt(baseDay);
  const haveIndex = idx0 != null && idx0 > 0;

  const out: VsIndexBase100Point[] = [];
  for (const day of days) {
    if (day < baseDay) continue;
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
    if (haveIndex) {
      const idx = indexAt(day);
      if (idx != null && idx > 0) {
        point.indexBase100 = (100 * idx) / idx0!;
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
