/**
 * Cap de profondeur d'historique — une seule constante, lue par tout ce qui
 * décide « depuis quand » une série ou une borne « Tout » démarre.
 *
 * Mesuré (2026-09-06, local, utilisateur demo) : `GET /api/portfolio` rejouait
 * le moteur sur 1998 → 2026, soit 1550 points et ~9,4 s pour le corps de la
 * route. Les transactions antérieures au cap **restent en base** — ce n'est
 * pas une purge, seulement une borne de lecture. `MAX_HISTORY_YEARS` est
 * l'unique endroit où cette profondeur est écrite ; `historyFloorDay` est
 * l'unique fonction qui la transforme en `DayKey`. Un second endroit qui
 * recopierait `6` désynchroniserait les chips de la série qu'ils annoncent —
 * exactement le symptôme que ce cap corrige.
 */

import { parisDayKey } from "../../dates/paris";
import type { DayKey } from "./types";

export const MAX_HISTORY_YEARS = 6;

/**
 * Premier jour lisible, tous scopes confondus : `aujourd'hui − MAX_HISTORY_YEARS`.
 *
 * Jours civils Europe/Paris, comme le reste du moteur historique.
 */
export function historyFloorDay(now: Date = new Date()): DayKey {
  const floor = new Date(now.getTime());
  floor.setUTCFullYear(floor.getUTCFullYear() - MAX_HISTORY_YEARS);
  return parisDayKey(floor);
}

/**
 * Borne « depuis quand » ramenée sous le cap — jamais avant `historyFloorDay`.
 *
 * `null` reste `null` : un scope sans aucune donnée observée n'en acquiert
 * pas une par l'effet du cap.
 */
export function capEarliestDay(
  day: DayKey | null,
  now: Date = new Date()
): DayKey | null {
  if (day == null) return null;
  const floor = historyFloorDay(now);
  return day < floor ? floor : day;
}
