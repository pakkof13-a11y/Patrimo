/**
 * Filtrage calendriers marché : À venir / Publiées.
 * Basé sur la disponibilité effective du résultat, pas uniquement l’heure.
 */

import type { EarningsEvent, MacroEvent } from "@/app/lib/news/service";
import {
  isEarningsEventPublished,
  isMacroEventPublished,
} from "@/app/lib/news/service";

export type MarketReleaseFilter = "upcoming" | "published";

export const MARKET_RELEASE_FILTERS: {
  id: MarketReleaseFilter;
  label: string;
}[] = [
  { id: "upcoming", label: "À venir" },
  { id: "published", label: "Publiées" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Horizon max des événements non publiés encore listés en « À venir ». */
export const UPCOMING_HORIZON_MS = 14 * DAY_MS;
/** Fenêtre des publications récentes. */
export const PUBLISHED_WINDOW_MS = DAY_MS;

function isSameLocalDay(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const a = new Date(t);
  return (
    a.getFullYear() === now.getFullYear() &&
    a.getMonth() === now.getMonth() &&
    a.getDate() === now.getDate()
  );
}

/**
 * Macro — À venir : annonces **du jour** encore sans résultat.
 * Publiées : réel disponible · même jour (ou fenêtre 24 h si hors mock jour).
 */
export function filterMacroByRelease(
  items: MacroEvent[],
  filter: MarketReleaseFilter,
  now = new Date()
): MacroEvent[] {
  const nowT = now.getTime();
  return items
    .filter((e) => {
      const published = isMacroEventPublished(e, now);
      const t = Date.parse(e.time);
      if (!Number.isFinite(t)) return false;

      if (filter === "upcoming") {
        if (published) return false;
        // Jour civil : tous les indicateurs du jour encore sans résultat
        // (même si l’heure est passée — le réel n’est pas encore là)
        if (isSameLocalDay(e.time, now)) return true;
        // Multi-jours éventuels : futurs dans l’horizon 14 j
        return t > nowT && t <= nowT + UPCOMING_HORIZON_MS;
      }
      if (!published) return false;
      // Publiées du jour en priorité
      if (isSameLocalDay(e.time, now)) return t <= nowT + 30 * 60 * 1000;
      return t >= nowT - PUBLISHED_WINDOW_MS && t <= nowT + 30 * 60 * 1000;
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/**
 * Résultats — même logique : bascule dès qu’epsActual est présent.
 */
export function filterEarningsByRelease(
  items: EarningsEvent[],
  filter: MarketReleaseFilter,
  now = new Date()
): EarningsEvent[] {
  const nowT = now.getTime();
  return items
    .filter((e) => {
      const published = isEarningsEventPublished(e);
      const t = Date.parse(e.time);
      if (!Number.isFinite(t)) return false;

      if (filter === "upcoming") {
        if (published) return false;
        return t <= nowT + UPCOMING_HORIZON_MS;
      }
      if (!published) return false;
      return t >= nowT - PUBLISHED_WINDOW_MS && t <= nowT + 30 * 60 * 1000;
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}
