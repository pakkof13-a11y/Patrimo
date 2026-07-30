/**
 * Stub `NftMetadataProvider` (D10 / limite V1 §1 de `docs/nft-backend-v1.md`).
 *
 * Aucune clé de metadata dédiée n'est disponible en V1 : ce stub satisfait
 * l'interface (pour que le rafraîchissement de metadata ait un chemin
 * d'appel propre à brancher plus tard) sans jamais prétendre avoir
 * réellement interrogé un provider.
 */

import type { NftMetadataProvider } from "./nft-provider-types";

export const stubNftMetadataProvider: NftMetadataProvider = async () => {
  return { ok: false, reason: "not-configured" };
};
