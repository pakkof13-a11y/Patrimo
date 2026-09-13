import { prisma } from "../prisma";
import { isNonOwnedStatus } from "../crypto/nft-taxonomy";

/**
 * Périmètre patrimonial : quelles lignes du journal ne comptent nulle part.
 *
 * La règle tenait en trois tests recopiés dans `getHoldings`,
 * `getPlatformCashBalances` et `historical/load` — trois copies d'une même
 * définition, donc trois occasions de diverger. C'est exactement ce qui s'était
 * produit : le résumé du jour excluait une position DeFi de `marketValue` que
 * la courbe comptait encore. Un seul prédicat, ici.
 *
 * Ce que la règle dit : une position DeFi ou un NFT que l'utilisateur a
 * explicitement écarté du patrimoine (`isIgnoredInPortfolio`), ou un NFT qu'il
 * détient sans le posséder (emprunt, `isNonOwnedStatus`), reste au journal —
 * l'historique et la fiscalité en dépendent — mais ne pèse dans aucun total
 * affiché : ni valeur de marché, ni coût de revient, ni P&L latent, ni réalisé.
 */
export type PortfolioScopeAsset = {
  defiPosition?: { isIgnoredInPortfolio: boolean } | null;
  nftItem?: { isIgnoredInPortfolio: boolean; status: string } | null;
};

/** Vrai si l'actif est hors périmètre patrimonial. */
export function isIgnoredInPortfolio(asset: PortfolioScopeAsset): boolean {
  if (asset.defiPosition?.isIgnoredInPortfolio) return true;
  if (asset.nftItem?.isIgnoredInPortfolio) return true;
  if (asset.nftItem != null && isNonOwnedStatus(asset.nftItem.status)) return true;
  return false;
}

/** Même prédicat, appliqué à une collection déjà chargée. */
export function collectIgnoredAssetIds<T extends PortfolioScopeAsset & { id: string }>(
  assets: readonly T[]
): Set<string> {
  const ids = new Set<string>();
  for (const a of assets) if (isIgnoredInPortfolio(a)) ids.add(a.id);
  return ids;
}

/**
 * Identifiants hors périmètre d'un utilisateur.
 *
 * Lecture dédiée parce que le réalisé porte sur des positions *fermées* : une
 * ligne soldée ne figure plus dans `getHoldings` (quantité nulle), on ne peut
 * donc pas déduire son exclusion du seul jeu de lignes ouvertes. Le `select`
 * est réduit aux deux relations qui portent la règle.
 */
export async function loadIgnoredAssetIds(userId: string): Promise<Set<string>> {
  const assets = await prisma.asset.findMany({
    where: { userId },
    select: {
      id: true,
      defiPosition: { select: { isIgnoredInPortfolio: true } },
      nftItem: { select: { isIgnoredInPortfolio: true, status: true } },
    },
  });
  return collectIgnoredAssetIds(assets);
}
