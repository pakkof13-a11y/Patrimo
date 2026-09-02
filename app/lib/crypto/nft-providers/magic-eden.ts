/**
 * Client Magic Eden — floor price d'une collection Solana.
 *
 * Magic Eden expose des statistiques de collection sans clé pour un usage
 * léger, mais reste gardé derrière `MAGIC_EDEN_API_KEY` par cohérence avec les
 * autres providers : un usage en production mérite une clé dédiée (quotas,
 * traçabilité), même si l'API publique répondrait sans.
 */

import { d } from "@/app/lib/money/decimal";
import type { FloorPriceProvider, FloorPriceResult } from "../nft-estimate";

const MAGIC_EDEN_BASE = "https://api-mainnet.magiceden.dev/v2";

function resolveMagicEdenApiKey(): string {
  return (process.env.MAGIC_EDEN_API_KEY || "").trim();
}

type MagicEdenStatsResponse = {
  floorPrice?: number | null; // lamports
};

const LAMPORTS_PER_SOL = 1_000_000_000;

export const fetchMagicEdenFloorPrice: FloorPriceProvider = async (query) => {
  const apiKey = resolveMagicEdenApiKey();
  if (!apiKey) {
    return { ok: false, source: "MAGIC_EDEN", reason: "not-configured" };
  }
  if (!query.collectionSlug) {
    return { ok: false, source: "MAGIC_EDEN", reason: "not-found" };
  }

  try {
    const res = await fetch(
      `${MAGIC_EDEN_BASE}/collections/${query.collectionSlug}/stats`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );
    if (res.status === 429) return { ok: false, source: "MAGIC_EDEN", reason: "rate-limited" };
    if (!res.ok) return { ok: false, source: "MAGIC_EDEN", reason: "not-found" };

    const json = (await res.json()) as MagicEdenStatsResponse;
    if (json.floorPrice == null || !Number.isFinite(json.floorPrice)) {
      return { ok: false, source: "MAGIC_EDEN", reason: "not-found" };
    }

    const result: FloorPriceResult = {
      ok: true,
      source: "MAGIC_EDEN",
      floorPriceNative: d(json.floorPrice).div(LAMPORTS_PER_SOL),
      currency: "SOL",
      floorPriceUsd: null,
    };
    return result;
  } catch {
    return { ok: false, source: "MAGIC_EDEN", reason: "network-error" };
  }
};
