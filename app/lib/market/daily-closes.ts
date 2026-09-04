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
import type { PriceHistoryRange } from "./price-history-types";

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
  const spanDays = Math.max(
    0,
    (now.getTime() - from.getTime()) / 86_400_000
  );
  // `options.from` borne déjà le fetch ; le range n'est qu'un libellé, mais
  // « all » documente une fenêtre plus longue qu'un an (premier achat).
  const range: PriceHistoryRange = spanDays > 400 ? "all" : "1y";
  const floor = new Date(now.getTime());
  floor.setUTCFullYear(floor.getUTCFullYear() - 30);
  const fromClamped = from < floor ? floor : from;

  const result = await getAssetPriceHistory(userId, assetId, range, {
    interval: "1d",
    from: fromClamped,
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

export type DailyCloseCollectionReport = {
  /** Actifs examinés. */
  assetsConsidered: number;
  /** Actifs dont le cache méritait d'être complété. */
  assetsStale: number;
  /** Actifs ayant réellement reçu au moins une clôture. */
  assetsFilled: number;
  /** Clôtures écrites ou rafraîchies. */
  closesWritten: number;
  errors: Array<{ assetId: string; message: string }>;
};

/**
 * Complète le cache de clôtures des actifs dont il a besoin.
 *
 * ## Une seule implémentation, deux appelants
 *
 * `getDailyCloses` s'en sert pour compléter ce qu'un écran vient de demander ;
 * la tâche planifiée s'en sert pour entretenir l'historique sans qu'aucun écran
 * n'ait été ouvert. Dupliquer cette boucle dans le cron aurait fait deux
 * politiques de fraîcheur, deux gestions d'erreur et, tôt ou tard, deux
 * comportements.
 *
 * ## Ce qui la rend sûre à répéter
 *
 * - `assetsNeedingFetch` écarte ce qui est déjà frais : deux passages
 *   rapprochés ne rappellent pas les fournisseurs ;
 * - `fillDailyCloses` fait un `upsert` sur `(assetId, day)` : une journée ne
 *   peut pas exister en double, quel que soit le nombre de passages ;
 * - une série `mock` est refusée en amont : un trou assumé plutôt qu'un
 *   montant faux.
 *
 * L'échec d'un actif n'interrompt jamais les suivants : un fournisseur muet
 * laisse un trou que le passage d'après comblera.
 */
export async function collectDailyCloses(opts: {
  userId: string;
  assetIds: string[];
  fromDay: DayKey;
  toDay: DayKey;
  now?: Date;
}): Promise<DailyCloseCollectionReport> {
  const now = opts.now ?? new Date();
  const unique = [...new Set(opts.assetIds)].filter(Boolean);
  const report: DailyCloseCollectionReport = {
    assetsConsidered: unique.length,
    assetsStale: 0,
    assetsFilled: 0,
    closesWritten: 0,
    errors: [],
  };
  if (unique.length === 0) return report;

  const stale = await assetsNeedingFetch(unique, opts.toDay, now);
  report.assetsStale = stale.length;
  if (stale.length === 0) return report;

  const from = new Date(`${opts.fromDay}T00:00:00Z`);
  await mapWithConcurrency(stale, FETCH_CONCURRENCY, async (assetId) => {
    try {
      const written = await fillDailyCloses(opts.userId, assetId, from, now);
      if (written > 0) {
        report.assetsFilled++;
        report.closesWritten += written;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "échec fournisseur";
      report.errors.push({ assetId, message });
      console.error(`[daily-closes] remplissage impossible pour ${assetId}:`, err);
    }
  });

  return report;
}

/**
 * Lit les clôtures quotidiennes d'un ensemble d'actifs sur une plage.
 *
 * ## La collecte se demande, elle ne s'obtient pas par omission
 *
 * La condition était `opts?.refresh !== false` : ne rien passer suffisait donc
 * à déclencher des appels fournisseurs et des écritures dans `AssetDailyClose`.
 * Les trois appelants de lecture passaient bien `refresh: false` et étaient
 * corrects, mais le défaut était structurel — le comportement dangereux était
 * celui qu'on obtenait sans rien écrire, et aucun test n'aurait signalé un
 * futur appelant l'oubliant.
 *
 * `refresh: true` est désormais la seule façon de collecter. Une lecture reste
 * une lecture, y compris quand on l'écrit vite.
 *
 * Rien d'autre ne change : ni les règles de fraîcheur, ni la politique de
 * remplissage, ni le comportement de `refresh: true`, qui appelle le même
 * `collectDailyCloses` qu'auparavant. La tâche planifiée, elle, ne passe pas
 * par ici : elle appelle `collectDailyClosesForAssets` directement.
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

  if (opts?.refresh === true && unique.length > 0) {
    await collectDailyCloses({ userId, assetIds: unique, fromDay, toDay, now });
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
