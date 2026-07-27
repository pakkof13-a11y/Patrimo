/**
 * Client OpenSea — floor price d'une collection (Ethereum, Base, Polygon,
 * et repli pour le reste de l'EVM).
 *
 * Suit le même principe que `resolveZerionApiKey` : sans clé configurée, la
 * fonction renvoie un échec typé `not-configured` plutôt que de lever une
 * exception. C'est ce qui permet au module NFT de fonctionner intégralement
 * dès aujourd'hui — saisie manuelle, galerie, historique — la seule chose qui
 * manque tant qu'`OPENSEA_API_KEY` n'est pas renseignée est le rafraîchissement
 * automatique du floor price. Le jour où la clé arrive, aucun code n'a besoin
 * de changer.
 */

import { d } from "@/app/lib/money/decimal";
import type { FloorPriceProvider, FloorPriceResult } from "../nft-estimate";

const OPENSEA_BASE = "https://api.opensea.io/api/v2";

function resolveOpenSeaApiKey(): string {
  return (process.env.OPENSEA_API_KEY || "").trim();
}

/** OpenSea attend le nom de chaîne dans son propre vocabulaire. */
const CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  polygon: "matic",
  arbitrum: "arbitrum",
  optimism: "optimism",
};

type OpenSeaStatsResponse = {
  total?: { floor_price?: number | null; floor_price_symbol?: string | null };
};

/**
 * Résout le slug de collection à partir du contrat si nécessaire, puis
 * interroge les statistiques de la collection.
 *
 * Deux appels dans le pire cas (résolution + stats) : OpenSea n'indexe le
 * floor price que par slug, jamais directement par adresse de contrat.
 */
export const fetchOpenSeaFloorPrice: FloorPriceProvider = async (query) => {
  const apiKey = resolveOpenSeaApiKey();
  if (!apiKey) {
    return { ok: false, source: "OPENSEA", reason: "not-configured" };
  }

  const headers = { "X-API-KEY": apiKey, Accept: "application/json" };

  try {
    let slug = query.collectionSlug;
    if (!slug && query.contractAddr) {
      const chainParam = CHAIN_MAP[query.chain.toLowerCase()] || query.chain;
      const res = await fetch(
        `${OPENSEA_BASE}/chain/${chainParam}/contract/${query.contractAddr}`,
        { headers }
      );
      if (res.status === 429) return { ok: false, source: "OPENSEA", reason: "rate-limited" };
      if (!res.ok) return { ok: false, source: "OPENSEA", reason: "not-found" };
      const json = (await res.json()) as { collection?: string };
      slug = json.collection || null;
    }
    if (!slug) return { ok: false, source: "OPENSEA", reason: "not-found" };

    const statsRes = await fetch(`${OPENSEA_BASE}/collections/${slug}/stats`, { headers });
    if (statsRes.status === 429) return { ok: false, source: "OPENSEA", reason: "rate-limited" };
    if (!statsRes.ok) return { ok: false, source: "OPENSEA", reason: "not-found" };

    const stats = (await statsRes.json()) as OpenSeaStatsResponse;
    const floor = stats.total?.floor_price;
    if (floor == null || !Number.isFinite(floor)) {
      return { ok: false, source: "OPENSEA", reason: "not-found" };
    }

    const result: FloorPriceResult = {
      ok: true,
      source: "OPENSEA",
      floorPriceNative: d(floor),
      currency: (stats.total?.floor_price_symbol || "ETH").toUpperCase(),
      floorPriceUsd: null,
    };
    return result;
  } catch {
    return { ok: false, source: "OPENSEA", reason: "network-error" };
  }
};
