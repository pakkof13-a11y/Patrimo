/**
 * Plus-value immobilière des particuliers — CGI art. 150 U à 150 VH.
 *
 * Module pur : aucune dépendance Prisma, tout entre par les paramètres. Les
 * montants restent en Decimal.js de bout en bout, jamais en `number` — un
 * arrondi flottant sur une assiette à six chiffres se voit à l'euro près.
 *
 * Trois pièges que ce module traite explicitement, parce qu'ils sont la source
 * habituelle des écarts avec le calcul du notaire :
 *
 * 1. Les abattements pour durée de détention **diffèrent entre l'IR et les
 *    prélèvements sociaux** : exonération à 22 ans d'un côté, 30 ans de
 *    l'autre. Un barème unique donnerait un résultat faux dès la 22e année.
 * 2. La durée se compte en **années pleines de détention**, pas en différence
 *    de millésimes : un bien acheté le 31/12/2000 et vendu le 01/01/2022 n'a
 *    pas 22 ans de détention.
 * 3. La surtaxe des plus-values > 50 000 € (art. 1609 nonies G) porte sur la
 *    plus-value **imposable** (après abattements), pas sur la plus-value brute.
 */

import { d, zero, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";

/** Taux d'imposition de la plus-value immobilière au titre de l'impôt sur le revenu. */
export const CAPITAL_GAIN_IR_RATE = d("0.19");

/** Prélèvements sociaux sur les revenus du patrimoine. */
export const CAPITAL_GAIN_SOCIAL_RATE = d("0.172");

/**
 * Forfait de frais d'acquisition retenu à défaut de justificatifs (art. 150 VB
 * II 3°). Ne s'applique qu'aux acquisitions à titre onéreux.
 */
export const ACQUISITION_FEES_FLAT_RATE = d("0.075");

/**
 * Forfait travaux (art. 150 VB II 4°) — ouvert seulement si le bien est détenu
 * depuis plus de cinq ans, et sans avoir à justifier de travaux réels.
 */
export const WORKS_FLAT_RATE = d("0.15");
export const WORKS_FLAT_MIN_HOLDING_YEARS = 5;

/** Seuil de déclenchement de la taxe sur les plus-values élevées. */
export const SURTAX_THRESHOLD = d(50_000);

export type CapitalGainInput = {
  /** Prix de cession net vendeur. */
  salePriceEur: DecimalInput;
  /** Frais supportés par le vendeur à la cession (diagnostics, mainlevée…). */
  saleCostsEur?: DecimalInput;

  /** Prix d'acquisition effectivement payé. */
  purchasePriceEur: DecimalInput;
  /**
   * Frais d'acquisition réels (notaire, droits). Si omis et
   * `useFlatAcquisitionFees` est vrai, le forfait de 7,5 % s'applique.
   */
  acquisitionFeesEur?: DecimalInput;
  useFlatAcquisitionFees?: boolean;

  /** Travaux réellement supportés et justifiés. */
  worksEur?: DecimalInput;
  /** Retenir le forfait de 15 % au lieu des travaux réels (si éligible). */
  useFlatWorks?: boolean;

  purchaseDate: Date;
  saleDate: Date;

  /**
   * Résidence principale du cédant au jour de la vente : exonération totale
   * (art. 150 U II 1°). Court-circuite tout le reste du calcul.
   */
  isPrimaryResidence?: boolean;

  /** Quote-part détenue, en pourcentage (100 = pleine propriété). */
  ownershipPct?: DecimalInput;
};

export type CapitalGainResult = {
  /** Années pleines de détention. */
  holdingYears: number;
  /** Prix d'acquisition majoré des frais et travaux retenus. */
  adjustedPurchasePriceEur: Decimal;
  /** Prix de cession diminué des frais de vente. */
  netSalePriceEur: Decimal;
  /** Plus-value avant tout abattement. */
  grossGainEur: Decimal;
  /** Abattements appliqués, exprimés en euros. */
  irAbatementEur: Decimal;
  socialAbatementEur: Decimal;
  /** Assiettes après abattement. */
  taxableGainIrEur: Decimal;
  taxableGainSocialEur: Decimal;
  /** Impôts dus. */
  irTaxEur: Decimal;
  socialTaxEur: Decimal;
  surtaxEur: Decimal;
  totalTaxEur: Decimal;
  /** Produit net de cession, après impôt. */
  netProceedsEur: Decimal;
  /** Vrai si la cession est exonérée (résidence principale ou durée). */
  exempt: boolean;
  exemptionReason: "PRIMARY_RESIDENCE" | "HOLDING_PERIOD" | null;
};

/**
 * Années **pleines** de détention entre deux dates.
 *
 * On ne soustrait pas les millésimes : la loi compte de date à date, et cette
 * nuance décale d'un cran tout le barème d'abattement autour des anniversaires.
 */
export function holdingYearsBetween(purchaseDate: Date, saleDate: Date): number {
  let years = saleDate.getFullYear() - purchaseDate.getFullYear();
  const monthDelta = saleDate.getMonth() - purchaseDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && saleDate.getDate() < purchaseDate.getDate())) {
    years -= 1;
  }
  return Math.max(0, years);
}

/**
 * Taux d'abattement IR cumulé (art. 150 VC I).
 * 0 % jusqu'à 5 ans · 6 %/an de la 6e à la 21e · 4 % la 22e · exonéré ensuite.
 */
export function irAbatementRate(holdingYears: number): Decimal {
  if (holdingYears <= 5) return zero();
  // 6 %/an × 16 ans (6e à 21e) = 96 %, puis 4 % la 22e : le cumul tombe
  // exactement à 100 %, d'où l'exonération pleine à partir de 22 ans.
  if (holdingYears >= 22) return d(1);
  return d("0.06").times(holdingYears - 5);
}

/**
 * Taux d'abattement au titre des prélèvements sociaux (art. 150 VC I).
 * 0 % jusqu'à 5 ans · 1,65 %/an de la 6e à la 21e · 1,60 % la 22e ·
 * 9 %/an de la 23e à la 30e · exonéré ensuite.
 */
export function socialAbatementRate(holdingYears: number): Decimal {
  if (holdingYears <= 5) return zero();
  if (holdingYears >= 30) return d(1);

  const yearsAt165 = Math.min(holdingYears, 21) - 5;
  let rate = d("0.0165").times(yearsAt165);

  if (holdingYears >= 22) rate = rate.plus("0.016");
  if (holdingYears >= 23) {
    const yearsAt9 = Math.min(holdingYears, 30) - 22;
    rate = rate.plus(d("0.09").times(yearsAt9));
  }
  // Le cumul théorique atteint exactement 100 % à 30 ans ; on borne par
  // sécurité pour qu'un arrondi ne produise jamais un abattement > 100 %.
  return rate.gt(1) ? d(1) : rate;
}

/**
 * Barème de la taxe sur les plus-values immobilières élevées
 * (art. 1609 nonies G). Progressif par tranches sur la PV imposable à l'IR.
 *
 * Le barème légal comporte des paliers « lissés » destinés à éviter les effets
 * de seuil brutaux ; on retient ici la formule simple par tranche, très
 * légèrement conservatrice aux bornes.
 */
export function surtaxRate(taxableGainIr: Decimal): Decimal {
  const g = taxableGainIr;
  if (g.lte(50_000)) return zero();
  if (g.lte(100_000)) return d("0.02");
  if (g.lte(150_000)) return d("0.03");
  if (g.lte(200_000)) return d("0.04");
  if (g.lte(250_000)) return d("0.05");
  return d("0.06");
}

export function computeCapitalGain(input: CapitalGainInput): CapitalGainResult {
  const holdingYears = holdingYearsBetween(input.purchaseDate, input.saleDate);
  const ownership = input.ownershipPct != null ? d(input.ownershipPct).div(100) : d(1);

  const empty = (reason: CapitalGainResult["exemptionReason"]): CapitalGainResult => ({
    holdingYears,
    adjustedPurchasePriceEur: zero(),
    netSalePriceEur: zero(),
    grossGainEur: zero(),
    irAbatementEur: zero(),
    socialAbatementEur: zero(),
    taxableGainIrEur: zero(),
    taxableGainSocialEur: zero(),
    irTaxEur: zero(),
    socialTaxEur: zero(),
    surtaxEur: zero(),
    totalTaxEur: zero(),
    netProceedsEur: d(input.salePriceEur).times(ownership),
    exempt: true,
    exemptionReason: reason,
  });

  // La résidence principale est exonérée quelle que soit la durée de détention.
  if (input.isPrimaryResidence) return empty("PRIMARY_RESIDENCE");

  const purchasePrice = d(input.purchasePriceEur);

  // Frais d'acquisition : réels, ou forfait de 7,5 % à défaut de justificatifs.
  const acquisitionFees = input.useFlatAcquisitionFees
    ? purchasePrice.times(ACQUISITION_FEES_FLAT_RATE)
    : d(input.acquisitionFeesEur ?? 0);

  // Forfait travaux : réservé aux biens détenus depuis plus de cinq ans.
  const flatWorksEligible =
    Boolean(input.useFlatWorks) && holdingYears > WORKS_FLAT_MIN_HOLDING_YEARS;
  const works = flatWorksEligible
    ? purchasePrice.times(WORKS_FLAT_RATE)
    : d(input.worksEur ?? 0);

  const adjustedPurchase = purchasePrice.plus(acquisitionFees).plus(works);
  const netSale = d(input.salePriceEur).minus(d(input.saleCostsEur ?? 0));

  // Une moins-value immobilière n'est ni imputable ni reportable : le résultat
  // est ramené à zéro plutôt que de produire un impôt négatif.
  const grossGain = netSale.minus(adjustedPurchase);
  if (grossGain.lte(0)) {
    return {
      holdingYears,
      adjustedPurchasePriceEur: adjustedPurchase.times(ownership),
      netSalePriceEur: netSale.times(ownership),
      grossGainEur: grossGain.times(ownership),
      irAbatementEur: zero(),
      socialAbatementEur: zero(),
      taxableGainIrEur: zero(),
      taxableGainSocialEur: zero(),
      irTaxEur: zero(),
      socialTaxEur: zero(),
      surtaxEur: zero(),
      totalTaxEur: zero(),
      netProceedsEur: netSale.times(ownership),
      exempt: false,
      exemptionReason: null,
    };
  }

  const irRate = irAbatementRate(holdingYears);
  const socialRate = socialAbatementRate(holdingYears);

  const irAbatement = grossGain.times(irRate);
  const socialAbatement = grossGain.times(socialRate);

  const taxableIr = grossGain.minus(irAbatement);
  const taxableSocial = grossGain.minus(socialAbatement);

  const irTax = taxableIr.times(CAPITAL_GAIN_IR_RATE);
  const socialTax = taxableSocial.times(CAPITAL_GAIN_SOCIAL_RATE);
  const surtax = taxableIr.times(surtaxRate(taxableIr));

  const totalTax = irTax.plus(socialTax).plus(surtax);

  // Exonéré par la durée : les deux assiettes sont éteintes simultanément.
  const exempt = taxableIr.lte(0) && taxableSocial.lte(0);

  const scale = (v: Decimal) => v.times(ownership);

  return {
    holdingYears,
    adjustedPurchasePriceEur: scale(adjustedPurchase),
    netSalePriceEur: scale(netSale),
    grossGainEur: scale(grossGain),
    irAbatementEur: scale(irAbatement),
    socialAbatementEur: scale(socialAbatement),
    taxableGainIrEur: scale(taxableIr),
    taxableGainSocialEur: scale(taxableSocial),
    irTaxEur: scale(irTax),
    socialTaxEur: scale(socialTax),
    surtaxEur: scale(surtax),
    totalTaxEur: scale(totalTax),
    netProceedsEur: scale(netSale.minus(totalTax)),
    exempt,
    exemptionReason: exempt ? "HOLDING_PERIOD" : null,
  };
}
