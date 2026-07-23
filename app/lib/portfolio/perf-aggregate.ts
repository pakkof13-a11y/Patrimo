/**
 * Agrégation temporelle de la série de performance :
 * - composé (stock) → dernière valeur du bucket
 * - décomposé (flux) → somme des flux du bucket
 */

import type { PriceHistoryRange } from "@/app/lib/market/price-history-types";
import type {
  LedgerTxLite,
  TotalReturnPoint,
} from "@/app/lib/portfolio/total-return";

export type AggregateInterval = "day" | "week" | "month";

/** Mode de performance affiché sur le graphe */
export type PerfMetricMode = "period" | "cumul" | "dividends";

/** Date ISO de la première transaction d'achat (ACHAT), ou null. */
export function getFirstBuyAt(
  transactions: Array<Pick<LedgerTxLite, "type" | "occurredAt">>
): string | null {
  let earliest: string | null = null;
  let earliestT = Infinity;
  for (const tx of transactions) {
    if (tx.type !== "ACHAT") continue;
    const t = new Date(tx.occurredAt).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < earliestT) {
      earliestT = t;
      earliest = tx.occurredAt;
    }
  }
  return earliest;
}

/**
 * Âge de la position en jours calendaires (Paris) :
 * du jour du premier achat à aujourd'hui (inclusif-ish via ms/864e5).
 */
export function getPositionAgeDays(
  firstBuyAt: string | null,
  now = new Date()
): number {
  if (!firstBuyAt) return 0;
  const t0 = new Date(firstBuyAt).getTime();
  if (!Number.isFinite(t0)) return 0;
  return Math.max(0, (now.getTime() - t0) / (24 * 60 * 60 * 1000));
}

/**
 * 1er janvier de l'année civile courante (minuit UTC approx. via année locale Paris).
 */
export function startOfCurrentCalendarYear(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value ?? now.getFullYear());
  return new Date(Date.UTC(y, 0, 1, 0, 0, 0));
}

/**
 * Active/désactive les boutons de période selon l'âge réel de la position.
 * - 7J, Tout : toujours actifs
 * - 1M ≥ 30j · 3M ≥ 90j · 1A ≥ 365j · 5Y ≥ 1825j
 * - YTD : 1ère tx avant le 1er janvier de l'année en cours
 */
export function isPerfPeriodEnabled(
  range: PriceHistoryRange,
  firstBuyAt: string | null,
  now = new Date()
): boolean {
  if (range === "7d" || range === "all") return true;
  if (!firstBuyAt) {
    return false;
  }

  const ageDays = getPositionAgeDays(firstBuyAt, now);
  const firstT = new Date(firstBuyAt).getTime();

  switch (range) {
    case "1m":
      return ageDays >= 30;
    case "3m":
      return ageDays >= 90;
    case "1y":
      return ageDays >= 365;
    case "5y":
      return ageDays >= 1825;
    case "ytd": {
      const yStart = startOfCurrentCalendarYear(now).getTime();
      return firstT < yStart;
    }
    default:
      return true;
  }
}

/**
 * Coupe la série de perf : aucun point avant le jour du premier achat.
 * Le premier point affiché = jour du premier BUY (ou la barre la plus proche ≥).
 *
 * Comparaison par **jour calendaire Paris** (pas l'horodatage strict) :
 * une barre daily à 00:00 UTC le jour de l'achat (14h) doit être conservée,
 * sinon le clip saute au lendemain et le « jour 1 » part déjà en Δ cours.
 */
export function clipSeriesFromFirstBuy(
  series: TotalReturnPoint[],
  firstBuyAt: string | null
): TotalReturnPoint[] {
  if (series.length === 0) return series;
  if (!firstBuyAt) return [];

  const buyT = new Date(firstBuyAt).getTime();
  if (!Number.isFinite(buyT)) return [];
  const buyDay = parisYmdKey(firstBuyAt);

  let startIdx = series.findIndex((p) => {
    const barDay = parisYmdKey(p.date);
    if (buyDay && barDay) return barDay >= buyDay;
    return new Date(p.date).getTime() >= buyT;
  });
  if (startIdx < 0) return [];

  for (let i = startIdx; i < series.length; i++) {
    const p = series[i]!;
    if (p.qty > 0 || p.qtyOpen > 0 || p.events.some((e) => e.kind === "BUY")) {
      startIdx = i;
      break;
    }
  }

  return series.slice(startIdx);
}

function parisYmdKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export type AggregatedPerfPoint = {
  date: string;
  dateStart: string;
  dateEnd: string;
  label: string;
  periodLabel: string;

  /** Flux : somme des periodPnl du bucket */
  periodPnlEur: number;
  pricePnlEur: number;
  periodRealizedEur: number;
  /** Flux div nets du bucket (somme) */
  incomePnlEur: number;

  /** Stock : dernière valeur du bucket */
  totalPnlEur: number;
  totalPnlPct: number;
  latentPnlEur: number;
  latentPnlPct: number;
  dividendsNetCumEur: number;
  dividendsGrossCumEur: number;
  withholdingCumEur: number;

  /**
   * Valeur active pour le graphe (selon mode au moment de l'affichage
   * — remplie par applyPerfMetricMode, ou period par défaut).
   */
  chartValueEur: number;
  chartValuePct: number;

  /** Aires / colonnes divergentes basées sur chartValueEur */
  pos: number;
  neg: number;

  intervalType: AggregateInterval;
  close: number;
  qty: number;
  cumpEur: number;
  cashInvestedNet: number;
  dividendsCum: number;
};

function parisYmd(isoOrDate: string | Date): { y: number; m: number; d: number } {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function parisWeekdayMon0(isoOrDate: string | Date): number {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[wd] ?? 0;
}

/** Clé de regroupement stable (Europe/Paris). */
export function bucketKey(iso: string, intervalType: AggregateInterval): string {
  const { y, m, d } = parisYmd(iso);
  if (intervalType === "day") {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (intervalType === "month") {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const mon0 = parisWeekdayMon0(iso);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const monday = new Date(utcNoon - mon0 * 24 * 60 * 60 * 1000);
  const my = monday.getUTCFullYear();
  const mm = monday.getUTCMonth() + 1;
  const md = monday.getUTCDate();
  return `W${my}-${String(mm).padStart(2, "0")}-${String(md).padStart(2, "0")}`;
}

function formatDayShort(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function formatMonthLabel(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    month: "short",
    year: "2-digit",
  }).format(new Date(iso));
}

function formatMonthLong(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function formatWeekRangeLabel(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameYear =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
    }).format(start) ===
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
    }).format(end);

  const dStart = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" as const }),
  }).format(start);
  const dEnd = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(end);
  return `Semaine du ${dStart} au ${dEnd}`;
}

function weekAxisLabel(startIso: string): string {
  return (
    "S. " +
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "short",
    }).format(new Date(startIso))
  );
}

/**
 * Choisit l'intervalle d'agrégation selon la période UI et la profondeur d'historique.
 */
export function resolvePerfAggregateInterval(
  range: PriceHistoryRange,
  data: Array<{ date: string }>
): AggregateInterval {
  if (range === "7d" || range === "1m") return "day";
  if (range === "3m" || range === "1y") return "week";
  if (range === "5y") return "month";

  if (data.length < 2) return "day";
  const t0 = new Date(data[0]!.date).getTime();
  const t1 = new Date(data[data.length - 1]!.date).getTime();
  const days = Math.max(0, (t1 - t0) / (24 * 60 * 60 * 1000));
  if (days < 90) return "day";
  if (days <= 730) return "week";
  return "month";
}

function sumField(
  group: TotalReturnPoint[],
  key:
    | "periodPnlEur"
    | "pricePnlEur"
    | "periodRealizedEur"
    | "incomePnlEur"
): number {
  let s = 0;
  for (const p of group) {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v)) s += v;
  }
  return s;
}

/**
 * Regroupe les points bruts.
 * - Flux (period*) → somme du bucket
 * - Stock (total*, latent*) → dernière observation
 */
export function groupDataByInterval(
  data: TotalReturnPoint[],
  intervalType: AggregateInterval
): AggregatedPerfPoint[] {
  if (data.length === 0) return [];

  const buckets = new Map<string, TotalReturnPoint[]>();
  const order: string[] = [];

  for (const p of data) {
    const key = bucketKey(p.date, intervalType);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(p);
  }

  return order.map((key) => {
    const group = buckets.get(key)!;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const dateStart = first.date;
    const dateEnd = last.date;

    const periodPnlEur = sumField(group, "periodPnlEur");
    const pricePnlEur = sumField(group, "pricePnlEur");
    const periodRealizedEur = sumField(group, "periodRealizedEur");
    const incomePnlEur = sumField(group, "incomePnlEur");

    const totalPnlEur = last.totalPnlEur ?? 0;
    const totalPnlPct = last.totalPnlPct ?? 0;
    const latentPnlEur =
      typeof last.latentPnlEur === "number" ? last.latentPnlEur : 0;
    const latentPnlPct =
      typeof last.latentPnlPct === "number" ? last.latentPnlPct : 0;
    const dividendsNetCumEur =
      typeof last.dividendsNetCumEur === "number"
        ? last.dividendsNetCumEur
        : typeof last.dividendsCum === "number"
          ? last.dividendsCum
          : 0;
    const dividendsGrossCumEur =
      typeof last.dividendsGrossCumEur === "number"
        ? last.dividendsGrossCumEur
        : dividendsNetCumEur;
    const withholdingCumEur =
      typeof last.withholdingCumEur === "number" ? last.withholdingCumEur : 0;

    // Défaut affichage = composé (stock) ; applyPerfMetricMode peut basculer
    const chartValueEur = totalPnlEur;
    const chartValuePct = totalPnlPct;

    let label: string;
    let periodLabel: string;
    if (intervalType === "day") {
      label = formatDayShort(dateEnd);
      periodLabel = formatDayLong(dateEnd);
    } else if (intervalType === "week") {
      const { y, m, d } = parisYmd(dateStart);
      const mon0 = parisWeekdayMon0(dateStart);
      const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
      const mondayMs = utcNoon - mon0 * 24 * 60 * 60 * 1000;
      const sundayMs = mondayMs + 6 * 24 * 60 * 60 * 1000;
      const weekStartIso = new Date(mondayMs).toISOString();
      const weekEndIso = new Date(sundayMs).toISOString();
      label = weekAxisLabel(weekStartIso);
      periodLabel = formatWeekRangeLabel(weekStartIso, weekEndIso);
    } else {
      label = formatMonthLabel(dateEnd);
      periodLabel = formatMonthLong(dateEnd);
    }

    return {
      date: dateEnd,
      dateStart,
      dateEnd,
      label,
      periodLabel,
      periodPnlEur,
      pricePnlEur,
      periodRealizedEur,
      incomePnlEur,
      totalPnlEur,
      totalPnlPct,
      latentPnlEur,
      latentPnlPct,
      dividendsNetCumEur,
      dividendsGrossCumEur,
      withholdingCumEur,
      chartValueEur,
      chartValuePct,
      pos: chartValueEur >= 0 ? chartValueEur : 0,
      neg: chartValueEur < 0 ? chartValueEur : 0,
      intervalType,
      close: last.close,
      qty: last.qty,
      cumpEur: last.cumpEur ?? 0,
      cashInvestedNet: last.cashInvestedNet,
      dividendsCum: dividendsNetCumEur,
    };
  });
}

/** Applique le mode Δ / Σ / Dividendes sur les points agrégés (dataKey chart). */
export function applyPerfMetricMode(
  points: AggregatedPerfPoint[],
  mode: PerfMetricMode
): AggregatedPerfPoint[] {
  return points.map((p) => {
    let chartValueEur = p.totalPnlEur;
    let chartValuePct = p.totalPnlPct;
    if (mode === "period") {
      chartValueEur = p.periodPnlEur;
      chartValuePct =
        p.cashInvestedNet > 1e-9
          ? (p.periodPnlEur / p.cashInvestedNet) * 100
          : 0;
    } else if (mode === "dividends") {
      chartValueEur = p.dividendsNetCumEur;
      chartValuePct =
        p.cashInvestedNet > 1e-9
          ? (p.dividendsNetCumEur / p.cashInvestedNet) * 100
          : 0;
    }
    return {
      ...p,
      chartValueEur,
      chartValuePct,
      pos: chartValueEur >= 0 ? chartValueEur : 0,
      neg: chartValueEur < 0 ? chartValueEur : 0,
    };
  });
}

/** Pipeline complet : intervalle + agrégation (+ mode optionnel). */
export function buildAggregatedPerfSeries(
  data: TotalReturnPoint[],
  range: PriceHistoryRange,
  mode: PerfMetricMode = "cumul"
): { intervalType: AggregateInterval; points: AggregatedPerfPoint[] } {
  const intervalType = resolvePerfAggregateInterval(range, data);
  const raw = groupDataByInterval(data, intervalType);
  return {
    intervalType,
    points: applyPerfMetricMode(raw, mode),
  };
}
