/**
 * Index en mémoire des barres intra-séance, et politique de report.
 *
 * ## Le problème que résout cet index
 *
 * Valoriser une fenêtre de 7 jours en pas horaire, c'est ~168 instants × N
 * actifs résolutions de prix. Une requête par actif et par instant serait
 * quadratique et interdirait la lecture. Les barres sont donc chargées **en une
 * requête**, rangées par actif en tableaux triés, et cherchées par dichotomie.
 *
 * ## La politique de report — la décision de ce module
 *
 * Une collecte horaire laisse des trous : marché fermé, fournisseur muet,
 * ordonnanceur en panne. Trois réponses possibles à « que valait cet actif à
 * 12 h ? », et une seule est interdite.
 *
 * | Situation | Réponse | Statut |
 * |---|---|---|
 * | barre à 12 h | son cours | `observed` |
 * | barre à 11 h, rien à 12 h | le cours de 11 h | **reporté** → estimé |
 * | dernière barre à plus de `maxCarryMs` | rien | le moteur retient le coût |
 * | aucune barre avant t | rien | idem |
 *
 * Inventer `12 h = 100` parce que 11 h valait 100 **et** 13 h vaut 99 est exclu :
 * ce serait une interpolation, c'est-à-dire un cours qui n'a jamais été coté.
 * Le report, lui, rend une valeur qui a réellement existé — à un autre instant,
 * et c'est pourquoi il dégrade le statut.
 *
 * ## Pourquoi une borne, et pourquoi 96 heures
 *
 * Sans borne, un actif dont la collecte s'est arrêtée il y a six mois
 * continuerait de peser son dernier cours connu, indéfiniment, et la courbe
 * afficherait une ligne parfaitement plate qu'aucune donnée ne soutient.
 *
 * 96 heures couvrent un week-end prolongé : une action cotée le vendredi à
 * 17 h reste valorisée à ce cours jusqu'au mardi matin — le marché était fermé,
 * son prix n'a effectivement pas bougé. Au-delà, l'absence cesse d'être une
 * fermeture de marché et devient une panne : la position retombe alors à son
 * prix de revient, exactement comme le moteur quotidien traite un actif sans
 * cours connu.
 *
 * Faute de calendrier boursier dans le dépôt, on ne sait pas distinguer « marché
 * fermé » de « fournisseur muet ». La borne est donc la seule règle honnête
 * disponible, et tout report est annoncé estimé — y compris un week-end, où la
 * valeur est pourtant juste. Mieux vaut un statut trop prudent qu'un `EXACT`
 * trompeur.
 */

import { prisma } from "../../prisma";
import type { PriceResolution, PriceResolver } from "../historical/price-resolver";

/** Durée maximale d'un report, en millisecondes. Voir l'en-tête du module. */
export const MAX_CARRY_FORWARD_MS = 96 * 60 * 60 * 1000;

export type IntradayBar = { at: number; priceEur: number };

/** Barres d'un actif, triées par instant croissant. */
export type IntradayBarIndex = Map<string, IntradayBar[]>;

/**
 * Charge les barres d'une fenêtre en une seule requête.
 *
 * La fenêtre est élargie de `MAX_CARRY_FORWARD_MS` vers le passé : sans cela,
 * le premier instant de la série n'aurait jamais de cours à reporter et
 * démarrerait au prix de revient — une marche à l'ouverture de la fenêtre qui
 * ne correspondrait à aucun mouvement.
 */
export async function loadIntradayBars(opts: {
  userId: string;
  from: Date;
  to: Date;
  interval: string;
}): Promise<IntradayBarIndex> {
  const rows = await prisma.assetIntradayBar.findMany({
    where: {
      interval: opts.interval,
      asset: { is: { userId: opts.userId } },
      barStart: {
        gte: new Date(opts.from.getTime() - MAX_CARRY_FORWARD_MS),
        lte: opts.to,
      },
    },
    select: { assetId: true, barStart: true, closeEur: true },
    orderBy: { barStart: "asc" },
  });

  const index: IntradayBarIndex = new Map();
  for (const r of rows) {
    const price = Number(r.closeEur.toString());
    if (!Number.isFinite(price) || price <= 0) continue;
    const list = index.get(r.assetId);
    const bar: IntradayBar = { at: r.barStart.getTime(), priceEur: price };
    if (list) list.push(bar);
    else index.set(r.assetId, [bar]);
  }
  return index;
}

/**
 * Dernière barre à ou avant `at`, par dichotomie.
 *
 * Les tableaux sont triés à la construction ; une recherche linéaire coûterait
 * O(barres) par instant et par actif, soit le coût que cet index existe
 * précisément pour éviter.
 */
export function barAtOrBefore(
  bars: IntradayBar[] | undefined,
  at: number
): IntradayBar | null {
  if (!bars || bars.length === 0) return null;
  let lo = 0;
  let hi = bars.length - 1;
  let found: IntradayBar | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bar = bars[mid]!;
    if (bar.at <= at) {
      found = bar;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Résolveur de prix pour un instant donné.
 *
 * `intervalMs` sert à décider ce qu'est une observation : une barre est
 * observée à `t` si elle **couvre** `t`, c'est-à-dire si `t` tombe dans son
 * intervalle. Au-delà, c'est un report.
 */
export function intradayPriceResolver(
  index: IntradayBarIndex,
  at: number,
  intervalMs: number,
  maxCarryMs: number = MAX_CARRY_FORWARD_MS
): PriceResolver {
  return (assetId: string): PriceResolution | null => {
    const bar = barAtOrBefore(index.get(assetId), at);
    if (!bar) return null;
    const age = at - bar.at;
    if (age > maxCarryMs) return null;
    return {
      priceEur: bar.priceEur,
      origin: age < intervalMs ? "MARKET_EXACT" : "MARKET_CARRIED",
      appliesAt: new Date(bar.at),
    };
  };
}

/** Instant de la première barre connue, tous actifs confondus. */
export function firstObservationAt(index: IntradayBarIndex): number | null {
  let first: number | null = null;
  for (const bars of index.values()) {
    const at = bars[0]?.at;
    if (at != null && (first == null || at < first)) first = at;
  }
  return first;
}
