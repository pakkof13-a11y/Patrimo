/**
 * Orchestration de l'estimation de floor price — logique pure, sans réseau.
 *
 * Chaque provider (OpenSea, Magic Eden, Blur, Tensor, Reservoir) est injecté
 * comme une fonction : ce module ne sait pas parler HTTP, il sait seulement
 * quel provider interroger en premier pour une chaîne donnée, et vers quel
 * provider basculer si le premier échoue. C'est ce qui le rend testable sans
 * réseau ni clé API — et c'est la même raison que les moteurs fiscaux
 * immobiliers sont restés purs : la logique de décision et l'appel externe
 * sont deux choses différentes, qui ne doivent pas être testées ensemble.
 */

import type Decimal from "decimal.js";
import type { NftEstimateSource } from "./nft-constants";

export type FloorPriceQuery = {
  chain: string;
  contractAddr: string | null;
  collectionSlug: string | null;
};

export type FloorPriceSuccess = {
  ok: true;
  source: NftEstimateSource;
  floorPriceNative: Decimal;
  currency: string;
  floorPriceUsd: Decimal | null;
};

export type FloorPriceFailureReason =
  /** Aucune clé API configurée pour ce provider — pas une panne, un manque de configuration. */
  | "not-configured"
  | "not-found"
  | "rate-limited"
  | "network-error";

export type FloorPriceFailure = {
  ok: false;
  source: NftEstimateSource;
  reason: FloorPriceFailureReason;
};

export type FloorPriceResult = FloorPriceSuccess | FloorPriceFailure;

export type FloorPriceProvider = (query: FloorPriceQuery) => Promise<FloorPriceResult>;

/**
 * Provider principal et provider de repli par chaîne.
 *
 * Une simple table, comme le barème des dispositifs fiscaux immobiliers :
 * elle se corrige d'une ligne le jour où un exchange change d'API, sans
 * logique à ré-auditer. Ethereum/Base/Polygon vont à OpenSea (couverture la
 * plus large), Solana à Magic Eden (le seul des deux à connaître SPL), le
 * reste de l'EVM retombe sur OpenSea également mais avec Reservoir en repli
 * plutôt que Blur, qui ne couvre que l'Ethereum mainnet.
 */
export function providersForChain(
  chain: string
): { primary: NftEstimateSource; fallback: NftEstimateSource } {
  const c = chain.toLowerCase();
  if (c === "solana") return { primary: "MAGIC_EDEN", fallback: "TENSOR" };
  if (c === "ethereum" || c === "base" || c === "polygon") {
    return { primary: "OPENSEA", fallback: "BLUR" };
  }
  return { primary: "OPENSEA", fallback: "RESERVOIR" };
}

export type FloorPriceOutcome = {
  result: FloorPriceResult;
  /** Tentative(s) effectuée(s), dans l'ordre — utile pour diagnostiquer un échec. */
  attempts: FloorPriceResult[];
};

/**
 * Estime le floor price d'une collection : tente le provider principal, puis
 * le provider de repli si le premier échoue — quelle que soit la raison.
 *
 * Ne réessaie jamais un provider qui vient d'échouer : un « not-configured »
 * ne devient pas vrai en insistant, et une erreur réseau transitoire relève
 * d'un retry applicatif plus haut, pas de cette fonction.
 */
export async function estimateFloorPrice(
  query: FloorPriceQuery,
  providers: Partial<Record<NftEstimateSource, FloorPriceProvider>>
): Promise<FloorPriceOutcome> {
  const { primary, fallback } = providersForChain(query.chain);
  const attempts: FloorPriceResult[] = [];

  const primaryFn = providers[primary];
  const primaryResult: FloorPriceResult = primaryFn
    ? await primaryFn(query)
    : { ok: false, source: primary, reason: "not-configured" };
  attempts.push(primaryResult);
  if (primaryResult.ok) return { result: primaryResult, attempts };

  const fallbackFn = providers[fallback];
  const fallbackResult: FloorPriceResult = fallbackFn
    ? await fallbackFn(query)
    : { ok: false, source: fallback, reason: "not-configured" };
  attempts.push(fallbackResult);

  return { result: fallbackResult, attempts };
}
