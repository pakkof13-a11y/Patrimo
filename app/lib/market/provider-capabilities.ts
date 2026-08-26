/**
 * Ce que chaque fournisseur sait réellement faire.
 *
 * ## Pourquoi le déclarer
 *
 * Savoir rendre un prix courant ne dit rien de la capacité à rendre une barre
 * de 14 h 35 il y a dix-huit mois. Sans déclaration explicite, un appelant
 * finit par demander de l'intra-journalier à un fournisseur qui n'en a pas, et
 * interprète le silence comme une absence de données plutôt que comme une
 * absence de capacité — deux choses très différentes quand on cherche à savoir
 * si l'histoire d'un actif est reconstructible.
 *
 * ## Ce tableau décrit le code, pas la documentation des fournisseurs
 *
 * Chaque ligne a été relevée dans `price-history.ts` et `registry.ts` :
 * seuls Yahoo et CoinGecko y servent des barres historiques. Finnhub et
 * Binance n'y sont appelés que pour le cours courant, quoi que leurs API
 * publiques permettent par ailleurs — déclarer une capacité que le dépôt
 * n'exploite pas serait un faux support.
 */

import type { PriceBarInterval } from "./price-history-types";

export type HistoryGranularity = "none" | "daily" | "intraday";

export type ProviderCapabilities = {
  id: string;
  /** Sait rendre le dernier cours connu. */
  currentPrice: boolean;
  /** Profondeur historique réellement exploitée par le dépôt. */
  history: HistoryGranularity;
  /**
   * Intervalles que le fournisseur honore tels quels.
   *
   * Vide quand il impose sa propre finesse : demander « 15 minutes » n'y a
   * alors aucun effet, et prétendre le contraire produirait des barres dont la
   * granularité annoncée serait fausse.
   */
  honouredIntervals: PriceBarInterval[];
  /** Limitations connues, constatées dans le code ou par les fournisseurs. */
  limitations: string[];
};

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  yahoo: {
    id: "yahoo",
    currentPrice: true,
    history: "intraday",
    // `yahooIntervalFor` traduit 4h en 1h puis agrège : 4h n'est donc pas
    // honoré nativement, il est reconstruit.
    honouredIntervals: ["15m", "1h", "1d", "1wk"],
    limitations: [
      "Fenêtre intraday bornée par le fournisseur : ~2 jours en 15m, ~10 jours en 1h (INTERVAL_WINDOW_DAYS).",
      "4h n'existe pas nativement — agrégé depuis 1h.",
      "Pas de contrat d'API publique : disponibilité non garantie.",
    ],
  },
  coingecko: {
    id: "coingecko",
    currentPrice: true,
    history: "intraday",
    /*
      Aucun intervalle honoré : `/coins/{id}/ohlc` choisit sa propre finesse
      selon le paramètre `days`, et le code ramène 15m/1h/4h à « 1h ». Demander
      une granularité n'a donc pas d'effet — c'est le fournisseur qui décide.
    */
    honouredIntervals: [],
    limitations: [
      "La granularité est imposée par le fournisseur via `days` ; la demande est ignorée.",
      "Résolution effective repliée sur 1h pour toute demande intra-journalière.",
      "Quotas serrés sur l'offre gratuite — appels lissés (COINGECKO_PACE_MS) et lotis.",
      "Nécessite un mapping vers un identifiant CoinGecko : pas de résolution par ticker seul.",
    ],
  },
  finnhub: {
    id: "finnhub",
    currentPrice: true,
    // Le dépôt n'appelle Finnhub que pour le cours courant.
    history: "none",
    honouredIntervals: [],
    limitations: [
      "Aucun historique exploité par le dépôt — seul `fetchPrice` est branché.",
      "60 appels/minute sur l'offre gratuite (FINNHUB_REST_LIMIT_PER_MINUTE = 55).",
      "Requiert une clé API.",
    ],
  },
  binance: {
    id: "binance",
    currentPrice: true,
    history: "none",
    honouredIntervals: [],
    limitations: [
      "Branché en temps réel seulement ; aucun historique n'en est tiré.",
      "Couvre les seuls tickers listés (isBinanceSupported).",
    ],
  },
  manual: {
    id: "manual",
    currentPrice: true,
    history: "none",
    honouredIntervals: [],
    limitations: [
      "Valeur saisie : aucune histoire, d'où l'origine STATIC côté résolution.",
    ],
  },
};

/** Un fournisseur peut-il servir de l'historique à cette finesse ? */
export function canServeHistory(
  providerId: string,
  granularity: HistoryGranularity
): boolean {
  const c = PROVIDER_CAPABILITIES[providerId.toLowerCase()];
  if (!c) return false;
  if (granularity === "none") return true;
  if (granularity === "daily") return c.history !== "none";
  return c.history === "intraday";
}

/**
 * L'intervalle demandé sera-t-il réellement respecté ?
 *
 * Sert à ne pas annoncer « barres de 15 minutes » quand le fournisseur rendra
 * ce qu'il veut. Un appelant honnête interroge ceci avant de qualifier ses
 * données.
 */
export function honoursInterval(
  providerId: string,
  interval: PriceBarInterval
): boolean {
  const c = PROVIDER_CAPABILITIES[providerId.toLowerCase()];
  return c ? c.honouredIntervals.includes(interval) : false;
}
