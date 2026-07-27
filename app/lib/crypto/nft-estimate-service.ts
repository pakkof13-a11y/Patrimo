/**
 * Rafraîchissement des floor prices — assemblage Prisma + réseau.
 *
 * Une requête par **collection unique**, jamais par NFT : dix Bored Apes
 * détenus ne justifient pas dix appels identiques à OpenSea, seulement un.
 * C'est ce regroupement qui rend l'opération praticable sur un portefeuille
 * dense sans épuiser un quota d'API gratuit.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { fxRateToEur } from "../market/fx";
import { estimateFloorPrice, type FloorPriceOutcome } from "./nft-estimate";
import { NFT_PROVIDER_REGISTRY } from "./nft-providers/registry";

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

function collectionKey(row: { chain: string; collectionSlug: string | null; contractAddr: string | null }): string {
  return `${row.chain}:${row.collectionSlug || row.contractAddr || "?"}`;
}

/**
 * Convertit une devise native de floor price (ETH, SOL…) en euros.
 *
 * Une conversion de complaisance : sans oracle de prix crypto dédié à ce
 * module, on route par le taux de change classique quand la devise est déjà
 * une devise fiat reconnue, et on laisse `null` sinon plutôt que d'inventer un
 * taux ETH→EUR qui n'a rien à faire dans `fxRateToEur`.
 */
async function toEur(amount: ReturnType<typeof d>, currency: string): Promise<ReturnType<typeof d> | null> {
  try {
    const rate = await fxRateToEur(currency);
    return amount.times(d(rate));
  } catch {
    return null;
  }
}

/**
 * Rafraîchit le floor price de toutes les collections de l'utilisateur (ou
 * d'un sous-ensemble d'actifs donné).
 *
 * Chaque échec est typé et n'interrompt jamais le traitement des collections
 * suivantes — l'absence d'`OPENSEA_API_KEY` ne doit pas empêcher une
 * collection Solana déjà configurée de se rafraîchir.
 */
export async function refreshNftFloorPrices(
  userId: string,
  assetIds?: string[]
): Promise<RefreshSummary> {
  const details = await prisma.nftItemDetail.findMany({
    where: {
      asset: { is: { userId } },
      ...(assetIds ? { assetId: { in: assetIds } } : {}),
    },
    select: {
      assetId: true,
      chain: true,
      contractAddr: true,
      collectionSlug: true,
    },
  });

  const byCollection = new Map<string, typeof details>();
  for (const row of details) {
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
        chain: sample.chain,
        contractAddr: sample.contractAddr,
        collectionSlug: sample.collectionSlug,
      },
      NFT_PROVIDER_REGISTRY
    );

    let updated = 0;
    if (outcome.result.ok) {
      const floorEur = await toEur(
        outcome.result.floorPriceNative,
        outcome.result.currency
      );
      const now = new Date();

      for (const item of items) {
        await prisma.nftItemDetail.update({
          where: { assetId: item.assetId },
          data: {
            valuationMode: "FLOOR_AUTO",
            floorPriceNative: outcome.result.floorPriceNative.toFixed(10),
            floorPriceCurrency: outcome.result.currency,
            floorPriceEur: floorEur ? floorEur.toFixed(2) : null,
            estimateSource: outcome.result.source,
            estimateDate: now,
            lastValuedAt: now,
          },
        });
        if (floorEur) {
          await prisma.asset.update({
            where: { id: item.assetId },
            data: { manualPrice: floorEur.toFixed(12) },
          });
        }
        updated += 1;
      }
    }

    itemsUpdated += updated;
    results.push({ collectionKey: key, chain: sample.chain, updated, outcome });
  }

  return {
    collectionsProcessed: byCollection.size,
    itemsUpdated,
    results,
  };
}
