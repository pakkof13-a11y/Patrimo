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
  | "bitcoin";

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

const BY_KEY = new Map(MARKET_INDICES.map((i) => [i.key, i]));

export function isMarketIndexKey(v: unknown): v is MarketIndexKey {
  return typeof v === "string" && BY_KEY.has(v as MarketIndexKey);
}

export function marketIndexByKey(key: string): MarketIndex | undefined {
  return BY_KEY.get(key as MarketIndexKey);
}

export function marketIndexLabel(key: string): string {
  return BY_KEY.get(key as MarketIndexKey)?.label ?? "Indice";
}

/** Table {key → symbole Yahoo} pour l'API benchmark. */
export const MARKET_INDEX_SYMBOLS: Record<string, string> = Object.fromEntries(
  MARKET_INDICES.map((i) => [i.key, i.yahoo])
);
