/**
 * Série patrimoniale à pas horaire — construction, échantillonnage, extrêmes.
 *
 * ## Ce que ce module n'est pas
 *
 * Ce n'est pas un second moteur. Toute l'arithmétique — exclusions, poches non
 * cotées, passifs projetés, flux externes, statut — vient de
 * `PortfolioValuationEngine.buildInstantSeries`. Ce module décide **à quels
 * instants** interroger le moteur, et comment réduire le résultat pour l'écran.
 *
 * Deux définitions du patrimoine, c'est le défaut que les chantiers précédents
 * ont supprimé ; il n'en est pas réintroduit une troisième.
 *
 * ## Où commence la série
 *
 * Au premier instant où **une** donnée de prix existe — barre intra-séance ou
 * clôture quotidienne. Avant cela, les positions n'auraient que leur prix de
 * revient, et la courbe dessinerait une ligne plate qu'aucune observation ne
 * soutient. Une fenêtre entièrement antérieure aux données rend donc une série
 * vide : c'est une réponse, pas un échec.
 *
 * Ce qui change avec l'historique reconstructible : la série ne dépend plus de
 * la seule collecte intraday. Un compte créé aujourd'hui, dont les transactions
 * remontent à 2020, obtient une courbe dès que les clôtures quotidiennes de ses
 * actifs sont connues — sans qu'aucun instantané n'ait été pris à l'époque.
 * Chaque point porte alors `DAILY_EXACT`, qui ne se fait pas passer pour une
 * observation de 14 h 37.
 */

import { parisDayKey } from "../../dates/paris";
import { loadHistoricalInputs } from "../historical/load";
import { PortfolioValuationEngine } from "../historical/engine";
import type {
  HistoricalDataStatus,
  PortfolioValuationPoint,
} from "../historical/types";
import { PRICE_ORIGINS } from "../historical/price-resolver";
import {
  firstObservationAt,
  loadIntradayBars,
  MAX_CARRY_FORWARD_MS,
  type IntradayBarIndex,
} from "./bar-index";
import { resolverAt } from "../../market/market-data-repository";

/** Pas de la restitution, aligné sur la granularité collectée. */
export const INTRADAY_STEP_MS = 60 * 60 * 1000;
export const INTRADAY_INTERVAL = "1h";

/**
 * Un point de la série, tel que le frontend le recevra.
 *
 * Volontairement dépourvu de toute forme propre à une bibliothèque de graphes :
 * la restitution visuelle viendra plus tard et ne doit pas dicter le contrat
 * métier.
 */
export type IntradayPoint = {
  /** Horodatage canonique, UTC. C'est lui qui fait foi. */
  at: string;
  /** Jour civil parisien contenant ce point — conservé pour les regroupements. */
  day: string;
  netWorth: number;
  grossAssets: number;
  liabilities: number;
  cash: number;
  securities: number;
  crypto: number;
  realEstate: number;
  lifeInsurance: number;
  alternatives: number;
  employeeSavings: number;
  otherAssets: number;
  externalFlows: number;
  status: HistoricalDataStatus;
  estimatedComponents: string[];
  /** D'où venaient les cours — l'origine la moins bien étayée du point. */
  priceOrigin: string | null;
  /** Part des positions réellement valorisées, de 0 à 1. */
  priceCoverage: number;
};

export type IntradayExtremes = {
  max: { at: string; value: number };
  min: { at: string; value: number };
  /** Repli maximal depuis un sommet antérieur, en euros (valeur ≥ 0). */
  drawdownEur: number;
  drawdownPct: number;
  /** Sommet d'où part le repli, et creux atteint. */
  peakAt: string;
  troughAt: string;
  /** Premier instant où la valeur retrouve le sommet, si elle y revient. */
  recoveredAt: string | null;
};

export type IntradaySeries = {
  interval: string;
  stepMs: number;
  /** Instant de la première observation **intraday**, ou null si aucune. */
  observedFrom: string | null;
  points: IntradayPoint[];
  extremes: IntradayExtremes | null;
  /**
   * Part du patrimoine historiquement valorisable sur la fenêtre, de 0 à 1.
   *
   * Mieux vaut annoncer « 82 % valorisable » qu'une courbe complète dont un
   * cinquième repose sur des prix de revient. C'est la moyenne des couvertures
   * de chaque point : une seule ligne muette pèse sur toute la fenêtre.
   */
  coverage: number;
  /** Origines rencontrées sur la fenêtre, de la plus étayée à la moins. */
  origins: string[];
};

const toPoint = (p: PortfolioValuationPoint & { at: Date }): IntradayPoint => ({
  at: p.at.toISOString(),
  day: p.day,
  netWorth: p.netWorth,
  grossAssets: p.grossAssets,
  liabilities: p.liabilities,
  cash: p.cash,
  securities: p.securities,
  crypto: p.crypto,
  realEstate: p.realEstate,
  lifeInsurance: p.lifeInsurance,
  alternatives: p.alternatives,
  employeeSavings: p.employeeSavings,
  otherAssets: p.otherAssets,
  externalFlows: p.externalFlows,
  status: p.status,
  estimatedComponents: p.estimatedComponents,
  priceOrigin: p.weakestPriceOrigin,
  priceCoverage: p.priceCoverage,
});


/**
 * Premier instant où une valorisation de marché est possible.
 *
 * Une barre intra-séance ou une clôture quotidienne suffisent. Sans l'une ni
 * l'autre, il n'y a rien à tracer — et rien à inventer.
 */
export function earliestPricedAt(
  bars: IntradayBarIndex,
  daily: Map<string, Map<string, number>>
): number | null {
  let first = firstObservationAt(bars);
  for (const byDay of daily.values()) {
    for (const day of byDay.keys()) {
      const at = Date.parse(`${day}T00:00:00Z`);
      if (Number.isFinite(at) && (first == null || at < first)) first = at;
    }
  }
  return first;
}


/** Couverture moyenne de la fenêtre — 1 quand tout a pu être valorisé. */
function averageCoverage(points: IntradayPoint[]): number {
  if (points.length === 0) return 1;
  let sum = 0;
  for (const p of points) sum += p.priceCoverage;
  return sum / points.length;
}

/** Origines rencontrées, dans l'ordre de fiabilité décroissante. */
function distinctOrigins(points: IntradayPoint[]): string[] {
  const seen = new Set<string>();
  for (const p of points) if (p.priceOrigin) seen.add(p.priceOrigin);
  return PRICE_ORIGINS.filter((o) => seen.has(o));
}


/**
 * Pas d'échantillonnage adapté à la fenêtre.
 *
 * Interroger le moteur toutes les heures sur un an fait 8 760 valorisations
 * pour n'en afficher que quelques centaines — et quand les données sous-jacentes
 * sont des clôtures quotidiennes, les 23 points d'une même journée portent de
 * toute façon la même valeur.
 *
 * Le pas ne change ni les données ni leur origine : il change le nombre de
 * questions posées. La finesse reste disponible là où elle a un sens, c'est-à-dire
 * sur la fenêtre courte.
 */
export function stepForWindow(from: Date, to: Date): number {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 8) return INTRADAY_STEP_MS;
  if (days <= 35) return 4 * INTRADAY_STEP_MS;
  return 24 * INTRADAY_STEP_MS;
}

/** Instants d'échantillonnage, alignés sur le pas, bornes comprises. */
export function enumerateInstants(
  from: Date,
  to: Date,
  stepMs = INTRADAY_STEP_MS
): Date[] {
  const start = Math.ceil(from.getTime() / stepMs) * stepMs;
  const end = to.getTime();
  const out: Date[] = [];
  for (let t = start; t <= end; t += stepMs) out.push(new Date(t));
  return out;
}

/**
 * Extrêmes et repli maximal d'une série.
 *
 * Le repli est mesuré depuis le **sommet courant**, pas depuis le maximum
 * global : un patrimoine qui monte, chute, puis dépasse son ancien sommet a
 * bien connu un repli, que la seule différence max−min effacerait si le creux
 * précède le sommet final.
 */
export function computeExtremes(points: IntradayPoint[]): IntradayExtremes | null {
  if (points.length === 0) return null;

  let max = points[0]!;
  let min = points[0]!;
  let peak = points[0]!;
  let worst = { drop: 0, peak: points[0]!, trough: points[0]! };

  for (const p of points) {
    if (p.netWorth > max.netWorth) max = p;
    if (p.netWorth < min.netWorth) min = p;
    if (p.netWorth > peak.netWorth) peak = p;
    const drop = peak.netWorth - p.netWorth;
    if (drop > worst.drop) worst = { drop, peak, trough: p };
  }

  // Retour au sommet : le premier point, après le creux, qui le rejoint.
  let recoveredAt: string | null = null;
  let seenTrough = false;
  for (const p of points) {
    if (p.at === worst.trough.at) {
      seenTrough = true;
      continue;
    }
    if (seenTrough && p.netWorth >= worst.peak.netWorth) {
      recoveredAt = p.at;
      break;
    }
  }

  return {
    max: { at: max.at, value: max.netWorth },
    min: { at: min.at, value: min.netWorth },
    drawdownEur: worst.drop,
    drawdownPct:
      worst.peak.netWorth > 0 ? (worst.drop / worst.peak.netWorth) * 100 : 0,
    peakAt: worst.peak.at,
    troughAt: worst.trough.at,
    recoveredAt,
  };
}

/**
 * Réduit une série à un nombre de points affichable, sans perdre ce qui compte.
 *
 * `downsampleSeries` (courbe quotidienne) raisonne en indices de jours. Ici
 * l'axe est temporel, et l'enjeu est différent : c'est précisément le creux de
 * milieu de journée que l'échantillonnage ne doit pas emporter — un repli de
 * 15 000 € qui disparaît parce qu'il tombe entre deux points retenus rendrait
 * la courbe inutile.
 *
 * Sont donc conservés, quoi qu'il arrive : le premier et le dernier point, les
 * extrêmes de chaque tranche, tout point portant un flux externe, et tout
 * changement de statut — passer d'observé à estimé est une information, pas un
 * détail de tracé.
 *
 * Le tracé n'est jamais lissé : les points retenus sont des points réels.
 */
export function downsampleIntraday(
  points: IntradayPoint[],
  maxPoints: number
): IntradayPoint[] {
  if (maxPoints < 3 || points.length <= maxPoints) return points;

  const keep = new Set<number>([0, points.length - 1]);

  for (let i = 1; i < points.length; i++) {
    if (points[i]!.externalFlows !== 0) keep.add(i);
    if (points[i]!.status !== points[i - 1]!.status) keep.add(i);
  }

  /*
    Extrêmes par tranche plutôt qu'un pas régulier : un échantillonnage
    uniforme retiendrait 14 h et 15 h et laisserait tomber le creux de 14 h 30.
  */
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const size = points.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(points.length, Math.floor((b + 1) * size));
    if (start >= end) continue;
    let hi = start;
    let lo = start;
    for (let i = start; i < end; i++) {
      if (points[i]!.netWorth > points[hi]!.netWorth) hi = i;
      if (points[i]!.netWorth < points[lo]!.netWorth) lo = i;
    }
    keep.add(hi);
    keep.add(lo);
  }

  return [...keep].sort((a, b) => a - b).map((i) => points[i]!);
}

/**
 * Construit la série intraday d'un utilisateur sur une fenêtre.
 *
 * Lecture pure : aucune écriture, aucun appel fournisseur. Les barres viennent
 * de la base, les cours manquants ne sont pas cherchés ailleurs — c'est ce qui
 * rend l'affichage indépendant du réseau.
 */
export async function buildIntradaySeries(opts: {
  userId: string;
  from: Date;
  to: Date;
  maxPoints?: number;
  stepMs?: number;
  /** Injectable pour les tests : évite la base sans réimplémenter le moteur. */
  deps?: {
    loadBars?: (o: {
      userId: string;
      from: Date;
      to: Date;
      interval: string;
    }) => Promise<IntradayBarIndex>;
    buildEngine?: (userId: string) => Promise<PortfolioValuationEngine>;
  };
}): Promise<IntradaySeries> {
  const stepMs = opts.stepMs ?? stepForWindow(opts.from, opts.to);
  const loadBars = opts.deps?.loadBars ?? loadIntradayBars;
  const buildEngine =
    opts.deps?.buildEngine ??
    (async (userId: string) =>
      new PortfolioValuationEngine(await loadHistoricalInputs(userId)));

  const [bars, engine] = await Promise.all([
    loadBars({
      userId: opts.userId,
      from: opts.from,
      to: opts.to,
      interval: INTRADAY_INTERVAL,
    }),
    buildEngine(opts.userId),
  ]);

  const observed = firstObservationAt(bars);
  /*
    Le début possible de la courbe, toutes sources confondues.

    `observedFrom` garde son sens — la première observation *intraday* — mais ce
    n'est plus lui qui borne la série : une clôture quotidienne suffit à
    valoriser un point, et c'est ce qui rend le passé reconstructible.
  */
  const priced = earliestPricedAt(bars, engine.dailyCloses());
  const empty: IntradaySeries = {
    interval: INTRADAY_INTERVAL,
    stepMs,
    observedFrom: observed == null ? null : new Date(observed).toISOString(),
    points: [],
    extremes: null,
    coverage: 1,
    origins: [],
  };
  if (priced == null) return empty;

  /*
    La série ne commence pas avant la première observation.

    Valoriser avant toute donnée de prix reviendrait à reporter un cours
    *futur* vers le passé, ou à retenir les positions à leur prix de revient et
    à afficher une marche qu'aucun mouvement n'a produite.
  */
  const start = new Date(Math.max(opts.from.getTime(), priced));
  if (start.getTime() > opts.to.getTime()) return empty;

  const instants = enumerateInstants(start, opts.to, stepMs);
  if (instants.length === 0) return empty;

  /*
    Le résolveur consulte les barres **puis** les clôtures quotidiennes.

    C'est ce qui rend l'historique reconstructible : un actif sans barre à cet
    instant, mais dont la clôture du jour est connue, est valorisé au marché et
    non plus retenu à son prix de revient. Un utilisateur arrivant aujourd'hui
    avec des transactions de 2020 obtient donc une courbe, sans qu'aucun
    instantané n'ait jamais été pris à l'époque.

    L'origine de chaque cours reste portée par le point : `DAILY_EXACT` ne se
    fait pas passer pour une observation de 14 h 37.
  */
  /*
    `intervalMs` est la durée d'une **barre**, pas le pas d'échantillonnage.

    Les confondre ferait qu'une barre horaire « couvrirait » une journée entière
    dès que le pas passe au jour, et un report de vingt-trois heures serait
    annoncé comme une observation. La finesse de la donnée ne dépend pas de la
    fréquence à laquelle on l'interroge.
  */
  const raw = engine.buildInstantSeries(instants, (at) =>
    resolverAt(
      { intraday: bars, daily: engine.dailyCloses() },
      at,
      { intervalMs: INTRADAY_STEP_MS, maxCarryMs: MAX_CARRY_FORWARD_MS }
    )
  );

  const all = raw.map(toPoint);
  const points = opts.maxPoints ? downsampleIntraday(all, opts.maxPoints) : all;

  return {
    interval: INTRADAY_INTERVAL,
    stepMs,
    observedFrom: observed == null ? null : new Date(observed).toISOString(),
    points,
    // Les extrêmes sont mesurés sur la série **complète** : les calculer après
    // échantillonnage rendrait le creux dépendant du nombre de points affichés.
    extremes: computeExtremes(all),
    // Couverture et origines aussi : elles décrivent la fenêtre, pas l'écran.
    coverage: averageCoverage(all),
    origins: distinctOrigins(all),
  };
}

/** Jour civil parisien d'un instant — réexporté pour les consommateurs. */
export const dayOf = parisDayKey;
