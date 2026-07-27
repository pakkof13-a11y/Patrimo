/** Client Tensor — repli de Magic Eden sur Solana. */

import { d } from "@/app/lib/money/decimal";
import type { FloorPriceProvider, FloorPriceResult } from "../nft-estimate";

const TENSOR_BASE = "https://api.tensor.so/graphql";

function resolveTensorApiKey(): string {
  return (process.env.TENSOR_API_KEY || "").trim();
}

const LAMPORTS_PER_SOL = 1_000_000_000;

type TensorCollectionStats = {
  data?: { collection?: { statsV2?: { floorPrice?: string | number | null } } };
};

export const fetchTensorFloorPrice: FloorPriceProvider = async (query) => {
  const apiKey = resolveTensorApiKey();
  if (!apiKey) {
    return { ok: false, source: "TENSOR", reason: "not-configured" };
  }
  if (!query.collectionSlug) {
    return { ok: false, source: "TENSOR", reason: "not-found" };
  }

  try {
    const res = await fetch(TENSOR_BASE, {
      method: "POST",
      headers: {
        "x-tensor-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query:
          "query($slug: String!) { collection(slug: $slug) { statsV2 { floorPrice } } }",
        variables: { slug: query.collectionSlug },
      }),
    });
    if (res.status === 429) return { ok: false, source: "TENSOR", reason: "rate-limited" };
    if (!res.ok) return { ok: false, source: "TENSOR", reason: "not-found" };

    const json = (await res.json()) as TensorCollectionStats;
    const raw = json.data?.collection?.statsV2?.floorPrice;
    if (raw == null) return { ok: false, source: "TENSOR", reason: "not-found" };

    const floor = d(raw).div(LAMPORTS_PER_SOL);
    if (!floor.isFinite()) return { ok: false, source: "TENSOR", reason: "not-found" };

    const result: FloorPriceResult = {
      ok: true,
      source: "TENSOR",
      floorPriceNative: floor,
      currency: "SOL",
      floorPriceUsd: null,
    };
    return result;
  } catch {
    return { ok: false, source: "TENSOR", reason: "network-error" };
  }
};
