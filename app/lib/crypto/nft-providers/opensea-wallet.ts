/**
 * Découverte des NFT détenus par une adresse EVM — OpenSea.
 *
 * Même dégradation que `opensea.ts` : sans `OPENSEA_API_KEY`, renvoie
 * `not-configured` plutôt que d'échouer. La saisie manuelle reste le seul
 * chemin fonctionnel tant que la clé n'est pas renseignée.
 */

import type { WalletNftFetchResult, WalletNftItem, WalletNftProvider } from "./wallet-types";

const OPENSEA_BASE = "https://api.opensea.io/api/v2";

function resolveOpenSeaApiKey(): string {
  return (process.env.OPENSEA_API_KEY || "").trim();
}

const CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  polygon: "matic",
  arbitrum: "arbitrum",
  optimism: "optimism",
};

type OpenSeaAccountNftsResponse = {
  nfts?: Array<{
    identifier?: string;
    contract?: string;
    collection?: string;
    name?: string | null;
    image_url?: string | null;
    token_standard?: string | null;
  }>;
  next?: string | null;
};

/** Une seule page (50 NFT) — largement suffisant pour un portefeuille type. */
export const fetchOpenSeaWalletNfts: WalletNftProvider = async (address, chain) => {
  const apiKey = resolveOpenSeaApiKey();
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const chainParam = CHAIN_MAP[chain.toLowerCase()];
  if (!chainParam) return { ok: false, reason: "not-found" };

  try {
    const res = await fetch(
      `${OPENSEA_BASE}/chain/${chainParam}/account/${address}/nfts?limit=50`,
      { headers: { "X-API-KEY": apiKey, Accept: "application/json" } }
    );
    if (res.status === 429) return { ok: false, reason: "rate-limited" };
    if (!res.ok) return { ok: false, reason: "not-found" };

    const json = (await res.json()) as OpenSeaAccountNftsResponse;
    const items: WalletNftItem[] = (json.nfts ?? [])
      .filter((n) => n.identifier && n.contract)
      .map((n) => ({
        tokenId: n.identifier!,
        contractAddr: n.contract!,
        chain: chain.toLowerCase(),
        name: n.name || `#${n.identifier}`,
        collectionName: n.collection || null,
        collectionSlug: n.collection || null,
        imageUrl: n.image_url || null,
        standard:
          n.token_standard?.toLowerCase() === "erc1155" ? "ERC_1155" : "ERC_721",
      }));

    const result: WalletNftFetchResult = { ok: true, items };
    return result;
  } catch {
    return { ok: false, reason: "network-error" };
  }
};
