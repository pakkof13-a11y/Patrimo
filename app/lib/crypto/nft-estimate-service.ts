/**
 * Rafraîchissement des floor prices — assemblage Prisma + réseau.
 *
 * Une requête par **collection unique**, jamais par NFT : dix Bored Apes
 * détenus ne justifient pas dix appels identiques à OpenSea, seulement un.
 * Écrit le floor sur `NftCollection` (partagé par tous les NFT de la
 * collection) puis applique `chooseNftValuation` par détention — une
 * expertise manuelle active reste prioritaire (jamais écrasée par un floor).
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { fxRateToEur } from "../market/fx";
import { estimateFloorPrice, type FloorPriceOutcome } from "./nft-estimate";
import { NFT_PROVIDER_REGISTRY } from "./nft-providers/registry";
import { applyNftValuation, latestManualNftValuation } from "./nft-position-service";
import { chooseNftValuation } from "./nft-valuation";

export type RefreshOutcome = {
  collectionKey: string;
  chain: string;
  updated: number;
  outcome: FloorPriceOutcome;
};

export type RefreshSummary = {
  collectionsProcessed: number;
  itemsUpdated: number;
  results: RefreshOutcome[];
};

type HoldingRow = Awaited<ReturnType<typeof loadHoldings>>[number];

async function loadHoldings(userId: string, assetIds?: string[]) {
  return prisma.nftItemDetail.findMany({
    where: {
      asset: { is: { userId } },
      ...(assetIds ? { assetId: { in: assetIds } } : {}),
      status: { notIn: ["BURNED", "TRANSFERRED_OUT", "SOLD"] },
    },
    include: { nftAsset: { include: { collection: true } } },
  });
}

function collectionKey(row: HoldingRow): string {
  const chain = row.nftAsset.chainId;
  const ref = row.nftAsset.collection?.slug || row.nftAsset.collection?.contractAddress || row.nftAsset.contractAddress || "?";
  return `${chain}:${ref}`;
}

/**
 * Convertit une devise native de floor price (ETH, SOL…) en euros.
 *
 * Conversion de complaisance : sans oracle de prix crypto dédié à ce module,
 * on route par le taux de change classique quand la devise est déjà une
 * devise fiat reconnue, et on laisse `null` sinon.
 */
async function toEur(amount: ReturnType<typeof d>, currency: string): Promise<ReturnType<typeof d> | null> {
  try {
    const rate = await fxRateToEur(currency);
    return amount.times(d(rate));
  } catch {
    return null;
  }
}

export async function refreshNftFloorPrices(
  userId: string,
  assetIds?: string[]
): Promise<RefreshSummary> {
  const holdings = await loadHoldings(userId, assetIds);

  const byCollection = new Map<string, HoldingRow[]>();
  for (const row of holdings) {
    const key = collectionKey(row);
    const list = byCollection.get(key) ?? [];
    list.push(row);
    byCollection.set(key, list);
  }

  const results: RefreshOutcome[] = [];
  let itemsUpdated = 0;

  for (const [key, items] of byCollection) {
    const sample = items[0];
    const outcome = await estimateFloorPrice(
      {
        chain: sample.nftAsset.chainId,
        contractAddr: sample.nftAsset.contractAddress,
        collectionSlug: sample.nftAsset.collection?.slug ?? null,
      },
      NFT_PROVIDER_REGISTRY
    );

    let updated = 0;
    if (outcome.result.ok) {
      const floorEur = await toEur(outcome.result.floorPriceNative, outcome.result.currency);
      const now = new Date();

      if (floorEur && sample.nftAsset.collectionId) {
        await prisma.nftCollection.update({
          where: { id: sample.nftAsset.collectionId },
          data: {
            floorPriceNative: outcome.result.floorPriceNative.toFixed(10),
            floorPriceCurrency: outcome.result.currency,
            floorPriceEur: floorEur.toFixed(2),
            floorPriceSource: outcome.result.source,
            floorPriceUpdatedAt: now,
          },
        });
      }

      for (const item of items) {
        // Une expertise manuelle active reste prioritaire — jamais écrasée
        // silencieusement par un floor automatique (règle de priorité de
        // `chooseNftValuation`).
        const manual = await latestManualNftValuation(item.nftAssetId);
        if (manual) continue;

        const spamStatus = item.nftAsset.isSpam ? "CONFIRMED_SPAM" : item.nftAsset.isScamSuspected ? "SUSPECTED" : "CLEAN";
        const acquisitionCost = item.acquisitionCostEur ? d(item.acquisitionCostEur.toString()) : null;

        // Pas de conversion EUR possible (devise inconnue) : `floorPrice`
        // reste `null`, `chooseNftValuation` retombe sur le repli suivant.
        const choice = chooseNftValuation({
          spamStatus,
          manualAppraisal: null,
          lastSale: null,
          floorPrice: floorEur ? { amountEur: floorEur, isReliable: true } : null,
          acquisitionCostEur: acquisitionCost,
        });

        const share = item.ownershipShare ? d(item.ownershipShare.toString()).div(100) : d(1);
        await applyNftValuation(
          item.nftAssetId,
          item.id,
          item.assetId,
          share,
          choice,
          {
            valuationDate: now,
            sourceProvider: outcome.result.source,
            floorPriceEur: floorEur,
          }
        );
        updated += 1;
      }
    }

    itemsUpdated += updated;
    results.push({ collectionKey: key, chain: sample.nftAsset.chainId, updated, outcome });
  }

  return {
    collectionsProcessed: byCollection.size,
    itemsUpdated,
    results,
  };
}
