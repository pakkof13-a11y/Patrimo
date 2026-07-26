/**
 * Impôt sur la fortune immobilière — CGI art. 964 à 983.
 *
 * Module pur. Trois règles sont contre-intuitives et constituent l'essentiel
 * des erreurs de calcul « maison » :
 *
 * 1. **Le seuil et le barème ne coïncident pas.** On n'est redevable qu'au-delà
 *    de 1 300 000 € de patrimoine net taxable, mais le barème se calcule à
 *    partir de 800 000 €. Franchir le seuil rend donc immédiatement imposable
 *    la tranche 800 000–1 300 000, d'où un impôt qui « démarre » à 2 500 €.
 * 2. **La décote** (art. 977 II) lisse cet effet de falaise entre 1,3 et 1,4 M€ :
 *    17 500 − 1,25 % × patrimoine. Sans elle, un euro de plus au-dessus du
 *    seuil coûterait 2 500 € d'impôt.
 * 3. **Seules les dettes afférentes aux actifs imposables** sont déductibles.
 *    Un crédit à la consommation ou un prêt adossé à un actif financier ne
 *    réduit pas l'assiette IFI.
 */

import { d, zero, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";

/** Patrimoine net taxable à partir duquel on devient redevable. */
export const IFI_THRESHOLD = d(1_300_000);

/** Abattement légal sur la résidence principale (art. 973 I al. 2). */
export const PRIMARY_RESIDENCE_ALLOWANCE_RATE = d("0.30");

/** Bornes de la décote de seuil. */
export const IFI_DISCOUNT_CEILING = d(1_400_000);
export const IFI_DISCOUNT_BASE = d(17_500);
export const IFI_DISCOUNT_RATE = d("0.0125");

/**
 * Barème par tranches (art. 977). La première tranche est à taux nul : elle
 * existe pour que le calcul reste continu, pas pour exonérer.
 */
export const IFI_BRACKETS: readonly { upTo: Decimal | null; rate: Decimal }[] = [
  { upTo: d(800_000), rate: zero() },
  { upTo: d(1_300_000), rate: d("0.005") },
  { upTo: d(2_570_000), rate: d("0.007") },
  { upTo: d(5_000_000), rate: d("0.01") },
  { upTo: d(10_000_000), rate: d("0.0125") },
  { upTo: null, rate: d("0.015") },
];

/** Un actif immobilier tel qu'il entre dans l'assiette. */
export type IfiAsset = {
  id: string;
  label: string;
  /** Valeur vénale de la quote-part détenue, avant abattement RP. */
  grossValueEur: DecimalInput;
  /** Résidence principale : ouvre l'abattement de 30 %. */
  isPrimaryResidence?: boolean;
  /**
   * Exclusion de l'assiette. Sert aux biens professionnels (art. 975) et
   * laisse à l'utilisateur la main sur les cas limites, plutôt que de trancher
   * à sa place une qualification qui dépend de sa situation.
   */
  excluded?: boolean;
  /**
   * Fraction immobilière imposable, en pourcentage. Vaut 100 pour un bien
   * détenu en direct ; pour des parts de SCPI ou de société, seule la quote-part
   * représentative d'immobilier est taxable (art. 965 2°).
   */
  realEstateSharePct?: DecimalInput;
  /** Dette déductible rattachée à cet actif (capital restant dû). */
  deductibleDebtEur?: DecimalInput;
};

export type IfiAssetLine = {
  id: string;
  label: string;
  grossValueEur: Decimal;
  /** Abattement RP appliqué, en euros. */
  allowanceEur: Decimal;
  /** Valeur retenue dans l'assiette après abattement et quote-part immo. */
  taxableValueEur: Decimal;
  deductibleDebtEur: Decimal;
  /** Contribution nette de la ligne à l'assiette. */
  netValueEur: Decimal;
  excluded: boolean;
};

export type IfiResult = {
  lines: IfiAssetLine[];
  /** Somme des valeurs taxables avant dettes. */
  grossTaxableEur: Decimal;
  totalDeductibleDebtEur: Decimal;
  /** Assiette nette, plancher à zéro. */
  netTaxableEur: Decimal;
  /** Vrai si l'assiette dépasse le seuil de 1,3 M€. */
  liable: boolean;
  /** Impôt avant décote. */
  grossTaxEur: Decimal;
  discountEur: Decimal;
  /** Impôt dû, après décote. */
  taxEur: Decimal;
  /** Taux moyen d'imposition sur l'assiette. */
  effectiveRatePct: Decimal;
};

/**
 * Impôt brut par application du barème progressif, sans décote ni condition
 * de seuil. Exporté pour être testable indépendamment.
 */
export function ifiScaleTax(netTaxable: Decimal): Decimal {
  if (netTaxable.lte(0)) return zero();

  let tax = zero();
  let lowerBound = zero();

  for (const bracket of IFI_BRACKETS) {
    if (netTaxable.lte(lowerBound)) break;
    const upper = bracket.upTo ?? netTaxable;
    const ceiling = netTaxable.lt(upper) ? netTaxable : upper;
    const slice = ceiling.minus(lowerBound);
    if (slice.gt(0)) tax = tax.plus(slice.times(bracket.rate));
    if (bracket.upTo === null) break;
    lowerBound = bracket.upTo;
  }

  return tax;
}

/**
 * Décote de seuil (art. 977 II) : 17 500 − 1,25 % × patrimoine, applicable
 * entre 1,3 M€ et 1,4 M€. Bornée à l'impôt dû pour ne jamais le rendre négatif.
 */
export function ifiDiscount(netTaxable: Decimal, grossTax: Decimal): Decimal {
  if (netTaxable.lt(IFI_THRESHOLD) || netTaxable.gte(IFI_DISCOUNT_CEILING)) {
    return zero();
  }
  const raw = IFI_DISCOUNT_BASE.minus(netTaxable.times(IFI_DISCOUNT_RATE));
  if (raw.lte(0)) return zero();
  return raw.gt(grossTax) ? grossTax : raw;
}

export function computeIfi(assets: readonly IfiAsset[]): IfiResult {
  const lines: IfiAssetLine[] = [];

  let grossTaxable = zero();
  let totalDebt = zero();

  for (const asset of assets) {
    const gross = d(asset.grossValueEur);
    const excluded = Boolean(asset.excluded);

    // Quote-part immobilière : 100 % par défaut (détention directe).
    const sharePct = asset.realEstateSharePct != null ? d(asset.realEstateSharePct) : d(100);
    const shared = gross.times(sharePct).div(100);

    const allowance = asset.isPrimaryResidence
      ? shared.times(PRIMARY_RESIDENCE_ALLOWANCE_RATE)
      : zero();

    const taxable = excluded ? zero() : shared.minus(allowance);
    const debt = excluded ? zero() : d(asset.deductibleDebtEur ?? 0);

    lines.push({
      id: asset.id,
      label: asset.label,
      grossValueEur: gross,
      allowanceEur: excluded ? zero() : allowance,
      taxableValueEur: taxable,
      deductibleDebtEur: debt,
      netValueEur: taxable.minus(debt),
      excluded,
    });

    grossTaxable = grossTaxable.plus(taxable);
    totalDebt = totalDebt.plus(debt);
  }

  // L'assiette ne peut pas être négative : un endettement supérieur à la
  // valeur des biens ne crée pas de créance d'impôt.
  const rawNet = grossTaxable.minus(totalDebt);
  const netTaxable = rawNet.lt(0) ? zero() : rawNet;

  const liable = netTaxable.gte(IFI_THRESHOLD);
  const grossTax = liable ? ifiScaleTax(netTaxable) : zero();
  const discount = liable ? ifiDiscount(netTaxable, grossTax) : zero();
  const tax = grossTax.minus(discount);

  return {
    lines,
    grossTaxableEur: grossTaxable,
    totalDeductibleDebtEur: totalDebt,
    netTaxableEur: netTaxable,
    liable,
    grossTaxEur: grossTax,
    discountEur: discount,
    taxEur: tax,
    effectiveRatePct: netTaxable.gt(0) ? tax.div(netTaxable).times(100) : zero(),
  };
}
