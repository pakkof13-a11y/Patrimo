/**
 * Synchronisation des NFT détenus par un wallet — assemblage Prisma + réseau.
 *
 * Suit le principe de `defi-sync.ts` : le NFT devient un `Asset`, jamais une
 * valeur stockée à côté. Une seule page (50 NFT) par appel provider, mais la
 * synchronisation boucle en interne (plafonnée) pour compléter un passage
 * complet en un seul clic — le curseur `NftSyncCursor` permet de reprendre
 * si le plafond est atteint avant la fin.
 */

import { prisma } from "../prisma";
import { createTransaction } from "../transactions/service";
import { loadLedgerForUser } from "../portfolio/service";
import { positionKey } from "../accounting/types";
import { fetchOpenSeaWalletNfts } from "./nft-providers/opensea-wallet";
import { fetchMagicEdenWalletNfts } from "./nft-providers/magic-eden-wallet";
import type { WalletNftFetchResult, WalletNftItem } from "./nft-providers/wallet-types";
import { ensureNftAsset, ensureNftCollection, recordNftEvent, updateNftSyncCursor, getNftSyncCursor } from "./nft-position-service";
import { classifyNftSpam, spamStatusToAssetFlags } from "./nft-classification";
import { isSolanaStandard } from "./nft-taxonomy";
import { holdingsGoneMissing } from "./nft-dedup";

export const NFT_SYNC_NOTE_TAG = "[wallet-sync:nft]";

/** Pages max par appel — protège d'un wallet massif contre un budget d'API illimité. */
const MAX_PAGES_PER_CALL = 10;

export type NftWalletSyncResult = {
  fetched: WalletNftFetchResult;
  assetsCreated: number;
  assetsExisting: number;
  reappeared: number;
  missingFlagged: number;
  /** `false` si le plafond de pages a été atteint avant la fin réelle du wallet. */
  completed: boolean;
};

/** Route Solana vers Magic Eden, tout le reste (EVM) vers OpenSea. */
export function providerForChain(chain: string) {
  return chain.toLowerCase() === "solana"
    ? fetchMagicEdenWalletNfts
    : fetchOpenSeaWalletNfts;
}

function providerKeyName(chain: string): string {
  return chain.toLowerCase() === "solana" ? "MAGIC_EDEN_WALLET" : "OPENSEA_WALLET";
}

/** Clé d'identité côté `Asset` — distincte des préfixes `zr:`/`df:` déjà utilisés. */
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
): Promise<{ assetId: string; created: boolean; reappeared: boolean }> {
  const key = nftProviderKey(item);
  const existing = await prisma.asset.findFirst({
    where: { userId, platformId, providerSymbol: key },
    include: { nftItem: true },
  });
  if (existing?.nftItem) {
    // Réapparu après une disparition constatée lors d'une sync précédente.
    const reappeared = existing.nftItem.status === "UNKNOWN";
    if (reappeared) {
      await prisma.nftItemDetail.update({
        where: { id: existing.nftItem.id },
        data: { status: "HELD" },
      });
    }
    return { assetId: existing.id, created: false, reappeared };
  }

  const standard = isSolanaStandard(item.standard || "") || item.chain.toLowerCase() === "solana"
    ? "SPL"
    : item.standard || "ERC_721";
  const isSolana = isSolanaStandard(standard);

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

  const collection = await ensureNftCollection(userId, {
    chainId: item.chain,
    contractAddress: isSolana ? null : item.contractAddr,
    slug: item.collectionSlug,
    name: item.collectionName,
  });

  // Découvert par sync, coût inconnu : jamais qualifié d'AIRDROP par
  // défaut (l'utilisateur a pu l'acheter ailleurs) — seule l'absence de
  // floor connu et une collection non vérifiée le rendent "suspect".
  const spam = classifyNftSpam({
    collectionVerifiedStatus: "UNKNOWN",
    hasReliableFloor: false,
    acquisitionSource: "WALLET_SYNC",
    acquisitionCostEur: null,
    name: item.name,
    description: null,
  });
  const spamFlags = spamStatusToAssetFlags(spam.spamStatus);

  const nftAsset = await ensureNftAsset(
    userId,
    {
      standard,
      chainId: item.chain,
      contractAddress: isSolana ? null : item.contractAddr,
      tokenId: isSolana ? null : item.tokenId,
      mintAddress: isSolana ? item.tokenId : null,
      collectionId: collection?.id ?? null,
      name: item.name,
      imageUrl: item.imageUrl,
      metadataQuality: item.imageUrl ? "PARTIAL" : "UNKNOWN",
      category: "UNKNOWN",
      ...spamFlags,
    },
    asset.id
  );

  await prisma.nftItemDetail.create({
    data: {
      assetId: asset.id,
      nftAssetId: nftAsset.id,
      accessMode: "SELF_CUSTODY",
      custodyModel: "SELF_CUSTODY",
      dataOrigin: "WALLET_SYNC",
      status: "HELD",
      acquisitionDate: new Date(),
      acquisitionSource: "WALLET_SYNC",
    },
  });

  return { assetId: asset.id, created: true, reappeared: false };
}

/**
 * Synchronise les NFT d'une adresse — boucle plafonnée à `MAX_PAGES_PER_CALL`
 * pages, reprend depuis le curseur stocké. Une découverte n'a pas de prix
 * d'acquisition connu, contrairement à la saisie manuelle : la position
 * entre au journal via `REWARD` plutôt que par un `ACHAT` à un prix inventé.
 */
export async function syncNftsFromWallet(
  userId: string,
  platformId: string,
  address: string,
  chain: string
): Promise<NftWalletSyncResult> {
  const provider = providerKeyName(chain);
  const fetchFn = providerForChain(chain);
  const existingCursor = await getNftSyncCursor(userId, provider, { platformId });
  let cursor: string | null = existingCursor?.cursor ?? null;

  let created = 0;
  let existing = 0;
  let reappeared = 0;
  let pages = 0;
  let completed = false;
  const seenAssetIds = new Set<string>();
  let lastFetch: WalletNftFetchResult | null = null;

  const ledger = await loadLedgerForUser(userId);

  while (pages < MAX_PAGES_PER_CALL) {
    const fetched = await fetchFn(address, chain, cursor);
    lastFetch = fetched;
    pages += 1;

    if (!fetched.ok) {
      await updateNftSyncCursor(userId, provider, {
        platformId,
        success: false,
        lastError: fetched.reason,
      });
      return { fetched, assetsCreated: created, assetsExisting: existing, reappeared, missingFlagged: 0, completed: false };
    }

    for (const item of fetched.items) {
      const { assetId, created: isNew, reappeared: didReappear } = await findOrCreateAsset(
        userId,
        platformId,
        item
      );
      if (isNew) created += 1;
      else existing += 1;
      if (didReappear) reappeared += 1;
      seenAssetIds.add(assetId);

      const pos = ledger.positions.get(positionKey(assetId, platformId));
      const alreadyHeld = pos && pos.quantity.gt(0);
      if (alreadyHeld && !didReappear) continue;

      const holding = await prisma.nftItemDetail.findFirst({
        where: { assetId },
        select: { id: true, nftAssetId: true },
      });

      try {
        const tx = await createTransaction({
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
        if (holding) {
          await recordNftEvent(holding.nftAssetId, {
            eventType: "TRANSFER_IN",
            eventDate: new Date(),
            nftHoldingId: holding.id,
            sourceProvider: provider === "OPENSEA_WALLET" ? "OPENSEA" : "MAGIC_EDEN",
            ledgerTransactionId:
              tx && typeof tx === "object" && "id" in tx ? (tx as { id: string }).id : null,
          });
        }
      } catch (e) {
        console.warn("[nft-wallet-sync] tx", item.tokenId, e instanceof Error ? e.message : e);
      }
    }

    cursor = fetched.nextCursor ?? null;
    if (!cursor) {
      completed = true;
      break;
    }
  }

  // Disparition constatée uniquement sur un passage COMPLET : un plafond de
  // pages atteint ne dit rien sur les NFT des pages non lues (D7).
  let missingFlagged = 0;
  if (completed) {
    const previouslyHeld = await prisma.nftItemDetail.findMany({
      where: {
        status: "HELD",
        dataOrigin: "WALLET_SYNC",
        asset: { is: { userId, platformId } },
      },
      select: { id: true, assetId: true, nftAssetId: true },
    });
    const missingAssetIds = holdingsGoneMissing(
      previouslyHeld.map((r) => r.assetId),
      seenAssetIds
    );
    const missingRows = previouslyHeld.filter((r) => missingAssetIds.includes(r.assetId));
    for (const row of missingRows) {
      await prisma.nftItemDetail.update({ where: { id: row.id }, data: { status: "UNKNOWN" } });
      await recordNftEvent(row.nftAssetId, {
        eventType: "SYNC_MISSING",
        eventDate: new Date(),
        nftHoldingId: row.id,
        sourceProvider: provider === "OPENSEA_WALLET" ? "OPENSEA" : "MAGIC_EDEN",
      });
      missingFlagged += 1;
    }
  }

  await updateNftSyncCursor(userId, provider, {
    platformId,
    cursor,
    success: true,
    importedCount: created,
    updatedCount: existing + reappeared,
    ignoredCount: missingFlagged,
  });

  return {
    fetched: lastFetch ?? { ok: true, items: [] },
    assetsCreated: created,
    assetsExisting: existing,
    reappeared,
    missingFlagged,
    completed,
  };
}
