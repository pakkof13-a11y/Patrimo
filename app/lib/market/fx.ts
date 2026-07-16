import { d, toFixed, type DecimalInput } from "../money/decimal";

type CacheEntry = { rates: Record<string, number>; fetchedAt: number };

let cache: CacheEntry | null = null;
let inflight: Promise<Record<string, number>> | null = null;
const TTL_MS = 60 * 60 * 1000;
const FALLBACK: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  CHF: 0.96,
  GBP: 0.85,
  JPY: 160,
};

/**
 * Rates as 1 EUR = X foreign.
 * Never hangs the UI: short timeout + shared inflight + fallback.
 */
export async function getEurRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.rates;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch("https://api.frankfurter.app/latest?from=EUR", {
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rates = { EUR: 1, ...FALLBACK, ...(data.rates ?? {}) };
      cache = { rates, fetchedAt: Date.now() };
      return rates;
    } catch {
      const rates = { ...FALLBACK };
      cache = { rates, fetchedAt: Date.now() };
      return rates;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function convertFromEurSync(
  amountEur: DecimalInput,
  to: string,
  rates: Record<string, number>
): string {
  const cur = to.toUpperCase();
  if (cur === "EUR") return toFixed(d(amountEur), 12);
  const rate = rates[cur] ?? FALLBACK[cur] ?? 1;
  return toFixed(d(amountEur).times(rate), 12);
}

export function convertToEurSync(
  amount: DecimalInput,
  from: string,
  rates: Record<string, number>
): string {
  const cur = from.toUpperCase();
  if (cur === "EUR") return toFixed(d(amount), 12);
  const rate = rates[cur] ?? FALLBACK[cur] ?? 1;
  if (!rate) return toFixed(d(amount), 12);
  return toFixed(d(amount).div(rate), 12);
}

export async function toEurAmount(amount: DecimalInput, from: string): Promise<string> {
  const rates = await getEurRates();
  return convertToEurSync(amount, from, rates);
}

export async function fromEurAmount(amountEur: DecimalInput, to: string): Promise<string> {
  const rates = await getEurRates();
  return convertFromEurSync(amountEur, to, rates);
}

export async function fxRateToEur(from: string): Promise<string> {
  const cur = from.toUpperCase();
  if (cur === "EUR") return "1";
  const rates = await getEurRates();
  const rate = rates[cur] ?? FALLBACK[cur] ?? 1;
  if (!rate) return "1";
  return toFixed(d(1).div(rate), 10);
}

/**
 * Taux historique : 1 unité `from` → EUR, pour une date donnée (YYYY-MM-DD).
 * Source Frankfurter (BCE) ; fallback live puis table.
 */
export async function fxRateToEurOnDate(
  from: string,
  date: Date | string
): Promise<string> {
  const cur = from.toUpperCase();
  if (cur === "EUR") return "1";

  const day =
    typeof date === "string"
      ? date.slice(0, 10)
      : date.toISOString().slice(0, 10);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    // Frankfurter: 1 EUR = X foreign
    const res = await fetch(
      `https://api.frankfurter.app/${day}?from=EUR&to=${encodeURIComponent(cur)}`,
      { cache: "no-store", signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.[cur];
      if (rate && rate > 0) {
        return toFixed(d(1).div(rate), 10);
      }
    }
  } catch {
    // fall through
  }
  return fxRateToEur(cur);
}

export async function convertAmount(
  amount: DecimalInput,
  from: string,
  to: string
): Promise<string> {
  if (from.toUpperCase() === to.toUpperCase()) return toFixed(d(amount), 12);
  const rates = await getEurRates();
  const eur = convertToEurSync(amount, from, rates);
  return convertFromEurSync(eur, to, rates);
}
