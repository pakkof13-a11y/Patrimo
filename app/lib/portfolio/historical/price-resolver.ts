/**
 * Résolution du prix d'un actif à l'instant valorisé.
 *
 * ## Pourquoi cette indirection existe
 *
 * `PortfolioValuationEngine` porte toute l'arithmétique du patrimoine :
 * exclusions, poches non cotées, passifs projetés, flux externes, statut
 * observé/estimé. Une seule chose y dépendait du **jour** plutôt que de
 * l'instant : le prix d'une position.
 *
 * Restituer de l'intra-journalier en dupliquant le moteur créerait deux
 * définitions du patrimoine, exactement ce que les chantiers précédents ont
 * supprimé. On paramètre donc la seule ligne qui varie, et la courbe horaire
 * emprunte le reste sans en réécrire un mot.
 *
 * ## Les trois réponses possibles
 *
 * - un cours **observé** à l'instant demandé ;
 * - un cours **reporté**, réel mais antérieur — la valeur est plausible, elle
 *   n'est pas observée ; le compartiment devient estimé ;
 * - **rien**, et la position est alors retenue à son prix de revient, comme le
 *   moteur quotidien le fait déjà.
 *
 * Aucune de ces réponses n'invente un cours : le report rend une valeur qui a
 * réellement existé, à un autre instant.
 */

import { d, zero, type Decimal } from "../../money/decimal";

export type PriceResolution = {
  priceEur: number;
  /**
   * `false` quand le cours vient d'une observation antérieure.
   *
   * C'est ce drapeau qui empêche un point reporté d'être annoncé `EXACT`.
   */
  observed: boolean;
};

/** Rend le cours d'un actif à l'instant valorisé, ou `null` s'il n'y en a pas. */
export type PriceResolver = (assetId: string) => PriceResolution | null;

/**
 * Valorise des positions avec un résolveur de prix.
 *
 * Reprend mot pour mot la règle de `marketValueOfPositions` — sans cours
 * connu, la position est retenue à son prix de revient — et y ajoute le
 * décompte des cours reportés, dont le moteur quotidien n'avait pas besoin.
 */
export function valuePositions(
  positions: Iterable<{
    assetId: string;
    quantity: Decimal;
    costBasisEur: Decimal;
  }>,
  resolve: PriceResolver
): { marketEur: Decimal; unpricedAssets: number; carriedAssets: number } {
  let marketEur = zero();
  const unpriced = new Set<string>();
  const carried = new Set<string>();

  for (const pos of positions) {
    if (pos.quantity.isZero()) continue;
    const price = resolve(pos.assetId);
    if (price == null) {
      unpriced.add(pos.assetId);
      marketEur = marketEur.plus(pos.costBasisEur);
      continue;
    }
    if (!price.observed) carried.add(pos.assetId);
    marketEur = marketEur.plus(pos.quantity.times(d(price.priceEur)));
  }

  return {
    marketEur,
    unpricedAssets: unpriced.size,
    carriedAssets: carried.size,
  };
}
