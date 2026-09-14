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
import { parisDayKey, parisYesterdayKey } from "../dates/paris";
import { getDailyCloses } from "../market/daily-closes";
import { valueHeldAtDay } from "../market/daily-valuation";
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
  /**
   * Clôture d'hier (`parisYesterdayKey`), pour la variation 24h.
   *
   * `null` sans clôture connue à moins de `MAX_STALE_DAYS` d'hier. La
   * variation elle-même ne se calcule **pas** ici : ce module ne connaît que
   * des clôtures passées, or la définition retenue (voir
   * `summary-service.ts`) compare la valeur **actuelle** — cotation live,
   * connue de l'appelant via `CoinCard.currentPriceEur` — à cette clôture.
   * La calculer ici comparerait deux clôtures déjà passées (souvent
   * avant-veille → veille tant que la clôture du jour n'est pas encore en
   * cache) au lieu d'une vraie fenêtre de 24h se terminant maintenant — c'est
   * précisément l'écart qui faisait diverger le KPI strip et l'onglet
   * Comptant.
   */
  previousCloseEur: number | null;
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
 * Clôture d'un actif à la date la plus proche d'`yesterday`, sans la dépasser.
 *
 * `MAX_STALE_DAYS` borne la fraîcheur : au-delà, la clôture trouvée décrit une
 * autre journée qu'« hier » (week-end + jour férié consécutifs, fournisseur
 * muet…), et la présenter comme la veille pour une variation « 24 h » serait
 * faux. On rend alors `null`, que l'écran sait dire.
 */
const MAX_STALE_DAYS = 3;

function previousCloseNear(
  index: Map<DayKey, number>,
  yesterday: DayKey
): number | null {
  let bestDay = "";
  let bestValue: number | null = null;
  for (const [day, value] of index) {
    if (day <= yesterday && day > bestDay) {
      bestDay = day;
      bestValue = value;
    }
  }
  if (bestValue == null || bestValue <= 0) return null;

  const gapDays =
    (Date.parse(`${yesterday}T00:00:00Z`) - Date.parse(`${bestDay}T00:00:00Z`)) /
    (24 * 3600 * 1000);
  return gapDays <= MAX_STALE_DAYS ? bestValue : null;
}

export async function getSpotHistory(
  userId: string,
  range: SpotRange,
  now = new Date()
): Promise<SpotHistory> {
  const toDay = parisDayKey(now);
  // Borne partagée avec le KPI strip (`summary-service.ts`) : voir la doctrine
  // de `parisYesterdayKey` pour la définition unique de la variation 24h.
  const yesterday = parisYesterdayKey(now);

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

  // Lecture seule — voir `performance-service` : la collecte appartient à la
  // tâche planifiée, pas à l'ouverture d'un écran.
  const { closes } = await getDailyCloses(userId, [...heldIds], readFrom, toDay, {
    refresh: false,
  });

  /* ── Courbe de la poche ─────────────────────────────────────────── */

  const points: SpotValuePoint[] = [];
  const lastDay = days[days.length - 1]!;

  /*
    Un jour n'entre dans la courbe que si **toutes** les lignes détenues y sont
    valorisables.

    La boucle précédente sautait la ligne sans clôture et publiait le total
    quand même : un jour sans aucune cotation valait donc 0 €, et un jour à
    moitié coté valait la moitié du portefeuille. La courbe décrochait puis
    remontait sans qu'aucune position n'ait bougé.

    `valueHeldAtDay` porte cette règle et le report depuis la dernière clôture
    observée ; les jours incomplets sont simplement absents de la série.
  */
  for (const day of days) {
    const held = Object.entries(quantities.get(day) ?? {})
      .filter(([assetId, qty]) => heldIds.has(assetId) && qty !== 0)
      .map(([assetId, quantity]) => ({ assetId, quantity }));

    const valuation = valueHeldAtDay(held, closes, day);
    if (!valuation.complete) continue;
    points.push({ day, valueEur: valuation.valueEur });
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
      La clôture de la veille se lit sur une clôture **réellement cotée**, et
      non sur la série ci-dessus : celle-ci reporte la dernière clôture connue
      pour dessiner une courbe continue, si bien qu'un cache périmé
      afficherait « stable » là où la bonne réponse est « on ne sait pas ».

      La variation elle-même n'est pas calculée ici : voir la doc de
      `previousCloseEur` sur `SpotAssetSeries` — c'est l'appelant
      (`buildAssetRows`, `spot-overview.ts`) qui la rapporte à la cotation
      **actuelle** (`CoinCard.currentPriceEur`), pas à une seconde clôture déjà
      passée.
    */
    const previousCloseEur = previousCloseNear(index, yesterday);

    // Deux coins peuvent partager un symbole (même jeton sur deux réseaux) :
    // la première série connue fait foi, plutôt que d'en moyenner deux qui
    // décrivent le même cours.
    if (bySymbol[symbol]) continue;

    bySymbol[symbol] = {
      previousCloseEur,
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
