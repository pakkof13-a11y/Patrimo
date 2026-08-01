/**
 * Bornes de fenêtres temporelles, en clés de jour civil (`YYYY-MM-DD`).
 *
 * Chaque écran à sélecteur de période — assurance-vie, épargne salariale,
 * crypto comptant — a besoin des mêmes deux opérations : reculer de N mois,
 * reculer de N jours. Elles vivent ici pour n'avoir qu'une seule définition du
 * cas limite qui les rend délicates (voir `shiftMonths`).
 */

/** Jour civil UTC d'une date, au format `YYYY-MM-DD`. */
export function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Recule (ou avance) de `months` mois en bornant au dernier jour du mois
 * d'arrivée.
 *
 * `setUTCMonth` déborde : le 31 juillet moins un mois donne le 31 juin, que
 * JavaScript reporte au 1er juillet — la fenêtre « 1M » ne couvrait alors
 * qu'un seul jour. On vise donc le 30 juin, comme le ferait un relevé.
 */
export function shiftMonths(now: Date, months: number): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + months;
  const day = now.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return dayKeyUtc(new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget))));
}

/** Recule (ou avance) de `days` jours. Aucun piège ici : les jours s'ajoutent. */
export function shiftDays(now: Date, days: number): string {
  return dayKeyUtc(new Date(now.getTime() + days * 24 * 3600 * 1000));
}
