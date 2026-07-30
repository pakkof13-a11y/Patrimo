/**
 * Saisie manuelle d'un NFT.
 *
 * Chemin qui fonctionne intégralement sans aucune clé API : l'utilisateur
 * renseigne le prix d'acquisition (coût de revient au journal) et peut fixer
 * une valeur manuelle qui prévaut tant qu'aucun rafraîchissement automatique
 * n'a eu lieu.
 *
 * Reprend `defi-manual-service.ts` : actif, identité (`NftAsset`), détention
 * (`NftItemDetail`) et écriture d'entrée créés dans une même transaction DB.
 * Le contrat public (`CreateNftInput`) reste inchangé depuis avant ce
 * chantier — le frontend existant (`components/crypto/nft-panel.tsx`)
 * continue de fonctionner sans modification.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { NFT_STANDARDS } from "./nft-constants";
import { allowsQuantityAboveOne, isSolanaStandard } from "./nft-taxonomy";
import { ensureNftAsset, ensureNftCollection, applyNftValuation, recordNftEvent, NftInputError } from "./nft-position-service";
import { classifyNftSpam, spamStatusToAssetFlags } from "./nft-classification";
import { chooseNftValuation } from "./nft-valuation";

export { NftInputError };

export type CreateNftInput = {
  platformId: string;
  name: string;
  tokenId: string;
  contractAddr?: string | null;
  chain: string;
  collectionName?: string | null;
  collectionSlug?: string | null;
  imageUrl?: string | null;
  standard?: string | null;
  quantity?: string;
  acquisitionPriceEur: string;
  acquisitionDate: string;
  manualFloorPriceEur?: string | null;
  notes?: string | null;
  // ── Champs additifs du chantier NFT (optionnels, défauts patrimoniaux sûrs) ──
  ownerLabel?: string | null;
  ownershipShare?: string | null;
  accessMode?: string | null;
  custodyModel?: string | null;
  acquisitionSource?: string | null;
};

export type CreateNftResult = {
  assetId: string;
  itemId: string;
};

function dec(v: string | null | undefined) {
  if (v == null || v === "") return null;
  const n = d(v);
  return n.isFinite() ? n.toString() : null;
}

export async function createNftManual(
  userId: string,
  input: CreateNftInput
): Promise<CreateNftResult> {
  const platform = await prisma.platform.findFirst({
    where: { id: input.platformId, userId },
    select: { id: true },
  });
  if (!platform) throw new NftInputError("Plateforme introuvable");

  if (!input.name.trim()) throw new NftInputError("Le nom du NFT est requis");
  if (!input.tokenId.trim()) throw new NftInputError("Le token ID est requis");
  if (!input.chain.trim()) throw new NftInputError("La chaîne est requise");
  const standard = input.standard || (input.chain.trim().toLowerCase() === "solana" ? "SPL" : "ERC_721");
  if (!(standard in NFT_STANDARDS)) {
    throw new NftInputError("Standard de jeton inconnu");
  }

  const quantity = d(input.quantity || "1");
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new NftInputError("La quantité doit être strictement positive");
  }
  if (quantity.gt(1) && !allowsQuantityAboveOne(standard)) {
    throw new NftInputError(
      `Une quantité supérieure à 1 n'a de sens que pour un ERC-1155 (reçu : ${standard})`
    );
  }

  const acqPrice = d(input.acquisitionPriceEur);
  if (!acqPrice.isFinite() || acqPrice.lt(0)) {
    throw new NftInputError("Le prix d'acquisition ne peut pas être négatif");
  }

  const acquisitionDate = new Date(input.acquisitionDate);
  if (Number.isNaN(acquisitionDate.getTime())) {
    throw new NftInputError("Date d'acquisition invalide");
  }

  if (input.ownershipShare != null && input.ownershipShare !== "") {
    const share = d(input.ownershipShare);
    if (!share.isFinite() || share.lte(0) || share.gt(100)) {
      throw new NftInputError("La quote-part doit être comprise dans ]0 ; 100]");
    }
  }

  const manualFloor = dec(input.manualFloorPriceEur);
  const isSolana = isSolanaStandard(standard);

  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        userId,
        platformId: platform.id,
        name: input.name.trim(),
        assetClass: "CRYPTO",
        category: "OTHER",
        accountType: "CRYPTO",
        currency: "EUR",
        priceProvider: "MANUAL",
        // Valeur définitive posée par `applyNftValuation` plus bas — ce
        // premier chiffre n'est qu'un repli avant que la valorisation ne
        // tourne, jamais affiché tel quel dans les agrégats.
        manualPrice: manualFloor ? d(manualFloor).toFixed(12) : quantity.gt(0) ? acqPrice.div(quantity).toFixed(12) : "0",
        logoUrl: input.imageUrl?.trim() || null,
        acquisitionDate,
        notes: input.notes?.trim() || null,
      },
    });

    const collection = await ensureNftCollection(
      userId,
      {
        chainId: input.chain,
        contractAddress: isSolana ? null : input.contractAddr,
        slug: input.collectionSlug,
        name: input.collectionName,
      },
      tx
    );

    // Une saisie manuelle payée n'est jamais un airdrop non sollicité : la
    // classification retombe presque toujours sur CLEAN, sauf motif de
    // phishing explicite dans le nom.
    const spam = classifyNftSpam({
      collectionVerifiedStatus: "UNKNOWN",
      hasReliableFloor: false,
      acquisitionSource: input.acquisitionSource || "MANUAL",
      acquisitionCostEur: acqPrice,
      name: input.name,
      description: null,
    });
    const spamFlags = spamStatusToAssetFlags(spam.spamStatus);

    const nftAsset = await ensureNftAsset(
      userId,
      {
        standard,
        chainId: input.chain,
        contractAddress: isSolana ? null : input.contractAddr,
        tokenId: isSolana ? null : input.tokenId,
        mintAddress: isSolana ? input.tokenId : null,
        collectionId: collection?.id ?? null,
        name: input.name.trim(),
        imageUrl: input.imageUrl,
        metadataQuality: input.imageUrl ? "PARTIAL" : "UNKNOWN",
        category: "UNKNOWN",
        ...spamFlags,
      },
      asset.id,
      tx
    );

    const item = await tx.nftItemDetail.create({
      data: {
        assetId: asset.id,
        nftAssetId: nftAsset.id,
        accessMode: input.accessMode || "SELF_CUSTODY",
        custodyModel: input.custodyModel || "UNKNOWN",
        dataOrigin: "MANUAL",
        ownerLabel: input.ownerLabel?.trim() || null,
        ownershipShare: dec(input.ownershipShare),
        status: "HELD",
        acquisitionDate,
        acquisitionSource: input.acquisitionSource || "MANUAL",
        acquisitionCostNative: acqPrice.toString(),
        acquisitionCurrency: "EUR",
        acquisitionCostEur: acqPrice.toFixed(2),
        notes: input.notes?.trim() || null,
      },
    });

    // `allowNegativeCash` comme pour une souscription SCPI ou un engagement
    // DeFi : l'acquisition d'un NFT déjà réglée n'est pas financée par la
    // trésorerie suivie ici.
    const ledgerTx = await createTransaction(
      {
        userId,
        type: "ACHAT",
        platformId: platform.id,
        assetId: asset.id,
        quantity: quantity.toString(),
        unitPrice: quantity.gt(0) ? acqPrice.div(quantity).toFixed(12) : "0",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: acquisitionDate.toISOString(),
        allowNegativeCash: true,
        notes: `Acquisition NFT — ${input.name.trim()}`,
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );

    await recordNftEvent(
      nftAsset.id,
      {
        eventType: "BUY",
        eventDate: acquisitionDate,
        nftHoldingId: item.id,
        priceEur: acqPrice.toFixed(2),
        sourceProvider: "MANUAL",
        ledgerTransactionId:
          ledgerTx && typeof ledgerTx === "object" && "id" in ledgerTx
            ? (ledgerTx as { id: string }).id
            : null,
      },
      tx
    );

    const ownershipSharePct = item.ownershipShare ? d(item.ownershipShare.toString()) : null;
    const choice = chooseNftValuation({
      spamStatus: spam.spamStatus,
      manualAppraisal: manualFloor ? { amountEur: d(manualFloor) } : null,
      lastSale: null,
      floorPrice: null,
      acquisitionCostEur: acqPrice,
    });
    await applyNftValuation(
      nftAsset.id,
      item.id,
      asset.id,
      ownershipSharePct,
      choice,
      {
        valuationDate: acquisitionDate,
        sourceProvider: "MANUAL",
        isManual: choice.method === "APPRAISAL",
      },
      tx
    );

    return { assetId: asset.id, itemId: item.id };
  });
}

export async function setNftHidden(userId: string, assetId: string, hidden: boolean) {
  const item = await prisma.nftItemDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true },
  });
  if (!item) throw new NftInputError("NFT introuvable");
  return prisma.nftItemDetail.update({
    where: { id: item.id },
    data: { isHidden: hidden },
  });
}

export async function setNftManualFloorPrice(
  userId: string,
  assetId: string,
  floorPriceEur: string
) {
  const item = await prisma.nftItemDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true },
  });
  if (!item) throw new NftInputError("NFT introuvable");

  const floor = d(floorPriceEur);
  if (!floor.isFinite() || floor.lt(0)) {
    throw new NftInputError("Le prix ne peut pas être négatif");
  }

  const { overrideNftValuation } = await import("./nft-position-service");
  await overrideNftValuation(userId, assetId, floor.toFixed(2));
}

/**
 * Suppression physique — réservée à la correction d'une saisie manuelle
 * erronée, sans historique réel à préserver (D8 de `docs/nft-backend-v1.md`).
 * Une sortie patrimoniale réelle (vente, burn, transfert) doit passer par
 * `disposeNftHolding`, qui conserve la ligne.
 */
export async function deleteNftItem(userId: string, assetId: string) {
  const item = await prisma.nftItemDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true },
  });
  if (!item) throw new NftInputError("NFT introuvable");
  await prisma.transaction.deleteMany({ where: { assetId } });
  await prisma.nftItemDetail.delete({ where: { id: item.id } });
  await prisma.asset.delete({ where: { id: assetId } });
}
