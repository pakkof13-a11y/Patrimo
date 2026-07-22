/**
 * Calendrier macro live — source publique type « economic calendar »
 * (JSON Forex Factory / faireconomy, même genre qu’Investing.com).
 *
 * Investing.com n’a pas d’API officielle gratuite ; Finnhub economic calendar
 * est payant (403 sur free). On utilise donc ce flux JSON public + fallback mock.
 */

import type { MacroEvent, MacroImpact } from "@/app/lib/news/service";
import { getMacroCalendarToday } from "@/app/lib/news/service";

type FfEvent = {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
};

/** Devise calendrier FF → code pays UI + ISO drapeau */
const CCY_TO_COUNTRY: Record<
  string,
  { country: string; countryCode: string }
> = {
  USD: { country: "US", countryCode: "us" },
  EUR: { country: "EZ", countryCode: "eu" },
  GBP: { country: "UK", countryCode: "gb" },
  JPY: { country: "JP", countryCode: "jp" },
  AUD: { country: "AU", countryCode: "au" },
  CAD: { country: "CA", countryCode: "ca" },
  CHF: { country: "CH", countryCode: "ch" },
  CNY: { country: "CN", countryCode: "cn" },
  NZD: { country: "NZ", countryCode: "nz" },
  // parfois codes pays directs
  US: { country: "US", countryCode: "us" },
  UK: { country: "UK", countryCode: "gb" },
  GB: { country: "UK", countryCode: "gb" },
  DE: { country: "DE", countryCode: "de" },
  FR: { country: "FR", countryCode: "fr" },
  EZ: { country: "EZ", countryCode: "eu" },
  EU: { country: "EZ", countryCode: "eu" },
};

function mapImpact(raw: string | undefined): MacroImpact | "holiday" {
  const i = (raw || "").toLowerCase();
  if (i === "high") return "high";
  if (i === "medium" || i === "med") return "medium";
  if (i === "holiday") return "holiday";
  return "low";
}

/** Jour civil Europe/Paris (YYYY-MM-DD) — pas le fuseau serveur (souvent UTC). */
function parisDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Même jour civil parisien (l'événement « du jour » pour un utilisateur FR). */
function sameLocalDay(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return parisDay(new Date(t)) === parisDay(now);
}

function emptyToNull(s: string | undefined): string | null {
  const t = (s || "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Convertit une ligne calendrier FF → MacroEvent (ou null si holiday / invalide).
 */
export function ffRowToMacro(row: FfEvent, idx: number): MacroEvent | null {
  const title = (row.title || "").trim();
  if (!title) return null;
  const impact = mapImpact(row.impact);
  if (impact === "holiday") return null;

  const ccy = (row.country || "").trim().toUpperCase();
  const mapped = CCY_TO_COUNTRY[ccy] || {
    country: ccy.slice(0, 2) || "??",
    countryCode: ccy.slice(0, 2).toLowerCase() || "un",
  };

  const time = row.date ? new Date(row.date).toISOString() : "";
  if (!time || Number.isNaN(Date.parse(time))) return null;

  return {
    id: `ff-${idx}-${time}-${title.slice(0, 24)}`,
    time,
    country: mapped.country,
    countryCode: mapped.countryCode,
    title,
    impact,
    actual: emptyToNull(row.actual),
    forecast: emptyToNull(row.forecast),
    previous: emptyToNull(row.previous),
  };
}

export type MacroLiveResult = {
  events: MacroEvent[];
  source: "forexfactory" | "mock";
  date: string;
};

/** Cache process : évite de marteler faireconomy (429 fréquent en e2e / multi-onglets). */
const CACHE_TTL_MS = 30 * 60_000; // 30 min
/** Après un 429, ne plus retenter le réseau pendant ce délai. */
const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;

type CacheEntry = {
  result: MacroLiveResult;
  expiresAt: number;
};

let cache: CacheEntry | null = null;
let rateLimitedUntil = 0;
let lastHttpWarnAt = 0;

function mockResult(date: string): MacroLiveResult {
  return {
    events: getMacroCalendarToday(),
    source: "mock",
    date,
  };
}

function isE2eOrDisabled(): boolean {
  return (
    process.env.E2E === "1" ||
    process.env.PLAYWRIGHT === "1" ||
    process.env.MACRO_LIVE_DISABLED === "1" ||
    process.env.CI === "true"
  );
}

/**
 * Calendrier macro du jour (événements du jour civil local).
 * - Cache mémoire 30 min
 * - Sur HTTP 429 : cooldown 15 min + mock (log throttlé)
 * - E2E / CI / MACRO_LIVE_DISABLED : mock direct (pas d’appel externe)
 */
export async function resolveMacroCalendarToday(): Promise<MacroLiveResult> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const nowMs = Date.now();

  // E2E / CI : ne jamais appeler l’API publique (rate-limit strict)
  if (isE2eOrDisabled()) {
    return mockResult(date);
  }

  // Cache hit (même jour civil UTC key)
  if (
    cache &&
    cache.expiresAt > nowMs &&
    cache.result.date === date
  ) {
    return cache.result;
  }

  // Encore en cooldown 429
  if (rateLimitedUntil > nowMs) {
    if (cache?.result) return cache.result;
    return mockResult(date);
  }

  try {
    const res = await fetch(
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      {
        // Next peut revalider ; on garde aussi le cache process ci-dessus
        next: { revalidate: 1800 },
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "application/json",
          "User-Agent": "Patrimo/1.0 (portfolio; macro calendar)",
        },
      }
    );
    if (!res.ok) {
      if (res.status === 429) {
        rateLimitedUntil = nowMs + RATE_LIMIT_COOLDOWN_MS;
      }
      // Log max 1× / 5 min pour ne pas polluer la console e2e / dev
      if (nowMs - lastHttpWarnAt > 5 * 60_000) {
        lastHttpWarnAt = nowMs;
        console.warn(
          "[macro-live] HTTP",
          res.status,
          res.status === 429 ? "(cooldown 15 min → mock/cache)" : ""
        );
      }
      if (cache?.result) return cache.result;
      return mockResult(date);
    }

    const rows = (await res.json()) as FfEvent[];
    if (!Array.isArray(rows) || rows.length === 0) {
      const r = mockResult(date);
      cache = { result: r, expiresAt: nowMs + CACHE_TTL_MS };
      return r;
    }

    const events = rows
      .map((r, i) => ffRowToMacro(r, i))
      .filter((e): e is MacroEvent => e != null)
      .filter((e) => sameLocalDay(e.time, now))
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

    if (events.length === 0) {
      // Week-end / jour sans event : mock du jour pour ne pas vider l’UI
      const r = mockResult(date);
      cache = { result: r, expiresAt: nowMs + CACHE_TTL_MS };
      return r;
    }

    const result: MacroLiveResult = {
      events,
      source: "forexfactory",
      date,
    };
    cache = { result, expiresAt: nowMs + CACHE_TTL_MS };
    rateLimitedUntil = 0;
    return result;
  } catch (e) {
    if (nowMs - lastHttpWarnAt > 5 * 60_000) {
      lastHttpWarnAt = nowMs;
      console.warn("[macro-live]", e instanceof Error ? e.message : e);
    }
    if (cache?.result) return cache.result;
    return mockResult(date);
  }
}

/** Tests / hot-reload */
export function __resetMacroLiveCache(): void {
  cache = null;
  rateLimitedUntil = 0;
  lastHttpWarnAt = 0;
}
