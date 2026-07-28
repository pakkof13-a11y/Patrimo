/**
 * Fiscalité des métaux précieux physiques — articles 150 VI à 150 VM du CGI.
 *
 * Vendre de l'or n'est pas vendre une action. Le régime de droit commun ne
 * porte pas sur le gain mais sur le **prix de vente**, plus-value ou moins-value
 * indifféremment : on peut donc payer l'impôt en perdant de l'argent. Le
 * législateur ouvre en contrepartie une option pour le régime réel, mais la
 * subordonne à une preuve — et c'est cette condition, plus que l'arithmétique,
 * qui décide du régime dans la plupart des cas réels.
 *
 * ## Les deux régimes
 *
 * | | Taxe forfaitaire (défaut) | Plus-values sur biens meubles (option) |
 * |---|---|---|
 * | Assiette | prix de cession **brut** | plus-value nette |
 * | Taux | **11,5 %** (11 % + 0,5 % CRDS) | **37,6 %** (19 % IR + 18,6 % PS) |
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
 * plus-value / prix de vente**. Tant que la plus-value nette d'abattement
 * représente moins de 30,6 % environ du prix de vente, le régime réel coûte
 * moins cher ; au-delà, la taxe forfaitaire reprend l'avantage. Une revente
 * quasi au prix d'achat rend le régime réel presque gratuit, là où les 11,5 %
 * frappent quand même.
 *
 * Mais sans facture nominative et datée, l'option est fermée : le vendeur
 * subit les 11,5 % même quand ils coûtent trois fois plus. Ce module refuse
 * donc de « recommander » un régime inaccessible — il annonce l'économie
 * perdue, ce qui est une information actionnable pour les achats à venir.
 */

import { d, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";
import {
  MOVABLE_CAPITAL_GAIN_INCOME_TAX_RATE,
  MOVABLE_CAPITAL_GAIN_TOTAL_RATE,
  SOCIAL_CHARGES_RATE,
} from "@/app/lib/tax/rates";

/** Taxe forfaitaire : 11 % + 0,5 % de CRDS, assise sur le prix de cession. */
export const FLAT_METAL_TAX_RATE = "0.115";
export const FLAT_METAL_TAX_BASE_RATE = "0.11";
export const FLAT_METAL_TAX_CRDS_RATE = "0.005";

/** Abattement par année de détention, à compter de la 3ᵉ. */
export const HOLDING_ALLOWANCE_PER_YEAR = "0.05";
/** Années sans abattement : la 1ʳᵉ et la 2ᵉ. */
export const HOLDING_ALLOWANCE_FREE_YEARS = 2;
/** Durée au terme de laquelle l'abattement atteint 100 %. */
export const FULL_EXEMPTION_YEARS = 22;

export const METAL_TAX_REGIMES = ["FORFAIT", "PLUS_VALUE"] as const;
export type MetalTaxRegime = (typeof METAL_TAX_REGIMES)[number];

export const REGIME_LABELS: Record<MetalTaxRegime, string> = {
  FORFAIT: "Taxe forfaitaire (11,5 %)",
  PLUS_VALUE: "Plus-value sur biens meubles (37,6 %)",
};

export const REGIME_FORMS: Record<MetalTaxRegime, string> = {
  FORFAIT: "2091-SD",
  PLUS_VALUE: "2092-SD",
};

export type MetalSaleInput = {
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

export type RegimeResult = {
  regime: MetalTaxRegime;
  /** Montant sur lequel le taux s'applique. */
  taxableBaseEur: string;
  taxEur: string;
  /** Produit net de la vente, impôt et frais déduits. */
  netProceedsEur: string;
  form: string;
  /** `false` quand la loi ferme ce régime au vendeur. */
  available: boolean;
  unavailableReason: string | null;
};

export type MetalSaleTax = {
  grossGainEur: string;
  /** Années **révolues** de détention au jour de la vente. */
  holdingYears: number;
  /** Taux d'abattement appliqué, de 0 à 1. */
  allowanceRate: string;
  allowanceEur: string;
  exempt: boolean;
  flat: RegimeResult;
  capitalGain: RegimeResult;
  /** Régime le moins coûteux **parmi ceux réellement ouverts**. */
  recommended: MetalTaxRegime;
  savingsEur: string;
  /**
   * Économie perdue faute de justificatif : nulle si l'option est ouverte, ou
   * si elle aurait de toute façon coûté plus cher.
   */
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

/**
 * Calcule les deux régimes pour une cession et désigne le moins coûteux.
 *
 * Aucun arrondi intermédiaire : les montants ne sont figés à deux décimales
 * qu'à la sortie, pour que la comparaison des deux régimes ne dépende pas de
 * l'ordre des opérations.
 */
export function computeMetalSaleTax(input: MetalSaleInput): MetalSaleTax {
  const salePrice = d(input.salePriceEur);
  const costBasis = d(input.costBasisEur ?? 0);
  const saleFees = d(input.saleFeesEur ?? 0);
  const soldAt = toDate(input.soldAt) ?? new Date();
  const acquiredAt = toDate(input.acquiredAt);

  const holdingYears = acquiredAt ? completedYearsBetween(acquiredAt, soldAt) : 0;
  const allowanceRate = holdingAllowanceRate(holdingYears);
  const exempt = allowanceRate.gte(1);

  // La plus-value du régime réel se calcule net des frais de vente : ils
  // réduisent le prix de cession retenu, alors qu'ils sont sans effet sur
  // l'assiette forfaitaire, assise sur le prix brut.
  const grossGain = salePrice.minus(saleFees).minus(costBasis);
  const positiveGain = grossGain.gt(0) ? grossGain : d(0);
  const allowance = positiveGain.times(allowanceRate);
  const taxableGain = positiveGain.minus(allowance);

  const flatTax = salePrice.times(FLAT_METAL_TAX_RATE);
  const gainTax = taxableGain.times(MOVABLE_CAPITAL_GAIN_TOTAL_RATE);

  // L'option suppose de prouver la date **et** le prix d'acquisition — sauf
  // détention de plus de 22 ans, où l'exonération se démontre par la seule
  // ancienneté (art. 150 VL CGI).
  const provable = Boolean(input.hasInvoice) && acquiredAt !== null;
  const optionOpen = provable || (acquiredAt !== null && holdingYears >= FULL_EXEMPTION_YEARS);

  const flat: RegimeResult = {
    regime: "FORFAIT",
    taxableBaseEur: salePrice.toFixed(2),
    taxEur: flatTax.toFixed(2),
    netProceedsEur: salePrice.minus(saleFees).minus(flatTax).toFixed(2),
    form: REGIME_FORMS.FORFAIT,
    available: true,
    unavailableReason: null,
  };

  const capitalGain: RegimeResult = {
    regime: "PLUS_VALUE",
    taxableBaseEur: taxableGain.toFixed(2),
    taxEur: gainTax.toFixed(2),
    netProceedsEur: salePrice.minus(saleFees).minus(gainTax).toFixed(2),
    form: REGIME_FORMS.PLUS_VALUE,
    available: optionOpen,
    unavailableReason: optionOpen
      ? null
      : acquiredAt === null
        ? "Date d'acquisition inconnue : l'option pour le régime réel est fermée."
        : "Sans facture nominative et datée, l'option pour le régime réel est fermée.",
  };

  const optionCheaper = gainTax.lt(flatTax);
  const recommended: MetalTaxRegime =
    optionOpen && optionCheaper ? "PLUS_VALUE" : "FORFAIT";
  const savings =
    recommended === "PLUS_VALUE" ? flatTax.minus(gainTax) : d(0);
  const forgone = !optionOpen && optionCheaper ? flatTax.minus(gainTax) : d(0);

  return {
    grossGainEur: grossGain.toFixed(2),
    holdingYears,
    allowanceRate: allowanceRate.toFixed(4),
    allowanceEur: allowance.toFixed(2),
    exempt,
    flat,
    capitalGain,
    recommended,
    savingsEur: savings.toFixed(2),
    forgoneSavingsEur: forgone.toFixed(2),
    rationale: explain({
      optionOpen,
      optionCheaper,
      exempt,
      holdingYears,
      grossGain,
      forgone,
      savings,
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
  optionOpen: boolean;
  optionCheaper: boolean;
  exempt: boolean;
  holdingYears: number;
  grossGain: Decimal;
  forgone: Decimal;
  savings: Decimal;
}): string {
  if (!ctx.optionOpen) {
    return ctx.forgone.gt(0)
      ? `Faute de justificatif d'acquisition, la taxe forfaitaire s'impose : ${eur(
          ctx.forgone
        )} d'impôt en plus par rapport au régime réel.`
      : "Faute de justificatif d'acquisition, la taxe forfaitaire s'impose — elle reste ici la moins coûteuse.";
  }
  if (ctx.exempt) {
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

/** Détail du taux forfaitaire, pour l'afficher sans le réinventer côté UI. */
export const FLAT_TAX_BREAKDOWN = [
  { label: "Taxe sur les métaux précieux", rate: FLAT_METAL_TAX_BASE_RATE },
  { label: "CRDS", rate: FLAT_METAL_TAX_CRDS_RATE },
] as const;

/** Détail du régime réel. */
export const CAPITAL_GAIN_BREAKDOWN = [
  { label: "Impôt sur le revenu", rate: MOVABLE_CAPITAL_GAIN_INCOME_TAX_RATE },
  { label: "Prélèvements sociaux", rate: SOCIAL_CHARGES_RATE },
] as const;

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
      sale.regime && computed[sale.regime === "FORFAIT" ? "flat" : "capitalGain"].available
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
