/**
 * Résolution du logo d'un actif côté serveur.
 *
 * Le rendu client (AssetLogo) construit une chaîne de sources et descend au
 * maillon suivant à chaque échec ; ici, on n'a qu'une valeur à stocker ou à
 * renvoyer dans une réponse d'API. On prend donc la première candidate de cette
 * même chaîne, pour que les deux chemins ne divergent jamais.
 *
 * @see https://www.logo.dev/docs/logo-images/introduction
 */

import { assetLogoSources } from "../logos/logodev";

export function resolveAssetLogo(opts: {
  logoUrl?: string | null;
  ticker?: string | null;
  isin?: string | null;
  name?: string | null;
  assetClass?: string | null;
}): string | null {
  return assetLogoSources({ ...opts, size: 64 })[0] ?? null;
}
