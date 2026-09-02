/**
 * Interfaces des providers NFT (D10 de `docs/nft-backend-v1.md`).
 *
 * Trois familles de besoin, trois interfaces — même si toutes ne sont pas
 * branchées à un vrai appel réseau en V1 :
 * - `NftOwnershipProvider` : quels NFT une adresse détient (sync wallet) ;
 * - `NftValuationProvider` : combien vaut une collection (floor/estimation) ;
 * - `NftMetadataProvider` : rafraîchir nom/médias/traits d'un NFT précis.
 *
 * Les implémentations existantes (`nft-providers/opensea*.ts`,
 * `magic-eden*.ts`, `blur.ts`, `tensor.ts`, `reservoir.ts`) satisfont déjà
 * `NftOwnershipProvider`/`NftValuationProvider` — elles dégradent proprement
 * en `not-configured`/`rate-limited`/`network-error` sans clé API.
 */

export type { FloorPriceProvider as NftValuationProvider } from "./nft-estimate";
export type { WalletNftProvider as NftOwnershipProvider } from "./nft-providers/wallet-types";

export type NftMetadataQuery = {
  chainId: string;
  standard: string;
  contractAddress: string | null;
  tokenId: string | null;
  mintAddress: string | null;
};

export type NftMetadataSuccess = {
  ok: true;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  animationUrl: string | null;
  externalUrl: string | null;
  traits: Array<{ traitType: string; value: string }>;
  rawPayload: unknown;
};

export type NftMetadataFailureReason =
  | "not-configured"
  | "not-found"
  | "rate-limited"
  | "network-error"
  | "parse-error";

export type NftMetadataFailure = {
  ok: false;
  reason: NftMetadataFailureReason;
};

export type NftMetadataResult = NftMetadataSuccess | NftMetadataFailure;

/**
 * Rafraîchit la metadata (nom, médias, traits) d'un NFT précis.
 *
 * Aucune implémentation réseau en V1 (limite documentée : pas de clé de
 * metadata dédiée disponible) — `nft-metadata-provider.ts` fournit le stub
 * qui satisfait cette interface en renvoyant `not-configured`, pour que
 * l'appelant (rafraîchissement de metadata) ait un chemin propre plutôt
 * qu'un appel manquant.
 */
export type NftMetadataProvider = (query: NftMetadataQuery) => Promise<NftMetadataResult>;
