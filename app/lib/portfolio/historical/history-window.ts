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
import { enumerateDays } from "./timeline";
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

/* ────────────────────────────────────────────────────────────────────────────
   Pas de la série — décidé ici, au même endroit que la fenêtre.

   `historyFloorDay` répond « depuis quand », `historyStepForWindow` répond
   « tous les combien ». Les deux se lisent au même endroit et pour la même
   raison : un second module qui écrirait « 5A ⇒ semaine » se désynchroniserait
   du fenêtrage à la première fenêtre qui n'est pas exactement 5 ans (« Tout »
   ramené à la première observation du scope, cap à six ans, scope jeune…).

   Le pas ne se déduit donc pas du *libellé* de la période mais de l'**étendue
   servie**, seule grandeur que le serveur connaisse — et que le client relit
   ensuite dans `DailyNavResult.step` / `DailyNavPoint.intervalType` au lieu de
   la recalculer.

   Mesuré (2026-09-07, utilisateur demo, scope financier) : 5A/Tout rejouait
   2 191 valorisations pour 2 725 ms de route. Le journal, lui, continue d'être
   rejoué jour par jour — c'est la valorisation qui s'espace, pas la
   reconstitution comptable.
   ──────────────────────────────────────────────────────────────────────────── */

/** Pas d'échantillonnage d'une série historique. */
export type HistoryStep = "day" | "week";

/**
 * Étendue (en jours civils, bornes incluses) à partir de laquelle une série
 * passe au pas hebdomadaire.
 *
 * 401 sépare sans ambiguïté les fenêtres courtes (7J → 1A : au plus 366 jours,
 * 368 avec le jour d'ancrage) des longues (5A ≈ 1 827 jours, Tout jusqu'au cap
 * de six ans). Aucune période du tableau de bord ne tombe près de la borne :
 * la déplacer de quelques jours ne change le pas d'aucune d'entre elles.
 */
export const WEEKLY_STEP_MIN_SPAN_DAYS = 401;

/** Nombre de jours civils entre deux `DayKey`, bornes incluses. */
function spanInDays(from: DayKey, to: DayKey): number {
  const [y0, m0, d0] = from.split("-").map(Number);
  const [y1, m1, d1] = to.split("-").map(Number);
  const a = Date.UTC(y0!, m0! - 1, d0!, 12);
  const b = Date.UTC(y1!, m1! - 1, d1!, 12);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Pas d'une série sur la fenêtre **servie** — l'unique décision de granularité.
 */
export function historyStepForWindow(from: DayKey, to: DayKey): HistoryStep {
  if (from > to) return "day";
  return spanInDays(from, to) >= WEEKLY_STEP_MIN_SPAN_DAYS ? "week" : "day";
}

/** Lundi = 1, dimanche = 0 — jour civil, sans dépendance au fuseau de la machine. */
function weekdayOf(day: DayKey): number {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, dd!, 12)).getUTCDay();
}

/**
 * Jours où la série **émet un point**, bornes incluses.
 *
 * Pas quotidien : tous les jours civils — contrat T-05 inchangé.
 *
 * Pas hebdomadaire : `from`, chaque **lundi** de la fenêtre, et `to`. La
 * semaine civile est ancrée sur le lundi comme le reste du moteur (jours
 * Europe/Paris).
 *
 * Deux intervalles sont donc plus courts que sept jours : celui qui ouvre la
 * fenêtre (`from` → premier lundi) et celui qui la ferme (dernier lundi →
 * `to`). Ce dernier est délibéré : le dernier point est **toujours le jour
 * demandé**, jamais le lundi qui précède. Un hero titré « valo au 6 sept. »
 * au-dessus d'une valorisation du 1er serait faux de cinq jours de marché.
 * Un intervalle court n'est pas un problème pour l'identité métier
 * `Δmarché = NAV_t − NAV_{t−1} − flux_t` : celle-ci est indexée sur les points
 * émis, et les flux sont sommés sur l'intervalle qui sépare deux points, quelle
 * qu'en soit la durée.
 */
export function seriesEmissionDays(
  from: DayKey,
  to: DayKey,
  step: HistoryStep
): DayKey[] {
  const days = enumerateDays(from, to);
  if (step === "day" || days.length === 0) return days;
  const last = days.length - 1;
  return days.filter(
    (day, i) => i === 0 || i === last || weekdayOf(day) === 1
  );
}
