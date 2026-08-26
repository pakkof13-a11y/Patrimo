/**
 * Accès unique aux données de marché historiques.
 *
 * ## Pourquoi cette couche existe
 *
 * Le moteur de valorisation ne doit pas savoir d'où vient un cours. Il posait
 * jusqu'ici deux questions distinctes à deux caches distincts — les barres
 * intra-séance d'un côté, les clôtures quotidiennes de l'autre — avec un
 * résolveur par échelle. Deux chemins, deux politiques de report, deux façons
 * d'annoncer un statut : la divergence était une question de temps.
 *
 * Ce dépôt les réunit derrière une seule question :
 *
 * > quelle est la meilleure valeur historiquement disponible pour cet actif à
 * > cet instant, et d'où vient-elle ?
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'appelle aucun fournisseur. La collecte est un travail planifié
 * (`/api/cron/collect-intraday`, `fillDailyCloses`) : une lecture ne doit pas
 * dépendre du réseau, règle établie sur les passifs puis sur la collecte
 * intraday. Ce qui manque au cache manque à la réponse, et c'est dit.
 *
 * ## Ordre de résolution
 *
 * 1. barre intra-séance couvrant l'instant → `MARKET_EXACT` ;
 * 2. barre antérieure sous la borne de report → `MARKET_CARRIED` ;
 * 3. clôture du jour ou d'un jour antérieur → `DAILY_EXACT` ;
 * 4. valeur constatée à une date → `VALUATION_EVENT` ;
 * 5. prix manuel sans historique → `STATIC` ;
 * 6. rien → `UNAVAILABLE`.
 *
 * L'ordre suit la finesse, pas la fraîcheur : une clôture du jour même est
 * préférée à une barre horaire vieille de trois jours, parce qu'elle décrit
 * mieux la journée demandée.
 */

import { parisDayKey } from "../dates/paris";
import type {
  PriceResolution,
  PriceResolver,
} from "../portfolio/historical/price-resolver";
import type { DailyCloseIndex } from "../portfolio/class-history";
import {
  barAtOrBefore,
  MAX_CARRY_FORWARD_MS,
  type IntradayBarIndex,
} from "../portfolio/intraday/bar-index";

/**
 * Valeur constatée à une date, pour un actif sans marché continu.
 *
 * Généralise ce que `TangibleValuation` et `PrivateEquityValuation` portent
 * déjà — `valuedAt` + une valeur — sans créer de table de plus : les familles
 * qui ont leur propre historique le gardent, et celles qui n'en ont pas
 * peuvent s'y rattacher.
 */
export type ValuationEvent = { at: number; valueEur: number };

/** Tout ce qu'un actif offre comme trace temporelle. */
export type AssetTimeSeries = {
  /** Barres intra-séance, triées. */
  intraday?: IntradayBarIndex;
  /** Clôtures quotidiennes, par actif puis par jour. */
  daily?: DailyCloseIndex;
  /** Valeurs constatées, triées par date, par actif. */
  valuationEvents?: Map<string, ValuationEvent[]>;
  /** Prix saisi à la main, sans historique — dernier recours avant l'absence. */
  staticPrices?: Map<string, number>;
};

export type ResolverOptions = {
  /** Durée d'une barre : au-delà, une barre ne « couvre » plus l'instant. */
  intervalMs: number;
  /** Borne de report d'une observation antérieure. */
  maxCarryMs?: number;
};

/** Dernière clôture connue à ou avant un jour, en parcourant l'index trié. */
function closeAtOrBeforeDay(
  closes: Map<string, number> | undefined,
  day: string
): { priceEur: number; day: string } | null {
  if (!closes || closes.size === 0) return null;
  const exact = closes.get(day);
  if (exact != null && Number.isFinite(exact)) return { priceEur: exact, day };
  let best: number | null = null;
  let bestDay = "";
  for (const [k, v] of closes) {
    if (k <= day && k > bestDay && Number.isFinite(v)) {
      best = v;
      bestDay = k;
    }
  }
  return best == null ? null : { priceEur: best, day: bestDay };
}

/** Dernier événement de valorisation à ou avant un instant. */
function eventAtOrBefore(
  events: ValuationEvent[] | undefined,
  at: number
): ValuationEvent | null {
  if (!events || events.length === 0) return null;
  let lo = 0;
  let hi = events.length - 1;
  let found: ValuationEvent | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = events[mid]!;
    if (e.at <= at) {
      found = e;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Construit le résolveur d'un instant donné, à partir des séries préchargées.
 *
 * Toutes les sources sont déjà en mémoire : la résolution ne touche ni la base
 * ni le réseau. C'est ce qui permet de valoriser des centaines de points sans
 * que le coût dépende du nombre de points.
 */
export function resolverAt(
  series: AssetTimeSeries,
  at: Date,
  opts: ResolverOptions
): PriceResolver {
  const ms = at.getTime();
  const day = parisDayKey(at);
  const maxCarryMs = opts.maxCarryMs ?? MAX_CARRY_FORWARD_MS;

  return (assetId: string): PriceResolution | null => {
    // 1 & 2 — marché intra-séance.
    const bar = barAtOrBefore(series.intraday?.get(assetId), ms);
    if (bar) {
      const age = ms - bar.at;
      if (age < opts.intervalMs) {
        return {
          priceEur: bar.priceEur,
          origin: "MARKET_EXACT",
          appliesAt: new Date(bar.at),
        };
      }
      /*
        Une barre ancienne ne l'emporte pas sur une clôture du jour : elle est
        plus fine, mais elle décrit un autre moment. On ne la retient donc que
        si aucune clôture ne couvre la journée demandée.
      */
      const close = closeAtOrBeforeDay(series.daily?.get(assetId), day);
      if (!close && age <= maxCarryMs) {
        return {
          priceEur: bar.priceEur,
          origin: "MARKET_CARRIED",
          appliesAt: new Date(bar.at),
        };
      }
      if (close) {
        return {
          priceEur: close.priceEur,
          origin: "DAILY_EXACT",
          appliesAt: new Date(`${close.day}T00:00:00Z`),
        };
      }
    }

    // 3 — clôture quotidienne.
    const close = closeAtOrBeforeDay(series.daily?.get(assetId), day);
    if (close) {
      return {
        priceEur: close.priceEur,
        origin: "DAILY_EXACT",
        appliesAt: new Date(`${close.day}T00:00:00Z`),
      };
    }

    // 4 — valeur constatée.
    const event = eventAtOrBefore(series.valuationEvents?.get(assetId), ms);
    if (event) {
      return {
        priceEur: event.valueEur,
        origin: "VALUATION_EVENT",
        appliesAt: new Date(event.at),
      };
    }

    // 5 — prix saisi, sans histoire.
    const manual = series.staticPrices?.get(assetId);
    if (manual != null && Number.isFinite(manual) && manual > 0) {
      /*
        Aucun `appliesAt` : ce prix ne se rattache à aucun instant. Le dater
        laisserait croire à une observation, alors qu'il ne dit rien de plus
        que « la valeur saisie, faute de mieux ».
      */
      return { priceEur: manual, origin: "STATIC" };
    }

    // 6 — rien d'exploitable. On ne fabrique pas.
    return null;
  };
}

/**
 * Part du patrimoine réellement valorisée, par origine.
 *
 * Sert à énoncer « historique partiellement disponible » plutôt qu'à laisser
 * croire à une courbe complète. Le dénominateur est la valeur totale, y compris
 * ce qui n'a pas pu être valorisé.
 */
export function coverageRatio(
  valueByOrigin: Map<string, { toNumber(): number }>,
  unavailableEur: number
): number {
  let total = 0;
  let valued = 0;
  for (const [origin, v] of valueByOrigin) {
    const n = Math.abs(v.toNumber());
    total += n;
    if (origin !== "UNAVAILABLE") valued += n;
  }
  total = total || Math.abs(unavailableEur);
  if (total <= 0) return 1;
  return valued / total;
}
