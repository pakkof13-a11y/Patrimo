/**
 * Dernière clôture lue par getDailyNav — une seule règle pour hero, KPI
 * et watchlist.
 *
 * `loadHistoricalInputs` inscrit le cours du jour (`PriceQuote` / prix
 * manuel) sur le jour civil Paris courant. Sans ce complément, la courbe
 * retombait au coût alors que la watchlist lisait le cours live : deux
 * dates, un écart lu comme une perte. Hero, sparks KPI et watchlist
 * doivent donc résoudre **la même** date de dernière clôture.
 *
 * `fetchedAt` est l'horodatage de collecte (AssetDailyClose ou
 * PriceQuote.lastUpdatedAt). Le front s'en sert pour un badge « cours
 * daté » si la collecte a plus de 24 h (Vague2 D11). Ce module n'affiche
 * rien : il expose la donnée.
 */

import { prisma } from "../prisma";
import { parisDayKey, parisDayStart } from "../dates/paris";
import type { DayKey } from "../portfolio/historical/types";

/** Une collecte plus vieille que cela autorise le badge « cours daté ». */
export const CLOSE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type LastDailyClose = {
  day: DayKey;
  closeEur: number;
  fetchedAt: Date;
};

export type LastCloseQuote = {
  priceEur: number;
  lastUpdatedAt: Date | null;
};

export type LastCloseAsOf = {
  /** Jour civil Paris de la clôture retenue — même jour que le dernier point NAV si overlay. */
  day: DayKey;
  closeEur: number;
  /** ISO 8601, ou `null` si rien n'a jamais été collecté (prix manuel). */
  fetchedAt: string | null;
  source: "quote" | "daily-close";
};

/**
 * Même règle que `loadHistoricalInputs` : un cours live (ou manuel) se
 * pose sur **aujourd'hui** ; sinon la dernière `AssetDailyClose`.
 */
export function resolveLastCloseAsOf(opts: {
  today: DayKey;
  lastDaily?: LastDailyClose | null;
  quote?: LastCloseQuote | null;
}): LastCloseAsOf | null {
  const quoteEur = opts.quote?.priceEur;
  if (
    opts.quote &&
    typeof quoteEur === "number" &&
    Number.isFinite(quoteEur) &&
    quoteEur > 0
  ) {
    return {
      day: opts.today,
      closeEur: quoteEur,
      fetchedAt: opts.quote.lastUpdatedAt
        ? opts.quote.lastUpdatedAt.toISOString()
        : null,
      source: "quote",
    };
  }

  const daily = opts.lastDaily;
  if (
    daily &&
    typeof daily.closeEur === "number" &&
    Number.isFinite(daily.closeEur) &&
    daily.closeEur > 0
  ) {
    return {
      day: daily.day,
      closeEur: daily.closeEur,
      fetchedAt: daily.fetchedAt.toISOString(),
      source: "daily-close",
    };
  }

  return null;
}

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const PARIS_WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Paris",
  weekday: "short",
});

function parisWeekday(day: DayKey): number {
  return WEEKDAY_SHORT[PARIS_WEEKDAY.format(parisDayStart(day))] ?? 0;
}

export function isParisWeekend(day: DayKey): boolean {
  const wd = parisWeekday(day);
  return wd === 0 || wd === 6;
}

function nextParisDay(day: DayKey): DayKey {
  return parisDayKey(new Date(parisDayStart(day).getTime() + 36 * 3600_000));
}

/**
 * Séances de bourse (lun–ven Paris) entre deux jours civils.
 *
 * Vendredi → samedi = 0 (le week-end n'est pas une séance).
 * Vendredi → lundi = 1. Même jour = 0.
 */
export function sessionGap(a: DayKey, b: DayKey): number {
  if (!a || !b || a === b) return 0;
  const [from, to] = a < b ? [a, b] : [b, a];
  let gap = 0;
  let cursor = from;
  while (cursor < to) {
    cursor = nextParisDay(cursor);
    if (!isParisWeekend(cursor)) gap++;
  }
  return gap;
}

/** DoD D4 : watchlist et dernier point de courbe, même ticker, ≤ 1 séance. */
export function lastCloseAligned(
  watchlistDay: DayKey | null | undefined,
  navLastDay: DayKey | null | undefined
): boolean {
  if (!watchlistDay || !navLastDay) return false;
  return sessionGap(watchlistDay, navLastDay) <= 1;
}

export function isCloseFetchStale(
  fetchedAt: string | null | undefined,
  now = new Date()
): boolean {
  if (!fetchedAt) return false;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t > CLOSE_STALE_AFTER_MS;
}

/** Plus ancienne collecte parmi les dernières clôtures — fraîcheur du point. */
export function oldestFetchedAt(
  asOf: Iterable<LastCloseAsOf> | undefined
): string | null {
  if (!asOf) return null;
  let oldest: string | null = null;
  for (const item of asOf) {
    if (!item.fetchedAt) continue;
    if (oldest == null || item.fetchedAt < oldest) oldest = item.fetchedAt;
  }
  return oldest;
}

/**
 * Dernière ligne `AssetDailyClose` par actif — lecture seule, aucun réseau.
 */
export async function readLastClosesAsOf(
  assetIds: string[]
): Promise<Map<string, LastDailyClose>> {
  const out = new Map<string, LastDailyClose>();
  const unique = [...new Set(assetIds)].filter(Boolean);
  if (unique.length === 0) return out;

  const latest = await prisma.assetDailyClose.groupBy({
    by: ["assetId"],
    where: { assetId: { in: unique } },
    _max: { day: true },
  });
  const pairs = latest.flatMap((r) =>
    r._max.day ? [{ assetId: r.assetId, day: r._max.day }] : []
  );
  if (pairs.length === 0) return out;

  const rows = await prisma.assetDailyClose.findMany({
    where: { OR: pairs },
    select: { assetId: true, day: true, closeEur: true, fetchedAt: true },
  });

  for (const row of rows) {
    const close = Number(row.closeEur.toString());
    if (!Number.isFinite(close) || close <= 0) continue;
    out.set(row.assetId, {
      day: row.day,
      closeEur: close,
      fetchedAt: row.fetchedAt,
    });
  }
  return out;
}
