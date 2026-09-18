import { formatCurrency, MONTANT_INCONNU } from "@/app/lib/utils";

/**
 * Inconnu ≠ zéro, pour la poche crypto comptant.
 *
 * La vue d'ensemble reçoit ses positions sous forme de tableau (`holdings`),
 * et un tableau vide y raconte deux histoires incompatibles : « le portefeuille
 * ne contient rien » et « les positions ne sont pas encore arrivées ». Tant que
 * l'écran ne distinguait pas les deux, le premier rendu affirmait 0,00 €,
 * « 0 actif » et « Aucune crypto en comptant » — trois affirmations fausses —
 * avant de basculer sur la valeur réelle une fois `/api/holdings` répondu.
 *
 * Ces fonctions portent la distinction, hors de tout composant, pour qu'elle
 * soit testable et qu'un seul endroit décide de ce que « on ne sait pas encore »
 * donne à l'écran.
 *
 * `donneesConnues` se lit sur la requête, pas sur les données dérivées : une
 * requête en échec après ses tentatives reste « inconnu » (elle n'a jamais
 * répondu), et non « vide ».
 */

/**
 * Ce que l'écran sait de la poche.
 *
 * - `inconnu` : la requête n'a pas encore répondu → squelette ou « — ».
 * - `vide` : elle a répondu, il n'y a rien → l'état vide métier est légitime.
 * - `garni` : au moins une position.
 */
export type EtatPoche = "inconnu" | "vide" | "garni";

export function etatPoche(
  donneesConnues: boolean,
  aDesPositions: boolean
): EtatPoche {
  if (!donneesConnues) return "inconnu";
  return aDesPositions ? "garni" : "vide";
}

/**
 * Compteur d'actifs de l'en-tête.
 *
 * « 0 actif » est un constat, pas un chargement : il ne s'écrit que lorsque le
 * portefeuille est réellement connu et réellement vide.
 */
export function compteActifs(donneesConnues: boolean, nbActifs: number): string {
  if (!donneesConnues) return "—";
  return `${nbActifs} actif${nbActifs > 1 ? "s" : ""}`;
}

/**
 * Montant affichable — « — € » tant que la donnée n'est pas connue.
 *
 * Un zéro réellement observé reste un zéro : seule l'absence de réponse change
 * le rendu.
 */
export function montantAffiche(
  donneesConnues: boolean,
  valeur: number,
  devise = "EUR"
): string {
  return donneesConnues ? formatCurrency(valeur, devise) : MONTANT_INCONNU;
}
