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

/**
 * Macro — À venir : pas de chiffre réel · horizon 14 j.
 * Publiées : réel disponible · fenêtre 24 h.
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
        return t <= nowT + UPCOMING_HORIZON_MS;
      }
      if (!published) return false;
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
