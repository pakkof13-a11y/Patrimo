/**
 * Catalogue d'indices de référence proposés dans le comparateur « Vs » du
 * module Évolution. Source unique partagée entre l'UI (sélecteur) et l'API
 * `/api/benchmark` (symboles Yahoo autorisés) pour rester cohérents.
 */

export type MarketIndexKey =
  // Comparateur « Versus »
  | "cac40"
  | "sp500"
  | "nasdaq"
  | "eurostoxx50"
  | "msciworld"
  | "bitcoin"
  // Bandeau de marché
  | "dax"
  | "stoxx600"
  | "nasdaq100"
  | "djia"
  | "btcusd"
  | "ethusd"
  | "xauusd"
  | "xagusd"
  | "eurusd";

export type MarketIndex = {
  key: MarketIndexKey;
  label: string;
  /** Symbole Yahoo Finance (clôtures journalières). */
  yahoo: string;
  hint: string;
};

export const MARKET_INDICES: MarketIndex[] = [
  { key: "cac40", label: "CAC 40", yahoo: "^FCHI", hint: "Actions françaises" },
  { key: "sp500", label: "S&P 500", yahoo: "^GSPC", hint: "Grandes cap. US" },
  { key: "nasdaq", label: "Nasdaq", yahoo: "^IXIC", hint: "Tech US" },
  {
    key: "eurostoxx50",
    label: "Euro Stoxx 50",
    yahoo: "^STOXX50E",
    hint: "Grandes cap. zone euro",
  },
  {
    key: "msciworld",
    label: "MSCI World",
    yahoo: "URTH",
    hint: "Actions monde (proxy ETF)",
  },
  { key: "bitcoin", label: "Bitcoin", yahoo: "BTC-EUR", hint: "BTC en euro" },
];

/**
 * Bandeau marchés du terminal — catalogue distinct de `MARKET_INDICES`.
 *
 * Les deux listes servent des rôles différents et ne doivent pas fusionner :
 * `MARKET_INDICES` peuple le sélecteur « Versus » du graphique d'évolution
 * (seules des références auxquelles comparer un portefeuille y ont un sens),
 * tandis que celle-ci est un fil d'actualité de marché — une parité EUR/USD
 * s'y lit très bien mais ne serait pas un benchmark patrimonial recevable.
 *
 * L'ordre est celui du défilement : les places européennes, puis les
 * américaines, puis le hors-séance permanent (crypto, métaux, change). Il suit
 * la journée d'un investisseur français, et regroupe les instruments qui
 * ferment ensemble — un bandeau où « fermé » alterne avec des cours vivants se
 * lit plus mal qu'un bandeau où les états se suivent.
 *
 * Les deux alimentent en revanche la même liste blanche côté API.
 */
export const MARKET_TICKERS: MarketIndex[] = [
  { key: "cac40", label: "CAC 40", yahoo: "^FCHI", hint: "Actions françaises" },
  { key: "dax", label: "DAX", yahoo: "^GDAXI", hint: "Actions allemandes" },
  {
    key: "stoxx600",
    label: "STOXX 600",
    yahoo: "^STOXX",
    hint: "Grandes cap. européennes",
  },
  { key: "sp500", label: "S&P 500", yahoo: "^GSPC", hint: "Grandes cap. US" },
  { key: "nasdaq100", label: "NASDAQ 100", yahoo: "^NDX", hint: "Tech US" },
  { key: "djia", label: "DOW JONES", yahoo: "^DJI", hint: "Industrielles US" },
  { key: "btcusd", label: "BTC/USD", yahoo: "BTC-USD", hint: "Bitcoin en dollar" },
  { key: "ethusd", label: "ETH/USD", yahoo: "ETH-USD", hint: "Ether en dollar" },
  { key: "xauusd", label: "XAU/USD", yahoo: "XAUUSD=X", hint: "Once d'or" },
  { key: "xagusd", label: "XAG/USD", yahoo: "XAGUSD=X", hint: "Once d'argent" },
  {
    key: "eurusd",
    label: "EUR/USD",
    yahoo: "EURUSD=X",
    hint: "Parité euro / dollar",
  },
];

const BY_KEY = new Map(
  [...MARKET_INDICES, ...MARKET_TICKERS].map((i) => [i.key, i])
);

/**
 * Vrai uniquement pour les clés proposées dans le sélecteur « Versus ».
 *
 * Volontairement plus strict que `BY_KEY` : une préférence persistée pointant
 * sur un symbole réservé au bandeau (EUR/USD…) laisserait le `<select>` sans
 * option correspondante, donc sans valeur affichée.
 */
const SELECTABLE = new Set(MARKET_INDICES.map((i) => i.key));

export function isMarketIndexKey(v: unknown): v is MarketIndexKey {
  return typeof v === "string" && SELECTABLE.has(v as MarketIndexKey);
}

export function marketIndexByKey(key: string): MarketIndex | undefined {
  return BY_KEY.get(key as MarketIndexKey);
}

export function marketIndexLabel(key: string): string {
  return BY_KEY.get(key as MarketIndexKey)?.label ?? "Indice";
}

/**
 * Liste blanche {key → symbole Yahoo} de l'API `/api/benchmark`.
 * Union des deux catalogues : tout ce que l'UI peut demander, et rien de plus.
 */
export const MARKET_INDEX_SYMBOLS: Record<string, string> = Object.fromEntries(
  [...MARKET_INDICES, ...MARKET_TICKERS].map((i) => [i.key, i.yahoo])
);
