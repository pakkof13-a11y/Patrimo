/**
 * Trois états, pas deux — pour ce qui dérive de plusieurs requêtes.
 *
 * `products` (comptes + livrets + dépôts à terme) vaut `[]` tant que l'une
 * des trois listes n'a pas répondu : tout ce qui en découle — nombre
 * d'établissements, nombre de comptes, total visible — se lisait alors
 * « 0 » / « 0,00 € » au premier rendu, puis la vraie valeur. Et après un
 * échec, ce zéro restait, sans plus rien pour le distinguer d'un compte
 * réellement sans produit.
 *
 * UNKNOWN ≠ ZERO : inconnu se rend « — » ou squelette, un vrai zéro reste un
 * zéro, un vrai vide garde son état vide. D'où trois états et non un booléen :
 *
 *   loading      au moins une requête n'a pas encore répondu la première fois ;
 *   known        toutes ont une réponse — les dérivés sont fiables, zéro compris ;
 *   unavailable  plus rien n'est en attente et une réponse manque : échec.
 *
 * La réponse doit être complète pour être « connue » : un total calculé sur
 * deux listes sur trois n'est pas un total.
 *
 * Module **pur** : ni React, ni réseau — il ne lit que les deux champs de
 * React Query qui portent cette distinction.
 */

export type LoadState = "loading" | "known" | "unavailable";

export function resolveLoadState(
  queries: ReadonlyArray<{ isPending: boolean; data: unknown }>
): LoadState {
  if (queries.every((q) => q.data != null)) return "known";
  if (queries.some((q) => q.isPending)) return "loading";
  return "unavailable";
}
