/**
 * Cession de biens meubles — articles 150 UA et 150 VI à 150 VM du CGI.
 *
 * Ce module est le moteur commun aux métaux précieux et aux actifs tangibles :
 * les deux relèvent du même dispositif, avec des paramètres différents. En
 * écrire deux versions garantirait qu'elles divergent à la première réforme.
 *
 * ## Trois questions, dans cet ordre
 *
 * 1. **Le bien est-il taxable par nature ?** Les meubles meublants, l'
 *    électroménager et les automobiles sont expressément exonérés (art. 150 UA
 *    II 1°). L'exonération tombe si le bien est un objet de collection pour
 *    lequel l'option de l'art. 150 VL a été exercée — une 2 CV ordinaire n'est
 *    pas imposée, une Bugatti de collection l'est.
 * 2. **Le prix dépasse-t-il 5 000 € ?** En dessous, la cession est exonérée
 *    des deux régimes (art. 150 VI pour la taxe forfaitaire, art. 150 UA II 2°
 *    pour les plus-values). Ce seuil ne joue **pas** pour les métaux précieux,
 *    taxables dès le premier euro.
 * 3. **Quel régime ?** Taxe forfaitaire sur le prix de vente, ou option pour
 *    le régime réel avec abattement pour durée de détention.
 *
 * Sauter la première ou la deuxième question donne un impôt inventé sur des
 * ventes qui n'en supportent aucun — le cas le plus fréquent dans une
 * collection personnelle, où la plupart des pièces valent moins de 5 000 €.
 *
 * ## Le taux forfaitaire dépend de la nature
 *
 * | Nature | Taux | Composition |
 * |---|---|---|
 * | Métaux précieux | **11,5 %** | 11 % + 0,5 % CRDS |
 * | Bijoux, art, collection, antiquités | **6,5 %** | 6 % + 0,5 % CRDS |
 *
 * Le régime réel, lui, est le même pour tous : 37,6 % (19 % + 18,6 % de
 * prélèvements sociaux depuis le 1ᵉʳ janvier 2026).
 */

import { d, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";
import {
  MOVABLE_CAPITAL_GAIN_INCOME_TAX_RATE,
  MOVABLE_CAPITAL_GAIN_TOTAL_RATE,
  SOCIAL_CHARGES_RATE,
} from "@/app/lib/tax/rates";

/**
 * Nature du bien cédé, au sens fiscal — pas au sens du catalogue produit.
 *
 * `EXEMPT_BY_NATURE` couvre les meubles meublants, l'électroménager et les
 * automobiles ordinaires ; `COLLECTIBLE` couvre les mêmes biens lorsqu'ils
 * sont des objets de collection, ce qui les fait basculer dans le champ de
 * l'impôt.
 */
export const MOVABLE_NATURES = [
  "PRECIOUS_METAL",
  "COLLECTIBLE",
  "EXEMPT_BY_NATURE",
] as const;
export type MovableNature = (typeof MOVABLE_NATURES)[number];

/** Taxe forfaitaire sur les métaux précieux : 11 % + 0,5 % de CRDS. */
export const METAL_FLAT_TAX_RATE = "0.115";
/** Taxe forfaitaire sur les objets précieux : 6 % + 0,5 % de CRDS. */
export const COLLECTIBLE_FLAT_TAX_RATE = "0.065";
export const CRDS_RATE = "0.005";

export const FLAT_TAX_RATE_BY_NATURE: Record<MovableNature, string> = {
  PRECIOUS_METAL: METAL_FLAT_TAX_RATE,
  COLLECTIBLE: COLLECTIBLE_FLAT_TAX_RATE,
  EXEMPT_BY_NATURE: "0",
};

/**
 * Seuil d'exonération, art. 150 VI et 150 UA II 2°.
 *
 * Il s'apprécie **par cession**, pas par année ni par bien : vendre trois
 * montres à 4 000 € le même jour à des acheteurs différents fait trois
 * cessions exonérées.
 */
export const SMALL_SALE_EXEMPTION_EUR = "5000";

/** Les métaux précieux sont taxables dès le premier euro. */
export const NATURES_WITHOUT_THRESHOLD: readonly MovableNature[] = [
  "PRECIOUS_METAL",
];

/** Abattement par année de détention, à compter de la 3ᵉ. */
export const HOLDING_ALLOWANCE_PER_YEAR = "0.05";
/** Années sans abattement : la 1ʳᵉ et la 2ᵉ. */
export const HOLDING_ALLOWANCE_FREE_YEARS = 2;
/** Durée au terme de laquelle l'abattement atteint 100 %. */
export const FULL_EXEMPTION_YEARS = 22;

export const MOVABLE_TAX_REGIMES = ["FORFAIT", "PLUS_VALUE"] as const;
export type MovableTaxRegime = (typeof MOVABLE_TAX_REGIMES)[number];

export const REGIME_FORMS: Record<MovableTaxRegime, string> = {
  FORFAIT: "2091-SD",
  PLUS_VALUE: "2092-SD",
};

export type MovableSaleInput = {
  nature: MovableNature;
  /** Prix de cession brut, avant frais de vente. */
  salePriceEur: DecimalInput;
  /** Prix d'acquisition de la quantité cédée, frais d'achat inclus. */
  costBasisEur?: DecimalInput;
  /** Frais de vente — déductibles du seul régime réel. */
  saleFeesEur?: DecimalInput;
  acquiredAt?: Date | string | null;
  soldAt: Date | string;
  /** Facture nominative et datée conservée. */
  hasInvoice?: boolean;
};

export type MovableRegimeResult = {
  regime: MovableTaxRegime;
  taxableBaseEur: string;
  taxEur: string;
  /** Produit net de la vente, impôt et frais déduits. */
  netProceedsEur: string;
  form: string;
  /** `false` quand la loi ferme ce régime au vendeur. */
  available: boolean;
  unavailableReason: string | null;
};

/** Pourquoi une cession échappe à l'impôt, quand c'est le cas. */
export const EXEMPTION_REASONS = [
  "NATURE",
  "SMALL_SALE",
  "HOLDING_PERIOD",
] as const;
export type ExemptionReason = (typeof EXEMPTION_REASONS)[number];

export type MovableSaleTax = {
  nature: MovableNature;
  grossGainEur: string;
  /** Années **révolues** de détention au jour de la vente. */
  holdingYears: number;
  allowanceRate: string;
  allowanceEur: string;
  /** Vrai dès qu'aucun impôt n'est dû, quelle qu'en soit la raison. */
  exempt: boolean;
  /** Motif de l'exonération — `null` quand un impôt reste dû. */
  exemptionReason: ExemptionReason | null;
  flat: MovableRegimeResult;
  capitalGain: MovableRegimeResult;
  recommended: MovableTaxRegime;
  savingsEur: string;
  /** Économie perdue faute de justificatif. */
  forgoneSavingsEur: string;
  rationale: string;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Années révolues entre deux dates.
 *
 * Le calendrier, pas une division par 365,25 : un lot acheté le 1ᵉʳ mars 2004
 * et vendu le 28 février 2026 a 21 ans, pas 22 — un jour d'écart déplace ici
 * plusieurs milliers d'euros.
 */
export function completedYearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDiff = to.getUTCMonth() - from.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return Math.max(0, years);
}

/** Taux d'abattement pour une durée de détention donnée, borné à 100 %. */
export function holdingAllowanceRate(holdingYears: number): Decimal {
  const eligible = Math.max(0, holdingYears - HOLDING_ALLOWANCE_FREE_YEARS);
  const rate = d(HOLDING_ALLOWANCE_PER_YEAR).times(eligible);
  return rate.gt(1) ? d(1) : rate;
}

/** Le seuil de 5 000 € s'applique-t-il à cette nature ? */
export function hasSmallSaleThreshold(nature: MovableNature): boolean {
  return !NATURES_WITHOUT_THRESHOLD.includes(nature);
}

/**
 * Calcule l'impôt dû sur une cession de bien meuble et désigne le régime le
 * moins coûteux parmi ceux réellement ouverts au vendeur.
 *
 * Aucun arrondi intermédiaire : les montants ne sont figés à deux décimales
 * qu'à la sortie, pour que la comparaison des deux régimes ne dépende pas de
 * l'ordre des opérations.
 */
export function computeMovableSaleTax(input: MovableSaleInput): MovableSaleTax {
  const nature = input.nature;
  const salePrice = d(input.salePriceEur);
  const costBasis = d(input.costBasisEur ?? 0);
  const saleFees = d(input.saleFeesEur ?? 0);
  const soldAt = toDate(input.soldAt) ?? new Date();
  const acquiredAt = toDate(input.acquiredAt);

  const holdingYears = acquiredAt ? completedYearsBetween(acquiredAt, soldAt) : 0;
  const allowanceRate = holdingAllowanceRate(holdingYears);
  const fullyDepreciated = allowanceRate.gte(1);

  const grossGain = salePrice.minus(saleFees).minus(costBasis);
  const positiveGain = grossGain.gt(0) ? grossGain : d(0);
  const allowance = positiveGain.times(allowanceRate);
  const taxableGain = positiveGain.minus(allowance);

  // Les deux exonérations qui priment sur tout le reste.
  const exemptByNature = nature === "EXEMPT_BY_NATURE";
  const belowThreshold =
    hasSmallSaleThreshold(nature) && salePrice.lte(SMALL_SALE_EXEMPTION_EUR);
  const noTaxAtAll = exemptByNature || belowThreshold;

  const flatRate = FLAT_TAX_RATE_BY_NATURE[nature];
  const flatTax = noTaxAtAll ? d(0) : salePrice.times(flatRate);
  const gainTax = noTaxAtAll ? d(0) : taxableGain.times(MOVABLE_CAPITAL_GAIN_TOTAL_RATE);

  // L'option suppose de prouver la date **et** le prix d'acquisition — sauf
  // détention de plus de 22 ans, où l'exonération se démontre par la seule
  // ancienneté (art. 150 VL).
  const provable = Boolean(input.hasInvoice) && acquiredAt !== null;
  const optionOpen =
    noTaxAtAll ||
    provable ||
    (acquiredAt !== null && holdingYears >= FULL_EXEMPTION_YEARS);

  const flat: MovableRegimeResult = {
    regime: "FORFAIT",
    taxableBaseEur: noTaxAtAll ? "0.00" : salePrice.toFixed(2),
    taxEur: flatTax.toFixed(2),
    netProceedsEur: salePrice.minus(saleFees).minus(flatTax).toFixed(2),
    form: noTaxAtAll ? "—" : REGIME_FORMS.FORFAIT,
    available: true,
    unavailableReason: null,
  };

  const capitalGain: MovableRegimeResult = {
    regime: "PLUS_VALUE",
    taxableBaseEur: noTaxAtAll ? "0.00" : taxableGain.toFixed(2),
    taxEur: gainTax.toFixed(2),
    netProceedsEur: salePrice.minus(saleFees).minus(gainTax).toFixed(2),
    form: noTaxAtAll ? "—" : REGIME_FORMS.PLUS_VALUE,
    available: optionOpen,
    unavailableReason: optionOpen
      ? null
      : acquiredAt === null
        ? "Date d'acquisition inconnue : l'option pour le régime réel est fermée."
        : "Sans facture nominative et datée, l'option pour le régime réel est fermée.",
  };

  const optionCheaper = gainTax.lt(flatTax);
  const recommended: MovableTaxRegime =
    optionOpen && optionCheaper ? "PLUS_VALUE" : "FORFAIT";
  const savings = recommended === "PLUS_VALUE" ? flatTax.minus(gainTax) : d(0);
  const forgone = !optionOpen && optionCheaper ? flatTax.minus(gainTax) : d(0);

  const exemptionReason: ExemptionReason | null = exemptByNature
    ? "NATURE"
    : belowThreshold
      ? "SMALL_SALE"
      : fullyDepreciated && optionOpen
        ? "HOLDING_PERIOD"
        : null;

  return {
    nature,
    grossGainEur: grossGain.toFixed(2),
    holdingYears,
    allowanceRate: allowanceRate.toFixed(4),
    allowanceEur: allowance.toFixed(2),
    // « Exonéré » ne veut dire quelque chose que si l'impôt effectivement dû
    // est nul : un abattement de 100 % sur un régime fermé n'exonère personne.
    exempt: noTaxAtAll || (fullyDepreciated && optionOpen && recommended === "PLUS_VALUE"),
    exemptionReason,
    flat,
    capitalGain,
    recommended,
    savingsEur: savings.toFixed(2),
    forgoneSavingsEur: forgone.toFixed(2),
    rationale: explain({
      nature,
      exemptByNature,
      belowThreshold,
      optionOpen,
      optionCheaper,
      fullyDepreciated,
      holdingYears,
      grossGain,
      forgone,
      savings,
      salePrice,
    }),
  };
}

function eur(value: Decimal): string {
  return `${Number(value.toFixed(2)).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function explain(ctx: {
  nature: MovableNature;
  exemptByNature: boolean;
  belowThreshold: boolean;
  optionOpen: boolean;
  optionCheaper: boolean;
  fullyDepreciated: boolean;
  holdingYears: number;
  grossGain: Decimal;
  forgone: Decimal;
  savings: Decimal;
  salePrice: Decimal;
}): string {
  if (ctx.exemptByNature) {
    return "Meubles meublants, électroménager et automobiles sont exonérés par nature (art. 150 UA II 1°) — sauf véhicule de collection, à déclarer comme tel.";
  }
  if (ctx.belowThreshold) {
    return `Cession inférieure à ${eur(d(SMALL_SALE_EXEMPTION_EUR))} : exonérée des deux régimes. Le seuil s'apprécie par cession, pas par année.`;
  }
  if (!ctx.optionOpen) {
    return ctx.forgone.gt(0)
      ? `Faute de justificatif d'acquisition, la taxe forfaitaire s'impose : ${eur(
          ctx.forgone
        )} d'impôt en plus par rapport au régime réel.`
      : "Faute de justificatif d'acquisition, la taxe forfaitaire s'impose — elle reste ici la moins coûteuse.";
  }
  if (ctx.fullyDepreciated) {
    return `Après ${ctx.holdingYears} ans de détention, l'abattement atteint 100 % : la plus-value est exonérée, contre ${eur(
      ctx.savings
    )} de taxe forfaitaire.`;
  }
  if (ctx.grossGain.lte(0)) {
    return "La cession se solde par une perte : le régime réel n'impose rien, alors que la taxe forfaitaire reste due sur le prix de vente.";
  }
  return ctx.optionCheaper
    ? `L'option pour le régime réel économise ${eur(ctx.savings)} — la plus-value nette d'abattement reste faible au regard du prix de vente.`
    : "La plus-value est trop élevée par rapport au prix de vente : la taxe forfaitaire coûte moins cher que les 37,6 %.";
}

/**
 * Année de détention à partir de laquelle le régime réel devient moins cher
 * que la taxe forfaitaire, à prix de cession et prix de revient donnés.
 *
 * L'abattement ne progresse que par paliers annuels : plutôt que d'inverser
 * l'équation et d'arrondir, on parcourt les 22 années possibles et on retient
 * la première qui bascule. Vingt-deux itérations sur des entiers, c'est exact
 * et cela reste lisible.
 *
 * Renvoie `null` quand la bascule n'arrive jamais — cession exonérée, ou
 * moins-value où le régime réel est déjà le moins cher dès la première année.
 */
export function breakEvenYear(input: {
  nature: MovableNature;
  salePriceEur: DecimalInput;
  costBasisEur?: DecimalInput;
  saleFeesEur?: DecimalInput;
}): number | null {
  const salePrice = d(input.salePriceEur);
  if (
    input.nature === "EXEMPT_BY_NATURE" ||
    (hasSmallSaleThreshold(input.nature) && salePrice.lte(SMALL_SALE_EXEMPTION_EUR))
  ) {
    return null;
  }

  const gain = salePrice
    .minus(d(input.saleFeesEur ?? 0))
    .minus(d(input.costBasisEur ?? 0));
  if (gain.lte(0)) return null;

  const flatTax = salePrice.times(FLAT_TAX_RATE_BY_NATURE[input.nature]);
  for (let year = 0; year <= FULL_EXEMPTION_YEARS; year += 1) {
    const taxable = gain.times(d(1).minus(holdingAllowanceRate(year)));
    if (taxable.times(MOVABLE_CAPITAL_GAIN_TOTAL_RATE).lt(flatTax)) {
      return year;
    }
  }
  return null;
}

/** Détail du régime réel, pour l'afficher sans le réinventer côté UI. */
export const CAPITAL_GAIN_BREAKDOWN = [
  { label: "Impôt sur le revenu", rate: MOVABLE_CAPITAL_GAIN_INCOME_TAX_RATE },
  { label: "Prélèvements sociaux", rate: SOCIAL_CHARGES_RATE },
] as const;

/** Détail du taux forfaitaire applicable à une nature donnée. */
export function flatTaxBreakdown(
  nature: MovableNature
): readonly { label: string; rate: string }[] {
  if (nature === "EXEMPT_BY_NATURE") return [];
  const total = d(FLAT_TAX_RATE_BY_NATURE[nature]);
  return [
    {
      label:
        nature === "PRECIOUS_METAL"
          ? "Taxe sur les métaux précieux"
          : "Taxe sur les objets précieux",
      rate: total.minus(CRDS_RATE).toString(),
    },
    { label: "CRDS", rate: CRDS_RATE },
  ];
}
