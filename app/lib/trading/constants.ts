/**
 * Vocabulaire métier du trading à levier.
 *
 * Séparé du service — qui touche Prisma — parce que ces valeurs sont lues par
 * les composants client : les importer depuis `account-service.ts` tirerait le
 * driver PostgreSQL dans le bundle navigateur, et la compilation échoue.
 * Même découpage que `crypto/constants.ts` et `securities/constants.ts`.
 */

export const TRADING_ACCOUNT_TYPES = {
  CFD: "CFD",
  FUTURES: "Futures",
  SPREAD_BETTING: "Spread betting",
  MIXED: "Mixte",
} as const;

export type TradingAccountType = keyof typeof TRADING_ACCOUNT_TYPES;

export function tradingAccountTypeLabel(value: string): string {
  return TRADING_ACCOUNT_TYPES[value as TradingAccountType] ?? value;
}

export function isTradingAccountType(
  value: string
): value is TradingAccountType {
  return value in TRADING_ACCOUNT_TYPES;
}

/**
 * Nature du sous-jacent d'une position à levier.
 *
 * `CRYPTO` est la valeur historique : la table ne contenait que des futures
 * crypto avant l'ouverture aux CFD.
 */
export const UNDERLYING_TYPES = {
  CRYPTO: "Crypto",
  INDEX: "Indice",
  FOREX: "Forex",
  COMMODITY: "Matière première",
  STOCK: "Action",
  BOND: "Obligation",
} as const;

export type UnderlyingType = keyof typeof UNDERLYING_TYPES;

export function underlyingTypeLabel(value: string): string {
  return UNDERLYING_TYPES[value as UnderlyingType] ?? value;
}
