/**
 * Cache de clôtures journalières par actif (table `AssetDailyClose`).
 *
 * `PriceHistory` ne convient pas pour valoriser l'historique au marché : elle
 * n'enregistre qu'une capture spot à chaque rafraîchissement de cours, donc
 * une série creuse, irrégulière, et vide tant que l'utilisateur n'a jamais
 * lancé de refresh. On construit ici une série **régulière**, un point par jour
 * civil, alimentée depuis les mêmes fournisseurs que les graphiques de cours.
 *
 * C'est un cache et rien d'autre : le vider ne perd aucune donnée utilisateur,
 * les transactions restent la source de vérité. Il est donc écrit en
 * « best effort » — un fournisseur muet laisse simplement un trou, que le
 * calcul de P&L comble par report du dernier cours connu.
 */

import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import { toFixed } from "../money/decimal";
import type { DailyCloseIndex, DayKey } from "../portfolio/class-history";
import { getAssetPriceHistory } from "./price-history";

/**
 * Fraîcheur exigée du cache pour le jour courant. En deçà, on ne redemande
 * rien au fournisseur : un dashboard rechargé trois fois de suite ne doit pas
 * déclencher trois séries d'appels réseau par actif.
 */
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

/** Nombre d'actifs interrogés en parallèle lors d'un remplissage. */
const FETCH_CONCURRENCY = 4;

export type DailyCloseCoverage = {
  /** Actifs pour lesquels au moins une clôture est connue. */
  covered: string[];
  /** Actifs sans aucune clôture, malgré une tentative de remplissage. */
  missing: string[];
};

/** Lecture seule du cache, sans aucun appel réseau. */
export async function readDailyCloses(
  assetIds: string[],
  fromDay: DayKey,
  toDay: DayKey
): Promise<DailyCloseIndex> {
  const index: DailyCloseIndex = new Map();
  if (assetIds.length === 0) return index;

  const rows = await prisma.assetDailyClose.findMany({
    where: {
      assetId: { in: assetIds },
      day: { gte: fromDay, lte: toDay },
    },
    select: { assetId: true, day: true, closeEur: true },
    orderBy: { day: "asc" },
  });

  for (const row of rows) {
    let series = index.get(row.assetId);
    if (!series) {
      series = new Map();
      index.set(row.assetId, series);
    }
    const close = Number(row.closeEur.toString());
    if (Number.isFinite(close) && close > 0) series.set(row.day, close);
  }
  return index;
}

/**
 * Décide quels actifs méritent un appel fournisseur.
 *
 * Un actif est rafraîchi s'il n'a aucune clôture dans la fenêtre, ou si sa
 * dernière clôture connue est plus ancienne que la fin de fenêtre demandée et
 * que le cache n'a pas été touché récemment. On évite ainsi de retélécharger
 * un historique complet à chaque affichage tout en gardant le jour courant à jour.
 */
export async function assetsNeedingFetch(
  assetIds: string[],
  toDay: DayKey,
  now = new Date()
): Promise<string[]> {
  if (assetIds.length === 0) return [];

  const latest = await prisma.assetDailyClose.groupBy({
    by: ["assetId"],
    where: { assetId: { in: assetIds } },
    _max: { day: true, fetchedAt: true },
  });

  const byAsset = new Map(latest.map((r) => [r.assetId, r._max]));
  const stale: string[] = [];
  for (const assetId of assetIds) {
    const seen = byAsset.get(assetId);
    if (!seen?.day) {
      stale.push(assetId);
      continue;
    }
    if (seen.day >= toDay) continue;
    const fetchedAt = seen.fetchedAt?.getTime() ?? 0;
    if (now.getTime() - fetchedAt > REFRESH_AFTER_MS) stale.push(assetId);
  }
  return stale;
}

/**
 * Remplit le cache d'un actif depuis les fournisseurs de cours.
 * Rend le nombre de clôtures écrites (0 si le fournisseur n'a rien donné).
 *
 * Les séries `mock` sont explicitement rejetées : elles servent à ne pas
 * laisser un graphique vide à l'écran, mais les injecter ici produirait un
 * P&L inventé, présenté comme un chiffre réel dans un tableau de bord
 * patrimonial. Un trou assumé vaut mieux qu'un montant faux.
 */
export async function fillDailyCloses(
  userId: string,
  assetId: string,
  from: Date,
  now = new Date()
): Promise<number> {
  const result = await getAssetPriceHistory(userId, assetId, "1y", {
    interval: "1d",
    from,
  });
  if (!result || result.source === "mock" || result.points.length === 0) {
    return 0;
  }

  const byDay = new Map<DayKey, number>();
  for (const point of result.points) {
    const day = parisDayKey(point.date);
    if (!day || day > parisDayKey(now)) continue;
    if (!Number.isFinite(point.close) || point.close <= 0) continue;
    // Plusieurs barres sur un même jour civil : la dernière fait la clôture.
    byDay.set(day, point.close);
  }
  if (byDay.size === 0) return 0;

  const source = result.source;
  await prisma.$transaction(
    [...byDay].map(([day, close]) =>
      prisma.assetDailyClose.upsert({
        where: { assetId_day: { assetId, day } },
        create: {
          assetId,
          day,
          closeEur: toFixed(close, 12),
          source,
        },
        update: {
          closeEur: toFixed(close, 12),
          source,
          fetchedAt: now,
        },
      })
    )
  );
  return byDay.size;
}

/** Exécute `worker` sur `items` avec une concurrence bornée. */
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

/**
 * Point d'entrée : rend les clôtures journalières des actifs demandés sur la
 * fenêtre, en complétant le cache au passage.
 *
 * Le remplissage est best effort et ne remonte jamais d'erreur : le P&L par
 * classe est un enrichissement de l'affichage, pas une donnée comptable. Un
 * fournisseur indisponible doit dégrader le graphique, jamais casser le
 * dashboard.
 */
export async function getDailyCloses(
  userId: string,
  assetIds: string[],
  fromDay: DayKey,
  toDay: DayKey,
  opts?: { refresh?: boolean; now?: Date }
): Promise<{ closes: DailyCloseIndex; coverage: DailyCloseCoverage }> {
  const now = opts?.now ?? new Date();
  const unique = [...new Set(assetIds)].filter(Boolean);

  if (opts?.refresh !== false && unique.length > 0) {
    const stale = await assetsNeedingFetch(unique, toDay, now);
    if (stale.length > 0) {
      const from = new Date(`${fromDay}T00:00:00Z`);
      await mapWithConcurrency(stale, FETCH_CONCURRENCY, async (assetId) => {
        try {
          await fillDailyCloses(userId, assetId, from, now);
        } catch (err) {
          console.error(
            `[daily-closes] remplissage impossible pour ${assetId}:`,
            err
          );
        }
      });
    }
  }

  const closes = await readDailyCloses(unique, fromDay, toDay);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const assetId of unique) {
    if ((closes.get(assetId)?.size ?? 0) > 0) covered.push(assetId);
    else missing.push(assetId);
  }

  return { closes, coverage: { covered, missing } };
}
