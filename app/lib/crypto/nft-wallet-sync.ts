/**
 * Synchronisation des NFT détenus par un wallet — assemblage Prisma + réseau.
 *
 * Suit le principe de `defi-sync.ts` : le NFT devient un `Asset`, jamais une
 * valeur stockée à côté. Contrairement au floor price (où un principal et un
 * repli existants ont un sens — Blur et Reservoir savent aussi répondre),
 * il n'y a ici qu'un seul provider honnête par famille de chaîne : aucune
 * alternative fiable à OpenSea (EVM) ou Magic Eden (Solana) pour *lister* les
 * NFT d'une adresse sans clé propre à chacune, donc pas de repli inventé.
 */

import { prisma } from "../prisma";
import { createTransaction } from "../transactions/service";
import { loadLedgerForUser } from "../portfolio/service";
import { positionKey } from "../accounting/types";
import { fetchOpenSeaWalletNfts } from "./nft-providers/opensea-wallet";
import { fetchMagicEdenWalletNfts } from "./nft-providers/magic-eden-wallet";
import type { WalletNftFetchResult, WalletNftItem } from "./nft-providers/wallet-types";

export const NFT_SYNC_NOTE_TAG = "[wallet-sync:nft]";

export type NftWalletSyncResult = {
  fetched: WalletNftFetchResult;
  assetsCreated: number;
  assetsExisting: number;
};

/** Route Solana vers Magic Eden, tout le reste (EVM) vers OpenSea. */
export function providerForChain(chain: string) {
  return chain.toLowerCase() === "solana"
    ? fetchMagicEdenWalletNfts
    : fetchOpenSeaWalletNfts;
}

/** Clé d'identité stable — distincte des préfixes `zr:` et `df:` déjà utilisés. */
function nftProviderKey(item: WalletNftItem): string {
  const asset = item.contractAddr
    ? `${item.contractAddr.toLowerCase()}:${item.tokenId}`
    : item.tokenId;
  return `nft:${item.chain}:${asset}`;
}

async function findOrCreateAsset(
  userId: string,
  platformId: string,
  item: WalletNftItem
): Promise<{ assetId: string; created: boolean }> {
  const key = nftProviderKey(item);
  const existing = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    select: { id: true },
  });
  if (existing) return { assetId: existing.id, created: false };

  const asset = await prisma.asset.create({
    data: {
      userId,
      platformId,
      name: item.name.slice(0, 120),
      assetClass: "CRYPTO",
      category: "OTHER",
      accountType: "CRYPTO",
      currency: "EUR",
      priceProvider: "MANUAL",
      providerSymbol: key,
      logoUrl: item.imageUrl,
      notes: `${NFT_SYNC_NOTE_TAG} chain=${item.chain}`,
    },
  });

  await prisma.nftItemDetail.create({
    data: {
      assetId: asset.id,
      tokenId: item.tokenId,
      contractAddr: item.contractAddr,
      chain: item.chain,
      collectionName: item.collectionName,
      collectionSlug: item.collectionSlug,
      imageUrl: item.imageUrl,
      standard: item.standard,
      valuationMode: "MANUAL",
    },
  });

  return { assetId: asset.id, created: true };
}

/**
 * Synchronise les NFT d'une adresse.
 *
 * Une découverte n'a pas de prix d'acquisition connu — contrairement à la
 * saisie manuelle, où l'utilisateur le renseigne. Comme pour un solde Zerion
 * sans cotation, la position entre au journal via `REWARD` plutôt que par un
 * `ACHAT` à un prix inventé, qui fausserait le coût de revient affiché.
 */
export async function syncNftsFromWallet(
  userId: string,
  platformId: string,
  address: string,
  chain: string
): Promise<NftWalletSyncResult> {
  const fetchFn = providerForChain(chain);
  const fetched = await fetchFn(address, chain);

  if (!fetched.ok) {
    return { fetched, assetsCreated: 0, assetsExisting: 0 };
  }

  let created = 0;
  let existing = 0;
  const ledger = await loadLedgerForUser(userId);

  for (const item of fetched.items) {
    const { assetId, created: isNew } = await findOrCreateAsset(userId, platformId, item);
    if (isNew) created += 1;
    else existing += 1;

    const pos = ledger.positions.get(positionKey(assetId, platformId));
    const alreadyHeld = pos && pos.quantity.gt(0);
    if (alreadyHeld) continue;

    try {
      await createTransaction({
        userId,
        type: "REWARD",
        platformId,
        assetId,
        quantity: "1",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: new Date().toISOString(),
        notes: `${NFT_SYNC_NOTE_TAG} ${item.name}`,
        allowNegativeCash: true,
      });
    } catch (e) {
      console.warn("[nft-wallet-sync] tx", item.tokenId, e instanceof Error ? e.message : e);
    }
  }

  return { fetched, assetsCreated: created, assetsExisting: existing };
}
