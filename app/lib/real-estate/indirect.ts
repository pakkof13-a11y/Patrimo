/**
 * Immobilier détenu indirectement — SCPI, SCI, OPCI, foncières cotées.
 *
 * Module pur : vocabulaire et règles d'assiette IFI, sans accès base.
 *
 * Le principe qui structure tout : ces véhicules **sont déjà des positions du
 * journal** (parts × prix de part), exactement comme une action. Rien n'est
 * valorisé ici. Ne vivent dans ce module que les caractéristiques propres au
 * véhicule et la part de sa valeur qui entre dans l'assiette IFI.
 */

import { d, zero, type Decimal, type DecimalInput } from "@/app/lib/money/decimal";

export const INDIRECT_VEHICLES = {
  SCPI: "SCPI (société civile de placement immobilier)",
  SCI_IR: "SCI à l'impôt sur le revenu",
  SCI_IS: "SCI à l'impôt sur les sociétés",
  OPCI: "OPCI (organisme de placement collectif immobilier)",
  SIIC: "SIIC / foncière cotée",
  GFI: "Groupement forestier ou foncier",
  AUTRE: "Autre véhicule",
} as const;

export type IndirectVehicle = keyof typeof INDIRECT_VEHICLES;

export const TAX_TRANSPARENCY = {
  IR: "Transparente — imposition chez l'associé (IR)",
  IS: "Opaque — imposition au niveau de la société (IS)",
  EXONERE: "Exonérée",
} as const;

export type TaxTransparency = keyof typeof TAX_TRANSPARENCY;

/**
 * Quote-part immobilière retenue par défaut, en %.
 *
 * Une SCPI ou une SCI n'a pratiquement que de l'immobilier à l'actif : 100 %
 * est le point de départ raisonnable. Un OPCI détient réglementairement au
 * moins 60 % d'immobilier, le reste étant financier et liquide — d'où un
 * défaut plus prudent, que l'utilisateur corrige avec le chiffre publié.
 */
export const DEFAULT_REAL_ESTATE_SHARE_PCT: Record<IndirectVehicle, number> = {
  SCPI: 100,
  SCI_IR: 100,
  SCI_IS: 100,
  OPCI: 60,
  SIIC: 100,
  GFI: 0,
  AUTRE: 100,
};

/**
 * Seuil d'exonération des titres de sociétés cotées à prépondérance
 * immobilière (art. 972 bis) : en deçà de 5 % du capital, les parts ne sont
 * pas comprises dans l'assiette IFI.
 */
export const LISTED_EXEMPTION_STAKE_PCT = d(5);

/** Véhicules cotés, seuls concernés par l'exonération des 5 %. */
export const LISTED_VEHICLES: readonly IndirectVehicle[] = ["SIIC"];

export function vehicleLabel(value: string): string {
  return INDIRECT_VEHICLES[value as IndirectVehicle] ?? value;
}

export function transparencyLabel(value: string): string {
  return TAX_TRANSPARENCY[value as TaxTransparency] ?? value;
}

export type IndirectHolding = {
  assetId: string;
  label: string;
  vehicle: string;
  /** Valeur de marché de la position, issue du journal. */
  marketValueEur: DecimalInput;
  realEstateSharePct?: DecimalInput | null;
  ownershipStakePct?: DecimalInput | null;
  ifiExcluded?: boolean;
};

export type IndirectIfiAssessment = {
  /** Fraction immobilière retenue, en %. */
  sharePct: Decimal;
  /** Valeur entrant dans l'assiette IFI. */
  taxableValueEur: Decimal;
  excluded: boolean;
  /** Motif d'exclusion, à afficher tel quel. */
  exclusionReason: string | null;
};

/**
 * Part d'un véhicule indirect entrant dans l'assiette IFI.
 *
 * Trois cas d'exclusion, dans cet ordre :
 * 1. exclusion manuelle par le porteur ;
 * 2. foncière cotée détenue à moins de 5 % du capital (art. 972 bis) —
 *    c'est la règle qui sort la plupart des lignes de foncières cotées d'un
 *    portefeuille de particulier, et l'oublier gonfle l'assiette à tort ;
 * 3. véhicule sans actif immobilier imposable (part à 0 %).
 */
export function assessIndirectForIfi(
  holding: IndirectHolding
): IndirectIfiAssessment {
  const value = d(holding.marketValueEur);

  const none = (reason: string | null): IndirectIfiAssessment => ({
    sharePct: zero(),
    taxableValueEur: zero(),
    excluded: true,
    exclusionReason: reason,
  });

  if (holding.ifiExcluded) return none("Exclu manuellement de l'assiette");

  const vehicle = holding.vehicle as IndirectVehicle;

  if ((LISTED_VEHICLES as readonly string[]).includes(vehicle)) {
    const stake = holding.ownershipStakePct != null ? d(holding.ownershipStakePct) : null;
    // Sans participation renseignée, on suppose un porteur minoritaire :
    // c'est le cas de très loin le plus fréquent pour une foncière cotée, et
    // l'hypothèse inverse ferait payer un impôt qui n'est pas dû.
    if (stake == null || stake.lt(LISTED_EXEMPTION_STAKE_PCT)) {
      return none("Foncière cotée détenue à moins de 5 % — hors assiette IFI");
    }
  }

  const sharePct =
    holding.realEstateSharePct != null
      ? d(holding.realEstateSharePct)
      : d(DEFAULT_REAL_ESTATE_SHARE_PCT[vehicle] ?? 100);

  if (sharePct.lte(0)) {
    return none("Aucune fraction immobilière imposable");
  }

  return {
    sharePct,
    taxableValueEur: value.times(sharePct).div(100),
    excluded: false,
    exclusionReason: null,
  };
}

/**
 * Revenu annuel attendu d'un véhicule, d'après son taux de distribution.
 *
 * Purement indicatif : le taux affiché par une société de gestion est un
 * historique, pas un engagement.
 */
export function expectedAnnualIncomeEur(
  marketValueEur: DecimalInput,
  distributionRatePct?: DecimalInput | null
): Decimal {
  if (distributionRatePct == null) return zero();
  return d(marketValueEur).times(d(distributionRatePct)).div(100);
}
