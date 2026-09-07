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
 * Dernière clôture calendaire — le jour où la courbe s'arrête.
 *
 * Décision produit, et non une correction mesurée : la courbe patrimoniale
 * trace des **clôtures**. Pas un NAV intra-journalier, pas une valorisation à
 * seize heures, pas les écritures du jour en cours. Un point d'aujourd'hui
 * mélange une journée inachevée à une série de journées closes, et les compare
 * comme si elles étaient de même nature.
 *
 * Le gros chiffre de la carte de tête ne suit pas cette règle et n'a pas à la
 * suivre : c'est un encours, daté « valo au » du jour, et c'est bien ce que
 * l'on veut savoir maintenant. Ce sont la courbe, les écarts de période et les
 * barres qui s'arrêtent à la veille.
 *
 * Un mur en fin de courbe a été signalé sur le 7 septembre 2026. Le lien avec
 * cette règle **n'a pas été mesuré** — la machine où ce commit est écrit n'a
 * pas de base. Si le mur subsiste après ce changement, il est ailleurs, dans le
 * jeu de données, et il ne faut pas couper un jour de plus pour le cacher.
 */
export function lastCloseDay(now: Date = new Date()): DayKey {
  const veille = new Date(now.getTime());
  veille.setUTCDate(veille.getUTCDate() - 1);
  return parisDayKey(veille);
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

/** Dimanche = 0 — jour civil, sans dépendance au fuseau de la machine. */
function weekdayOf(day: DayKey): number {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, dd!, 12)).getUTCDay();
}

/**
 * Dimanche de la semaine civile qui contient `day`.
 *
 * Sert à nommer un point hebdomadaire. Le point lui-même tombe sur un
 * dimanche, sauf à la borne qui ouvre la fenêtre — la seule qui reste
 * partielle depuis que la borne de fin ne l'est plus (cf.
 * `seriesEmissionDays`). Nommer ce point par sa propre date laisserait croire
 * à une semaine qui commencerait un mercredi ; le nommer par son dimanche dit
 * l'intervalle qu'il ouvre, ce qui est ce que le lecteur cherche.
 */
export function sundayOfWeek(day: DayKey): DayKey {
  const [y, m, dd] = day.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1, dd!, 12));
  const recul = d.getUTCDay(); // dimanche = 0, donc déjà le recul cherché.
  d.setUTCDate(d.getUTCDate() - recul);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Jours où la série **émet un point**, bornes incluses.
 *
 * Pas quotidien : tous les jours civils — contrat T-05 inchangé.
 *
 * Pas hebdomadaire : `from`, puis chaque **dimanche** de la fenêtre —
 * jamais `to` en plus, sauf s'il tombe lui-même un dimanche. La semaine
 * civile va de dimanche 00:00 Paris au dimanche 00:00 suivant ; le dernier
 * point émis est donc le dernier dimanche ≤ `to`, et la semaine en cours
 * (celle que `to` traverse sans la clore) n'est **pas servie** — exactement
 * comme le jour en cours a été retiré des séries quotidiennes
 * (`lastCloseDay`).
 *
 * Décision produit tranchée le 2026-09-07, qui remplace l'ancien ancrage au
 * lundi *et* le point partiel de fin. Le point partiel se justifiait par « le
 * hero afficherait sinon une valorisation vieille de plusieurs jours » — un
 * raisonnement qui ne tient plus : le gros chiffre du hero est un encours
 * daté du jour (`grossAssets`/`netWorth` du jour, hors courbe), et la courbe,
 * elle, s'arrête déjà à la clôture (`lastCloseDay`). Rien ne demandait donc
 * plus à la courbe hebdomadaire de forcer un point sur un jour qui n'a pas
 * clos sa semaine.
 *
 * Un seul intervalle reste donc plus court que sept jours : celui qui ouvre
 * la fenêtre (`from` → premier dimanche). Il n'est pas un problème pour
 * l'identité métier `Δmarché = NAV_t − NAV_{t−1} − flux_t` : celle-ci est
 * indexée sur les points émis, et les flux sont sommés sur l'intervalle qui
 * sépare deux points, quelle qu'en soit la durée.
 */
export function seriesEmissionDays(
  from: DayKey,
  to: DayKey,
  step: HistoryStep
): DayKey[] {
  const days = enumerateDays(from, to);
  if (step === "day" || days.length === 0) return days;
  return days.filter((day, i) => i === 0 || weekdayOf(day) === 0);
}
