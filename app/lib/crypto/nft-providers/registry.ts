/**
 * Câblage des providers réels dans l'orchestrateur pur.
 *
 * Seul point du module qui connaît à la fois la logique de décision
 * (`nft-estimate.ts`) et les clients réseau — tenu à l'écart des deux pour que
 * chacun reste testable indépendamment.
 */

import type { NftEstimateSource } from "../nft-constants";
import type { FloorPriceProvider } from "../nft-estimate";
import { fetchOpenSeaFloorPrice } from "./opensea";
import { fetchMagicEdenFloorPrice } from "./magic-eden";
import { fetchBlurFloorPrice } from "./blur";
import { fetchTensorFloorPrice } from "./tensor";
import { fetchReservoirFloorPrice } from "./reservoir";

export const NFT_PROVIDER_REGISTRY: Partial<
  Record<NftEstimateSource, FloorPriceProvider>
> = {
  OPENSEA: fetchOpenSeaFloorPrice,
  MAGIC_EDEN: fetchMagicEdenFloorPrice,
  BLUR: fetchBlurFloorPrice,
  TENSOR: fetchTensorFloorPrice,
  RESERVOIR: fetchReservoirFloorPrice,
};
