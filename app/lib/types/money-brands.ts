/**
 * Montants sérialisés en string (précision décimale) avec marque de devise.
 * Empêche d’additionner / confondre EUR et devise de base au typage.
 *
 * Construction uniquement via les helpers — pas de `as EurAmount` ad hoc.
 */

declare const __eurBrand: unique symbol;
declare const __baseBrand: unique symbol;
declare const __qtyBrand: unique symbol;
declare const __pctBrand: unique symbol;
declare const __priceBrand: unique symbol;

/** Montant en EUR (coût, MV, PnL, etc.) */
export type EurAmount = string & { readonly [__eurBrand]: "EUR" };

/** Montant dans la devise de base du portefeuille (peut = EUR) */
export type BaseAmount = string & { readonly [__baseBrand]: "BASE" };

/** Quantité d’actif (pas une devise) */
export type QuantityString = string & { readonly [__qtyBrand]: "QTY" };

/** Pourcentage (allocation, PnL %) */
export type PercentString = string & { readonly [__pctBrand]: "PCT" };

/** Prix unitaire (EUR ou natif — marque générique de « prix ») */
export type PriceString = string & { readonly [__priceBrand]: "PRICE" };

export function asEurAmount(value: string): EurAmount {
  return value as EurAmount;
}

export function asBaseAmount(value: string): BaseAmount {
  return value as BaseAmount;
}

export function asQuantityString(value: string): QuantityString {
  return value as QuantityString;
}

export function asPercentString(value: string): PercentString {
  return value as PercentString;
}

export function asPriceString(value: string): PriceString {
  return value as PriceString;
}
