/** Client Reservoir — repli d'OpenSea sur l'EVM hors Ethereum/Base/Polygon. */

import { d } from "@/app/lib/money/decimal";
import type { FloorPriceProvider, FloorPriceResult } from "../nft-estimate";

const RESERVOIR_BASE = "https://api.reservoir.tools";

function resolveReservoirApiKey(): string {
  return (process.env.RESERVOIR_API_KEY || "").trim();
}

type ReservoirCollectionsResponse = {
  collections?: Array<{ floorAsk?: { price?: { amount?: { decimal?: number | null } } } }>;
};

export const fetchReservoirFloorPrice: FloorPriceProvider = async (query) => {
  const apiKey = resolveReservoirApiKey();
  if (!apiKey) {
    return { ok: false, source: "RESERVOIR", reason: "not-configured" };
  }
  if (!query.contractAddr) {
    return { ok: false, source: "RESERVOIR", reason: "not-found" };
  }

  try {
    const res = await fetch(
      `${RESERVOIR_BASE}/collections/v7?contract=${query.contractAddr}`,
      { headers: { "x-api-key": apiKey, Accept: "application/json" } }
    );
    if (res.status === 429) return { ok: false, source: "RESERVOIR", reason: "rate-limited" };
    if (!res.ok) return { ok: false, source: "RESERVOIR", reason: "not-found" };

    const json = (await res.json()) as ReservoirCollectionsResponse;
    const decimal = json.collections?.[0]?.floorAsk?.price?.amount?.decimal;
    if (decimal == null) return { ok: false, source: "RESERVOIR", reason: "not-found" };

    const floor = d(decimal);
    if (!floor.isFinite()) return { ok: false, source: "RESERVOIR", reason: "not-found" };

    const result: FloorPriceResult = {
      ok: true,
      source: "RESERVOIR",
      floorPriceNative: floor,
      currency: "ETH",
      floorPriceUsd: null,
    };
    return result;
  } catch {
    return { ok: false, source: "RESERVOIR", reason: "network-error" };
  }
};
