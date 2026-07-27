/** Vocabulaire du module NFT — standards de jeton et sources d'estimation. */

export const NFT_STANDARDS = {
  ERC_721: "ERC-721",
  ERC_1155: "ERC-1155",
  SPL: "SPL (Solana)",
} as const;

export type NftStandard = keyof typeof NFT_STANDARDS;

export const NFT_ESTIMATE_SOURCES = {
  OPENSEA: "OpenSea",
  BLUR: "Blur",
  MAGIC_EDEN: "Magic Eden",
  TENSOR: "Tensor",
  RESERVOIR: "Reservoir",
  MANUAL: "Saisie manuelle",
} as const;

export type NftEstimateSource = keyof typeof NFT_ESTIMATE_SOURCES;

export function nftEstimateSourceLabel(value: string): string {
  return NFT_ESTIMATE_SOURCES[value as NftEstimateSource] ?? value;
}

/**
 * Chaîne EVM ou Solana — au sens NFT, une simple étiquette de provenance.
 * `nft-providers.ts` en dérive la source d'estimation ; ce fichier ne fait
 * que nommer les chaînes reconnues pour l'affichage.
 */
export const NFT_CHAINS = {
  ethereum: "Ethereum",
  base: "Base",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  solana: "Solana",
} as const;

export function nftChainLabel(value: string): string {
  return NFT_CHAINS[value as keyof typeof NFT_CHAINS] ?? value;
}
