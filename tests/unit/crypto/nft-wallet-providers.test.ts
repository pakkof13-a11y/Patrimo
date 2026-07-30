/**
 * Pagination des providers de découverte wallet — cas 20 (sync partielle
 * avec curseur) et 46 (timeout/erreur provider). Fetch mocké selon la
 * convention établie par `tests/unit/market/finnhub-provider.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOpenSeaWalletNfts } from "@/app/lib/crypto/nft-providers/opensea-wallet";
import { fetchMagicEdenWalletNfts } from "@/app/lib/crypto/nft-providers/magic-eden-wallet";

const ORIGINAL_OPENSEA_KEY = process.env.OPENSEA_API_KEY;
const ORIGINAL_MAGIC_EDEN_KEY = process.env.MAGIC_EDEN_API_KEY;

function stubFetch(body: unknown, status = 200) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  process.env.OPENSEA_API_KEY = "test-opensea-key";
  process.env.MAGIC_EDEN_API_KEY = "test-magic-eden-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_OPENSEA_KEY === undefined) delete process.env.OPENSEA_API_KEY;
  else process.env.OPENSEA_API_KEY = ORIGINAL_OPENSEA_KEY;
  if (ORIGINAL_MAGIC_EDEN_KEY === undefined) delete process.env.MAGIC_EDEN_API_KEY;
  else process.env.MAGIC_EDEN_API_KEY = ORIGINAL_MAGIC_EDEN_KEY;
});

describe("fetchOpenSeaWalletNfts — pagination", () => {
  it("cas 20 : renvoie un nextCursor quand la page n'est pas la dernière", async () => {
    stubFetch({
      nfts: [{ identifier: "1", contract: "0xabc", name: "N1", token_standard: "erc721" }],
      next: "cursor-page-2",
    });
    const out = await fetchOpenSeaWalletNfts("0xwallet", "ethereum", null);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.items).toHaveLength(1);
      expect(out.nextCursor).toBe("cursor-page-2");
    }
  });

  it("transmet le curseur reçu à l'appel réseau suivant", async () => {
    const spy = stubFetch({ nfts: [], next: null });
    await fetchOpenSeaWalletNfts("0xwallet", "ethereum", "cursor-page-2");
    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("next=cursor-page-2");
  });

  it("nextCursor null signale la fin réelle du wallet — pas de reprise nécessaire", async () => {
    stubFetch({ nfts: [{ identifier: "9", contract: "0xdef", name: "Last" }], next: null });
    const out = await fetchOpenSeaWalletNfts("0xwallet", "ethereum", null);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.nextCursor).toBeNull();
  });

  it("cas 46 : un rate-limit (429) est distingué d'une erreur réseau", async () => {
    stubFetch({}, 429);
    const out = await fetchOpenSeaWalletNfts("0xwallet", "ethereum", null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("rate-limited");
  });

  it("une exception réseau renvoie network-error sans jeter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      })
    );
    const out = await fetchOpenSeaWalletNfts("0xwallet", "ethereum", null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("network-error");
  });

  it("sans clé API configurée, renvoie not-configured plutôt que d'échouer", async () => {
    delete process.env.OPENSEA_API_KEY;
    const out = await fetchOpenSeaWalletNfts("0xwallet", "ethereum", null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("not-configured");
  });

  it("cas 3 : un wallet vide renvoie une liste vide sans erreur", async () => {
    stubFetch({ nfts: [], next: null });
    const out = await fetchOpenSeaWalletNfts("0xemptywallet", "ethereum", null);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.items).toHaveLength(0);
  });
});

describe("fetchMagicEdenWalletNfts — pagination par offset", () => {
  it("cas 20 : une page pleine (50) laisse supposer une page suivante (offset+limit)", async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      mintAddress: `mint-${i}`,
      name: `NFT ${i}`,
    }));
    stubFetch(fullPage);
    const out = await fetchMagicEdenWalletNfts("solwallet", "solana", null);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.items).toHaveLength(50);
      expect(out.nextCursor).toBe("50");
    }
  });

  it("une page incomplète marque la fin (nextCursor null)", async () => {
    stubFetch([{ mintAddress: "mint-last", name: "Last" }]);
    const out = await fetchMagicEdenWalletNfts("solwallet", "solana", "50");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.nextCursor).toBeNull();
  });

  it("reprend depuis l'offset fourni par le curseur", async () => {
    const spy = stubFetch([]);
    await fetchMagicEdenWalletNfts("solwallet", "solana", "100");
    const calledUrl = spy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("offset=100");
  });

  it("cas 4 : un NFT Solana compressé (mint sans contrat EVM) est mappé correctement", async () => {
    stubFetch([{ mintAddress: "CompressedMint1", name: "Compressed" }]);
    const out = await fetchMagicEdenWalletNfts("solwallet", "solana", null);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.items[0].contractAddr).toBeNull();
      expect(out.items[0].tokenId).toBe("CompressedMint1");
      expect(out.items[0].standard).toBe("SPL");
    }
  });
});
