/**
 * Livrets réglementés — plafonds légaux et taux de référence.
 *
 * Ces chiffres sont fixés par décret et révisés périodiquement (le taux du
 * Livret A et du LDDS deux fois par an, en février et en août). Ils sont
 * déclaratifs ici, comme `apyPct` sur une position DeFi : ils servent à
 * pré-remplir un plafond et à signaler un taux saisi qui s'écarte franchement
 * du taux réglementé, jamais à valider ou corriger silencieusement la saisie
 * de l'utilisateur. Une mise à jour de ces valeurs après un décret est un
 * changement de code, pas un fetch réseau.
 */

export type RegulatedProductType =
  | "LIVRET_A"
  | "LDDS"
  | "LEP"
  | "PEL"
  | "CEL"
  | "AUTRE";

export const REGULATED_PRODUCT_LABELS: Record<RegulatedProductType, string> = {
  LIVRET_A: "Livret A",
  LDDS: "LDDS",
  LEP: "LEP",
  PEL: "PEL",
  CEL: "CEL",
  AUTRE: "Livret (autre)",
};

export type RegulatedProductInfo = {
  /** Plafond de versement légal, en euros — hors intérêts capitalisés. */
  ceilingAmount: string;
  /** Taux réglementé de référence en %, si publié et stable au moment du build. */
  referenceRatePct?: string;
};

/**
 * Plafonds connus au moment de l'écriture (2026). Volontairement limité aux
 * produits dont le plafond est un chiffre réglementaire unique et publié —
 * le CEL a un plafond légal mais dépend de conventions bancaires plus
 * variables, donc pas de valeur pré-remplie ici plutôt qu'un chiffre incertain.
 */
export const REGULATED_PRODUCT_INFO: Partial<
  Record<RegulatedProductType, RegulatedProductInfo>
> = {
  LIVRET_A: { ceilingAmount: "22950", referenceRatePct: "2.4" },
  LDDS: { ceilingAmount: "12000", referenceRatePct: "2.4" },
  LEP: { ceilingAmount: "10000" },
  PEL: { ceilingAmount: "61200" },
};

/**
 * % du plafond atteint par le solde. Null si aucun plafond n'est défini —
 * pas de barre de progression sans quoi comparer. Volontairement non
 * plafonné à 100 : un dépassement (versements + intérêts capitalisés qui
 * franchissent le plafond légal, ce qui arrive réellement sur un Livret A)
 * doit rester visible plutôt que d'être écrasé à 100 %.
 */
export function ceilingProgressPct(
  balance: string | number,
  ceilingAmount: string | number | null | undefined
): number | null {
  const ceiling = Number(ceilingAmount);
  if (!ceilingAmount || !Number.isFinite(ceiling) || ceiling <= 0) return null;
  const bal = Number(balance);
  if (!Number.isFinite(bal)) return null;
  return (bal / ceiling) * 100;
}

/** Seuil au-delà duquel la progression du plafond déclenche une alerte visuelle. */
export const CEILING_ALERT_THRESHOLD_PCT = 95;

/** Au-delà de cet écart au taux réglementé, le taux saisi est signalé comme suspect. */
const RATE_DEVIATION_ALERT_PCT = 1.5;

/**
 * Le taux saisi s'écarte-t-il fortement du taux réglementé de référence ?
 * Renvoie `false` si le produit n'a pas de taux de référence connu (rien à
 * comparer) — ne jamais interpréter l'absence de donnée comme une anomalie.
 */
export function isRateSuspicious(
  productType: string,
  enteredRatePct: string | number
): boolean {
  const info = REGULATED_PRODUCT_INFO[productType as RegulatedProductType];
  if (!info?.referenceRatePct) return false;
  const entered = Number(enteredRatePct);
  const reference = Number(info.referenceRatePct);
  if (!Number.isFinite(entered) || !Number.isFinite(reference)) return false;
  return Math.abs(entered - reference) > RATE_DEVIATION_ALERT_PCT;
}
