/**
 * Barre de jours J−7…J+7 (civil Europe/Paris) pour les calendriers marché.
 *
 * Un « jour » est ici une clé civile parisienne (YYYY-MM-DD), pas une fenêtre
 * de 24 h UTC : deux instants voisins en UTC peuvent tomber sur deux jours
 * parisiens différents selon la saison (CET/CEST). L'arithmétique de jours
 * s'ancre donc sur un instant fixe à midi UTC — jamais à cheval sur un
 * changement d'heure Europe/Paris, dont le décalage ne dépasse jamais deux
 * heures — plutôt que d'ajouter 24 h à l'instant courant, ce qui décalerait
 * le jour civil affiché les nuits de changement d'heure.
 */

import { parisDayOf } from "@/app/lib/ui/paris-clock";

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
  for (let offset = -before; offset <= after; offset++) {
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
