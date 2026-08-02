/**
 * Cours des métaux précieux : de l'once cotée au lingot détenu.
 *
 * Un métal se cote à l'once troy, mais se détient au gramme et à un titre
 * donné — une pièce de 20 F contient 5,806 g d'or fin pour 6,45 g pesés. Sans
 * cette conversion, le suivi d'un stock physique n'est qu'une saisie manuelle
 * qui vieillit ; avec elle, la valeur du métal est objectivement calculable et
 * n'a plus à être devinée.
 *
 * Ce module est pur et sans réseau : il convertit, il ne va rien chercher.
 */

import { d, zero, type Decimal, type DecimalInput } from "../money/decimal";
import type { PreciousMetal } from "./constants";

/** Once troy, en grammes. Constante de définition, pas une approximation. */
export const TROY_OUNCE_G = 31.1034768;

/** Symboles de cotation, par ordre de préférence, pour chaque métal.
 *
 *  La paire en euro évite une conversion — donc une source d'erreur — quand
 *  elle est cotée. À défaut, la paire en dollar est convertie par le taux de
 *  change du jour, ce que le second champ signale explicitement.
 */
export const METAL_QUOTE_SYMBOLS: Record<
  PreciousMetal,
  { symbol: string; currency: "EUR" | "USD" }[]
> = {
  GOLD: [
    { symbol: "XAUEUR=X", currency: "EUR" },
    { symbol: "XAUUSD=X", currency: "USD" },
  ],
  SILVER: [
    { symbol: "XAGEUR=X", currency: "EUR" },
    { symbol: "XAGUSD=X", currency: "USD" },
  ],
  PLATINUM: [
    { symbol: "XPTEUR=X", currency: "EUR" },
    { symbol: "XPTUSD=X", currency: "USD" },
  ],
  PALLADIUM: [
    { symbol: "XPDEUR=X", currency: "EUR" },
    { symbol: "XPDUSD=X", currency: "USD" },
  ],
  // « Autre » ne désigne aucun métal coté : il n'y a rien à interroger.
  OTHER: [],
};

/** Prix au gramme, à partir d'un prix à l'once troy. */
export function perGramFromOunce(pricePerOunce: DecimalInput): Decimal {
  const price = d(pricePerOunce);
  if (price.lte(0)) return zero();
  return price.div(d(TROY_OUNCE_G));
}

/**
 * Poids fin d'un lot, en grammes.
 *
 * Le titre (`fineness`) s'exprime en millièmes — 999 pour un lingot, 900 pour
 * une pièce de 20 F. C'est ce poids fin, et lui seul, qui vaut le cours du
 * métal : le reste de l'alliage n'a pas de valeur marchande.
 */
export function fineWeightGrams(
  quantity: DecimalInput,
  unitWeightG: DecimalInput,
  fineness: DecimalInput
): Decimal {
  const qty = d(quantity);
  const weight = d(unitWeightG);
  const title = d(fineness);
  if (qty.lte(0) || weight.lte(0) || title.lte(0)) return zero();
  return qty.times(weight).times(title).div(1000);
}

/**
 * Valeur du métal contenu dans un lot, au cours du jour.
 *
 * C'est un plancher de valorisation, pas un prix de revente : une pièce de
 * collection vaut son métal *plus* une prime, un lingot s'en approche à
 * quelques pourcents près.
 */
export function metalValueEur(
  fineWeightG: DecimalInput,
  eurPerGram: DecimalInput
): Decimal {
  const weight = d(fineWeightG);
  const price = d(eurPerGram);
  if (weight.lte(0) || price.lte(0)) return zero();
  return weight.times(price);
}

/**
 * Prime d'un produit sur son contenu métal, en pourcentage.
 *
 * C'est l'indicateur qui manque à un suivi de stock physique : elle dit ce que
 * l'on paie au-delà du métal, et son évolution dit si la cote numismatique se
 * tend ou se détend indépendamment du cours. `null` sans contenu métal —
 * diviser par zéro produirait un chiffre, pas une information.
 */
export function premiumPct(
  marketValueEur: DecimalInput,
  metalValue: DecimalInput
): Decimal | null {
  const market = d(marketValueEur);
  const metal = d(metalValue);
  if (metal.lte(0)) return null;
  return market.minus(metal).div(metal).times(100);
}
