/**
 * Agrégation du calendrier d’évolution patrimoniale (dashboard).
 * Règles de granularité selon la plage UI.
 */

import type { HistoryPoint } from "@/app/lib/types/ui";

export const EVOLUTION_RANGES = [
  "7d",
  "1m",
  "3m",
  "6m",
  "ytd",
  "1y",
  "5y",
  "all",
] as const;

export type EvolutionRange = (typeof EVOLUTION_RANGES)[number];

export type EvolutionInterval = "day" | "week" | "biweek" | "month";

export type EvolutionMetric = "period" | "cumul";
export type EvolutionChartStyle = "line" | "columns";
export type EvolutionViewMode = "global" | "decomposed";

export type EvolutionSeriesPoint = {
  date: string;
  label: string;
  periodLabel: string;
  /** Valeur totale (stock) en fin de bucket */
  total: number;
  cash: number;
  positions: number;
  realized: number;
  unrealized: number;
  /** Revenus cash cumulés (div. / coupons / loyers agrégés) */
  income: number;
  dividends: number;
  coupons: number;
  rents: number;
  /**
   * Valeur affichée principale :
   * - cumul → total
   * - period → Δ total vs bucket précédent
   */
  chartValue: number;
  /** Colonnes divergentes */
  pos: number;
  neg: number;
  /** Δ contributeurs (mode périodique décomposé) */
  dPositions: number;
  dCash: number;
  dRealized: number;
  dUnrealized: number;
  dIncome: number;
  dDividends: number;
  dCoupons: number;
  dRents: number;
  /** Série comparative rebasée (stock) */
  benchmark?: number;
  /** Δ période de la série comparative */
  benchmarkDelta?: number;
  intervalType: EvolutionInterval;
  isLive?: boolean;
};

function parisParts(iso: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function parisWeekdayMon0(iso: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(new Date(iso));
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

/** Début de jour civil Europe/Paris (approx. via parts locales → UTC noon-12h). */
function parisStartOfCalendarDay(now = new Date()): Date {
  const { y, m, d } = parisParts(now.toISOString());
  // Minuit Paris ≈ Date.UTC(y,m-1,d) + offset ; on utilise 00:00 UTC du jour civil
  // Paris et on élargit d’1h pour ne pas couper le jour (snapshots live du jour inclus).
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function startOfRange(range: EvolutionRange, now = new Date()): Date | null {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "7d": {
      // 7 jours calendaires incluant aujourd’hui : J-6 00:00 → live
      const start = parisStartOfCalendarDay(now);
      return new Date(start.getTime() - 6 * day);
    }
    case "1m": {
      // ~4–5 semaines ISO : lundi de la semaine contenant (now - 30j)
      const approx = new Date(now.getTime() - 30 * day);
      return startOfIsoWeekMonday(approx);
    }
    case "3m": {
      const approx = new Date(now.getTime() - 93 * day);
      return startOfIsoWeekMonday(approx);
    }
    case "6m":
      return new Date(now.getTime() - 183 * day);
    case "ytd": {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
      }).formatToParts(now);
      const y = Number(
        parts.find((p) => p.type === "year")?.value ?? now.getFullYear()
      );
      return new Date(Date.UTC(y, 0, 1, 0, 0, 0));
    }
    case "1y":
      return new Date(now.getTime() - 365 * day);
    case "5y":
      return new Date(now.getTime() - 5 * 365 * day);
    case "all":
      return null;
  }
}

/** Lundi 00:00 (civil Paris) de la semaine ISO contenant `date`. */
export function startOfIsoWeekMonday(date: Date): Date {
  const iso = date.toISOString();
  const { y, m, d } = parisParts(iso);
  const mon0 = parisWeekdayMon0(iso);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const mondayNoon = new Date(utcNoon - mon0 * 24 * 60 * 60 * 1000);
  const { y: my, m: mm, d: md } = {
    y: mondayNoon.getUTCFullYear(),
    m: mondayNoon.getUTCMonth() + 1,
    d: mondayNoon.getUTCDate(),
  };
  return new Date(Date.UTC(my, mm - 1, md, 0, 0, 0));
}

/**
 * Granularité selon la plage (spec produit).
 * - 7J → journalier (7 jours calendaires, jour courant inclus / live)
 * - 1M / 3M → hebdomadaire ISO (lundi 00:00 → dimanche 23:59)
 * - 6M / YTD → hebdomadaire
 * - 1A → bi-hebdo si dense, sinon mensuel
 * - 5A / Tout → mensuel
 */
export function resolveEvolutionInterval(
  range: EvolutionRange,
  pointCountInRange: number
): EvolutionInterval {
  if (range === "7d") return "day";
  if (range === "1m" || range === "3m") return "week";
  if (range === "6m" || range === "ytd") return "week";
  if (range === "1y") {
    return pointCountInRange >= 40 ? "biweek" : "month";
  }
  return "month";
}

/** Libellé court pour sous-titre (résolution d’affichage). */
export function evolutionIntervalLabel(iv: EvolutionInterval): string {
  switch (iv) {
    case "day":
      return "journalière";
    case "week":
      return "hebdomadaire";
    case "biweek":
      return "bihebdomadaire";
    case "month":
      return "mensuelle";
  }
}

/** Libellé long pour tooltips / accessibilité. */
export function evolutionIntervalHint(iv: EvolutionInterval): string {
  switch (iv) {
    case "day":
      return "un point par jour";
    case "week":
      return "un point par semaine";
    case "biweek":
      return "un point toutes les deux semaines";
    case "month":
      return "un point par mois";
  }
}

/**
 * Clé de bucket stable.
 * Semaine = semaine calendaire ISO Europe/Paris (lundi → dimanche).
 */
export function bucketKey(iso: string, interval: EvolutionInterval): string {
  const { y, m, d } = parisParts(iso);
  if (interval === "day") {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (interval === "month") {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  // week / biweek — lundi de la semaine ISO (Paris)
  const monday = startOfIsoWeekMonday(new Date(iso));
  const my = monday.getUTCFullYear();
  const mm = monday.getUTCMonth() + 1;
  const md = monday.getUTCDate();
  const weekKey = `W${my}-${String(mm).padStart(2, "0")}-${String(md).padStart(2, "0")}`;
  if (interval === "week") return weekKey;
  const start = new Date(Date.UTC(my, 0, 1));
  const weekNum = Math.floor(
    (monday.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  return `BW${my}-${String(Math.floor(weekNum / 2)).padStart(2, "0")}`;
}

function formatDayMonthShort(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
  }).format(d);
}

/**
 * Libellé axe / tooltip semaine ISO :
 * « S. 13 juil. - 19 juil. » (lundi → dimanche)
 */
export function formatWeekRangeLabel(iso: string): string {
  const mon = startOfIsoWeekMonday(new Date(iso));
  const sun = new Date(mon.getTime() + 6 * 24 * 60 * 60 * 1000);
  return `S. ${formatDayMonthShort(mon)} - ${formatDayMonthShort(sun)}`;
}

function formatAxisLabel(iso: string, interval: EvolutionInterval): string {
  const d = new Date(iso);
  if (interval === "month") {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      month: "short",
      year: "2-digit",
    }).format(d);
  }
  if (interval === "week" || interval === "biweek") {
    return formatWeekRangeLabel(iso);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
  }).format(d);
}

function formatPeriodLabel(iso: string, interval: EvolutionInterval): string {
  const d = new Date(iso);
  if (interval === "month") {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      month: "long",
      year: "numeric",
    }).format(d);
  }
  if (interval === "week" || interval === "biweek") {
    return formatWeekRangeLabel(iso);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "medium",
  }).format(d);
}

type StockAcc = {
  date: string;
  total: number;
  cash: number;
  positions: number;
  realized: number;
  unrealized: number;
  income: number;
  dividends: number;
  coupons: number;
  rents: number;
  isLive?: boolean;
};

/**
 * Densifie la série journalière 7J : un point par jour civil de la fenêtre
 * (J-6 … aujourd’hui). Jours sans snapshot = report de la dernière valeur connue
 * (après le premier point réel).
 */
function densifyDailyCalendar(
  stock: StockAcc[],
  from: Date,
  now: Date
): StockAcc[] {
  if (stock.length === 0) return stock;

  const dayMs = 24 * 60 * 60 * 1000;
  const byDay = new Map<string, StockAcc>();
  for (const s of stock) {
    byDay.set(bucketKey(s.date, "day"), s);
  }

  const start = parisStartOfCalendarDay(from);
  const end = parisStartOfCalendarDay(now);
  const out: StockAcc[] = [];
  let carry: StockAcc | null = null;

  // Valeur d’amorçage : dernier point strictement avant la fenêtre
  for (const s of stock) {
    if (Date.parse(s.date) < start.getTime()) {
      carry = { ...s, isLive: false };
    }
  }

  for (
    let t = start.getTime();
    t <= end.getTime() + dayMs / 2;
    t += dayMs
  ) {
    const dayDate = new Date(t);
    const key = bucketKey(dayDate.toISOString(), "day");
    const hit = byDay.get(key);
    if (hit) {
      carry = { ...hit };
      out.push(hit);
    } else if (carry) {
      // Report : même valorisation, horodatage = milieu de journée civil
      const { y, m, d } = parisParts(dayDate.toISOString());
      out.push({
        ...carry,
        date: new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toISOString(),
        isLive: false,
      });
    }
    // avant le premier snapshot : pas de point inventé
  }

  return out.length > 0 ? out : stock;
}

function normalizePoint(p: HistoryPoint): {
  date: string;
  total: number;
  cash: number;
  positions: number;
  realized: number;
  unrealized: number;
  income: number;
  dividends: number;
  coupons: number;
  rents: number;
  isLive?: boolean;
} {
  const total = Number(p.totalValueBase) || 0;
  const cash = Number(p.cashTotalBase) || 0;
  const positions =
    p.positionsBase != null ? Number(p.positionsBase) : total - cash;
  const dividends = Number(p.dividendsBase) || 0;
  const coupons = Number(p.couponsBase) || 0;
  const rents = Number(p.rentsBase) || 0;
  const income =
    Number(p.cashIncomeBase) || dividends + coupons + rents || 0;
  return {
    date: p.date,
    total,
    cash,
    positions,
    realized: Number(p.realizedPnlBase) || 0,
    unrealized: Number(p.unrealizedPnlBase) || 0,
    income,
    dividends,
    coupons,
    rents,
    isLive: p.isLive,
  };
}

/**
 * Filtre + agrège + applique le mode périodique / cumulé.
 */
export function buildEvolutionSeries(
  raw: HistoryPoint[],
  range: EvolutionRange,
  metric: EvolutionMetric,
  now = new Date()
): { points: EvolutionSeriesPoint[]; interval: EvolutionInterval } {
  if (raw.length === 0) {
    return { points: [], interval: "day" };
  }

  const from = startOfRange(range, now);
  let filtered = raw
    .map(normalizePoint)
    .filter((p) => Number.isFinite(Date.parse(p.date)));

  if (from) {
    const fromT = from.getTime();
    // garder un point d’ancrage juste avant la fenêtre pour le Δ
    let anchorIdx = -1;
    for (let i = 0; i < filtered.length; i++) {
      if (Date.parse(filtered[i]!.date) < fromT) anchorIdx = i;
    }
    const inRange = filtered.filter((p) => Date.parse(p.date) >= fromT);
    if (anchorIdx >= 0 && inRange.length > 0) {
      filtered = [filtered[anchorIdx]!, ...inRange];
    } else if (inRange.length > 0) {
      filtered = inRange;
    }
    // sinon garder tout (historique trop court)
  }

  const interval = resolveEvolutionInterval(range, filtered.length);

  // Bucket : dernière observation du bucket (stock)
  const buckets = new Map<string, StockAcc>();
  const order: string[] = [];

  for (const p of filtered) {
    const key = bucketKey(p.date, interval);
    if (!buckets.has(key)) {
      order.push(key);
      buckets.set(key, { ...p });
    } else {
      buckets.set(key, { ...p });
    }
  }

  let stock: StockAcc[] = order.map((k) => buckets.get(k)!);

  // 7J : densifier tous les jours calendaires (report des valeurs manquantes)
  if (range === "7d" && interval === "day" && from) {
    stock = densifyDailyCalendar(stock, from, now);
  }

  // Si ancre hors plage : on l’utilise pour le premier Δ puis on peut la retirer
  // en mode cumul si from est défini
  const fromT = from?.getTime() ?? null;

  const points: EvolutionSeriesPoint[] = stock.map((s, i) => {
    const prev = i > 0 ? stock[i - 1]! : null;
    const dTotal = prev ? s.total - prev.total : 0;
    const chartValue = metric === "cumul" ? s.total : dTotal;
    // Libellé semaine : ancré sur le lundi ISO (pas sur le jour de la dernière obs.)
    const labelIso =
      interval === "week" || interval === "biweek"
        ? startOfIsoWeekMonday(new Date(s.date)).toISOString()
        : s.date;
    return {
      date: s.date,
      label: formatAxisLabel(labelIso, interval),
      periodLabel: formatPeriodLabel(labelIso, interval),
      total: s.total,
      cash: s.cash,
      positions: s.positions,
      realized: s.realized,
      unrealized: s.unrealized,
      income: s.income,
      dividends: s.dividends,
      coupons: s.coupons,
      rents: s.rents,
      chartValue,
      pos: chartValue >= 0 ? chartValue : 0,
      neg: chartValue < 0 ? chartValue : 0,
      dPositions: prev ? s.positions - prev.positions : 0,
      dCash: prev ? s.cash - prev.cash : 0,
      dRealized: prev ? s.realized - prev.realized : 0,
      dUnrealized: prev ? s.unrealized - prev.unrealized : 0,
      dIncome: prev ? s.income - prev.income : 0,
      dDividends: prev ? s.dividends - prev.dividends : 0,
      dCoupons: prev ? s.coupons - prev.coupons : 0,
      dRents: prev ? s.rents - prev.rents : 0,
      intervalType: interval,
      isLive: s.isLive,
    };
  });

  // Retirer l’ancre pure (avant from) de l’affichage
  let display = points;
  if (fromT != null && display.length > 1) {
    const firstIn = display.findIndex((p) => Date.parse(p.date) >= fromT);
    if (firstIn > 0) {
      display = display.slice(firstIn);
    }
  }

  // En périodique, le 1er point sans précédent utile → 0 (déjà le cas si ancre absente)
  return { points: display, interval };
}

export function evolutionDeltaSummary(points: EvolutionSeriesPoint[]): {
  first: number;
  last: number;
  delta: number;
  pct: number;
} | null {
  if (points.length < 1) return null;
  const first = points[0]!.total;
  const last = points[points.length - 1]!.total;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  return { first, last, delta, pct };
}

/** Périodes activables selon profondeur d’historique disponible. */
export function isEvolutionRangeEnabled(
  range: EvolutionRange,
  firstDateIso: string | null,
  now = new Date()
): boolean {
  if (range === "7d" || range === "all") return true;
  if (!firstDateIso) return false;
  const ageDays =
    (now.getTime() - Date.parse(firstDateIso)) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(ageDays)) return false;
  switch (range) {
    case "1m":
      return ageDays >= 14;
    case "3m":
      return ageDays >= 45;
    case "6m":
      return ageDays >= 90;
    case "ytd": {
      const yStart = startOfRange("ytd", now);
      return yStart != null && Date.parse(firstDateIso) < yStart.getTime();
    }
    case "1y":
      return ageDays >= 180;
    case "5y":
      return ageDays >= 365;
    default:
      return true;
  }
}

export type EvolutionBenchmarkMode = "none" | "inflation" | "index";

/** Clôture d'indice brute (rebasée ensuite sur le premier total du portefeuille). */
export type IndexClosePoint = { date: string; close: number };

/**
 * Inflation France — glissement annuel de l'IPC (indice des prix à la
 * consommation, INSEE). Constante documentée : moyenne annuelle 2024 ≈ 2,0 %.
 * À rafraîchir quand l'INSEE publie une nouvelle référence annuelle.
 * Utilisée comme taux annualisé et appliquée au prorata du temps écoulé, donc
 * automatiquement adaptée à la périodicité affichée (jour / semaine / mois…).
 */
export const FRENCH_ANNUAL_CPI_RATE = 0.02;

export type BenchmarkOptions = {
  /** Clôtures d'indice (mode "index"), brutes — rebasées sur baseTotal. */
  indexCloses?: IndexClosePoint[];
  /** Taux d'inflation annuel (défaut : IPC France). */
  annualInflationRate?: number;
};

/** Sélectionne la dernière clôture d'indice ≤ date de barre (tolérance 36 h). */
function makeIndexPicker(indexCloses: IndexClosePoint[]) {
  const sorted = [...indexCloses]
    .filter((c) => Number.isFinite(Date.parse(c.date)) && c.close > 0)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return (barDate: string): number | null => {
    const t = Date.parse(barDate);
    if (!Number.isFinite(t)) return null;
    let best: number | null = null;
    for (const c of sorted) {
      if (Date.parse(c.date) <= t + 36e5) best = c.close;
      else break;
    }
    return best;
  };
}

/**
 * Attache une série comparative **rebasée** sur le premier total du portefeuille.
 * Alignement temporel : même dates que la série principale.
 *
 * - inflation : capital initial revalorisé au taux IPC France (pouvoir d'achat),
 *   appliqué au prorata du temps → s'adapte à la périodicité choisie.
 * - index : performance réelle de l'indice choisi (clôtures Yahoo), rebasée sur
 *   le premier total → directement comparable au portefeuille en €.
 *
 * En mode périodique, `benchmark` reste le stock rebasé ; le graphe dérive le Δ
 * via le point précédent.
 */
export function withBenchmarkSeries(
  points: EvolutionSeriesPoint[],
  mode: EvolutionBenchmarkMode,
  opts: BenchmarkOptions = {}
): EvolutionSeriesPoint[] {
  if (mode === "none" || points.length === 0) {
    return points.map((p) => ({ ...p, benchmark: undefined }));
  }

  const t0 = Date.parse(points[0]!.date);
  const baseTotal = points[0]!.total;
  if (!Number.isFinite(baseTotal) || baseTotal <= 0) {
    return points.map((p) => ({ ...p, benchmark: undefined }));
  }

  function yearsSince(iso: string): number {
    const t = Date.parse(iso);
    if (!Number.isFinite(t0) || !Number.isFinite(t)) return 0;
    return Math.max(0, (t - t0) / (365.25 * 24 * 60 * 60 * 1000));
  }

  let levelAt: (iso: string) => number;

  if (mode === "inflation") {
    const rate = opts.annualInflationRate ?? FRENCH_ANNUAL_CPI_RATE;
    levelAt = (iso) => baseTotal * Math.pow(1 + rate, yearsSince(iso));
  } else {
    // index : rebasage des clôtures réelles sur baseTotal
    const closes = opts.indexCloses ?? [];
    const pick = makeIndexPicker(closes);
    const baseClose = pick(points[0]!.date);
    if (baseClose == null || baseClose <= 0) {
      // Pas de données indice → pas de courbe (évite une ligne plate trompeuse)
      return points.map((p) => ({ ...p, benchmark: undefined }));
    }
    levelAt = (iso) => {
      const c = pick(iso) ?? baseClose;
      return baseTotal * (c / baseClose);
    };
  }

  return points.map((p, i) => {
    const benchmark = levelAt(p.date);
    const prevBm = i > 0 ? levelAt(points[i - 1]!.date) : benchmark;
    return {
      ...p,
      benchmark,
      benchmarkDelta: i === 0 ? 0 : benchmark - prevBm,
    };
  });
}

export function benchmarkLabel(mode: EvolutionBenchmarkMode): string {
  switch (mode) {
    case "none":
      return "Aucun";
    case "inflation":
      return "Inflation (IPC France)";
    case "index":
      return "Indice";
  }
}

/**
 * Écart de performance (points de %) entre le portefeuille et le benchmark sur
 * la période affichée : perf portefeuille − perf benchmark.
 * `null` si non calculable (pas de benchmark ou base nulle).
 */
export function benchmarkGapPct(
  points: EvolutionSeriesPoint[]
): { portfolioPct: number; benchmarkPct: number; gapPct: number } | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (!(first.total > 0)) return null;
  const portfolioPct = ((last.total - first.total) / first.total) * 100;
  const b0 = first.benchmark;
  const b1 = last.benchmark;
  if (b0 == null || b1 == null || !(b0 > 0)) return null;
  const benchmarkPct = ((b1 - b0) / b0) * 100;
  return {
    portfolioPct,
    benchmarkPct,
    gapPct: portfolioPct - benchmarkPct,
  };
}
