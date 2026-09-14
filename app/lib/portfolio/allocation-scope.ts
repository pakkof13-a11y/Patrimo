/**
 * Camembert aligné sur la carte active.
 *
 * Le dénominateur est le même chiffre que le titre : Financier n'est pas
 * le brut. Sans ce recoupement, 41 % d'immobilier s'affichaient sous
 * 295 k€ de Financier.
 *
 * - **Financier** — listed + cashInvestissement + fondsEuro + esLiquid.
 *   Zéro immobilier, zéro UC d'AV, zéro alternatif.
 * - **Brut** — ventilation `byClass` du patrimoine (immo = poche immobilier).
 * - **Net** — même ventilation que le brut ; la légende dit « hors passifs ».
 */

import { ASSET_CLASSES } from "../constants";
import {
  LISTED_ASSET_CLASSES,
  LISTED_EXCLUDED_ACCOUNT_TYPES,
} from "./patrimony-metrics";
import type { HeroNavScope } from "./daily-nav-view";

export type AllocationSlice = { name: string; value: number };

/** Clés ajoutées au camembert Financier, hors taxonomie `ASSET_CLASSES`. */
export const FINANCIER_EXTRA_SLICE_KEYS = ["FONDS_EURO", "ES_LIQUID"] as const;

export const ALLOCATION_SLICE_LABEL: Record<string, string> = {
  ...ASSET_CLASSES,
  FONDS_EURO: "Fonds euro",
  ES_LIQUID: "Épargne salariale",
};

export function allocationSliceLabel(name: string): string {
  return ALLOCATION_SLICE_LABEL[name] ?? name;
}

export function allocationLegendForScope(
  scope: HeroNavScope
): string | undefined {
  return scope === "net" ? "hors passifs" : undefined;
}

function positive(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isListedHolding(h: {
  assetClass: string;
  accountType: string;
}): boolean {
  return (
    LISTED_ASSET_CLASSES.has(h.assetClass) &&
    !LISTED_EXCLUDED_ACCOUNT_TYPES.has(h.accountType)
  );
}

export type ListedHoldingInput = {
  assetClass: string;
  accountType: string;
  marketValueBase?: unknown;
  marketValueEur?: unknown;
};

/**
 * Listed ventilé par classe — ACTIONS / OBLIGATIONS / CRYPTO, hors IMMO / AV.
 *
 * Une UC d'AV étiquetée ACTIONS ne doit pas gonfler le camembert Financier :
 * seul le fonds euro y entre, via `fondsEuro`.
 */
export function listedSlicesFromHoldings(
  holdings: readonly ListedHoldingInput[]
): AllocationSlice[] {
  const byClass = new Map<string, number>();
  for (const h of holdings) {
    if (!isListedHolding(h)) continue;
    const v = positive(h.marketValueBase ?? h.marketValueEur);
    if (v <= 0) continue;
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + v);
  }
  return [...byClass.entries()].map(([name, value]) => ({ name, value }));
}

export type AllocationScopeInput = {
  byClass: readonly AllocationSlice[];
  holdings?: readonly ListedHoldingInput[];
  cashInvestissement: number;
  fondsEuro: number;
  esLiquid: number;
};

export function allocationSlicesForScope(
  scope: HeroNavScope,
  input: AllocationScopeInput
): AllocationSlice[] {
  if (scope === "financier") {
    return [
      ...listedSlicesFromHoldings(input.holdings ?? []),
      { name: "CASH", value: positive(input.cashInvestissement) },
      { name: "FONDS_EURO", value: positive(input.fondsEuro) },
      { name: "ES_LIQUID", value: positive(input.esLiquid) },
    ].filter((s) => s.value > 0);
  }
  /*
    Brut et Net : même ventilation d'actifs. Les passifs ne sont pas une
    part — le Net les déduit du chiffre, pas du camembert.
  */
  return input.byClass.filter(
    (s) => typeof s.value === "number" && Number.isFinite(s.value) && s.value > 0
  );
}

export function immobilierSliceValue(
  slices: readonly AllocationSlice[]
): number {
  return slices.find((s) => s.name === "IMMOBILIER")?.value ?? 0;
}
