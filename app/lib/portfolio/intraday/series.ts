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
 * À la première barre réellement collectée, jamais avant. Le passé n'a pas
 * d'intra-journalier et ne doit pas en recevoir : le fabriquer à partir des
 * clôtures quotidiennes serait exactement l'invention que ce chantier
 * s'interdit. Une fenêtre antérieure à toute collecte rend donc une série vide,
 * et c'est une réponse — pas un échec.
 */

import { parisDayKey } from "../../dates/paris";
import { loadHistoricalInputs } from "../historical/load";
import { PortfolioValuationEngine } from "../historical/engine";
import type {
  HistoricalDataStatus,
  PortfolioValuationPoint,
} from "../historical/types";
import {
  firstObservationAt,
  intradayPriceResolver,
  loadIntradayBars,
  MAX_CARRY_FORWARD_MS,
  type IntradayBarIndex,
} from "./bar-index";

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
  /** Instant de la première observation disponible, ou null si aucune. */
  observedFrom: string | null;
  points: IntradayPoint[];
  extremes: IntradayExtremes | null;
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
});

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
  const stepMs = opts.stepMs ?? INTRADAY_STEP_MS;
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
  const empty: IntradaySeries = {
    interval: INTRADAY_INTERVAL,
    stepMs,
    observedFrom: observed == null ? null : new Date(observed).toISOString(),
    points: [],
    extremes: null,
  };
  if (observed == null) return empty;

  /*
    La série ne commence pas avant la première observation.

    Valoriser 10 h alors que la première barre est à 14 h reviendrait à
    reporter un cours *futur* vers le passé, ou à retenir les positions à leur
    prix de revient et à afficher une marche à 14 h qu'aucun mouvement n'a
    produite.
  */
  const start = new Date(Math.max(opts.from.getTime(), observed));
  if (start.getTime() > opts.to.getTime()) return empty;

  const instants = enumerateInstants(start, opts.to, stepMs);
  if (instants.length === 0) return empty;

  const raw = engine.buildInstantSeries(instants, (at) =>
    intradayPriceResolver(bars, at.getTime(), stepMs, MAX_CARRY_FORWARD_MS)
  );

  const all = raw.map(toPoint);
  const points = opts.maxPoints ? downsampleIntraday(all, opts.maxPoints) : all;

  return {
    interval: INTRADAY_INTERVAL,
    stepMs,
    observedFrom: new Date(observed).toISOString(),
    points,
    // Les extrêmes sont mesurés sur la série **complète** : les calculer après
    // échantillonnage rendrait le creux dépendant du nombre de points affichés.
    extremes: computeExtremes(all),
  };
}

/** Jour civil parisien d'un instant — réexporté pour les consommateurs. */
export const dayOf = parisDayKey;
