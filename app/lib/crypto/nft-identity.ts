/**
 * Normalisation d'identité NFT — fonctions pures, aucun accès Prisma.
 *
 * Centralise ce que le cahier des charges impose : adresses EVM stockées en
 * minuscules, `tokenId` toujours en chaîne (jamais en nombre — certains
 * dépassent la précision d'un entier JS), et une clé normalisée unique par
 * NFT qui sert de pivot à toute la déduplication (`nft-dedup.ts`).
 */

import { isSolanaStandard } from "./nft-taxonomy";

export type NftIdentityInput = {
  standard: string;
  chainId: string;
  contractAddress?: string | null;
  tokenId?: string | null;
  mintAddress?: string | null;
};

export type NftIdentity = {
  chainId: string;
  standard: string;
  contractAddress: string | null;
  tokenId: string | null;
  mintAddress: string | null;
  uniqueKey: string;
};

/** Adresse EVM normalisée — minuscules, espaces retirés, `null` si vide. */
export function normalizeEvmAddress(address: string | null | undefined): string | null {
  const v = (address ?? "").trim().toLowerCase();
  return v || null;
}

/** Mint Solana — sensible à la casse (base58), seul un `trim` s'applique. */
export function normalizeSolanaMint(mint: string | null | undefined): string | null {
  const v = (mint ?? "").trim();
  return v || null;
}

/** `tokenId` toujours en chaîne — jamais reformaté en nombre. */
export function normalizeTokenId(tokenId: string | null | undefined): string | null {
  const v = (tokenId ?? "").trim();
  return v || null;
}

export function normalizeChainId(chainId: string): string {
  return chainId.trim().toLowerCase();
}

/**
 * Construit l'identité normalisée d'un NFT.
 *
 * - Solana (`SPL`/`SPL_COMPRESSED`) : `sol:{chainId}:{mintAddress}`.
 * - EVM (`ERC_721`/`ERC_1155`) : `evm:{chainId}:{contractAddress}:{tokenId}`.
 * - Sans identifiant technique exploitable (saisie manuelle incomplète) :
 *   `manual:{fallbackKey}` — l'appelant fournit une clé stable (ex. l'id de
 *   l'`Asset` en cours de création) plutôt que de laisser deux NFT sans
 *   contrat ni mint collisionner silencieusement sur la même clé.
 *
 * Ne lève jamais : un identifiant manquant retombe sur `manual:`, la
 * validation métier (Zod + service) est seule responsable de refuser une
 * saisie EVM/Solana incomplète avant d'arriver ici.
 */
export function buildNftIdentity(
  input: NftIdentityInput,
  fallbackKey: string
): NftIdentity {
  const chainId = normalizeChainId(input.chainId);
  const isSolana = isSolanaStandard(input.standard);

  const contractAddress = isSolana ? null : normalizeEvmAddress(input.contractAddress);
  const tokenId = isSolana ? null : normalizeTokenId(input.tokenId);
  const mintAddress = isSolana ? normalizeSolanaMint(input.mintAddress) : null;

  let uniqueKey: string;
  if (isSolana && mintAddress) {
    uniqueKey = `sol:${chainId}:${mintAddress}`;
  } else if (!isSolana && contractAddress) {
    uniqueKey = `evm:${chainId}:${contractAddress}:${tokenId ?? ""}`;
  } else {
    uniqueKey = `manual:${fallbackKey}`;
  }

  return {
    chainId,
    standard: input.standard,
    contractAddress,
    tokenId,
    mintAddress,
    uniqueKey,
  };
}

/**
 * Clé de dédoublonnage d'une collection — `contractAddress` prioritaire
 * (identité forte), `slug` en repli (Solana n'a pas toujours de contrat de
 * collection), jamais les deux mêlés dans une seule chaîne ambiguë.
 */
export function collectionDedupKey(input: {
  chainId: string;
  contractAddress?: string | null;
  slug?: string | null;
}): string | null {
  const chainId = normalizeChainId(input.chainId);
  const contract = normalizeEvmAddress(input.contractAddress);
  if (contract) return `${chainId}:contract:${contract}`;
  const slug = (input.slug ?? "").trim().toLowerCase();
  if (slug) return `${chainId}:slug:${slug}`;
  return null;
}
