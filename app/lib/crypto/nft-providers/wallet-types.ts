/**
 * Découverte de NFT par adresse de wallet — types partagés.
 *
 * Distinct de `FloorPriceResult` (nft-estimate.ts) : ici la question n'est
 * pas « combien vaut cette collection » mais « quels NFT ce wallet détient ».
 * Deux opérations différentes, deux types différents — les mélanger aurait
 * rendu l'un ou l'autre incompréhensible dès qu'on ajoute un provider.
 */

export type WalletNftItem = {
  tokenId: string;
  contractAddr: string | null;
  chain: string;
  name: string;
  collectionName: string | null;
  collectionSlug: string | null;
  imageUrl: string | null;
  standard: string | null;
};

export type WalletNftFetchResult =
  | { ok: true; items: WalletNftItem[] }
  | {
      ok: false;
      reason: "not-configured" | "not-found" | "rate-limited" | "network-error";
    };

export type WalletNftProvider = (
  address: string,
  chain: string
) => Promise<WalletNftFetchResult>;
