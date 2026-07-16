import YahooFinance from "yahoo-finance2";
import { prisma } from "../prisma";
import { d, toFixed } from "../money/decimal";
import { toYahooSymbol } from "./symbol";
import { getEurRates, convertToEurSync } from "./fx";
import type {
  PriceBarInterval,
  PriceHistoryPoint,
  PriceHistoryRange,
  PriceHistoryResult,
} from "./price-history-types";
import {
  barIntervalForRange,
  normalizeSessionOhlc,
} from "./price-history-types";

export type { PriceHistoryPoint, PriceHistoryRange, PriceHistoryResult };
export {
  PRICE_HISTORY_RANGES,
  parseHistoryRange,
  barIntervalForRange,
  barIntervalLabel,
} from "./price-history-types";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

type YahooInterval =
  | "15m"
  | "60m"
  | "1h"
  | "1d"
  | "1wk";

const RANGE_DAYS: Record<Exclude<PriceHistoryRange, "ytd" | "all">, number> = {
  "7d": 7,
  "1m": 30,
  "3m": 90,
  "1y": 365,
  "5y": 365 * 5,
};


/** Plafond de profondeur historique (Yahoo / perf 1er achat). */
export const MAX_PRICE_HISTORY_YEARS = 30;

export type GetAssetPriceHistoryOptions = {
  /**
   * Date du premier achat (ou plus ancienne tx pertinente).
   * Pour les fenêtres longues (5y / all), étend le fetch en arrière
   * afin que le jour 1 de la perf soit le vrai premier achat, pas le
   * début arbitraire des 5 ans de cours.
   */
  since?: Date | string | null;
};

/**
 * Borne basse de fetch des barres de cours.
 * - Court terme (7d…1y, ytd) : strictement le range UI.
 * - 5y / all : min(rangeStart, since) plafonné à 30 ans.
 */
export function resolveHistoryFromDate(
  range: PriceHistoryRange,
  since?: Date | string | null,
  now = new Date()
): { from: Date; extendedToFirstBuy: boolean } {
  let base: Date;
  if (range === "ytd") {
    base = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  } else if (range === "all") {
    base = new Date(
      Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), now.getUTCDate())
    );
  } else {
    const days = RANGE_DAYS[range as Exclude<PriceHistoryRange, "ytd" | "all">];
    base = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  if (range !== "all" && range !== "5y") {
    return { from: base, extendedToFirstBuy: false };
  }

  if (since == null || since === "") {
    return { from: base, extendedToFirstBuy: false };
  }
  const s = typeof since === "string" ? new Date(since) : since;
  if (!(s instanceof Date) || Number.isNaN(s.getTime())) {
    return { from: base, extendedToFirstBuy: false };
  }

  const floor = new Date(now.getTime());
  floor.setUTCFullYear(floor.getUTCFullYear() - MAX_PRICE_HISTORY_YEARS);

  if (s >= base) {
    return { from: base, extendedToFirstBuy: false };
  }
  const from = s < floor ? floor : s;
  return { from, extendedToFirstBuy: true };
}

function sessionKeyParis(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Axis / tooltip label depending on bar size */
function formatLabel(iso: string, bar: PriceBarInterval): string {
  const d0 = new Date(iso);
  if (bar === "15m" || bar === "1h" || bar === "4h") {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d0);
  }
  if (bar === "1wk") {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "short",
      year: "2-digit",
    }).format(d0);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
  }).format(d0);
}

function barPoint(
  at: Date,
  ohlc: { open: number; high: number; low: number; close: number },
  bar: PriceBarInterval
): PriceHistoryPoint {
  const n = normalizeSessionOhlc(ohlc);
  const iso = at.toISOString();
  return {
    date: iso,
    label: formatLabel(iso, bar),
    open: n.open,
    high: n.high,
    low: n.low,
    close: n.close,
    price: n.close,
  };
}

function sessionFromCloses(
  prevClose: number | undefined,
  close: number,
  seed: number
): { open: number; high: number; low: number; close: number } {
  const c = Math.max(close, 1e-8);
  const gap = prevClose != null ? ((((seed * 13) % 9) - 4) * 0.0012) : -0.002;
  const open = prevClose != null ? Math.max(1e-8, prevClose * (1 + gap)) : c * 0.998;
  const bodyHi = Math.max(open, c);
  const bodyLo = Math.min(open, c);
  const body = Math.max(Math.abs(c - open), c * 0.003);
  const upWick = body * (0.25 + (seed % 5) * 0.12);
  const dnWick = body * (0.2 + (seed % 7) * 0.1);
  return normalizeSessionOhlc({
    open: Number(open.toPrecision(10)),
    close: Number(c.toPrecision(10)),
    high: Number((bodyHi + upWick).toPrecision(10)),
    low: Number(Math.max(1e-8, bodyLo - dnWick).toPrecision(10)),
  });
}

function barStepMs(bar: PriceBarInterval): number {
  switch (bar) {
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    case "1wk":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

/** Yahoo interval (no native 4h → fetch 1h then aggregate). */
function yahooIntervalFor(bar: PriceBarInterval): YahooInterval {
  switch (bar) {
    case "15m":
      return "15m";
    case "1h":
      return "1h";
    case "4h":
      return "1h";
    case "1d":
      return "1d";
    case "1wk":
      return "1wk";
  }
}

function aggregateBars(
  points: PriceHistoryPoint[],
  bar: PriceBarInterval
): PriceHistoryPoint[] {
  if (bar !== "4h" || points.length === 0) return points;
  // Group successive 1h bars into 4h buckets by floor timestamp
  const step = 4 * 60 * 60 * 1000;
  const buckets = new Map<number, PriceHistoryPoint[]>();
  for (const p of points) {
    const t = new Date(p.date).getTime();
    const key = Math.floor(t / step) * step;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, arr]) => {
      const open = arr[0]!.open;
      const close = arr[arr.length - 1]!.close;
      const high = Math.max(...arr.map((x) => x.high));
      const low = Math.min(...arr.map((x) => x.low));
      return barPoint(new Date(key), { open, high, low, close }, "4h");
    });
}

function buildMockSeries(
  assetId: string,
  endPrice: number,
  from: Date,
  to: Date,
  bar: PriceBarInterval
): PriceHistoryPoint[] {
  const seed = assetId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const step = barStepMs(bar);
  const points: PriceHistoryPoint[] = [];
  let close = endPrice * 0.9;
  let i = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += step, i++) {
    const d0 = new Date(t);
    // Skip weekends for day/week bars
    if ((bar === "1d" || bar === "1wk") && (d0.getUTCDay() === 0 || d0.getUTCDay() === 6)) {
      continue;
    }
    // For intraday, skip off-hours roughly (weekends only — markets vary)
    if ((bar === "15m" || bar === "1h" || bar === "4h") && (d0.getUTCDay() === 0 || d0.getUTCDay() === 6)) {
      continue;
    }
    const wave = Math.sin((i + seed) * 0.35) * 0.008;
    const progress = (t - from.getTime()) / Math.max(1, to.getTime() - from.getTime());
    const target = endPrice * (0.9 + 0.1 * progress);
    const prev = close;
    close = Math.max(
      1e-6,
      close +
        (target - close) * 0.06 +
        close * (wave + (((seed * (i + 2)) % 11) - 5) * 0.0006)
    );
    const ohlc = sessionFromCloses(prev, close, seed + i);
    points.push(barPoint(d0, ohlc, bar));
  }
  if (points.length === 0) {
    points.push(barPoint(to, sessionFromCloses(undefined, endPrice, seed), bar));
  } else {
    const prevClose = points.length > 1 ? points[points.length - 2]!.close : endPrice * 0.99;
    points[points.length - 1] = barPoint(
      to,
      sessionFromCloses(prevClose, endPrice, seed + 99),
      bar
    );
  }
  return points;
}

async function fetchYahooBars(
  symbol: string,
  from: Date,
  to: Date,
  bar: PriceBarInterval,
  nativeCurrency: string
): Promise<PriceHistoryPoint[] | null> {
  try {
    // Yahoo limits: 15m ~60 days max typically — clamp period1
    let period1 = from;
    if (bar === "15m") {
      const minFrom = new Date(to.getTime() - 55 * 24 * 60 * 60 * 1000);
      if (period1 < minFrom) period1 = minFrom;
    } else if (bar === "1h" || bar === "4h") {
      const minFrom = new Date(to.getTime() - 700 * 24 * 60 * 60 * 1000);
      if (period1 < minFrom) period1 = minFrom;
    }

    const result = (await yahooFinance.chart(symbol, {
      period1,
      period2: to,
      interval: yahooIntervalFor(bar),
    })) as {
      quotes?: Array<{
        date?: Date;
        open?: number | null;
        high?: number | null;
        low?: number | null;
        close?: number | null;
        adjclose?: number | null;
      }>;
    };

    const quotes = (result.quotes ?? []).filter(
      (q) => q.date && typeof (q.close ?? q.adjclose) === "number"
    );
    if (quotes.length < 2) return null;

    const rates = await getEurRates();
    const cur = nativeCurrency.toUpperCase();
    const toEur = (v: number) =>
      cur === "EUR" ? v : Number(convertToEurSync(v, cur, rates));

    let points: PriceHistoryPoint[] = [];
    for (const q of quotes) {
      const closeN = Number(q.close ?? q.adjclose);
      if (!Number.isFinite(closeN) || closeN <= 0 || !q.date) continue;
      const openN = typeof q.open === "number" && q.open > 0 ? q.open : closeN;
      const highN =
        typeof q.high === "number" && q.high > 0 ? q.high : Math.max(openN, closeN);
      const lowN =
        typeof q.low === "number" && q.low > 0 ? q.low : Math.min(openN, closeN);

      const ohlc = normalizeSessionOhlc({
        open: toEur(openN),
        high: toEur(highN),
        low: toEur(lowN),
        close: toEur(closeN),
      });

      // Keep real bar timestamp (intraday matters for 15m/1h/4h)
      points.push(
        barPoint(new Date(q.date), {
          open: Number(toFixed(d(ohlc.open), 8)),
          high: Number(toFixed(d(ohlc.high), 8)),
          low: Number(toFixed(d(ohlc.low), 8)),
          close: Number(toFixed(d(ohlc.close), 8)),
        }, bar === "4h" ? "1h" : bar)
      );
    }

    // Aggregate 1h → 4h when needed
    if (bar === "4h") {
      points = aggregateBars(points, "4h");
    }

    // Dedupe only for daily: one bar per calendar day
    if (bar === "1d") {
      const byDay = new Map<string, PriceHistoryPoint>();
      for (const p of points) {
        byDay.set(sessionKeyParis(new Date(p.date)), p);
      }
      points = [...byDay.values()].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
    } else {
      points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    return points.length >= 2 ? points : null;
  } catch {
    return null;
  }
}

function dbToBars(
  rows: Array<{ capturedAt: Date; priceEur: number }>,
  bar: PriceBarInterval,
  endPrice?: number
): PriceHistoryPoint[] {
  const step = barStepMs(bar);
  type Bucket = { at: Date; prices: number[] };
  const buckets = new Map<number, Bucket>();

  const push = (at: Date, price: number) => {
    const key = Math.floor(at.getTime() / step) * step;
    let b = buckets.get(key);
    if (!b) {
      b = { at: new Date(key), prices: [] };
      buckets.set(key, b);
    }
    b.prices.push(price);
  };

  for (const r of rows) push(r.capturedAt, r.priceEur);
  if (endPrice != null && endPrice > 0) push(new Date(), endPrice);

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const points: PriceHistoryPoint[] = [];
  let prevClose: number | undefined;

  for (let i = 0; i < keys.length; i++) {
    const b = buckets.get(keys[i]!)!;
    const prices = b.prices;
    if (!prices.length) continue;
    let ohlc: { open: number; high: number; low: number; close: number };
    if (prices.length >= 2) {
      ohlc = normalizeSessionOhlc({
        open: prices[0]!,
        close: prices[prices.length - 1]!,
        high: Math.max(...prices),
        low: Math.min(...prices),
      });
    } else {
      ohlc = sessionFromCloses(prevClose, prices[0]!, i + 1);
    }
    const p = barPoint(b.at, ohlc, bar);
    points.push(p);
    prevClose = p.close;
  }
  return points;
}

export async function getAssetPriceHistory(
  userId: string,
  assetId: string,
  range: PriceHistoryRange = "1m",
  options?: GetAssetPriceHistoryOptions
): Promise<PriceHistoryResult | null> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId },
    include: { priceQuote: true },
  });
  if (!asset) return null;

  const now = new Date();
  const bar = barIntervalForRange(range, now);
  const { from, extendedToFirstBuy } = resolveHistoryFromDate(
    range,
    options?.since,
    now
  );
  const to = now;
  const meta = {
    from: from.toISOString(),
    to: to.toISOString(),
    extendedToFirstBuy,
  };
  const endPrice = asset.priceQuote
    ? Number(asset.priceQuote.priceEur.toString())
    : asset.manualPrice
      ? Number(asset.manualPrice.toString())
      : 0;

  const native = asset.priceQuote?.nativeCurrency || asset.currency || "EUR";
  const symbol = toYahooSymbol(asset.ticker || "", asset.providerSymbol);

  // 1) Yahoo bars at the right resolution
  if (symbol) {
    const yahoo = await fetchYahooBars(symbol, from, to, bar, native);
    if (yahoo && yahoo.length >= 2) {
      if (endPrice > 0) {
        const last = yahoo[yahoo.length - 1]!;
        const lastT = new Date(last.date).getTime();
        const sameBucket =
          Math.floor(lastT / barStepMs(bar)) === Math.floor(to.getTime() / barStepMs(bar));
        if (sameBucket) {
          yahoo[yahoo.length - 1] = barPoint(
            new Date(last.date),
            normalizeSessionOhlc({
              open: last.open,
              high: Math.max(last.high, endPrice, last.open),
              low: Math.min(last.low, endPrice, last.open),
              close: endPrice,
            }),
            bar
          );
        }
      }
      return {
        assetId,
        range,
        barInterval: bar,
        currency: "EUR",
        source: "yahoo",
        points: yahoo,
        ...meta,
      };
    }
  }

  // 2) DB snapshots bucketed by bar size
  const rows = await prisma.priceHistory.findMany({
    where: { assetId, capturedAt: { gte: from } },
    orderBy: { capturedAt: "asc" },
    take: 8000,
  });

  if (rows.length >= 2) {
    const points = dbToBars(
      rows.map((r) => ({
        capturedAt: r.capturedAt,
        priceEur: Number(r.priceEur.toString()),
      })),
      bar,
      endPrice > 0 ? endPrice : undefined
    );
    if (points.length >= 2) {
      return {
        assetId,
        range,
        barInterval: bar,
        currency: "EUR",
        source: "db",
        points,
        ...meta,
      };
    }
  }

  // 3) Mock at the requested bar size
  const mockEnd = endPrice > 0 ? endPrice : 100;
  return {
    assetId,
    range,
    barInterval: bar,
    currency: "EUR",
    source: "mock",
    points: buildMockSeries(assetId, mockEnd, from, to, bar),
    ...meta,
  };
}
