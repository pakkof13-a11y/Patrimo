import { describe, expect, it } from "vitest";
import { providerForChain } from "@/app/lib/crypto/nft-wallet-sync";
import { fetchOpenSeaWalletNfts } from "@/app/lib/crypto/nft-providers/opensea-wallet";
import { fetchMagicEdenWalletNfts } from "@/app/lib/crypto/nft-providers/magic-eden-wallet";

describe("providerForChain", () => {
  it("route Solana vers Magic Eden", () => {
    expect(providerForChain("solana")).toBe(fetchMagicEdenWalletNfts);
    expect(providerForChain("SOLANA")).toBe(fetchMagicEdenWalletNfts);
  });

  it("route toute chaîne EVM vers OpenSea", () => {
    expect(providerForChain("ethereum")).toBe(fetchOpenSeaWalletNfts);
    expect(providerForChain("base")).toBe(fetchOpenSeaWalletNfts);
    expect(providerForChain("polygon")).toBe(fetchOpenSeaWalletNfts);
    expect(providerForChain("arbitrum")).toBe(fetchOpenSeaWalletNfts);
  });
});

describe("fetchOpenSeaWalletNfts — sans clé configurée", () => {
  it("renvoie not-configured plutôt que d'appeler le réseau", async () => {
    const res = await fetchOpenSeaWalletNfts("0xabc", "ethereum");
    expect(res).toEqual({ ok: false, reason: "not-configured" });
  });
});

describe("fetchMagicEdenWalletNfts — sans clé configurée", () => {
  it("renvoie not-configured plutôt que d'appeler le réseau", async () => {
    const res = await fetchMagicEdenWalletNfts("someaddr", "solana");
    expect(res).toEqual({ ok: false, reason: "not-configured" });
  });
});
