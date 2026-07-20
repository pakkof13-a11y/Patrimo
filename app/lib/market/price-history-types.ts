export const PRICE_HISTORY_RANGES = [
  "7d",
  "1m",
  "3m",
  "ytd",
  "1y",
  "5y",
  "all",
] as const;
export type PriceHistoryRange = (typeof PRICE_HISTORY_RANGES)[number];

/** Yahoo / mock bar size for the selected range */
export type PriceBarInterval = "15m" | "1h" | "4h" | "1d" | "1wk";

/**
 * One bar = one period (session day, or intraday slot, or week).
 * open/high/low/close of that bar; price = close (line chart).
 */
export type PriceHistoryPoint = {
  date: string;
  label: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type PriceHistoryResult = {
  assetId: string;
  range: PriceHistoryRange;
  /** Resolution of each bar (15m, 1h, 4h, 1d, 1wk) */
  barInterval: PriceBarInterval;
  currency: string;
  source: "db" | "yahoo" | "coingecko" | "mock";
  points: PriceHistoryPoint[];
  /**
   * Bornes de fetch réelles (ISO).
   * `from` peut être antérieur au range UI si `since` (1er achat) a étendu la fenêtre.
   */
  from?: string;
  to?: string;
  /** true si la fenêtre a été étendue jusqu'au 1er achat (perf). */
  extendedToFirstBuy?: boolean;
};

export type ChartStyle = "line" | "candle";

export function parseHistoryRange(raw: string | null): PriceHistoryRange {
  const v = (raw || "1m").toLowerCase();
  if ((PRICE_HISTORY_RANGES as readonly string[]).includes(v)) {
    return v as PriceHistoryRange;
  }
  return "1m";
}

/**
 * Bar interval rules (spec produit) :
 * - 7d  → 4h
 * - 1m, 3m, ytd, 1y → 1d (quotidien)
 * - 5y, all → 1wk (agrégé ; « mensuel » via 1wk dense + label)
 */
export function barIntervalForRange(range: PriceHistoryRange, now = new Date()): PriceBarInterval {
  if (range === "7d") return "4h";
  if (range === "1m" || range === "3m" || range === "1y") return "1d";
  if (range === "5y" || range === "all") return "1wk";
  // YTD : quotidien dès que > 7j
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = Math.max(
    1,
    (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (days <= 7) return "4h";
  return "1d";
}

export function barIntervalLabel(iv: PriceBarInterval): string {
  switch (iv) {
    case "15m":
      return "15 min";
    case "1h":
      return "1 h";
    case "4h":
      return "4 h";
    case "1d":
      return "1 jour";
    case "1wk":
      return "1 semaine";
  }
}

/** Enforce OHLC invariants for a single bar. */
export function normalizeSessionOhlc(p: {
  open: number;
  high: number;
  low: number;
  close: number;
}): { open: number; high: number; low: number; close: number } {
  const open = Number(p.open);
  const close = Number(p.close);
  let high = Number(p.high);
  let low = Number(p.low);
  if (![open, close, high, low].every((n) => Number.isFinite(n) && n > 0)) {
    const c = Number.isFinite(close) && close > 0 ? close : 1;
    return { open: c, high: c, low: c, close: c };
  }
  high = Math.max(high, open, close);
  low = Math.min(low, open, close);
  if (high < low) {
    const t = high;
    high = low;
    low = t;
  }
  return { open, high, low, close };
}
