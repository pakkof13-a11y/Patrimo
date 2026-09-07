/**
 * L'heure d'un événement de marché, telle qu'on l'écrit à l'écran.
 *
 * Les deux panneaux de contexte marché portaient chacun leur `clockTime`,
 * identiques : heure et minute, fuseau Europe/Paris. La conversion était juste
 * — mesuré sur la source, `ff_calendar_thisweek.json` date ses lignes avec un
 * décalage explicite (`2026-09-07T18:45:00-04:00`), que `new Date` lit sans
 * ambiguïté.
 *
 * Ce qui manquait n'était donc pas le fuseau mais **le jour**. Une publication
 * néo-zélandaise du 8 septembre à 00:45 heure de Paris s'affichait « 00:45 »,
 * et se lisait, un 7 septembre à treize heures, comme une heure déjà passée.
 * L'événement était correctement classé « à venir » ; c'est l'écran qui laissait
 * croire le contraire.
 */

const HM = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
});

const JOUR_HM = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const JOUR = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour civil parisien d'un instant, en `YYYY-MM-DD`. */
export function parisDayOf(iso: string | Date): string | null {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return JOUR.format(d);
}

/**
 * Heure de Paris, précédée du jour quand l'événement n'est pas d'aujourd'hui.
 *
 * `—` sur une date illisible : on n'invente pas un horaire, et une heure fausse
 * serait indiscernable d'une vraie.
 */
export function parisEventClock(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const jourEvent = parisDayOf(d);
  const jourCourant = parisDayOf(now);
  if (jourEvent && jourCourant && jourEvent !== jourCourant) {
    return JOUR_HM.format(d);
  }
  return HM.format(d);
}

/** Mention portée une fois par liste, plutôt que sur chaque ligne. */
export const PARIS_CLOCK_NOTE = "heure de Paris";
