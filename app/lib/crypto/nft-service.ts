/**
 * Lecture des NFT — seule couche (avec le service manuel) qui touche Prisma.
 *
 * La valeur vient de `getAssetValues()`, par actif et non par ticker fusionné
 * — même raison que pour la DeFi : un NFT n'a pas de ticker à fusionner, mais
 * passer par `getHoldings()` aurait exposé le module au même risque le jour
 * où deux NFT partageraient un nom d'affichage.
 */

import { prisma } from "../prisma";
import { getAssetValues } from "../portfolio/asset-values";

export type NftItemRow = {
  assetId: string;
  name: string;
  tokenId: string;
  contractAddr: string | null;
  chain: string;
  collectionName: string | null;
  collectionSlug: string | null;
  imageUrl: string | null;
  standard: string | null;
  valuationMode: string;
  floorPriceEur: string | null;
  estimateSource: string | null;
  estimateDate: string | null;
  rarityRank: number | null;
  isHidden: boolean;
  quantity: string;
  acquisitionPriceEur: string;
  currentValueEur: string;
};

export async function listNftItems(
  userId: string,
  opts?: { includeHidden?: boolean }
): Promise<NftItemRow[]> {
  const details = await prisma.nftItemDetail.findMany({
    where: {
      asset: { is: { userId } },
      ...(opts?.includeHidden ? {} : { isHidden: false }),
    },
    include: { asset: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (details.length === 0) return [];

  const values = await getAssetValues(
    userId,
    details.map((r) => r.assetId)
  );

  const rows: NftItemRow[] = [];
  for (const row of details) {
    const value = values.get(row.assetId);
    // Absent du journal = position liquidée ; le NFT reste listé (l'historique
    // d'acquisition garde son intérêt) mais sans valeur courante.
    rows.push({
      assetId: row.assetId,
      name: row.asset.name,
      tokenId: row.tokenId,
      contractAddr: row.contractAddr,
      chain: row.chain,
      collectionName: row.collectionName,
      collectionSlug: row.collectionSlug,
      imageUrl: row.imageUrl,
      standard: row.standard,
      valuationMode: row.valuationMode,
      floorPriceEur: row.floorPriceEur?.toString() ?? null,
      estimateSource: row.estimateSource,
      estimateDate: row.estimateDate?.toISOString() ?? null,
      rarityRank: row.rarityRank,
      isHidden: row.isHidden,
      quantity: value ? value.quantity.toFixed(0) : "0",
      acquisitionPriceEur: value ? value.costBasisEur.toFixed(2) : "0.00",
      currentValueEur: value ? value.marketValueEur.toFixed(2) : "0.00",
    });
  }
  return rows;
}
