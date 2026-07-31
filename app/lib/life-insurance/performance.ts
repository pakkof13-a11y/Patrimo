/**
 * Performance d'une enveloppe, pondérée par le temps et non par les flux.
 *
 * Le sujet est celui-ci : sur un contrat d'assurance-vie, l'essentiel des
 * variations de valeur vient des **versements**, pas des marchés. Une courbe
 * de valeur monte de 10 000 € parce qu'on a versé 10 000 €, et l'afficher
 * comme « performance » ferait passer un virement pour un gain — c'est la
 * façon la plus sûre de croire qu'un contrat travaille alors qu'il dort.
 *
 * On calcule donc un **taux de rendement pondéré par le temps** (TWR) : le
 * rendement d'un jour rapporte la variation *hors flux* à la valeur de la
 * veille, et les rendements journaliers se chaînent. Le résultat ne dépend ni
 * du montant ni de la date des versements — c'est ce qui permet de comparer
 * deux contrats, ou un contrat à un indice.
 *
 * Module pur : ni Prisma, ni React, ni date « maintenant » implicite.
 */

export type DailyValuePoint = {
  /** Jour civil Europe/Paris, `YYYY-MM-DD`. */
  day: string;
  /** Valeur de l'enveloppe à la clôture de ce jour, en euros. */
  valueEur: number;
  /**
   * Flux net du jour, en euros : versements positifs, rachats négatifs.
   * C'est la part de la variation qui ne doit *pas* compter comme performance.
   */
  netFlowEur: number;
};

export type PerformancePoint = {
  day: string;
  valueEur: number;
  /** Base 100 au premier jour de la fenêtre. */
  index: number;
  /** Performance cumulée depuis le début de la fenêtre, en %. */
  cumulativePct: number;
};

/**
 * Un rendement journalier n'a de sens que si la veille valait quelque chose.
 * Sous ce seuil (un euro), le rapport devient numériquement instable : un
 * contrat passant de 0,01 € à 500 € afficherait +5 000 000 %.
 */
const MIN_BASE_EUR = 1;

/**
 * Série de performance chaînée.
 *
 * Convention : le flux du jour est réputé investi **pendant** la journée, donc
 * retranché de la valeur de clôture avant comparaison à la veille —
 * `r = (V_t − F_t) / V_{t−1} − 1`. C'est la convention usuelle des relevés
 * d'assurance-vie, où l'on ne connaît pas l'heure du versement.
 *
 * Les jours où la base est trop faible (contrat encore vide) ne rompent pas la
 * chaîne : ils portent un rendement nul et l'indice reste plat, plutôt que de
 * produire un saut qui n'a aucune réalité.
 */
export function buildPerformanceSeries(
  points: DailyValuePoint[]
): PerformancePoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const out: PerformancePoint[] = [];
  let index = 100;
  let prevValue: number | null = null;

  for (const p of sorted) {
    if (prevValue != null && prevValue >= MIN_BASE_EUR) {
      const growth = (p.valueEur - p.netFlowEur) / prevValue;
      // Un ratio négatif signifierait une valeur négative après retrait du
      // flux : un journal localement incohérent, pas une performance de −180 %.
      if (Number.isFinite(growth) && growth > 0) {
        index *= growth;
      }
    }
    out.push({
      day: p.day,
      valueEur: p.valueEur,
      index,
      cumulativePct: index - 100,
    });
    prevValue = p.valueEur;
  }

  return out;
}

/**
 * Performance entre deux bornes de la série, en %.
 *
 * Rend `null` quand la fenêtre demandée ne contient pas au moins deux points :
 * un seul jour n'est pas une performance, et « 0,00 % » se lirait comme un
 * contrat à l'arrêt.
 */
export function performanceBetween(
  series: PerformancePoint[],
  fromDay?: string
): number | null {
  if (series.length < 2) return null;
  const start = fromDay
    ? series.find((p) => p.day >= fromDay)
    : series[0];
  const end = series[series.length - 1]!;
  if (!start || start.day >= end.day) return null;
  if (start.index <= 0) return null;
  return (end.index / start.index - 1) * 100;
}

/** Performance depuis le 1er janvier de l'année du dernier point. */
export function performanceYtd(series: PerformancePoint[]): number | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const year = last.day.slice(0, 4);
  return performanceBetween(series, `${year}-01-01`);
}

/**
 * Rendement annualisé sur la fenêtre, en %.
 *
 * Rend `null` sous un an de recul : ramener trois mois à l'année reviendrait à
 * annoncer 40 % l'an sur un trimestre chanceux, ce qu'aucun relevé ne fait.
 */
export function annualizedPerformance(
  series: PerformancePoint[]
): number | null {
  if (series.length < 2) return null;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  if (first.index <= 0) return null;

  const days =
    (Date.parse(`${last.day}T00:00:00Z`) -
      Date.parse(`${first.day}T00:00:00Z`)) /
    (24 * 3600 * 1000);
  if (!Number.isFinite(days) || days < 365) return null;

  const years = days / 365.25;
  return (Math.pow(last.index / first.index, 1 / years) - 1) * 100;
}

/* ── Fenêtres de temps ────────────────────────────────────────────── */

export const PERF_RANGES = ["1m", "ytd", "1y", "3y", "5y", "all"] as const;
export type PerfRange = (typeof PERF_RANGES)[number];

export const PERF_RANGE_LABEL: Record<PerfRange, string> = {
  "1m": "1M",
  ytd: "YTD",
  "1y": "1A",
  "3y": "3A",
  "5y": "5A",
  all: "Tout",
};

export function isPerfRange(v: string): v is PerfRange {
  return (PERF_RANGES as readonly string[]).includes(v);
}

/**
 * Premier jour d'une fenêtre, en clé de jour civil.
 *
 * `all` rend `null` : c'est au service de retomber sur la première transaction
 * connue, qu'une constante de durée ne saurait deviner.
 */
export function rangeStartDay(range: PerfRange, now: Date): string | null {
  switch (range) {
    case "1m":
      return shiftMonths(now, -1);
    case "ytd":
      return `${now.getUTCFullYear()}-01-01`;
    case "1y":
      return shiftMonths(now, -12);
    case "3y":
      return shiftMonths(now, -36);
    case "5y":
      return shiftMonths(now, -60);
    case "all":
      return null;
  }
}

/**
 * Recule de `months` mois en bornant au dernier jour du mois d'arrivée.
 *
 * `setUTCMonth` déborde : le 31 juillet moins un mois donne le 31 juin, que
 * JavaScript reporte au 1er juillet — la fenêtre « 1M » ne couvrait alors
 * qu'un jour. On vise donc le 30 juin, comme le ferait un relevé.
 */
function shiftMonths(now: Date, months: number): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + months;
  const day = now.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget)))
    .toISOString()
    .slice(0, 10);
}
