/**
 * Mise en forme des libellés de la carte de tête.
 *
 * Regroupées ici pour être testées sans monter de composant : ce sont des
 * fonctions pures, et ce sont elles qui portent les règles typographiques du
 * français — espaces insécables du format monétaire, signe explicite sur les
 * hausses, vrai signe moins plutôt qu'un trait d'union.
 */

const PARIS = "Europe/Paris";

/** « lundi 12 janv. 2026 » — l'en-tête de l'info-bulle. */
export function formatLongDateParis(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** « 12 janv. 2026 » — le sous-titre hors survol. */
export function formatShortDateParis(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** « 12 janv. » — le renvoi vers la dernière valorisation observée. */
export function formatDayMonthParis(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    day: "numeric",
    month: "short",
  }).format(date);
}

/**
 * « 14:32 », ou `null` quand l'heure ne veut rien dire.
 *
 * Chaque point d'historique est horodaté à la **fin** de sa journée civile
 * parisienne — 23 h 59 — parce qu'il décrit une clôture, pas un instant de
 * relevé. Afficher « · 23:59 » sous le chiffre laisserait croire à une
 * valorisation prise à minuit moins une, alors que rien n'a été mesuré à cette
 * heure-là : c'est une précision inventée, et le sous-titre s'en tient donc à
 * la date seule.
 *
 * La fonction n'écarte pas l'heure par principe : elle écarte **cette**
 * heure-là. Le jour où la carte recevra un point intra-journalier — la
 * valorisation vivante d'un mardi après-midi — l'heure apparaîtra d'elle-même,
 * sans qu'une ligne change ici.
 */
export function formatValuationTimeParis(
  isoOrDate: string | Date
): string | null {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  if (!hour || !minute) return null;
  // Marqueur de clôture de journée : pas une heure de valorisation.
  if (hour === "23" && minute === "59") return null;
  return `${hour}:${minute}`;
}

/**
 * Le chiffre de tête, sans symbole ni code devise (affichés à côté).
 *
 * Les centimes disparaissent au-delà de 10 000 € : à cette taille de police,
 * ils allongent le nombre sans rien apprendre, et c'est un ordre de grandeur
 * qu'on vient lire. En dessous, ils comptent — un patrimoine de 3 200,45 €
 * n'est pas 3 200 €.
 */
export function formatHeroAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const decimals = Math.abs(value) >= 10_000 ? 0 : 2;
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Variation en euros, signe toujours explicite.
 *
 * `+` sur les hausses — sans lui, une hausse et une valeur absolue se lisent
 * pareil — et le signe moins typographique (U+2212) sur les baisses, aligné sur
 * le reste du tableau de bord.
 */
export function formatSignedAmount(
  value: number,
  formatAbsolute: (v: number) => string
): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${formatAbsolute(Math.abs(value))}`;
}

/** « +1,2 % » / « −0,4 % ». */
export function formatSignedPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}
