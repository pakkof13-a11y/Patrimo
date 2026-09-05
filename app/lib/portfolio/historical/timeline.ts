/**
 * Chronologies de valeurs datées — la brique commune à tous les compartiments
 * qui ne cotent pas.
 *
 * Un compte bancaire, une part de fonds non coté, un tableau : aucun de ces
 * objets n'a de cours. Ce qu'on possède, ce sont des **constats datés** — un
 * relevé, une NAV trimestrielle, une expertise. Entre deux constats, la valeur
 * connue est la dernière constatée : c'est un escalier, pas une droite. Ce
 * module n'implémente que cela, sans Prisma ni réseau, pour que la règle soit
 * testable isolément.
 *
 * Deux interdits structurent le code :
 *
 * 1. **Jamais de valeur avant le premier constat.** Un objet acquis en 2022 ne
 *    vaut pas 0 en 2020 : il n'existe pas dans le patrimoine, ce qui n'est pas
 *    la même chose et se traduit par la même absence de contribution — mais
 *    surtout, sa valeur d'aujourd'hui ne doit jamais être reportée en arrière.
 * 2. **Jamais d'interpolation.** Entre une expertise à 10 k€ en janvier et une
 *    à 12 k€ en juillet, la valeur connue en avril est 10 k€. Tracer une pente
 *    inventerait une performance mensuelle que personne n'a observée.
 */

import { d, zero, type Decimal } from "../../money/decimal";
import type { DatedValue, DayKey } from "./types";

/**
 * Chronologie d'un objet : une suite de constats datés, triée et dédupliquée.
 *
 * Immuable une fois construite — le moteur en lit des milliers de fois par
 * courbe, il ne faut pas qu'un appelant puisse la déformer en cours de route.
 */
export class ValueTimeline {
  private readonly points: readonly DatedValue[];

  private constructor(points: readonly DatedValue[]) {
    this.points = points;
  }

  static empty(): ValueTimeline {
    return new ValueTimeline([]);
  }

  /**
   * Construit une chronologie à partir de constats bruts.
   *
   * Les entrées sans date sont écartées : sans date, un constat ne peut être
   * situé dans le temps, et le placer arbitrairement (aujourd'hui, ou à la
   * création de la ligne) fabriquerait une histoire. L'appelant décide quoi
   * faire de ce vide — le signaler, pas le combler.
   *
   * À date égale, le dernier constat fourni gagne : c'est la correction d'une
   * saisie, pas un second événement.
   */
  static from(
    entries: Array<{ day: DayKey | null | undefined; valueEur: Decimal; observed?: boolean }>
  ): ValueTimeline {
    const byDay = new Map<DayKey, DatedValue>();
    for (const e of entries) {
      if (!e.day) continue;
      byDay.set(e.day, {
        day: e.day,
        valueEur: e.valueEur,
        observed: e.observed ?? true,
      });
    }
    const points = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    return new ValueTimeline(points);
  }

  get isEmpty(): boolean {
    return this.points.length === 0;
  }

  /** Jour du premier constat, ou `null` si la chronologie est vide. */
  get firstDay(): DayKey | null {
    return this.points[0]?.day ?? null;
  }

  /**
   * Jour du premier constat **observé** (`observed: true`), ou `null`.
   *
   * Distinct de `firstDay` : un repli `createdAt`/`updatedAt` (`observed:
   * false`) ne borne rien — il dit seulement quand la ligne a été saisie, pas
   * depuis quand le patrimoine existe. La borne « Tout » ne doit reculer que
   * jusqu'à un fait réellement constaté (acquisition, flux, relevé daté).
   */
  get earliestObservedDay(): DayKey | null {
    for (const p of this.points) {
      if (p.observed) return p.day;
    }
    return null;
  }

  /**
   * Valeur connue à `day` : le dernier constat dont la date lui est
   * antérieure ou égale. Zéro avant le premier constat.
   *
   * Recherche dichotomique : le moteur appelle cette méthode une fois par jour
   * et par objet, soit couramment plusieurs centaines de milliers de fois.
   */
  valueAt(day: DayKey): Decimal {
    const idx = this.indexAtOrBefore(day);
    return idx < 0 ? zero() : this.points[idx]!.valueEur;
  }

  /**
   * `true` si `day` tombe exactement sur un constat observé — donc si la
   * valeur de ce jour est mesurée et non reportée.
   */
  isObservedAt(day: DayKey): boolean {
    const idx = this.indexAtOrBefore(day);
    if (idx < 0) return false;
    const p = this.points[idx]!;
    return p.observed && p.day === day;
  }

  /** `true` dès lors qu'au moins un constat précède ou égale `day`. */
  hasValueAt(day: DayKey): boolean {
    return this.indexAtOrBefore(day) >= 0;
  }

  /**
   * Variation de valeur entre la veille et `day` **imputable à un nouveau
   * constat**. Sert à distinguer une revalorisation (performance) d'un simple
   * report (rien ne s'est passé).
   */
  revaluationOn(day: DayKey, previousDay: DayKey): Decimal {
    if (!this.isObservedAt(day)) return zero();
    return this.valueAt(day).minus(this.valueAt(previousDay));
  }

  private indexAtOrBefore(day: DayKey): number {
    let lo = 0;
    let hi = this.points.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid]!.day <= day) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }
}

/**
 * Somme des chronologies d'un ensemble d'objets à une date.
 *
 * Trois compteurs, et ils disent trois choses différentes :
 *
 * - `observed` : un constat daté couvre ce jour ;
 * - `carried`  : la valeur vient d'un constat antérieur ;
 * - `unavailable` : l'objet existe, mais **aucun constat ne le précède** —
 *   rien n'est donc su de lui ce jour-là.
 *
 * Le troisième manquait. Une chronologie sans valeur était simplement sautée,
 * si bien qu'un compartiment entièrement inconnu se présentait comme exact :
 * l'absence de donnée était indiscernable de l'absence d'objet. Compter ces
 * cas permet à l'appelant de dire « je ne sais pas » au lieu de « zéro ».
 */
export function sumTimelinesAt(
  timelines: Iterable<ValueTimeline>,
  day: DayKey
): { totalEur: Decimal; carried: number; observed: number; unavailable: number } {
  let totalEur = zero();
  let carried = 0;
  let observed = 0;
  let unavailable = 0;
  for (const t of timelines) {
    if (!t.hasValueAt(day)) {
      unavailable += 1;
      continue;
    }
    totalEur = totalEur.plus(t.valueAt(day));
    if (t.isObservedAt(day)) observed += 1;
    else carried += 1;
  }
  return { totalEur, carried, observed, unavailable };
}

/** Jours civils inclusifs entre deux bornes, bornés par `cap`. */
export function enumerateDays(from: DayKey, to: DayKey, cap = 20_000): DayKey[] {
  if (from > to) return [];
  const out: DayKey[] = [];
  const [y0, m0, d0] = from.split("-").map(Number);
  const [y1, m1, d1] = to.split("-").map(Number);
  let t = Date.UTC(y0!, m0! - 1, d0!, 12, 0, 0);
  const end = Date.UTC(y1!, m1! - 1, d1!, 12, 0, 0);
  const dayMs = 86_400_000;
  while (t <= end && out.length < cap) {
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
        dt.getUTCDate()
      ).padStart(2, "0")}`
    );
    t += dayMs;
  }
  return out;
}

/** Jour civil précédent, en `YYYY-MM-DD`. */
export function previousDay(day: DayKey): DayKey {
  const [y, m, dd] = day.split("-").map(Number);
  const t = Date.UTC(y!, m! - 1, dd!, 12, 0, 0) - 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Convertit une date en jour civil parisien sans dépendre du fuseau du serveur. */
export function toDayKey(date: Date): DayKey {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Agrège des flux datés par jour civil. */
export function indexFlowsByDay(
  flows: Iterable<{ day: DayKey; amountEur: Decimal }>
): Map<DayKey, Decimal> {
  const out = new Map<DayKey, Decimal>();
  for (const f of flows) {
    out.set(f.day, (out.get(f.day) ?? zero()).plus(f.amountEur));
  }
  return out;
}

export const decimalOf = d;
