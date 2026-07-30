/**
 * Catalogue d'indices de référence proposés dans le comparateur « Vs » du
 * module Évolution. Source unique partagée entre l'UI (sélecteur) et l'API
 * `/api/benchmark` (symboles Yahoo autorisés) pour rester cohérents.
 */

export type MarketIndexKey =
  | "cac40"
  | "sp500"
  | "nasdaq"
  | "eurostoxx50"
  | "msciworld"
  | "bitcoin"
  | "ethereum"
  | "eurusd"
  | "gold";

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
 * Les deux alimentent en revanche la même liste blanche côté API.
 */
export const MARKET_TICKERS: MarketIndex[] = [
  { key: "cac40", label: "CAC 40", yahoo: "^FCHI", hint: "Actions françaises" },
  { key: "sp500", label: "S&P 500", yahoo: "^GSPC", hint: "Grandes cap. US" },
  { key: "bitcoin", label: "BTC/EUR", yahoo: "BTC-EUR", hint: "Bitcoin en euro" },
  { key: "ethereum", label: "ETH/EUR", yahoo: "ETH-EUR", hint: "Ether en euro" },
  { key: "eurusd", label: "EUR/USD", yahoo: "EURUSD=X", hint: "Parité euro / dollar" },
  { key: "gold", label: "OR", yahoo: "GC=F", hint: "Once d'or (futures)" },
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
