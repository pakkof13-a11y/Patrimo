/**
 * Découverte des NFT détenus par une adresse EVM — OpenSea.
 *
 * Même dégradation que `opensea.ts` : sans `OPENSEA_API_KEY`, renvoie
 * `not-configured` plutôt que d'échouer. La saisie manuelle reste le seul
 * chemin fonctionnel tant que la clé n'est pas renseignée.
 *
 * Partage `openSeaGetLimiter` avec le floor price : c'est le même budget
 * OpenSea (4 GET/s en free tier) pour tout le processus, pas un par client.
 */

import { openSeaGetLimiter } from "@/app/lib/market/rate-limit";
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

/**
 * Une page (50 NFT) par appel — la pagination réelle (curseur `next`) est
 * pilotée par l'appelant via `NftSyncCursor.cursor`, pas rejouée en boucle
 * ici : c'est ce qui permet à une synchronisation dense de reprendre là où
 * elle s'est arrêtée plutôt que de tout relire à chaque passage.
 */
export const fetchOpenSeaWalletNfts: WalletNftProvider = async (address, chain, cursor) => {
  const apiKey = resolveOpenSeaApiKey();
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const chainParam = CHAIN_MAP[chain.toLowerCase()];
  if (!chainParam) return { ok: false, reason: "not-found" };

  try {
    await openSeaGetLimiter.acquire();
    const cursorParam = cursor ? `&next=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(
      `${OPENSEA_BASE}/chain/${chainParam}/account/${address}/nfts?limit=50${cursorParam}`,
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

    const result: WalletNftFetchResult = { ok: true, items, nextCursor: json.next || null };
    return result;
  } catch {
    return { ok: false, reason: "network-error" };
  }
};
