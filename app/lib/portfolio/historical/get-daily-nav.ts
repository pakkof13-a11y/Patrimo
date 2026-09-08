/**
 * T-05 — `getDailyNav({ scope, from, to })`.
 *
 * Une série dont le **pas dépend de l'étendue servie** : un point par jour
 * civil Paris jusqu'à ~1 an, un point par semaine civile (dimanche) au-delà.
 * La règle est unique et vit dans `history-window.ts`, à côté du cap de
 * profondeur ; `DailyNavResult.step` et `DailyNavPoint.intervalType` la
 * publient pour que personne n'ait à la rejouer.
 *
 * Sur une série hebdomadaire, les **flux sont sommés sur l'intervalle** entre
 * deux points émis (cf. `engine.buildSeries`) : sans cela, un apport du
 * mercredi tomberait dans la barre « Performance » du dimanche suivant. Le
 * journal, lui, reste rejoué jour par jour. Le dernier point est le dernier
 * dimanche ≤ `to` : la semaine en cours, elle, n'est jamais servie
 * (`seriesEmissionDays`).
 *
 * Aucun lissage : rien n'est interpolé entre deux points, une semaine sans
 * observation n'est pas une semaine à zéro. Les scopes lisent le contrat T-01
 * (`computePatrimonyMetrics`) via les champs que le moteur publie déjà à
 * chaque date — aucune seconde formule.
 *
 * Lecture pure : le cache `AssetDailyClose` n'est pas complété ici. T-04
 * (cron / POST utilisateur) alimente les clôtures ; sans elles, une position
 * cotée reste au coût et le point se déclare estimé. Jamais de padding à 0.
 *
 * Vague2 D4 : `asOfDay` est le jour du dernier point — hero, KPI et
 * watchlist s'y calent. Vague2 D11 : `fetchedAt` est la plus ancienne
 * collecte de ces clôtures, pour un badge « cours daté » si > 24 h.
 */

import { parisDayKey } from "../../dates/paris";
import { oldestFetchedAt } from "../../market/last-close-as-of";
/*
  Ré-export seul : `parseDayKey` n'est pas utilisé dans ce fichier, il y
  transite pour les appelants qui lisent la fenêtre par ici (la route
  daily-nav). L'import jumeau qui l'accompagnait était mort.
*/
export { parseDayKey } from "./day-key";
import {
  PATRIMONY_ASSET_POCKETS,
  type PatrimonyAssetPocket,
} from "../patrimony-metrics";
import {
  historyStepForWindow,
  lastCloseDay,
  type HistoryStep,
} from "./history-window";
import { loadHistoricalInputs } from "./load";
import { PortfolioValuationEngine } from "./engine";
import type { PriceOrigin } from "./price-resolver";
import type {
  DayKey,
  EnvelopeCapableClass,
  HistoricalDataStatus,
  PortfolioValuationPoint,
  ValuationAssetClass,
  ValuationEnvelope,
} from "./types";

export const DAILY_NAV_SCOPES = [
  "financier",
  "brut",
  "net",
  ...PATRIMONY_ASSET_POCKETS,
] as const;

export type DailyNavScope = (typeof DAILY_NAV_SCOPES)[number];

const SCOPE_SET = new Set<string>(DAILY_NAV_SCOPES);

export function isDailyNavScope(value: string): value is DailyNavScope {
  return SCOPE_SET.has(value);
}

export type DailyNavPoint = {
  day: DayKey;
  /**
   * Durée que le point couvre — `"day"` ou `"week"`.
   *
   * Même information que `EvolutionSeriesPoint.intervalType`, et pour la même
   * raison : l'appelant ne doit pas avoir à deviner le pas de l'écart entre
   * deux dates, qui est de toute façon irrégulier (le premier et le dernier
   * intervalle d'une série hebdomadaire sont plus courts que sept jours).
   *
   * Sur un point hebdomadaire, `externalFlows` / `transactionFlow` /
   * `financierFlows` / `flowsByAssetClass` sont la **somme de l'intervalle**
   * qui sépare ce point du précédent ; `nav` et les ventilations restent des
   * stocks à la date du point.
   */
  intervalType: HistoryStep;
  nav: number;
  status: HistoricalDataStatus;
  /** Capital externe du jour (apports / retraits / achats hors cash explicite). */
  externalFlows: number;
  /**
   * Flux du journal sur les cotés (ACTIONS + OBLIGATIONS + CRYPTO).
   *
   * Les pastilles de la courbe lisent **ce** champ, pas `externalFlows` :
   * un achat immobilier est un flux externe (Marché/Flux) sans pastille
   * sur la courbe Financier.
   */
  transactionFlow: number;
  /**
   * Flux qui touchent l'agrégat Financier (listed + cash).
   *
   * Marché/Flux du hero Financier les somme ; un achat immo n'y figure pas.
   */
  financierFlows: number;
  listed: number;
  financier: number;
  brut: number;
  net: number;
  cash: number;
  immobilier: number;
  av: number;
  alternatifs: number;
  employeeSavings: number;
  passifs: number;
  /** Origines de prix du jour — `MARKET_CARRIED` → pastille creuse. */
  priceOrigins: PriceOrigin[];
  realizedPnl: number;
  ledgerCashIncome: number;
  /** `marketValue − costBasis` des positions journal, même formule que l'historique. */
  unrealizedPnl: number;
  /**
   * Croisement classe × enveloppe — même objet que le moteur.
   *
   * Sans ce champ, le hero / l'évolution branchés sur `getDailyNav` ne
   * peuvent pas dire qu'une part des titres est `UNKNOWN` avant le premier
   * constat. L'avertissement PEA/CTO disparaissait alors que l'API
   * `/api/portfolio` le publiait encore.
   */
  byAssetClassAndEnvelope: Record<
    EnvelopeCapableClass,
    Record<ValuationEnvelope, number | null>
  >;
  /**
   * Ventilation T-01 par classe — lecture du moteur, pas un recalcul.
   *
   * Les filtres Actions / Immo / Cash du panneau Évolution lisent **ce**
   * champ. Sans lui, la série dense ne portait que les poches, et
   * `scopeHistory` retirait tous les points faute de `byAssetClassBase`.
   */
  byAssetClass: Record<ValuationAssetClass, number>;
  /** Flux du jour par classe — même objet que le moteur. */
  flowsByAssetClass: Record<ValuationAssetClass, number>;
};

/** Journal coté du jour — pastilles, pas l'attribution Marché/Flux. */
export function listedTransactionFlow(
  flows: Record<ValuationAssetClass, number>
): number {
  return (flows.ACTIONS ?? 0) + (flows.OBLIGATIONS ?? 0) + (flows.CRYPTO ?? 0);
}

/** Flux qui expliquent ΔFinancier (hors immo / alt / ES). */
export function financierFlowOf(
  flows: Record<ValuationAssetClass, number>
): number {
  return listedTransactionFlow(flows) + (flows.CASH ?? 0);
}

/** P&L latent du journal — lecture des champs moteur, pas une seconde formule. */
export function unrealizedPnlOf(p: PortfolioValuationPoint): number {
  return (
    p.securities +
    p.crypto +
    p.realEstate +
    p.lifeInsurance +
    p.otherAssets -
    p.positionsCostBasis
  );
}

export type DailyNavResult = {
  scope: DailyNavScope;
  from: DayKey;
  to: DayKey;
  /**
   * Pas de la série servie — `"day"` ou `"week"` (`history-window.ts`).
   *
   * Décidé sur la fenêtre servie, jamais recopié par l'appelant : le client le
   * relit ici plutôt que de rejouer la règle sur la période qu'il a demandée.
   */
  step: HistoryStep;
  /** Un point par jour civil, ou par semaine civile si `step === "week"`. */
  points: DailyNavPoint[];
  /**
   * Jour du dernier point — ancre hero / KPI / watchlist (Vague2 D4).
   *
   * `null` si la série est vide : rien à dater.
   */
  asOfDay: DayKey | null;
  /**
   * Plus ancienne collecte des dernières clôtures (Vague2 D11).
   *
   * Le front affiche un badge « cours daté » si cet instant a plus de 24 h.
   * `null` si aucune clôture n'a jamais été collectée.
   */
  fetchedAt: string | null;
};

/**
 * Valeur du scope à une date — lecture du contrat T-01, pas un recalcul.
 *
 * `financier` / `listed` / `brut` / `net` / poches viennent de
 * `computePatrimonyMetrics` au même instant.
 */
export function navAtScope(
  p: PortfolioValuationPoint,
  scope: DailyNavScope
): number {
  switch (scope) {
    case "financier":
      return p.financier;
    case "brut":
      return p.brut;
    case "net":
      return p.net;
    default: {
      const pocket: PatrimonyAssetPocket = scope;
      return p.pockets[pocket];
    }
  }
}

export function dailyNavFromSeries(
  series: PortfolioValuationPoint[],
  scope: DailyNavScope,
  step: HistoryStep = "day"
): DailyNavPoint[] {
  return series.map((p) => ({
    day: p.day,
    intervalType: step,
    nav: navAtScope(p, scope),
    status: p.status,
    externalFlows: p.externalFlows,
    transactionFlow: listedTransactionFlow(p.flowsByAssetClass),
    financierFlows: financierFlowOf(p.flowsByAssetClass),
    listed: p.listed,
    financier: p.financier,
    brut: p.brut,
    net: p.net,
    cash: p.pockets.cash,
    immobilier: p.pockets.immobilier,
    av: p.pockets.av,
    alternatifs: p.pockets.alternatifs,
    employeeSavings: p.pockets.employeeSavings,
    passifs: p.pockets.passifs,
    priceOrigins: p.priceOrigins,
    realizedPnl: p.realizedPnl,
    ledgerCashIncome: p.ledgerCashIncome,
    unrealizedPnl: unrealizedPnlOf(p),
    byAssetClassAndEnvelope: p.byAssetClassAndEnvelope,
    byAssetClass: p.byAssetClass,
    flowsByAssetClass: p.flowsByAssetClass,
  }));
}

/**
 * Fenêtre par défaut quand l'appelant omet `from`/`to` — un an, jusqu'à la
 * dernière clôture.
 *
 * `to` était `parisDayKey(now)` : la documentation de la route dit pourtant
 * que la journée en cours n'est jamais servie (`lastCloseDay`, D22 P0). Le
 * tableau de bord ne voyait pas l'écart, il passe toujours `lastCloseDay()`
 * explicitement — mais un appelant qui s'en tient à la valeur par défaut
 * documentée recevait un dernier point mêlant une journée inachevée aux
 * journées closes qui le précèdent, et `asOfDay` valait aujourd'hui.
 */
export function defaultDailyNavWindow(now = new Date()): {
  from: DayKey;
  to: DayKey;
} {
  const to = lastCloseDay(now);
  const from = parisDayKey(new Date(now.getTime() - 365 * 86_400_000));
  return { from, to };
}

/** Pocket scopes already sketched by PatrimonyMetrics (hors passifs). */
export type DailyNavPocketScope = PatrimonyAssetPocket;

export async function getDailyNav(opts: {
  userId: string;
  scope: DailyNavScope;
  from: DayKey;
  to: DayKey;
  /** Référence du cap `MAX_HISTORY_YEARS` — tests seulement, jamais fourni en production. */
  now?: Date;
}): Promise<DailyNavResult> {
  const requestedFrom = opts.from <= opts.to ? opts.from : opts.to;
  const to = opts.from <= opts.to ? opts.to : opts.from;
  const now = opts.now ?? new Date();

  const inputs = await loadHistoricalInputs(opts.userId);
  const engine = new PortfolioValuationEngine(inputs);

  /*
    La borne « Tout » est celle du **scope demandé**, pas du patrimoine
    entier : Financier ne remonte pas à 1998 sous prétexte que Brut le fait.
    Une demande antérieure à cette borne est ramenée à elle — jamais servie
    telle quelle, et jamais fabriquée en une série plate qui n'existerait que
    par la compression aval (cf. `daily-nav-compress.ts`).

    Un scope sans aucune donnée observée (`null`), ou dont la borne tombe
    après `to`, ne produit aucun point : une série fantôme serait pire qu'une
    réponse vide.
  */
  const scopeEarliest = engine.earliestDayForScope(opts.scope, now);
  if (scopeEarliest == null || scopeEarliest > to) {
    return {
      scope: opts.scope,
      from: requestedFrom,
      to,
      step: "day",
      points: [],
      asOfDay: null,
      fetchedAt: null,
    };
  }
  const from = requestedFrom < scopeEarliest ? scopeEarliest : requestedFrom;

  /*
    Le pas se décide sur la fenêtre **servie**, pas sur celle qui a été
    demandée : « Tout » sur un scope né il y a trois mois est une fenêtre
    courte, et rien ne justifierait de la servir à la semaine. La règle vit
    dans `history-window.ts`, avec le cap de profondeur — un seul endroit
    décide « depuis quand » et « tous les combien ».
  */
  const step = historyStepForWindow(from, to);
  const series = engine.buildSeries(from, to, step);
  const points = dailyNavFromSeries(series, opts.scope, step);
  const last = points[points.length - 1];

  return {
    scope: opts.scope,
    from,
    to,
    step,
    points,
    asOfDay: last?.day ?? null,
    fetchedAt: oldestFetchedAt(inputs.lastCloseAsOf?.values()),
  };
}
