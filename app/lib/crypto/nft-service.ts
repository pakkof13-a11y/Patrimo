/**
 * Lecture des NFT — seule couche (avec le service manuel) qui touche Prisma.
 *
 * La valeur vient de `getAssetValues()`, par actif et non par ticker fusionné
 * — même raison que pour la DeFi. Le contrat public (`NftItemRow`) reste
 * inchangé depuis avant le chantier NFT : le frontend existant
 * (`components/crypto/nft-panel.tsx`) continue de fonctionner sans
 * modification, les champs d'identité étant désormais reconstruits depuis
 * `NftAsset`/`NftCollection` plutôt que lus directement sur `NftItemDetail`.
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
    include: {
      asset: { select: { id: true, name: true } },
      nftAsset: { include: { collection: true } },
      valuations: { orderBy: { valuationDate: "desc" }, take: 1 },
    },
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
    const latestValuation = row.valuations[0];
    // Absent du journal = position liquidée ; le NFT reste listé (l'historique
    // d'acquisition garde son intérêt) mais sans valeur courante.
    rows.push({
      assetId: row.assetId,
      name: row.asset.name,
      tokenId: row.nftAsset.tokenId ?? row.nftAsset.mintAddress ?? "",
      contractAddr: row.nftAsset.contractAddress,
      chain: row.nftAsset.chainId,
      collectionName: row.nftAsset.collection?.name ?? null,
      collectionSlug: row.nftAsset.collection?.slug ?? null,
      imageUrl: row.nftAsset.imageUrl,
      standard: row.nftAsset.standard,
      // Deux états seulement, pour compatibilité avec le frontend existant —
      // `retainedValueMethod` porte la méthode réelle et plus fine.
      valuationMode: row.retainedValueMethod === "MANUAL" || row.retainedValueMethod === "APPRAISAL" ? "MANUAL" : "FLOOR_AUTO",
      floorPriceEur: latestValuation?.floorPriceEur?.toString() ?? null,
      estimateSource: latestValuation?.sourceProvider ?? null,
      estimateDate: latestValuation?.valuationDate?.toISOString() ?? null,
      rarityRank: row.nftAsset.rarityRank,
      isHidden: row.isHidden,
      quantity: value ? value.quantity.toFixed(0) : "0",
      acquisitionPriceEur: value ? value.costBasisEur.toFixed(2) : "0.00",
      currentValueEur: value ? value.marketValueEur.toFixed(2) : "0.00",
    });
  }
  return rows;
}
