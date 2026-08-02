/**
 * Décalage Europe/Paris − UTC à un instant donné, en millisecondes.
 *
 * Lu dans le fuseau plutôt que codé en dur : +1 h en hiver, +2 h en été, et
 * les deux dates de bascule changent chaque année. Un décalage fixe ferait
 * dériver la journée civile deux fois par an.
 */
function parisOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    // `hour12: false` rend parfois « 24 » au lieu de « 00 » sur minuit.
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asIfUtc - at.getTime();
}

/**
 * Instant exact de 00 h 00, heure de Paris, pour un jour civil donné.
 *
 * C'est la frontière qui découpe les journées du portefeuille : une valeur
 * « au 3 août » se lit à 00 h 00 Paris, pas à minuit UTC. Les deux ne
 * coïncident jamais — une mesure prise entre minuit et 2 h du matin en été
 * tomberait sinon dans la journée de la veille.
 */
export function parisDayStart(day: string): Date {
  const naive = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(naive)) return new Date(NaN);
  // Première approximation avec le décalage vu à minuit UTC, puis correction
  // avec celui vu à l'instant trouvé : deux passes suffisent, la bascule
  // horaire ayant lieu à 01 h 00 UTC, loin de cette fenêtre.
  const first = naive - parisOffsetMs(new Date(naive));
  return new Date(naive - parisOffsetMs(new Date(first)));
}

/**
 * Dernier instant du jour civil parisien — la milliseconde avant que la
 * journée suivante ne commence.
 *
 * Sert à horodater le point de clôture d'une journée. On passe par le début
 * du jour suivant plutôt que par « + 24 h » : les jours de changement d'heure
 * durent 23 ou 25 heures.
 */
export function endOfParisDay(day: string): Date {
  const start = parisDayStart(day);
  if (Number.isNaN(start.getTime())) return start;
  const nextDay = new Date(start.getTime() + 36 * 3600_000);
  return new Date(parisDayStart(parisDayKey(nextDay)).getTime() - 1);
}

/** Jour civil Europe/Paris → clé YYYY-MM-DD (tri lexicographique = tri chronologique). */
export function parisDayKey(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
