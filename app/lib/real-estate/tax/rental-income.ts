/**
 * Revenus locatifs : arbitrage micro / réel, location nue (2044) et meublée
 * (BIC). Module pur.
 *
 * Deux différences de fond entre les deux régimes, souvent confondues :
 *
 * - **Nu (revenus fonciers)** : micro-foncier à 30 % d'abattement, plafonné à
 *   15 000 € de recettes brutes. Au réel, le déficit foncier s'impute sur le
 *   revenu global dans la limite de 10 700 €, mais **seulement pour la part
 *   qui ne provient pas des intérêts d'emprunt** — les intérêts ne peuvent
 *   créer qu'un déficit reportable sur les revenus fonciers futurs.
 * - **Meublé (BIC)** : micro-BIC à 50 %, plafond 77 700 €. Le réel autorise
 *   l'amortissement du bien, qui n'existe pas en location nue et explique
 *   l'essentiel de l'avantage du LMNP.
 *
 * Les plafonds et taux sont regroupés en constantes exportées : ils bougent en
 * loi de finances, et il vaut mieux un point unique à corriger qu'une valeur
 * disséminée dans les calculs.
 */

import { d, zero, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";

/** Location nue — micro-foncier (CGI art. 32). */
export const MICRO_FONCIER_ABATEMENT = d("0.30");
export const MICRO_FONCIER_CEILING = d(15_000);

/** Location meublée — micro-BIC de droit commun (CGI art. 50-0). */
export const MICRO_BIC_ABATEMENT = d("0.50");
export const MICRO_BIC_CEILING = d(77_700);

/** Meublé de tourisme classé — abattement majoré. */
export const MICRO_BIC_TOURISM_CLASSIFIED_ABATEMENT = d("0.71");
export const MICRO_BIC_TOURISM_CLASSIFIED_CEILING = d(188_700);

/** Plafond d'imputation du déficit foncier sur le revenu global (art. 156). */
export const DEFICIT_GLOBAL_CAP = d(10_700);

/** Prélèvements sociaux sur les revenus du patrimoine. */
export const SOCIAL_RATE = d("0.172");

export type RentalRegime =
  | "MICRO_FONCIER"
  | "REEL_FONCIER"
  | "MICRO_BIC"
  | "REEL_BIC";

export type RentalIncomeInput = {
  /** Recettes brutes encaissées sur l'exercice. */
  grossRentEur: DecimalInput;

  /** Charges déductibles au réel (hors intérêts d'emprunt). */
  deductibleChargesEur?: DecimalInput;
  /**
   * Intérêts d'emprunt. Isolés des autres charges : le déficit qu'ils
   * engendrent n'est pas imputable sur le revenu global.
   */
  loanInterestEur?: DecimalInput;
  /** Amortissement — meublé au réel uniquement. */
  depreciationEur?: DecimalInput;

  /** Meublé de tourisme classé : ouvre l'abattement majoré. */
  isClassifiedTourism?: boolean;

  /** Tranche marginale d'imposition, en pourcentage (0, 11, 30, 41, 45). */
  marginalTaxRatePct: DecimalInput;
};

export type RegimeOutcome = {
  regime: RentalRegime;
  /** Régime ouvert compte tenu des plafonds de recettes. */
  eligible: boolean;
  /** Raison d'inéligibilité, à afficher tel quel. */
  ineligibilityReason: string | null;
  /** Abattement forfaitaire ou charges réelles retenues. */
  deductionEur: Decimal;
  /** Résultat imposable, plancher à zéro. */
  taxableIncomeEur: Decimal;
  /** Déficit imputable sur le revenu global (foncier réel seulement). */
  deficitOffsetGlobalEur: Decimal;
  /** Déficit reportable sur les revenus de même nature. */
  deficitCarriedForwardEur: Decimal;
  incomeTaxEur: Decimal;
  socialTaxEur: Decimal;
  totalTaxEur: Decimal;
  /** Revenu net après impôt et prélèvements sociaux. */
  netAfterTaxEur: Decimal;
};

function taxOf(taxable: Decimal, marginalRatePct: Decimal) {
  const incomeTax = taxable.times(marginalRatePct).div(100);
  const socialTax = taxable.times(SOCIAL_RATE);
  return { incomeTax, socialTax, total: incomeTax.plus(socialTax) };
}

/** Évalue un régime donné sur les mêmes données d'entrée. */
export function evaluateRegime(
  regime: RentalRegime,
  input: RentalIncomeInput
): RegimeOutcome {
  const gross = d(input.grossRentEur);
  const tmi = d(input.marginalTaxRatePct);
  const charges = d(input.deductibleChargesEur ?? 0);
  const interest = d(input.loanInterestEur ?? 0);
  const depreciation = d(input.depreciationEur ?? 0);

  const base = (
    partial: Partial<RegimeOutcome> & Pick<RegimeOutcome, "deductionEur" | "taxableIncomeEur">
  ): RegimeOutcome => {
    const { incomeTax, socialTax, total } = taxOf(partial.taxableIncomeEur, tmi);
    return {
      regime,
      eligible: true,
      ineligibilityReason: null,
      deficitOffsetGlobalEur: zero(),
      deficitCarriedForwardEur: zero(),
      incomeTaxEur: incomeTax,
      socialTaxEur: socialTax,
      totalTaxEur: total,
      netAfterTaxEur: gross.minus(total),
      ...partial,
    };
  };

  if (regime === "MICRO_FONCIER") {
    if (gross.gt(MICRO_FONCIER_CEILING)) {
      return {
        ...base({ deductionEur: zero(), taxableIncomeEur: zero() }),
        eligible: false,
        ineligibilityReason: `Recettes de ${gross.toFixed(0)} € : au-delà du plafond micro-foncier de ${MICRO_FONCIER_CEILING.toFixed(0)} €.`,
        netAfterTaxEur: zero(),
        totalTaxEur: zero(),
        incomeTaxEur: zero(),
        socialTaxEur: zero(),
      };
    }
    const deduction = gross.times(MICRO_FONCIER_ABATEMENT);
    return base({ deductionEur: deduction, taxableIncomeEur: gross.minus(deduction) });
  }

  if (regime === "MICRO_BIC") {
    const ceiling = input.isClassifiedTourism
      ? MICRO_BIC_TOURISM_CLASSIFIED_CEILING
      : MICRO_BIC_CEILING;
    const rate = input.isClassifiedTourism
      ? MICRO_BIC_TOURISM_CLASSIFIED_ABATEMENT
      : MICRO_BIC_ABATEMENT;

    if (gross.gt(ceiling)) {
      return {
        ...base({ deductionEur: zero(), taxableIncomeEur: zero() }),
        eligible: false,
        ineligibilityReason: `Recettes de ${gross.toFixed(0)} € : au-delà du plafond micro-BIC de ${ceiling.toFixed(0)} €.`,
        netAfterTaxEur: zero(),
        totalTaxEur: zero(),
        incomeTaxEur: zero(),
        socialTaxEur: zero(),
      };
    }
    const deduction = gross.times(rate);
    return base({ deductionEur: deduction, taxableIncomeEur: gross.minus(deduction) });
  }

  if (regime === "REEL_BIC") {
    // Le meublé au réel amortit le bien : c'est ce poste qui neutralise
    // souvent l'imposition les premières années.
    const totalDeductions = charges.plus(interest).plus(depreciation);
    const result = gross.minus(totalDeductions);
    const taxable = result.lt(0) ? zero() : result;
    return {
      ...base({ deductionEur: totalDeductions, taxableIncomeEur: taxable }),
      // Le déficit BIC non professionnel ne s'impute que sur des BIC de même
      // nature — jamais sur le revenu global.
      deficitCarriedForwardEur: result.lt(0) ? result.negated() : zero(),
    };
  }

  // REEL_FONCIER
  const totalDeductions = charges.plus(interest);
  const result = gross.minus(totalDeductions);

  if (result.gte(0)) {
    return base({ deductionEur: totalDeductions, taxableIncomeEur: result });
  }

  // Déficit : la part imputable sur le revenu global exclut les intérêts.
  // On reconstitue donc le déficit « hors intérêts » avant plafonnement.
  const deficit = result.negated();
  const deficitExcludingInterest = (() => {
    const withoutInterest = gross.minus(charges);
    return withoutInterest.lt(0) ? withoutInterest.negated() : zero();
  })();

  const offsetGlobal = deficitExcludingInterest.gt(DEFICIT_GLOBAL_CAP)
    ? DEFICIT_GLOBAL_CAP
    : deficitExcludingInterest;

  const carried = deficit.minus(offsetGlobal);

  return {
    ...base({ deductionEur: totalDeductions, taxableIncomeEur: zero() }),
    deficitOffsetGlobalEur: offsetGlobal,
    deficitCarriedForwardEur: carried.lt(0) ? zero() : carried,
    // Aucun impôt sur un résultat déficitaire ; l'économie procurée par
    // l'imputation sur le revenu global n'est pas comptée ici comme un gain,
    // elle relève de la déclaration d'ensemble.
    netAfterTaxEur: gross.minus(totalDeductions),
  };
}

export type RentalComparison = {
  outcomes: RegimeOutcome[];
  /** Régime le moins imposé parmi ceux qui sont ouverts. */
  best: RegimeOutcome | null;
  /** Économie annuelle du meilleur régime sur le second. */
  savingVsNextEur: Decimal;
};

/**
 * Compare les régimes praticables pour une location donnée.
 *
 * `furnished` détermine le couple comparé : nu → micro-foncier vs réel foncier,
 * meublé → micro-BIC vs réel BIC. Comparer un régime nu à un régime meublé
 * n'aurait pas de sens : le choix du mode de location précède celui du régime.
 */
export function compareRentalRegimes(
  input: RentalIncomeInput,
  furnished: boolean
): RentalComparison {
  const regimes: RentalRegime[] = furnished
    ? ["MICRO_BIC", "REEL_BIC"]
    : ["MICRO_FONCIER", "REEL_FONCIER"];

  const outcomes = regimes.map((r) => evaluateRegime(r, input));
  const eligible = outcomes.filter((o) => o.eligible);

  if (eligible.length === 0) {
    return { outcomes, best: null, savingVsNextEur: zero() };
  }

  const sorted = [...eligible].sort((a, b) =>
    a.totalTaxEur.minus(b.totalTaxEur).toNumber()
  );
  const best = sorted[0]!;
  const saving =
    sorted.length > 1 ? sorted[1]!.totalTaxEur.minus(best.totalTaxEur) : zero();

  return { outcomes, best, savingVsNextEur: saving };
}
