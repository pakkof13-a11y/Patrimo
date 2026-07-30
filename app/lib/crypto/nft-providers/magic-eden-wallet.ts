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

/**
 * `cursor` porte un offset décimal (Magic Eden pagine par `offset`/`limit`,
 * pas par jeton opaque) — piloté par l'appelant via `NftSyncCursor.cursor`.
 */
export const fetchMagicEdenWalletNfts: WalletNftProvider = async (address, _chain, cursor) => {
  const apiKey = resolveMagicEdenApiKey();
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const limit = 50;
  const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;

  try {
    const res = await fetch(
      `${MAGIC_EDEN_BASE}/wallets/${address}/tokens?offset=${offset}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );
    if (res.status === 429) return { ok: false, reason: "rate-limited" };
    if (!res.ok) return { ok: false, reason: "not-found" };

    const json = (await res.json()) as MagicEdenWalletToken[];
    const rows = Array.isArray(json) ? json : [];
    const items: WalletNftItem[] = rows
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

    // Magic Eden ne renvoie pas de total : une page pleine laisse supposer
    // qu'il en reste une suivante, une page incomplète marque la fin.
    const nextCursor = rows.length >= limit ? String(offset + limit) : null;
    const result: WalletNftFetchResult = { ok: true, items, nextCursor };
    return result;
  } catch {
    return { ok: false, reason: "network-error" };
  }
};
