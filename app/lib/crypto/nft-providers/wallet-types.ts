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
  | {
      ok: true;
      items: WalletNftItem[];
      /** Curseur de page suivante — `null`/absent quand tout a été lu. */
      nextCursor?: string | null;
    }
  | {
      ok: false;
      reason: "not-configured" | "not-found" | "rate-limited" | "network-error";
    };

/**
 * `cursor` : curseur opaque de reprise, tel que renvoyé par un appel
 * précédent (`NftSyncCursor.cursor`). `undefined`/`null` = première page.
 */
export type WalletNftProvider = (
  address: string,
  chain: string,
  cursor?: string | null
) => Promise<WalletNftFetchResult>;
