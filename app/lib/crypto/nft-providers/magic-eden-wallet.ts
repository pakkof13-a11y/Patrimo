/** Découverte des NFT détenus par une adresse Solana — Magic Eden. */

import type { WalletNftFetchResult, WalletNftItem, WalletNftProvider } from "./wallet-types";

const MAGIC_EDEN_BASE = "https://api-mainnet.magiceden.dev/v2";

function resolveMagicEdenApiKey(): string {
  return (process.env.MAGIC_EDEN_API_KEY || "").trim();
}

type MagicEdenWalletToken = {
  mintAddress?: string;
  name?: string | null;
  image?: string | null;
  collection?: string | null;
  collectionName?: string | null;
};

export const fetchMagicEdenWalletNfts: WalletNftProvider = async (address) => {
  const apiKey = resolveMagicEdenApiKey();
  if (!apiKey) return { ok: false, reason: "not-configured" };

  try {
    const res = await fetch(
      `${MAGIC_EDEN_BASE}/wallets/${address}/tokens?limit=50`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );
    if (res.status === 429) return { ok: false, reason: "rate-limited" };
    if (!res.ok) return { ok: false, reason: "not-found" };

    const json = (await res.json()) as MagicEdenWalletToken[];
    const items: WalletNftItem[] = (Array.isArray(json) ? json : [])
      .filter((t) => t.mintAddress)
      .map((t) => ({
        tokenId: t.mintAddress!,
        contractAddr: null,
        chain: "solana",
        name: t.name || t.mintAddress!.slice(0, 8),
        collectionName: t.collectionName || null,
        collectionSlug: t.collection || null,
        imageUrl: t.image || null,
        standard: "SPL",
      }));

    const result: WalletNftFetchResult = { ok: true, items };
    return result;
  } catch {
    return { ok: false, reason: "network-error" };
  }
};
