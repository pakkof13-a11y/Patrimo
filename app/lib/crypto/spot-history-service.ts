/**
 * Historique de la poche crypto comptant : courbe de valeur et séries par actif.
 *
 * Même parti pris que pour l'assurance-vie : rien n'est revalorisé ici. Les
 * quantités viennent du rejeu du ledger (`buildDailyQuantities`), les cours du
 * cache de clôtures journalières (`getDailyCloses`). Une seconde chaîne de
 * valorisation finirait par diverger de la première — c'est déjà arrivé sur ce
 * dépôt, et deux écrans affichaient alors deux totaux pour le même portefeuille.
 *
 * Différence notable avec l'assurance-vie : la courbe rendue ici est en
 * **euros**, pas en indice pondéré par le temps. Sur une poche crypto, voir
 * l'encours monter est l'information recherchée ; la neutralisation des
 * versements, indispensable pour juger un contrat d'assurance-vie, n'est pas ce
 * que l'écran promet. Les apports restent lisibles à côté, dans le capital
 * investi.
 *
 * Ne sont retenues que les positions **comptant** : ni DeFi, ni NFT. Les deux
 * ont leurs propres sous-onglets, et les mélanger ici gonflerait la poche d'une
 * valeur que l'écran ne détaille pas.
 */

import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import { getDailyCloses } from "../market/daily-closes";
import {
  buildDailyQuantities,
  closeAtOrBefore,
  type DayKey,
} from "../portfolio/class-history";
import { enumerateDays } from "../portfolio/class-pnl-service";
import { mapDbTx } from "../portfolio/service";
import { spotRangeStartDay, type SpotRange } from "./spot-overview";

/** Fenêtre des sparklines : un mois de clôtures donne une pente lisible. */
export const SPARK_DAYS = 30;

/** Garde-fou : au-delà, la série est illisible et le calcul coûteux. */
const MAX_DAYS = 1900;

export type SpotValuePoint = {
  day: DayKey;
  /** Valeur de la poche ce jour-là, en euros. */
  valueEur: number;
};

export type SpotAssetSeries = {
  /** Variation entre l'avant-dernière et la dernière clôture, en %. */
  change24hPct: number | null;
  /** Jusqu'à 30 clôtures, du plus ancien au plus récent. */
  closes: number[];
};

export type SpotHistory = {
  range: SpotRange;
  fromDay: DayKey;
  toDay: DayKey;
  points: SpotValuePoint[];
  /**
   * Part de l'encours du dernier jour effectivement couverte par un historique
   * de cours, en %.
   *
   * Un coin sans clôture connue est absent de la courbe. Le dire est nécessaire :
   * une courbe qui décrit 40 % de la poche et se présente comme la poche entière
   * est un chiffre faux, pas une approximation.
   */
  coveragePct: number;
  /** Séries par symbole de coin — la clé de regroupement de `buildCoinCards`. */
  bySymbol: Record<string, SpotAssetSeries>;
  /** Cours du bitcoin au dernier jour coté, pour l'équivalent en BTC. */
  btcPriceEur: number | null;
};

/**
 * Symbole de regroupement d'un actif, aligné sur `coinSymbolOf`.
 *
 * Les deux doivent découper de la même façon, sinon les séries calculées ici ne
 * retrouveraient pas les cartes qu'elles décrivent : l'écran afficherait des
 * lignes sans courbe alors que l'historique existe.
 */
function symbolOf(a: { ticker: string | null; name: string }): string {
  const raw = (a.ticker || a.name || "").trim();
  if (!raw) return "?";
  return (raw.split(/[.\-/:]/)[0] ?? raw).toUpperCase();
}

/**
 * Deux dernières clôtures cotées d'un actif, si elles sont assez rapprochées.
 *
 * `MAX_STALE_DAYS` borne la fraîcheur : au-delà, l'écart entre deux clôtures
 * n'est plus une variation « 24 h » mais celle d'une semaine, et l'annoncer
 * comme telle serait faux. On rend alors `null`, que l'écran sait dire.
 */
const MAX_STALE_DAYS = 3;

function quotedPair(
  index: Map<DayKey, number>,
  toDay: DayKey
): { last: number; previous: number } | null {
  const days = [...index.keys()].filter((d) => d <= toDay).sort();
  if (days.length < 2) return null;

  const lastDay = days[days.length - 1]!;
  const previousDay = days[days.length - 2]!;

  const ageDays =
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${lastDay}T00:00:00Z`)) /
    (24 * 3600 * 1000);
  const gapDays =
    (Date.parse(`${lastDay}T00:00:00Z`) -
      Date.parse(`${previousDay}T00:00:00Z`)) /
    (24 * 3600 * 1000);
  if (ageDays > MAX_STALE_DAYS || gapDays > MAX_STALE_DAYS) return null;

  return { last: index.get(lastDay)!, previous: index.get(previousDay)! };
}

export async function getSpotHistory(
  userId: string,
  range: SpotRange,
  now = new Date()
): Promise<SpotHistory> {
  const toDay = parisDayKey(now);

  // Comptant = actif crypto sans fiche DeFi ni fiche NFT. Le filtre est posé
  // ici plutôt qu'après coup : une position DeFi entrée dans le rejeu du
  // ledger ressortirait dans la courbe sans jamais apparaître dans le tableau.
  const assets = await prisma.asset.findMany({
    where: {
      userId,
      accountType: "CRYPTO",
      defiPosition: { is: null },
      nftItem: { is: null },
    },
    select: { id: true, ticker: true, name: true },
  });

  if (assets.length === 0) return emptyHistory(range, toDay);

  const symbolByAsset = new Map(assets.map((a) => [a.id, symbolOf(a)]));
  const spotIds = [...symbolByAsset.keys()];

  const txRows = await prisma.transaction.findMany({
    where: { userId, assetId: { in: spotIds } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  if (txRows.length === 0) return emptyHistory(range, toDay);

  const firstDay = parisDayKey(txRows[0]!.occurredAt);
  const requested = spotRangeStartDay(range, now);
  // La fenêtre ne commence jamais avant la première opération : montrer des
  // mois de plat avant le premier achat ne renseigne sur rien.
  let fromDay = requested && requested > firstDay ? requested : firstDay;

  const span = enumerateDays(fromDay, toDay);
  const days = span.length > MAX_DAYS ? span.slice(span.length - MAX_DAYS) : span;
  if (days.length === 0) return emptyHistory(range, toDay);
  fromDay = days[0]!;

  const quantities = buildDailyQuantities(txRows.map(mapDbTx), days);

  const heldIds = new Set<string>();
  for (const day of days) {
    for (const [assetId, qty] of Object.entries(quantities.get(day) ?? {})) {
      if (qty !== 0 && symbolByAsset.has(assetId)) heldIds.add(assetId);
    }
  }
  if (heldIds.size === 0) return emptyHistory(range, toDay);

  /*
    Les sparklines demandent trente jours quelle que soit la fenêtre choisie :
    sur « 1J », la courbe de tête tient sur deux points mais la vignette d'une
    ligne doit rester une courbe. On élargit donc la lecture du cache vers le
    passé — elle porte sur les mêmes actifs, et le cache est déjà en base.
  */
  const sparkFrom = new Date(
    Date.parse(`${toDay}T00:00:00Z`) - SPARK_DAYS * 24 * 3600 * 1000
  )
    .toISOString()
    .slice(0, 10);
  const readFrom = sparkFrom < fromDay ? sparkFrom : fromDay;

  const { closes } = await getDailyCloses(userId, [...heldIds], readFrom, toDay);

  /* ── Courbe de la poche ─────────────────────────────────────────── */

  const points: SpotValuePoint[] = [];
  const lastDay = days[days.length - 1]!;

  for (const day of days) {
    let valueEur = 0;
    for (const [assetId, qty] of Object.entries(quantities.get(day) ?? {})) {
      if (!heldIds.has(assetId) || qty === 0) continue;
      // Trou ponctuel dans une série connue : la clôture est reportée depuis le
      // dernier jour coté, jamais devinée vers l'avenir. Sans aucune clôture,
      // la ligne n'entre pas dans la courbe — elle est comptée à la couverture.
      const close = closeAtOrBefore(closes.get(assetId), day);
      if (close == null) continue;
      valueEur += qty * close;
    }
    points.push({ day, valueEur });
  }

  // Couverture : part des actifs encore détenus au dernier jour dont la série
  // est connue. Mesurée en nombre de lignes plutôt qu'en valeur, faute de
  // pouvoir chiffrer précisément ce qu'on ne sait pas valoriser.
  const heldAtLast = Object.entries(quantities.get(lastDay) ?? {}).filter(
    ([assetId, qty]) => heldIds.has(assetId) && qty !== 0
  );
  const quotedAtLast = heldAtLast.filter(
    ([assetId]) => closeAtOrBefore(closes.get(assetId), lastDay) != null
  );
  const coveragePct =
    heldAtLast.length > 0
      ? (quotedAtLast.length / heldAtLast.length) * 100
      : 0;

  /* ── Séries par coin ────────────────────────────────────────────── */

  const sparkDays = enumerateDays(sparkFrom, toDay);
  const bySymbol: Record<string, SpotAssetSeries> = {};

  for (const assetId of heldIds) {
    const symbol = symbolByAsset.get(assetId)!;
    const index = closes.get(assetId);
    if (!index || index.size === 0) continue;

    const series: number[] = [];
    for (const day of sparkDays) {
      const close = closeAtOrBefore(index, day);
      if (close != null) series.push(close);
    }
    if (series.length === 0) continue;

    /*
      La variation 24 h se lit sur deux clôtures **réellement cotées**, et non
      sur la série ci-dessus : celle-ci reporte la dernière clôture connue pour
      dessiner une courbe continue, si bien qu'un cache périmé afficherait
      « 0,00 % » — « stable » là où la bonne réponse est « on ne sait pas ».

      On prend les deux derniers jours cotés plutôt que strictement hier et
      aujourd'hui : la clôture du jour n'est écrite qu'en fin de journée, et
      exiger sa présence rendrait la mesure indisponible toute la matinée alors
      que les deux veilles sont connues.
    */
    const quoted = quotedPair(index, toDay);

    // Deux coins peuvent partager un symbole (même jeton sur deux réseaux) :
    // la première série connue fait foi, plutôt que d'en moyenner deux qui
    // décrivent le même cours.
    if (bySymbol[symbol]) continue;

    bySymbol[symbol] = {
      change24hPct:
        quoted && quoted.previous > 0
          ? (quoted.last / quoted.previous - 1) * 100
          : null,
      closes: series.slice(-SPARK_DAYS),
    };
  }

  /*
    Aucune ligne cotée : il n'y a pas une courbe plate à montrer, il n'y a pas
    de courbe. Rendre 200 points à zéro dessinerait un portefeuille qui ne vaut
    rien, alors que la bonne réponse est « on ne connaît aucun cours » — et
    l'écran, lui, sait afficher une absence.
  */
  return {
    range,
    fromDay,
    toDay,
    points: coveragePct > 0 ? points : [],
    coveragePct,
    bySymbol,
    btcPriceEur: bySymbol.BTC?.closes.at(-1) ?? null,
  };
}

function emptyHistory(range: SpotRange, toDay: DayKey): SpotHistory {
  return {
    range,
    fromDay: toDay,
    toDay,
    points: [],
    coveragePct: 0,
    bySymbol: {},
    btcPriceEur: null,
  };
}
