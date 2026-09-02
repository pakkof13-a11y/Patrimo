/**
 * Vocabulaire des supports d'assurance-vie.
 *
 * Module pur, sans Prisma : importable par les composants clients sans traîner
 * le client de base de données dans le bundle.
 */

/**
 * Nature d'un support.
 *
 * Le fonds euro est distingué de l'UC parce que sa mécanique diffère sur le
 * point qui compte : capital garanti par l'assureur, donc aucune volatilité à
 * afficher et un classement obligataire, là où une UC porte le risque.
 */
export const SUPPORT_KINDS = {
  FONDS_EURO: "Fonds euro",
  UC: "Unité de compte",
  STRUCTURED: "Produit structuré",
} as const;

export type SupportKind = keyof typeof SUPPORT_KINDS;

export function supportKindLabel(kind: string): string {
  return SUPPORT_KINDS[kind as SupportKind] ?? kind;
}

export function isStructured(kind: string): boolean {
  return kind === "STRUCTURED";
}

/**
 * Périodicité de versement du coupon.
 *
 * `MATURITY` couvre les produits qui ne versent rien en cours de vie et
 * capitalisent jusqu'à l'échéance — fréquents parmi les structurés à capital
 * protégé, et qu'un simple « annuel » décrirait faux.
 */
export const COUPON_FREQUENCIES = {
  MONTHLY: "Mensuel",
  QUARTERLY: "Trimestriel",
  SEMIANNUAL: "Semestriel",
  ANNUAL: "Annuel",
  MATURITY: "À l'échéance",
} as const;

export type CouponFrequency = keyof typeof COUPON_FREQUENCIES;

export function couponFrequencyLabel(f: string): string {
  return COUPON_FREQUENCIES[f as CouponFrequency] ?? f;
}

/** Nombre de versements par an — 0 pour un produit qui ne verse qu'à l'échéance. */
export function couponsPerYear(frequency: string): number {
  switch (frequency) {
    case "MONTHLY":
      return 12;
    case "QUARTERLY":
      return 4;
    case "SEMIANNUAL":
      return 2;
    case "ANNUAL":
      return 1;
    default:
      return 0;
  }
}

/**
 * Classe d'actif d'un support, pour l'allocation du patrimoine.
 *
 * Un fonds euro est adossé à de l'obligataire. Une UC est inconnue par défaut :
 * la ranger d'office en actions serait faux pour un fonds obligataire ou
 * monétaire, et l'utilisateur peut reclasser depuis Positions. Un structuré est
 * classé « AUTRE » — ni action ni obligation, c'est un dérivé de crédit dont le
 * comportement ne suit aucune des deux classes.
 */
export function assetClassForKind(kind: string): string {
  if (kind === "FONDS_EURO") return "OBLIGATIONS";
  return "AUTRE";
}

/**
 * Montant d'un coupon périodique, en euros.
 *
 * Le taux est **annuel** par convention de marché : un produit à 8 % versé
 * trimestriellement verse 2 % par trimestre, pas 8 %. Confondre les deux
 * multiplierait le revenu attendu par quatre.
 *
 * Rend null quand le calcul n'a pas de sens — pas de nominal, pas de taux, ou
 * versement à l'échéance seule (auquel cas il n'y a pas de « coupon
 * périodique » à calculer).
 */
export function periodicCouponEur(input: {
  nominalEur: number | null;
  couponRatePct: number | null;
  couponFrequency: string;
}): number | null {
  const { nominalEur, couponRatePct, couponFrequency } = input;
  if (!nominalEur || nominalEur <= 0) return null;
  if (couponRatePct == null || couponRatePct <= 0) return null;
  const perYear = couponsPerYear(couponFrequency);
  if (perYear === 0) return null;
  return (nominalEur * couponRatePct) / 100 / perYear;
}

/**
 * Coupon annuel total attendu, en euros.
 *
 * Inclut les produits « à l'échéance » : le taux annuel court, même si rien
 * n'est versé avant le terme.
 */
export function annualCouponEur(input: {
  nominalEur: number | null;
  couponRatePct: number | null;
}): number | null {
  const { nominalEur, couponRatePct } = input;
  if (!nominalEur || nominalEur <= 0) return null;
  if (couponRatePct == null || couponRatePct <= 0) return null;
  return (nominalEur * couponRatePct) / 100;
}

/**
 * Le sous-jacent est-il au-dessus d'une barrière ?
 *
 * Les barrières sont exprimées en pourcentage du **niveau initial de
 * constatation** (le strike), pas en points d'indice : c'est la convention des
 * termsheets, et elle rend la comparaison indépendante du niveau absolu.
 *
 * Rend null quand la comparaison est impossible faute de strike ou de barrière —
 * plutôt que `false`, qui se lirait à tort comme « barrière franchie à la
 * baisse » et annoncerait une perte de capital qui n'est pas établie.
 */
export function isAboveBarrier(input: {
  currentLevel: number | null;
  strikeLevel: number | null;
  barrierPct: number | null;
}): boolean | null {
  const { currentLevel, strikeLevel, barrierPct } = input;
  if (currentLevel == null || strikeLevel == null || barrierPct == null) {
    return null;
  }
  if (strikeLevel <= 0) return null;
  return currentLevel >= (strikeLevel * barrierPct) / 100;
}

/**
 * Performance du sous-jacent depuis la constatation initiale, en %.
 *
 * C'est cette performance, et non celle du support, qui détermine coupon et
 * remboursement d'un structuré.
 */
export function underlyingPerformancePct(input: {
  currentLevel: number | null;
  strikeLevel: number | null;
}): number | null {
  const { currentLevel, strikeLevel } = input;
  if (currentLevel == null || strikeLevel == null || strikeLevel <= 0) {
    return null;
  }
  return ((currentLevel - strikeLevel) / strikeLevel) * 100;
}
