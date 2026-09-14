/**
 * Collecte des barres intra-séance.
 *
 * ## Ce que ce service résout
 *
 * L'audit Performance a établi qu'aucune donnée intra-journalière n'existait :
 * `AssetDailyClose` est quotidienne par contrainte d'unicité, `PortfolioSnapshot`
 * est un upsert quotidien qui détruit sa valeur précédente, et `PriceHistory`
 * était vide faute de collecteur — elle n'est alimentée qu'au clic d'un
 * utilisateur sur « rafraîchir ».
 *
 * La capacité de *récupération*, elle, existait déjà : `getAssetPriceHistory`
 * sait demander des barres 15m / 1h / 4h, et l'écran d'un actif s'en sert. Ce
 * service ne réinvente donc pas la récupération : il l'appelle, et **persiste**
 * ce qu'elle rapporte de réel.
 *
 * ## La règle qui gouverne tout le fichier
 *
 * Seules des observations réellement produites par un fournisseur entrent en
 * base. Trois portes sont fermées :
 *
 * - `source: "mock"` — série fabriquée pour ne pas laisser un graphique vide.
 *   `fillDailyCloses` la rejette déjà pour les clôtures ; la même règle vaut
 *   ici, et pour la même raison : « un trou assumé vaut mieux qu'un montant
 *   faux ».
 * - `source: "db"` — reconstruction de `getAssetPriceHistory` à partir de
 *   `PriceHistory`. La persister serait circulaire : on réécrirait nos propres
 *   captures en les présentant comme des observations de fournisseur.
 * - la barre en cours — voir `isBarComplete`.
 *
 * Aucun report, aucune interpolation : un trou reste un trou. C'est au lecteur
 * de décider s'il reporte la dernière valeur connue, et de l'annoncer alors
 * comme estimée. Écrire un point reporté ici le rendrait indiscernable d'une
 * observation quelques semaines plus tard.
 */

import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import { getAssetPriceHistory } from "./price-history";
import {
  collectDailyCloses,
  type DailyCloseCollectionReport,
} from "./daily-closes";
import type {
  PriceBarInterval,
  PriceHistoryResult,
} from "./price-history-types";
import { Prisma } from "../prisma-client/client";

/**
 * Granularités que cette table a le droit de porter.
 *
 * `1d` et `1wk` en sont exclus : la clôture quotidienne a déjà sa table, et
 * l'accepter ici créerait deux réponses possibles à « que valait cet actif ce
 * jour-là ». `parseBarInterval` admet les cinq intervalles parce qu'ils sont
 * tous sélectionnables sur le graphique d'un actif ; la collecte est plus
 * étroite que l'affichage.
 */
export const INTRADAY_INTERVALS = ["15m", "1h", "4h"] as const;
export type IntradayInterval = (typeof INTRADAY_INTERVALS)[number];

export function isIntradayInterval(i: PriceBarInterval): i is IntradayInterval {
  return (INTRADAY_INTERVALS as readonly string[]).includes(i);
}

/**
 * Granularité par défaut de la collecte : l'heure.
 *
 * `4h` ne donnerait que deux points par séance actions — trop grossier pour
 * montrer un creux de milieu de journée, qui est l'objet même du chantier.
 * `15m` quadruplerait le stockage pour une fenêtre fournisseur de deux jours
 * seulement, trop courte pour rattraper une panne. L'heure tient dans une
 * fenêtre de dix jours, ce qui laisse de la marge à la reprise.
 */
export const DEFAULT_INTRADAY_INTERVAL: IntradayInterval = "1h";

/**
 * Fournisseurs dont une barre peut être persistée.
 *
 * `db` et `mock` sont exclus par construction plutôt que par test explicite :
 * une liste blanche laisse un fournisseur futur hors de la base tant que
 * quelqu'un ne l'a pas ajouté sciemment, là où une liste noire l'y ferait
 * entrer par défaut.
 */
export const COLLECTABLE_SOURCES = ["yahoo", "coingecko"] as const;
export type CollectableSource = (typeof COLLECTABLE_SOURCES)[number];

export function isCollectableSource(s: string): s is CollectableSource {
  return (COLLECTABLE_SOURCES as readonly string[]).includes(s);
}

/** Durée d'une barre, en millisecondes. */
const INTERVAL_MS: Record<PriceBarInterval, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1wk": 7 * 24 * 60 * 60_000,
};

/**
 * Début de la barre contenant `date`, en UTC.
 *
 * C'est l'alignement qui rend la collecte idempotente : deux passages sur la
 * même observation calculent le même `barStart`, donc visent la même ligne. Un
 * horodatage de capture brut ne le permettrait pas — c'est précisément ce qui
 * empêche `PriceHistory` d'être idempotente.
 */
export function alignToBarStart(date: Date, interval: PriceBarInterval): Date {
  const ms = INTERVAL_MS[interval];
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

/**
 * Une barre n'est persistée qu'une fois son intervalle écoulé.
 *
 * Collecter à 14 h 30 avec des barres horaires donnerait pour « 14 h » un
 * cours de milieu d'heure, que le passage suivant corrigerait. La valeur
 * stockée changerait donc après coup, et une observation qui bouge n'est plus
 * une observation. On ne garde que les barres closes.
 */
export function isBarComplete(
  barStart: Date,
  interval: PriceBarInterval,
  now: Date
): boolean {
  return barStart.getTime() + INTERVAL_MS[interval] <= now.getTime();
}

export type SkipReason =
  | "source-mock"
  | "source-db"
  | "source-inconnue"
  | "devise-non-eur"
  | "aucune-barre"
  | "fournisseur-indisponible";

export type IntradayCollectionReport = {
  interval: PriceBarInterval;
  /** Actifs éligibles examinés. */
  assetsConsidered: number;
  /** Actifs ayant produit au moins une barre exploitable. */
  assetsCollected: number;
  /** Barres nouvellement écrites. */
  barsCreated: number;
  /** Barres déjà présentes dont le cours a été corrigé par le fournisseur. */
  barsUpdated: number;
  /** Barres déjà présentes et identiques — la preuve de l'idempotence. */
  barsUnchanged: number;
  /** Barres écartées parce que leur intervalle n'était pas clos. */
  barsIncomplete: number;
  skipped: Array<{ assetId: string; reason: SkipReason }>;
  errors: Array<{ assetId: string; message: string }>;
};

const emptyReport = (interval: PriceBarInterval): IntradayCollectionReport => ({
  interval,
  assetsConsidered: 0,
  assetsCollected: 0,
  barsCreated: 0,
  barsUpdated: 0,
  barsUnchanged: 0,
  barsIncomplete: 0,
  skipped: [],
  errors: [],
});

/**
 * Actifs dont un fournisseur peut produire une barre.
 *
 * La liste est **relue à chaque passage** plutôt que figée : un actif créé ce
 * matin doit être collecté ce soir, un actif supprimé doit cesser de l'être, et
 * un actif reclassé suit sa nouvelle classe. Le critère reprend celui de
 * `refreshEligiblePrices` — les deux chemins doivent viser le même périmètre,
 * sans quoi un actif serait rafraîchi sans être historisé.
 */
/**
 * Classes cotées dont l'historique quotidien alimente Financier.
 *
 * Aligné sur `LISTED_ASSET_CLASS_KEYS` (ACTIONS, OBLIGATIONS, CRYPTO).
 * Omettre `OBLIGATIONS` laissait les OAT/ETF obligataires sans clôture —
 * valorisés au coût, donc plats, jusqu'au cours live du jour.
 */
export const COLLECTABLE_LISTED_CLASSES = [
  "ACTIONS",
  "OBLIGATIONS",
  "CRYPTO",
] as const;

export async function listCollectableAssets(userId?: string) {
  return prisma.asset.findMany({
    where: {
      ...(userId ? { userId } : {}),
      OR: [
        { priceProvider: { in: ["FINNHUB", "YAHOO", "COINGECKO"] } },
        { assetClass: { in: [...COLLECTABLE_LISTED_CLASSES] } },
      ],
    },
    select: { id: true, userId: true, name: true },
  });
}


/**
 * Profondeur demandée aux fournisseurs pour les clôtures quotidiennes.
 *
 * Un an : c'est déjà la fenêtre que `fillDailyCloses` réclame, et la remonter
 * ne servirait qu'à demander ce qu'aucun fournisseur branché ne rend. La
 * profondeur réelle reste celle du fournisseur — on ne promet pas mieux.
 */
export const DAILY_LOOKBACK_DAYS = 365;

/**
 * Entretien des clôtures quotidiennes, sur le même périmètre que l'intraday.
 *
 * ## Pourquoi c'est ici
 *
 * `AssetDailyClose` n'était alimentée qu'en marge d'une consultation : ouvrir
 * un écran d'historique déclenchait le remplissage. Un compte qui n'ouvre
 * jamais cet écran n'accumulait donc aucun historique quotidien — et comme
 * c'est **cette table** qui rend le passé reconstructible, son historique
 * restait vide sans que rien ne le signale.
 *
 * La collecte planifiée s'en charge désormais. La lecture, elle, ne déclenche
 * plus rien de nouveau : elle lit ce que le cron a déposé.
 *
 * ## Aucune logique nouvelle
 *
 * `collectDailyCloses` est la fonction que `getDailyCloses` utilise déjà. Le
 * cron ne fait qu'appeler la même chose avec le même périmètre d'actifs que
 * l'intraday — relu à chaque passage, jamais figé.
 */
export async function collectDailyClosesForAssets(opts?: {
  userId?: string;
  now?: Date;
  lookbackDays?: number;
}): Promise<DailyCloseCollectionReport & { day: string }> {
  const now = opts?.now ?? new Date();
  const lookback = opts?.lookbackDays ?? DAILY_LOOKBACK_DAYS;

  const assets = await listCollectableAssets(opts?.userId);
  /*
    Le jour de référence est le jour **parisien**, comme partout ailleurs dans
    le moteur. Découper à minuit UTC ferait retomber une clôture prise entre
    minuit et 2 h dans la journée de la veille — le défaut déjà corrigé sur les
    instantanés.
  */
  const toDay = parisDayKey(now);
  const fromDay = parisDayKey(new Date(now.getTime() - lookback * 86_400_000));

  /*
    Le remplissage est par utilisateur : `fillDailyCloses` résout le symbole
    depuis l'actif, qui appartient à un compte. Les actifs sont donc regroupés,
    et non passés en vrac.
  */
  const byUser = new Map<string, string[]>();
  for (const a of assets) {
    const list = byUser.get(a.userId);
    if (list) list.push(a.id);
    else byUser.set(a.userId, [a.id]);
  }

  const total: DailyCloseCollectionReport = {
    assetsConsidered: 0,
    assetsStale: 0,
    assetsFilled: 0,
    closesWritten: 0,
    errors: [],
  };

  for (const [userId, assetIds] of byUser) {
    const r = await collectDailyCloses({ userId, assetIds, fromDay, toDay, now });
    total.assetsConsidered += r.assetsConsidered;
    total.assetsStale += r.assetsStale;
    total.assetsFilled += r.assetsFilled;
    total.closesWritten += r.closesWritten;
    total.errors.push(...r.errors);
  }

  return { ...total, day: toDay };
}

/** Ce que le collecteur consomme — injecté pour que les tests n'aient pas de réseau. */
export type CollectorDeps = {
  fetchHistory: (
    userId: string,
    assetId: string,
    interval: PriceBarInterval
  ) => Promise<PriceHistoryResult | null>;
  now: () => Date;
};

const defaultDeps: CollectorDeps = {
  fetchHistory: (userId, assetId, interval) =>
    getAssetPriceHistory(userId, assetId, "7d", { interval }),
  now: () => new Date(),
};

type UsableBar = { barStart: Date; closeEur: number };

/**
 * Retient les barres persistables d'un résultat fournisseur.
 *
 * Séparée de l'écriture pour être testable sans base : c'est ici que vivent
 * les trois refus (mock, db, barre en cours) et la normalisation de devise.
 */
export function selectUsableBars(
  result: PriceHistoryResult,
  interval: PriceBarInterval,
  now: Date
): { bars: UsableBar[]; skip?: SkipReason; incomplete: number } {
  if (result.source === "mock") return { bars: [], skip: "source-mock", incomplete: 0 };
  if (result.source === "db") return { bars: [], skip: "source-db", incomplete: 0 };
  if (!isCollectableSource(result.source)) {
    return { bars: [], skip: "source-inconnue", incomplete: 0 };
  }
  /*
    La conversion en EUR est faite par `getAssetPriceHistory` — CoinGecko est
    interrogé en `vs_currency=eur`, Yahoo est converti au chargement. On vérifie
    donc plutôt que l'on recalcule : refaire la conversion ici, c'est s'engager
    à la maintenir en double.
  */
  if (result.currency !== "EUR") {
    return { bars: [], skip: "devise-non-eur", incomplete: 0 };
  }

  const byStart = new Map<number, number>();
  let incomplete = 0;
  for (const p of result.points) {
    const at = new Date(p.date);
    if (Number.isNaN(at.getTime())) continue;
    if (!Number.isFinite(p.close) || p.close <= 0) continue;
    const start = alignToBarStart(at, interval);
    if (!isBarComplete(start, interval, now)) {
      incomplete++;
      continue;
    }
    // Plusieurs points dans la même barre : le dernier ferme la barre, même
    // règle que `fillDailyCloses` pour les clôtures quotidiennes.
    byStart.set(start.getTime(), p.close);
  }

  if (byStart.size === 0) {
    return { bars: [], skip: incomplete > 0 ? undefined : "aucune-barre", incomplete };
  }
  return {
    bars: [...byStart]
      .sort((a, b) => a[0] - b[0])
      .map(([t, closeEur]) => ({ barStart: new Date(t), closeEur })),
    incomplete,
  };
}

/**
 * Écrit les barres d'un actif sans jamais créer de doublon.
 *
 * Les lignes existantes sont lues d'abord, en une requête : cela permet de
 * distinguer ce qui est créé, corrigé, et inchangé — le compteur `barsUnchanged`
 * est ce qui rend l'idempotence observable plutôt que supposée.
 */
async function persistBars(
  assetId: string,
  interval: PriceBarInterval,
  bars: UsableBar[],
  source: string
): Promise<{ created: number; updated: number; unchanged: number }> {
  if (bars.length === 0) return { created: 0, updated: 0, unchanged: 0 };

  const existing = await prisma.assetIntradayBar.findMany({
    where: {
      assetId,
      interval,
      barStart: { in: bars.map((b) => b.barStart) },
    },
    select: { barStart: true, closeEur: true },
  });
  const known = new Map(
    existing.map((e) => [e.barStart.getTime(), e.closeEur.toString()])
  );

  const toCreate: UsableBar[] = [];
  const toUpdate: UsableBar[] = [];
  let unchanged = 0;

  for (const b of bars) {
    const prev = known.get(b.barStart.getTime());
    if (prev === undefined) {
      toCreate.push(b);
      continue;
    }
    // Comparaison sur la valeur décimale, pas sur la chaîne : "42" et
    // "42.000000000000" désignent la même observation.
    if (new Prisma.Decimal(prev).equals(new Prisma.Decimal(b.closeEur))) {
      unchanged++;
    } else {
      toUpdate.push(b);
    }
  }

  if (toCreate.length > 0) {
    await prisma.assetIntradayBar.createMany({
      data: toCreate.map((b) => ({
        assetId,
        interval,
        barStart: b.barStart,
        closeEur: new Prisma.Decimal(b.closeEur),
        source,
      })),
      // Filet contre une collecte concurrente : la contrainte d'unicité reste
      // l'arbitre, la course ne doit pas faire échouer le passage entier.
      skipDuplicates: true,
    });
  }

  for (const b of toUpdate) {
    await prisma.assetIntradayBar.update({
      where: {
        assetId_interval_barStart: { assetId, interval, barStart: b.barStart },
      },
      data: {
        closeEur: new Prisma.Decimal(b.closeEur),
        source,
        fetchedAt: new Date(),
      },
    });
  }

  return { created: toCreate.length, updated: toUpdate.length, unchanged };
}

/**
 * Collecte les barres intra-séance des actifs éligibles.
 *
 * Sans `userId`, parcourt tous les comptes — c'est le mode du cron. L'échec
 * d'un actif n'interrompt jamais le passage : un fournisseur indisponible ou
 * un 429 laisse un trou, que le passage suivant comblera tant que la fenêtre
 * du fournisseur le permet (10 jours en 1 h).
 */
export async function collectIntradayBars(opts?: {
  userId?: string;
  interval?: IntradayInterval;
  deps?: Partial<CollectorDeps>;
}): Promise<IntradayCollectionReport> {
  const interval = opts?.interval ?? DEFAULT_INTRADAY_INTERVAL;
  const deps: CollectorDeps = { ...defaultDeps, ...opts?.deps };
  const report = emptyReport(interval);

  const assets = await listCollectableAssets(opts?.userId);
  report.assetsConsidered = assets.length;

  for (const asset of assets) {
    const now = deps.now();
    let result: PriceHistoryResult | null;
    try {
      result = await deps.fetchHistory(asset.userId, asset.id, interval);
    } catch (e) {
      /*
        429, coupure réseau, fournisseur en panne : on note et on continue.
        Interrompre priverait de collecte tous les actifs suivants pour une
        raison qui ne les concerne pas.
      */
      report.errors.push({
        assetId: asset.id,
        message: e instanceof Error ? e.message : "échec fournisseur",
      });
      continue;
    }

    if (!result) {
      report.skipped.push({ assetId: asset.id, reason: "fournisseur-indisponible" });
      continue;
    }

    const { bars, skip, incomplete } = selectUsableBars(result, interval, now);
    report.barsIncomplete += incomplete;
    if (skip) {
      report.skipped.push({ assetId: asset.id, reason: skip });
      continue;
    }
    if (bars.length === 0) continue;

    try {
      const w = await persistBars(asset.id, interval, bars, result.source);
      report.barsCreated += w.created;
      report.barsUpdated += w.updated;
      report.barsUnchanged += w.unchanged;
      report.assetsCollected++;
    } catch (e) {
      report.errors.push({
        assetId: asset.id,
        message: e instanceof Error ? e.message : "échec d'écriture",
      });
    }
  }

  return report;
}
