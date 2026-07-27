/**
 * Saisie manuelle d'un NFT.
 *
 * Le chemin qui fonctionne intégralement dès aujourd'hui, sans aucune clé
 * API : l'utilisateur renseigne le prix d'acquisition (qui devient le coût de
 * revient au journal, comme pour tout autre actif) et peut fixer une valeur
 * manuelle qui tient lieu de floor price tant qu'aucun rafraîchissement
 * automatique n'a eu lieu.
 *
 * Reprend `indirect-service.ts` / `defi-manual-service.ts` : actif et
 * transaction d'entrée créés dans la même transaction de base.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { NFT_STANDARDS } from "./nft-constants";

export class NftInputError extends Error {
  readonly code = "NFT_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "NftInputError";
  }
}

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
  if (input.standard && !(input.standard in NFT_STANDARDS)) {
    throw new NftInputError("Standard de jeton inconnu");
  }

  const quantity = d(input.quantity || "1");
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new NftInputError("La quantité doit être strictement positive");
  }

  const acqPrice = d(input.acquisitionPriceEur);
  if (!acqPrice.isFinite() || acqPrice.lt(0)) {
    throw new NftInputError("Le prix d'acquisition ne peut pas être négatif");
  }

  const acquisitionDate = new Date(input.acquisitionDate);
  if (Number.isNaN(acquisitionDate.getTime())) {
    throw new NftInputError("Date d'acquisition invalide");
  }

  const manualFloor = dec(input.manualFloorPriceEur);

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
        manualPrice: manualFloor
          ? d(manualFloor).toFixed(12)
          : quantity.gt(0)
            ? acqPrice.div(quantity).toFixed(12)
            : "0",
        logoUrl: input.imageUrl?.trim() || null,
        acquisitionDate,
        notes: input.notes?.trim() || null,
      },
    });

    const item = await tx.nftItemDetail.create({
      data: {
        assetId: asset.id,
        tokenId: input.tokenId.trim(),
        contractAddr: input.contractAddr?.trim() || null,
        chain: input.chain.trim().toLowerCase(),
        collectionName: input.collectionName?.trim() || null,
        collectionSlug: input.collectionSlug?.trim() || null,
        imageUrl: input.imageUrl?.trim() || null,
        standard: input.standard || null,
        valuationMode: "MANUAL",
        floorPriceEur: manualFloor,
        estimateSource: manualFloor ? "MANUAL" : null,
        estimateDate: manualFloor ? new Date() : null,
        notes: input.notes?.trim() || null,
      },
    });

    // `allowNegativeCash` comme pour une souscription SCPI ou un engagement
    // DeFi : l'acquisition d'un NFT déjà réglée (souvent en cash ou via une
    // autre position) n'est pas financée par la trésorerie suivie ici.
    await createTransaction(
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

  return prisma.$transaction(async (tx) => {
    await tx.nftItemDetail.update({
      where: { id: item.id },
      data: {
        valuationMode: "MANUAL",
        floorPriceEur: floor.toFixed(2),
        estimateSource: "MANUAL",
        estimateDate: new Date(),
        lastValuedAt: new Date(),
      },
    });
    await tx.asset.update({
      where: { id: assetId },
      data: { manualPrice: floor.toFixed(12) },
    });
  });
}

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
