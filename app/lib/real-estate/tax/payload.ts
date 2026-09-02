/**
 * Forme sérialisée de `/api/real-estate/tax`.
 *
 * Extraite du panneau fiscal de l'onglet Immobilier, qui la déclarait
 * localement. Le module Fiscalité consomme la même réponse : deux
 * déclarations parallèles auraient divergé à la première évolution du
 * calculateur.
 *
 * Les montants sont des chaînes : les `Decimal` du moteur ne sont pas
 * sérialisables, et passer par `number` perdrait de la précision sur des
 * assiettes à sept chiffres.
 */

import type { MarginalRateSource } from "@/app/lib/tax/marginal-rate";

export type RegimeOutcome = {
  regime: string;
  eligible: boolean;
  ineligibilityReason: string | null;
  deductionEur: string;
  taxableIncomeEur: string;
  deficitOffsetGlobalEur: string;
  deficitCarriedForwardEur: string;
  incomeTaxEur: string;
  socialTaxEur: string;
  totalTaxEur: string;
  netAfterTaxEur: string;
};

export type RentalSection = {
  /** 0 signifie « section sans objet » — aucun bien loué dans ce mode. */
  count: number;
  grossRentEur: string;
  deductibleChargesEur: string;
  outcomes: RegimeOutcome[];
  bestRegime: string | null;
  /** Écart d'impôt entre le meilleur régime et le suivant. */
  savingVsNextEur: string;
};

export type SchemeRow = {
  assetId: string;
  label: string;
  scheme: string;
  eligibleBaseEur: string;
  totalReductionEur: string;
  annualReductionEur: string;
  yearsElapsed: number;
  yearsRemaining: number;
  finished: boolean;
  subjectToGlobalCap: boolean;
  baseWasCapped: boolean;
  note: string | null;
};

export type SchemesBlock = {
  rows: SchemeRow[];
  summary: {
    totalAnnualEur: string;
    cappedAnnualEur: string;
    uncappedAnnualEur: string;
    cappedAwayEur: string;
    /** Réduction réellement imputable après plafonnement global. */
    effectiveAnnualEur: string;
  };
};

export type IfiLine = {
  id: string;
  label: string;
  grossValueEur: string;
  allowanceEur: string;
  taxableValueEur: string;
  deductibleDebtEur: string;
  netValueEur: string;
  excluded: boolean;
};

export type IfiBlock = {
  lines: IfiLine[];
  grossTaxableEur: string;
  totalDeductibleDebtEur: string;
  netTaxableEur: string;
  /** Vrai si l'assiette nette dépasse le seuil de 1,3 M€. */
  liable: boolean;
  grossTaxEur: string;
  discountEur: string;
  taxEur: string;
  effectiveRatePct: string;
};

export type RealEstateTaxBundlePayload = {
  schemes: SchemesBlock;
  properties: Array<{ assetId: string; label: string; isRental: boolean }>;
  ifi: IfiBlock;
  /**
   * Tranche marginale réellement appliquée au calcul.
   *
   * **Déclarée**, jamais calculée : Aurea ne connaît ni les salaires ni la
   * composition du foyer. `marginalTaxRateSource` dit d'où elle vient, et
   * l'interface doit s'en servir — un défaut et une tranche déclarée ne
   * méritent pas la même assurance.
   */
  marginalTaxRatePct: number;
  marginalTaxRateSource: MarginalRateSource;
  rental: { bare: RentalSection; furnished: RentalSection };
};

/** Seuil d'assujettissement à l'IFI. */
export const IFI_THRESHOLD_EUR = 1_300_000;
