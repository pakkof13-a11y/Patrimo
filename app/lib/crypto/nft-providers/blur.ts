/**
 * Client Blur — repli d'OpenSea sur Ethereum mainnet uniquement.
 *
 * Blur ne couvre que l'Ethereum L1 : appelé pour Base ou Polygon, il répond
 * systématiquement `not-found` plutôt que d'inventer un chiffre — mieux vaut
 * une estimation absente qu'une estimation fausse.
 */

import { d } from "@/app/lib/money/decimal";
import type { FloorPriceProvider, FloorPriceResult } from "../nft-estimate";

const BLUR_BASE = "https://api.blur.io/v1";

function resolveBlurApiKey(): string {
  return (process.env.BLUR_API_KEY || "").trim();
}

type BlurCollectionResponse = {
  collection?: { floorPrice?: { amount?: string | number | null } };
};

export const fetchBlurFloorPrice: FloorPriceProvider = async (query) => {
  const apiKey = resolveBlurApiKey();
  if (!apiKey) {
    return { ok: false, source: "BLUR", reason: "not-configured" };
  }
  if (query.chain.toLowerCase() !== "ethereum" || !query.contractAddr) {
    return { ok: false, source: "BLUR", reason: "not-found" };
  }

  try {
    const res = await fetch(`${BLUR_BASE}/collections/${query.contractAddr}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (res.status === 429) return { ok: false, source: "BLUR", reason: "rate-limited" };
    if (!res.ok) return { ok: false, source: "BLUR", reason: "not-found" };

    const json = (await res.json()) as BlurCollectionResponse;
    const amount = json.collection?.floorPrice?.amount;
    if (amount == null) return { ok: false, source: "BLUR", reason: "not-found" };

    const floor = d(amount);
    if (!floor.isFinite()) return { ok: false, source: "BLUR", reason: "not-found" };

    const result: FloorPriceResult = {
      ok: true,
      source: "BLUR",
      floorPriceNative: floor,
      currency: "ETH",
      floorPriceUsd: null,
    };
    return result;
  } catch {
    return { ok: false, source: "BLUR", reason: "network-error" };
  }
};
