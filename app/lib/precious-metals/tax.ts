/**
 * Fiscalité des métaux précieux physiques — articles 150 VI à 150 VM du CGI.
 *
 * Le calcul lui-même vit dans `tax/movable-assets.ts`, partagé avec les actifs
 * tangibles : les deux relèvent du même dispositif, avec un taux forfaitaire
 * et un seuil différents. Ce fichier fixe les paramètres propres aux métaux et
 * conserve le vocabulaire du module.
 *
 * ## Ce qui distingue les métaux des autres biens meubles
 *
 * - **Taux forfaitaire de 11,5 %** (11 % + 0,5 % CRDS), contre 6,5 % pour les
 *   bijoux, l'art, la collection et les antiquités.
 * - **Aucun seuil d'exonération.** Les autres meubles échappent à l'impôt en
 *   dessous de 5 000 € de prix de cession ; l'or est taxable dès le premier
 *   euro.
 *
 * ## Les deux régimes
 *
 * | | Taxe forfaitaire (défaut) | Plus-values sur biens meubles (option) |
 * |---|---|---|
 * | Assiette | prix de cession **brut** | plus-value nette |
 * | Taux | **11,5 %** | **37,6 %** (19 % IR + 18,6 % PS) |
 * | Détention | sans effet | abattement 5 %/an dès la 3ᵉ année |
 * | Exonération | non | totale à **22 ans** |
 * | Justificatif | non exigé | **exigé** (date et prix d'acquisition) |
 * | Formulaire | 2091-SD | 2092-SD |
 *
 * Les deux se déclarent et se paient dans le **mois** de la cession, pas à la
 * déclaration annuelle de revenus : une échéance qu'on rate facilement.
 *
 * ## Pourquoi le comparateur ne se résume pas au moins cher
 *
 * Le point de bascule ne dépend pas du montant vendu mais du **ratio
 * plus-value / prix de vente**. Sans facture nominative et datée, l'option est
 * fermée : le vendeur subit les 11,5 % même quand ils coûtent trois fois plus.
 * Le moteur refuse donc de « recommander » un régime inaccessible — il annonce
 * l'économie perdue, information actionnable pour les achats à venir.
 */

import { d, type Decimal } from "@/app/lib/money/decimal";
import {
  computeMovableSaleTax,
  flatTaxBreakdown,
  METAL_FLAT_TAX_RATE,
  type MovableSaleInput,
  type MovableSaleTax,
  type MovableTaxRegime,
} from "@/app/lib/tax/movable-assets";

export {
  CAPITAL_GAIN_BREAKDOWN,
  completedYearsBetween,
  FULL_EXEMPTION_YEARS,
  HOLDING_ALLOWANCE_FREE_YEARS,
  HOLDING_ALLOWANCE_PER_YEAR,
  holdingAllowanceRate,
  REGIME_FORMS,
} from "@/app/lib/tax/movable-assets";

/** Taxe forfaitaire : 11 % + 0,5 % de CRDS, assise sur le prix de cession. */
export const FLAT_METAL_TAX_RATE = METAL_FLAT_TAX_RATE;
export const FLAT_METAL_TAX_BASE_RATE = "0.11";
export const FLAT_METAL_TAX_CRDS_RATE = "0.005";

export const METAL_TAX_REGIMES = ["FORFAIT", "PLUS_VALUE"] as const;
export type MetalTaxRegime = MovableTaxRegime;

export const REGIME_LABELS: Record<MetalTaxRegime, string> = {
  FORFAIT: "Taxe forfaitaire (11,5 %)",
  PLUS_VALUE: "Plus-value sur biens meubles (37,6 %)",
};

/** Détail du taux forfaitaire, pour l'afficher sans le réinventer côté UI. */
export const FLAT_TAX_BREAKDOWN = flatTaxBreakdown("PRECIOUS_METAL");

export type MetalSaleInput = Omit<MovableSaleInput, "nature">;
export type RegimeResult = MovableSaleTax["flat"];
export type MetalSaleTax = MovableSaleTax;

/** Calcule les deux régimes pour une cession de métal et désigne le moins coûteux. */
export function computeMetalSaleTax(input: MetalSaleInput): MetalSaleTax {
  return computeMovableSaleTax({ ...input, nature: "PRECIOUS_METAL" });
}

export type MetalTaxYear = {
  year: number;
  saleCount: number;
  grossSalesEur: string;
  taxDueEur: string;
  byRegime: Record<MetalTaxRegime, { count: number; taxEur: string }>;
};

/**
 * Agrège une année de cessions.
 *
 * Contrairement à l'article 150 ter (trading), il n'y a **ni compensation
 * annuelle ni report des moins-values** : chaque vente est un événement fiscal
 * clos sur lui-même. Une perte sur un lingot n'efface pas l'impôt dû sur la
 * vente d'un Napoléon le même jour.
 */
export function summarizeMetalTaxYear(
  year: number,
  sales: (MetalSaleInput & { regime?: MetalTaxRegime })[]
): MetalTaxYear {
  let gross = d(0);
  let tax = d(0);
  const byRegime: Record<MetalTaxRegime, { count: number; taxEur: string }> = {
    FORFAIT: { count: 0, taxEur: "0.00" },
    PLUS_VALUE: { count: 0, taxEur: "0.00" },
  };
  const totals: Record<MetalTaxRegime, Decimal> = {
    FORFAIT: d(0),
    PLUS_VALUE: d(0),
  };

  for (const sale of sales) {
    const computed = computeMetalSaleTax(sale);
    // Le régime déclaré prime sur la recommandation : le journal doit refléter
    // ce que le vendeur a réellement déposé, pas ce qu'il aurait dû faire.
    const chosen: MetalTaxRegime =
      sale.regime &&
      computed[sale.regime === "FORFAIT" ? "flat" : "capitalGain"].available
        ? sale.regime
        : computed.recommended;
    const line = chosen === "FORFAIT" ? computed.flat : computed.capitalGain;
    gross = gross.plus(d(sale.salePriceEur));
    tax = tax.plus(line.taxEur);
    byRegime[chosen].count += 1;
    totals[chosen] = totals[chosen].plus(line.taxEur);
  }

  byRegime.FORFAIT.taxEur = totals.FORFAIT.toFixed(2);
  byRegime.PLUS_VALUE.taxEur = totals.PLUS_VALUE.toFixed(2);

  return {
    year,
    saleCount: sales.length,
    grossSalesEur: gross.toFixed(2),
    taxDueEur: tax.toFixed(2),
    byRegime,
  };
}
