/**
 * Barre de jours (civil Europe/Paris) pour les calendriers marché.
 *
 * Un « jour » est ici une clé civile parisienne (YYYY-MM-DD), pas une fenêtre
 * de 24 h UTC : deux instants voisins en UTC peuvent tomber sur deux jours
 * parisiens différents selon la saison (CET/CEST). L'arithmétique de jours
 * s'ancre donc sur un instant fixe à midi UTC — jamais à cheval sur un
 * changement d'heure Europe/Paris, dont le décalage ne dépasse jamais deux
 * heures — plutôt que d'ajouter 24 h à l'instant courant, ce qui décalerait
 * le jour civil affiché les nuits de changement d'heure.
 *
 * `buildMarketDayWindow` est le primitif générique (`before`/`after` jours
 * de part et d'autre d'aujourd'hui). Le produit ne l'utilise plus en mode
 * symétrique J−7…J+7 : les deux onglets À venir / Publiées ont chacun leur
 * propre fenêtre de sept jours, disjointe sauf en J — voir
 * `buildReleaseDayWindow`.
 */

import { parisDayOf } from "@/app/lib/ui/paris-clock";
import type { MarketReleaseFilter } from "@/app/lib/news/release-filter";

export type MarketDay = {
  /** Clé civile Europe/Paris, YYYY-MM-DD. */
  key: string;
  /** Décalage en jours par rapport à aujourd'hui (0 = aujourd'hui). */
  offset: number;
  /** Étiquette courte affichée sur le bouton, ex. « lun. 7 sept. ». */
  label: string;
  isToday: boolean;
};

const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
  day: "numeric",
  month: "short",
});

function parisNoonAnchor(now: Date): Date {
  const ymd = parisDayOf(now);
  if (!ymd) return now;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
}

/**
 * Construit la barre de jours centrée sur aujourd'hui (Europe/Paris).
 * `before`/`after` : nombre de jours de part et d'autre (défaut 7 → J−7…J+7).
 */
export function buildMarketDayWindow(
  now: Date = new Date(),
  before = 7,
  after = 7
): MarketDay[] {
  const anchor = parisNoonAnchor(now);
  const todayKey = parisDayOf(anchor)!;
  const days: MarketDay[] = [];
  // `before === 0` donnerait un premier offset `-0` (JS : `-0` littéral) : un
  // même nombre que `0` en valeur, mais que `toEqual`/`Object.is` distinguent.
  // `buildReleaseDayWindow("upcoming", …)` appelle justement `before=0` : la
  // barre « À venir » démarre bien sur l'offset `0`, pas `-0`.
  const start = before === 0 ? 0 : -before;
  for (let offset = start; offset <= after; offset++) {
    const d = new Date(anchor.getTime() + offset * 86_400_000);
    const key = parisDayOf(d)!;
    days.push({
      key,
      offset,
      label: DAY_LABEL.format(d),
      isToday: key === todayKey,
    });
  }
  return days;
}

/**
 * Barre de jours d'un onglet À venir / Publiées — deux modes mutuellement
 * exclusifs, un seul jour affichable à la fois de chaque côté.
 *
 * « À venir » : J…J+6, aujourd'hui inclus, ordre chronologique croissant.
 * « Publiées » : J−6…J, aujourd'hui inclus, même ordre. J−1 et au-delà ne
 * sont ni visibles ni cliquables côté « À venir » ; J+1 et au-delà ne le sont
 * pas côté « Publiées ». Les deux fenêtres se rejoignent sur J, jamais
 * ailleurs : un jour ne peut jamais apparaître dans les deux barres à la
 * fois hors de ce point commun.
 */
export function buildReleaseDayWindow(
  filter: MarketReleaseFilter,
  now: Date = new Date()
): MarketDay[] {
  return filter === "upcoming"
    ? buildMarketDayWindow(now, 0, 6)
    : buildMarketDayWindow(now, 6, 0);
}

/**
 * Étendue effectivement couverte par une liste d'instants (clés jour min/max).
 * `null` si la liste est vide : on ne sait alors rien affirmer sur ce que la
 * source couvre, ce n'est pas une couverture nulle.
 */
export function coveredDayRange(
  isoTimes: string[]
): { min: string; max: string } | null {
  const keys = isoTimes
    .map((iso) => parisDayOf(iso))
    .filter((k): k is string => k != null);
  if (keys.length === 0) return null;
  let min = keys[0]!;
  let max = keys[0]!;
  for (const k of keys) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  return { min, max };
}

/**
 * Vrai/faux si `day` tombe dans l'étendue couverte, `null` si l'étendue est
 * inconnue (aucun événement reçu pour établir une fenêtre) — un jour hors
 * fenêtre n'est pas un jour sans événement, et une fenêtre inconnue n'est ni
 * l'un ni l'autre.
 */
export function isDayCovered(
  day: string,
  range: { min: string; max: string } | null
): boolean | null {
  if (!range) return null;
  return day >= range.min && day <= range.max;
}
