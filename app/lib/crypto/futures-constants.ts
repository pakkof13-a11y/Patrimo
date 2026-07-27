/** Vocabulaire du module Futures — exchanges, types de marge et de contrat. */

export const CRYPTO_EXCHANGES = {
  BINANCE: "Binance",
  BYBIT: "Bybit",
  OKX: "OKX",
  HYPERLIQUID: "Hyperliquid",
  DYDX: "dYdX",
  OTHER: "Autre",
} as const;

export type CryptoExchange = keyof typeof CRYPTO_EXCHANGES;

export const CRYPTO_MARGIN_TYPES = {
  USDT_M: "Marge USDT (linéaire)",
  COIN_M: "Marge en coin (inverse)",
} as const;

export type CryptoMarginType = keyof typeof CRYPTO_MARGIN_TYPES;

export const FUTURES_CONTRACT_TYPES = {
  PERPETUAL: "Perpétuel",
  QUARTERLY: "Trimestriel",
  MONTHLY: "Mensuel",
} as const;

export type FuturesContractType = keyof typeof FUTURES_CONTRACT_TYPES;

/** Exchanges dont l'import CSV de relevé de trades est reconnu. */
export const FUTURES_IMPORT_EXCHANGES = ["BINANCE", "BYBIT", "OKX"] as const;
export type FuturesImportExchange = (typeof FUTURES_IMPORT_EXCHANGES)[number];

export function exchangeLabel(value: string): string {
  return CRYPTO_EXCHANGES[value as CryptoExchange] ?? value;
}

export function marginTypeLabel(value: string): string {
  return CRYPTO_MARGIN_TYPES[value as CryptoMarginType] ?? value;
}

export function contractTypeLabel(value: string): string {
  return FUTURES_CONTRACT_TYPES[value as FuturesContractType] ?? value;
}
