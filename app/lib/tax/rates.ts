/**
 * Taux d'imposition des revenus du capital — source unique.
 *
 * Ces taux sont fixés par la loi et révisés par voie législative : les mettre à
 * jour est un changement de code, jamais un appel réseau. Les rassembler ici
 * plutôt que de les répéter dans chaque module évite qu'une révision n'en
 * corrige qu'une partie — ce qui s'est précisément produit au 1ᵉʳ janvier 2026.
 *
 * ## Ce qui a changé en 2026
 *
 * La loi de financement de la Sécurité sociale pour 2026 a porté la CSG sur le
 * capital de 9,2 % à 10,6 %. Les prélèvements sociaux passent donc de 17,2 % à
 * **18,6 %**, et le prélèvement forfaitaire unique de 30 % à **31,4 %**.
 *
 * ## Ce qui ne change pas
 *
 * La hausse ne touche pas tout : l'assurance-vie, les PEL/CEL/PEP, les revenus
 * fonciers et les plus-values immobilières **restent à 17,2 %**. C'est pourquoi
 * `life-insurance/fiscal.ts` et `real-estate/tax/` gardent leur propre
 * constante au lieu d'importer celle-ci — leur alignement serait une
 * régression, pas une harmonisation.
 *
 * ## « Flat tax » et « PFU »
 *
 * Ce sont deux noms du même dispositif, pas deux options. Le choix réel est
 * entre le PFU et le **barème progressif** de l'impôt sur le revenu, sur option
 * globale (case 2OP de la déclaration 2042) — option qui porte sur l'ensemble
 * des revenus du capital de l'année, et non produit par produit.
 */

/** Part « impôt sur le revenu » du prélèvement forfaitaire unique. */
export const PFU_INCOME_TAX_RATE = "0.128";

/**
 * Prélèvements sociaux sur les revenus du capital, depuis le 1ᵉʳ janvier 2026.
 *
 * Ne s'applique **pas** à l'assurance-vie, aux PEL/CEL/PEP, aux revenus
 * fonciers ni aux plus-values immobilières, restés à `SOCIAL_CHARGES_RATE_LEGACY`.
 */
export const SOCIAL_CHARGES_RATE = "0.186";

/**
 * Taux applicable aux gains constatés avant le 1ᵉʳ janvier 2026.
 *
 * Conservé parce que le découpage historique existe réellement : au retrait,
 * l'établissement teneur de compte applique 17,2 % à la fraction de gain
 * antérieure à 2026 et 18,6 % au-delà. Les simulations de ce dépôt appliquent
 * le taux courant à l'ensemble — approximation majorante, donc prudente, et
 * documentée à chaque point d'usage.
 */
export const SOCIAL_CHARGES_RATE_LEGACY = "0.172";

/** Date d'entrée en vigueur du taux courant. */
export const SOCIAL_CHARGES_RATE_CHANGE_DATE = "2026-01-01";

/** PFU complet : 12,8 % + 18,6 %. */
export const PFU_TOTAL_RATE = "0.314";

/** Rendu court pour l'affichage — « 18,6 % ». */
export function ratePct(rate: string): string {
  return `${(Number(rate) * 100).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  })} %`;
}
