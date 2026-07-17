/**
 * Calendrier des résultats — sources live accessibles dans Patrimo.
 *
 * Priorité :
 * 1. Yahoo Finance (yahoo-finance2, déjà dépendance) — sans clé, EU + US
 * 2. Finnhub calendar/earnings — si FINNHUB_API_KEY valide
 * 3. Mock local (dernier recours)
 */

import YahooFinance from "yahoo-finance2";
import type {
  EarningsEvent,
  EarningsTiming,
  PortfolioTickerRef,
} from "@/app/lib/news/service";
import { getEarningsCalendarMock } from "@/app/lib/news/service";
import { toYahooSymbol, toFinnhubSymbol } from "@/app/lib/market/symbol";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export type EarningsSource = "yahoo" | "finnhub" | "mixed" | "mock";

export type EarningsCalendarResult = {
  events: EarningsEvent[];
  source: EarningsSource;
};

function finnhubApiKey(): string | null {
  const key = (process.env.FINNHUB_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!key || key === "demo" || key === "votre-cle-finnhub") return null;
  return key;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatEps(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mapFinnhubHour(hour: string | null | undefined): EarningsTiming {
  const h = (hour || "").toLowerCase();
  if (h === "bmo") return "bmo";
  if (h === "amc") return "amc";
  if (h === "dmh") return "during";
  return "during";
}

/** Heuristique BMO / AMC à partir d’un timestamp UTC (Yahoo ne donne pas l’étiquette). */
function timingFromIso(iso: string): EarningsTiming {
  try {
    const h = new Date(iso).getUTCHours();
    if (h <= 12) return "bmo";
    if (h >= 20) return "amc";
    return "during";
  } catch {
    return "during";
  }
}

function normalizeKey(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\..*$/, "");
}

function dedupeRefs(list: PortfolioTickerRef[]): PortfolioTickerRef[] {
  const seen = new Set<string>();
  const out: PortfolioTickerRef[] = [];
  for (const p of list) {
    const t = (p.ticker || "").trim();
    if (!t) continue;
    const key = t.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ticker: t,
      name: p.name?.trim() || t,
    });
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

type YahooCal = {
  earnings?: {
    earningsDate?: Array<Date | string | number>;
    earningsAverage?: number;
    earningsLow?: number;
    earningsHigh?: number;
    isEarningsDateEstimate?: boolean;
  };
};

async function fetchYahooOne(
  ref: PortfolioTickerRef,
  inPortfolio: boolean
): Promise<EarningsEvent | null> {
  const symbol = toYahooSymbol(ref.ticker, null);
  if (!symbol) return null;

  try {
    const summary = (await yahooFinance.quoteSummary(symbol, {
      modules: ["calendarEvents"],
    })) as { calendarEvents?: YahooCal };

    const earn = summary?.calendarEvents?.earnings;
    const rawDate = earn?.earningsDate?.[0];
    if (rawDate == null) return null;

    const time =
      rawDate instanceof Date
        ? rawDate.toISOString()
        : typeof rawDate === "number"
          ? new Date(rawDate * (rawDate < 1e12 ? 1000 : 1)).toISOString()
          : new Date(rawDate).toISOString();

    if (Number.isNaN(Date.parse(time))) return null;

    const eps = earn?.earningsAverage ?? null;

    return {
      id: `yahoo-${symbol}-${time.slice(0, 10)}`,
      time,
      companyName: ref.name,
      ticker: ref.ticker.toUpperCase(),
      timing: timingFromIso(time),
      epsEstimate: formatEps(eps),
      epsActual: null,
      inPortfolio,
    };
  } catch {
    return null;
  }
}

type FinnhubRow = {
  date?: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  hour?: string;
  quarter?: number;
  symbol?: string;
  year?: number;
};

async function fetchFinnhubCalendar(opts: {
  from: string;
  to: string;
  symbol?: string;
}): Promise<FinnhubRow[]> {
  const apiKey = finnhubApiKey();
  if (!apiKey) return [];

  const q = new URLSearchParams({
    from: opts.from,
    to: opts.to,
    token: apiKey,
  });
  if (opts.symbol) q.set("symbol", opts.symbol);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?${q.toString()}`,
      { cache: "no-store", signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { earningsCalendar?: FinnhubRow[] };
    return Array.isArray(data.earningsCalendar) ? data.earningsCalendar : [];
  } catch {
    return [];
  }
}

function finnhubRowToEvent(
  row: FinnhubRow,
  nameByTicker: Map<string, string>,
  portfolioSet: Set<string>
): EarningsEvent | null {
  const symbol = (row.symbol || "").trim().toUpperCase();
  if (!symbol || !row.date) return null;

  const hour = (row.hour || "dmh").toLowerCase();
  // Heures indicatives Europe/Paris-friendly pour l’affichage
  let hh = 12;
  let mm = 0;
  if (hour === "bmo") {
    hh = 7;
    mm = 30;
  } else if (hour === "amc") {
    hh = 17;
    mm = 30;
  } else {
    hh = 14;
    mm = 0;
  }

  const [y, m, d] = row.date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const time = new Date(Date.UTC(y, m - 1, d, hh - 2, mm, 0)).toISOString();

  const base = normalizeKey(symbol);
  const name =
    nameByTicker.get(symbol) ||
    nameByTicker.get(base) ||
    symbol;

  return {
    id: `fh-${symbol}-${row.date}-${hour}`,
    time,
    companyName: name,
    ticker: symbol,
    timing: mapFinnhubHour(row.hour),
    epsEstimate: formatEps(row.epsEstimate ?? null),
    epsActual: formatEps(row.epsActual ?? null),
    inPortfolio: portfolioSet.has(symbol) || portfolioSet.has(base),
  };
}

/**
 * Résout le calendrier résultats avec sources live, priorisant le portefeuille.
 */
export async function resolveEarningsCalendar(opts: {
  portfolio?: PortfolioTickerRef[];
  watchlist?: PortfolioTickerRef[];
  limit?: number;
}): Promise<EarningsCalendarResult> {
  const limit = Math.min(20, Math.max(1, opts.limit ?? 8));
  const portfolio = dedupeRefs(opts.portfolio ?? []);
  const watch = dedupeRefs(opts.watchlist ?? []);

  const portfolioSet = new Set<string>();
  for (const p of portfolio) {
    portfolioSet.add(p.ticker.toUpperCase());
    portfolioSet.add(normalizeKey(p.ticker));
  }

  const nameByTicker = new Map<string, string>();
  for (const p of [...portfolio, ...watch]) {
    nameByTicker.set(p.ticker.toUpperCase(), p.name);
    nameByTicker.set(normalizeKey(p.ticker), p.name);
  }

  // Ordre de priorité des symboles à interroger
  const ordered = dedupeRefs([...portfolio, ...watch]);
  const targets =
    ordered.length > 0
      ? ordered.slice(0, 16)
      : [
          { ticker: "AAPL", name: "Apple" },
          { ticker: "MSFT", name: "Microsoft" },
          { ticker: "ASML.AS", name: "ASML Holding" },
          { ticker: "MC.PA", name: "LVMH" },
          { ticker: "SAP.DE", name: "SAP" },
        ];

  const now = new Date();
  const from = isoDate(addDays(now, -2));
  const to = isoDate(addDays(now, 21));

  const sourcesUsed = new Set<"yahoo" | "finnhub">();
  const byKey = new Map<string, EarningsEvent>();

  // 1) Yahoo — une date de résultats par titre (global, sans clé)
  const yahooHits = await mapPool(targets, 4, async (ref) => {
    const inPf =
      portfolioSet.has(ref.ticker.toUpperCase()) ||
      portfolioSet.has(normalizeKey(ref.ticker));
    return fetchYahooOne(ref, inPf);
  });

  for (const ev of yahooHits) {
    if (!ev) continue;
    sourcesUsed.add("yahoo");
    const k = `${normalizeKey(ev.ticker)}|${ev.time.slice(0, 10)}`;
    byKey.set(k, ev);
  }

  // 2) Finnhub — enrichissement EPS / timing + calendrier US bulk
  if (finnhubApiKey()) {
    // Par symbole portefeuille (max 12) pour EPS actual/estimate + hour
    const fhTargets = targets.slice(0, 12);
    const perSymbol = await mapPool(fhTargets, 3, async (ref) => {
      const sym = toFinnhubSymbol(ref.ticker, null);
      if (!sym || sym.includes("BINANCE:")) return [] as FinnhubRow[];
      return fetchFinnhubCalendar({ from, to, symbol: sym });
    });

    for (let i = 0; i < fhTargets.length; i++) {
      const rows = perSymbol[i] ?? [];
      for (const row of rows) {
        const ev = finnhubRowToEvent(row, nameByTicker, portfolioSet);
        if (!ev) continue;
        sourcesUsed.add("finnhub");
        const k = `${normalizeKey(ev.ticker)}|${ev.time.slice(0, 10)}`;
        const prev = byKey.get(k);
        if (!prev) {
          byKey.set(k, ev);
        } else {
          // Enrichir Yahoo avec hour / EPS Finnhub si plus complets
          byKey.set(k, {
            ...prev,
            timing: row.hour ? mapFinnhubHour(row.hour) : prev.timing,
            epsEstimate: ev.epsEstimate ?? prev.epsEstimate,
            epsActual: ev.epsActual ?? prev.epsActual,
            id: prev.id.startsWith("yahoo") ? prev.id : ev.id,
          });
        }
      }
    }

    // Si peu de résultats, calendrier global US (fenêtre courte)
    if (byKey.size < Math.min(4, limit)) {
      const bulk = await fetchFinnhubCalendar({ from, to });
      for (const row of bulk.slice(0, 40)) {
        const ev = finnhubRowToEvent(row, nameByTicker, portfolioSet);
        if (!ev) continue;
        sourcesUsed.add("finnhub");
        const k = `${normalizeKey(ev.ticker)}|${ev.time.slice(0, 10)}`;
        if (!byKey.has(k)) byKey.set(k, ev);
      }
    }
  }

  let events = Array.from(byKey.values());

  // Trier : portefeuille d’abord, puis date croissante
  events.sort((a, b) => {
    if (a.inPortfolio !== b.inPortfolio) return a.inPortfolio ? -1 : 1;
    return Date.parse(a.time) - Date.parse(b.time);
  });

  // Fenêtre utile : J-2 → J+21 (ignorer dates trop lointaines si beaucoup)
  const minTs = addDays(now, -3).getTime();
  const maxTs = addDays(now, 45).getTime();
  events = events.filter((e) => {
    const t = Date.parse(e.time);
    return Number.isFinite(t) && t >= minTs && t <= maxTs;
  });

  if (events.length > 0) {
    const source: EarningsSource =
      sourcesUsed.size === 0
        ? "mock"
        : sourcesUsed.size === 2
          ? "mixed"
          : sourcesUsed.has("yahoo")
            ? "yahoo"
            : "finnhub";

    return {
      events: events.slice(0, limit),
      source,
    };
  }

  // 3) Fallback mock
  return {
    events: getEarningsCalendarMock({
      portfolio,
      watchlist: watch,
      limit,
    }),
    source: "mock",
  };
}
