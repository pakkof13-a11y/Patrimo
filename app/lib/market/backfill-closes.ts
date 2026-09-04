/**
 * T-04 — remonte les clôtures quotidiennes jusqu'à la première transaction
 * de chaque ticker.
 *
 * `collectDailyClosesForAssets` n'entretient qu'une fenêtre d'un an. Sans
 * historique plus ancien, le moteur retient les positions à leur coût : la
 * courbe Financier n'a alors que des marches aux achats, puis un saut le jour
 * du cours live. Ce module comble `AssetDailyClose` depuis le premier
 * mouvement du journal, avec les mêmes fournisseurs que `fillDailyCloses`
 * (Yahoo / CoinGecko ; Finnhub et Binance restent du cours courant).
 *
 * Lecture inchangée : afficher un écran ne collecte toujours rien. Le cron
 * (et le POST utilisateur du même endpoint) appelle ceci explicitement.
 */

import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import {
  fillDailyCloses,
  type DailyCloseCollectionReport,
} from "./daily-closes";
import {
  DAILY_LOOKBACK_DAYS,
  listCollectableAssets,
} from "./intraday-collector";

/** Un actif sans transaction retombe sur la fenêtre d'entretien (un an). */
const FALLBACK_LOOKBACK_DAYS = DAILY_LOOKBACK_DAYS;

/**
 * Jours civils de grâce après le premier achat.
 *
 * Les clôtures Yahoo sautent week-ends et fériés : exiger une barre le jour
 * même du premier achat (un dimanche) relancerait le fetch à chaque passage.
 */
export const FIRST_CLOSE_GRACE_DAYS = 10;

const FETCH_CONCURRENCY = 4;

export type BackfillDailyClosesReport = DailyCloseCollectionReport & {
  day: string;
  /** Actifs dont le premier achat est antérieur à la fenêtre d'un an. */
  assetsFromFirstTx: number;
};

function addCalendarDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y!, m! - 1, d!, 12, 0, 0) + n * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** Premier jour de transaction, par actif. */
export async function firstTransactionDayByAsset(
  assetIds: string[],
  userId?: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (assetIds.length === 0) return out;

  const rows = await prisma.transaction.groupBy({
    by: ["assetId"],
    where: {
      assetId: { in: assetIds },
      ...(userId ? { userId } : {}),
    },
    _min: { occurredAt: true },
  });

  for (const row of rows) {
    if (!row.assetId || !row._min.occurredAt) continue;
    const day = parisDayKey(row._min.occurredAt);
    if (day) out.set(row.assetId, day);
  }
  return out;
}

/**
 * Un actif mérite un fetch s'il n'a pas de clôture près du premier achat,
 * ou si la fin de fenêtre n'est plus à jour (même règle que l'entretien).
 */
export function needsHistoryBackfill(opts: {
  firstTxDay: string | undefined;
  fallbackFromDay: string;
  toDay: string;
  minDay: string | null;
  maxDay: string | null;
  fetchedAt: Date | null;
  now: Date;
  freshnessMs?: number;
}): boolean {
  const fromDay = opts.firstTxDay ?? opts.fallbackFromDay;
  const freshAfter = opts.freshnessMs ?? 6 * 60 * 60 * 1000;

  if (!opts.minDay || !opts.maxDay) return true;

  const latestAcceptableStart = addCalendarDays(fromDay, FIRST_CLOSE_GRACE_DAYS);
  if (opts.minDay > latestAcceptableStart) return true;

  if (opts.maxDay >= opts.toDay) return false;
  const fetchedAt = opts.fetchedAt?.getTime() ?? 0;
  return opts.now.getTime() - fetchedAt > freshAfter;
}

export async function assetsNeedingHistoryBackfill(
  assetIds: string[],
  firstTxByAsset: Map<string, string>,
  fallbackFromDay: string,
  toDay: string,
  now: Date
): Promise<string[]> {
  if (assetIds.length === 0) return [];

  const coverage = await prisma.assetDailyClose.groupBy({
    by: ["assetId"],
    where: { assetId: { in: assetIds } },
    _min: { day: true },
    _max: { day: true, fetchedAt: true },
  });
  const byAsset = new Map(coverage.map((r) => [r.assetId, r]));

  const stale: string[] = [];
  for (const assetId of assetIds) {
    const seen = byAsset.get(assetId);
    if (
      needsHistoryBackfill({
        firstTxDay: firstTxByAsset.get(assetId),
        fallbackFromDay,
        toDay,
        minDay: seen?._min.day ?? null,
        maxDay: seen?._max.day ?? null,
        fetchedAt: seen?._max.fetchedAt ?? null,
        now,
      })
    ) {
      stale.push(assetId);
    }
  }
  return stale;
}

function fromDateForAsset(
  firstTxDay: string | undefined,
  fallbackFromDay: string,
  now: Date
): Date {
  const day = firstTxDay ?? fallbackFromDay;
  const floor = new Date(now.getTime());
  floor.setUTCFullYear(floor.getUTCFullYear() - 30);
  const from = new Date(`${day}T00:00:00Z`);
  return from < floor ? floor : from;
}

/**
 * Remplit `AssetDailyClose` depuis le premier achat de chaque ticker.
 *
 * Best effort : un fournisseur muet laisse un trou, jamais une série mock.
 * Idempotent : couverture déjà complète + fraîche → aucun appel réseau.
 */
export async function backfillDailyClosesFromFirstTx(opts?: {
  userId?: string;
  now?: Date;
}): Promise<BackfillDailyClosesReport> {
  const now = opts?.now ?? new Date();
  const toDay = parisDayKey(now);
  const fallbackFromDay = parisDayKey(
    new Date(now.getTime() - FALLBACK_LOOKBACK_DAYS * 86_400_000)
  );

  const assets = await listCollectableAssets(opts?.userId);
  const report: BackfillDailyClosesReport = {
    assetsConsidered: 0,
    assetsStale: 0,
    assetsFilled: 0,
    closesWritten: 0,
    errors: [],
    day: toDay,
    assetsFromFirstTx: 0,
  };

  const byUser = new Map<string, string[]>();
  for (const a of assets) {
    const list = byUser.get(a.userId);
    if (list) list.push(a.id);
    else byUser.set(a.userId, [a.id]);
  }

  for (const [userId, assetIds] of byUser) {
    const unique = [...new Set(assetIds)].filter(Boolean);
    report.assetsConsidered += unique.length;
    if (unique.length === 0) continue;

    const firstTx = await firstTransactionDayByAsset(unique, userId);
    report.assetsFromFirstTx += firstTx.size;

    const stale = await assetsNeedingHistoryBackfill(
      unique,
      firstTx,
      fallbackFromDay,
      toDay,
      now
    );
    report.assetsStale += stale.length;
    if (stale.length === 0) continue;

    await mapWithConcurrency(stale, FETCH_CONCURRENCY, async (assetId) => {
      try {
        const from = fromDateForAsset(firstTx.get(assetId), fallbackFromDay, now);
        const written = await fillDailyCloses(userId, assetId, from, now);
        if (written > 0) {
          report.assetsFilled++;
          report.closesWritten += written;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "échec fournisseur";
        report.errors.push({ assetId, message });
        console.error(`[backfill-closes] remplissage impossible pour ${assetId}:`, err);
      }
    });
  }

  return report;
}
