import { describe, expect, it } from "vitest";
import {
  blockTimeToDate,
  toOccurredAtIso,
} from "@/app/lib/solana/datetime";
import {
  isPlaceholderName,
  isPlaceholderTicker,
  lookupWellKnownMint,
} from "@/app/lib/solana/token-meta";
import { extractOnchainSignature } from "@/app/lib/market/solana-onchain-to-ledger";

describe("solana datetime", () => {
  it("blockTime secondes → Date UTC", () => {
    // 2024-06-15 12:00:00 UTC
    const d = blockTimeToDate(1_718_452_800);
    expect(d).toBeTruthy();
    expect(d!.toISOString()).toBe("2024-06-15T12:00:00.000Z");
  });

  it("toOccurredAtIso conserve le Z (évite parse local)", () => {
    const d = new Date("2024-06-15T12:00:00.000Z");
    const iso = toOccurredAtIso(d);
    expect(iso).toBe("2024-06-15T12:00:00.000Z");
    // new Date(iso) doit rester le même instant
    expect(new Date(iso!).toISOString()).toBe(iso);
  });

  it("slice(0,16) sans Z serait faux (documente le bug)", () => {
    const d = new Date("2024-06-15T12:00:00.000Z");
    const broken = d.toISOString().slice(0, 16); // "2024-06-15T12:00"
    expect(broken.endsWith("Z")).toBe(false);
    // Interprétation locale ≠ UTC selon fuseau — on n’utilise plus ce format
    expect(toOccurredAtIso(d)).toContain("Z");
  });
});

describe("solana token meta", () => {
  it("well-known USDC / USDT / SOL wrap", () => {
    expect(
      lookupWellKnownMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
        ?.symbol
    ).toBe("USDC");
    expect(
      lookupWellKnownMint("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")
        ?.symbol
    ).toBe("USDT");
  });

  it("placeholder ticker = préfixe mint, pas USDC/JUP", () => {
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    expect(isPlaceholderTicker("EPjF…", mint)).toBe(true);
    expect(isPlaceholderTicker("USDC", mint)).toBe(false);
    expect(isPlaceholderTicker("SOL")).toBe(false);
    // JUP est préfixe du mint JUPyiwr… mais c’est un vrai ticker
    expect(
      isPlaceholderTicker(
        "JUP",
        "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"
      )
    ).toBe(false);
  });

  it("placeholder name", () => {
    expect(isPlaceholderName("Token EPJF…")).toBe(true);
    expect(
      isPlaceholderName("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    ).toBe(true);
    expect(isPlaceholderName("USD Coin")).toBe(false);
  });
});

describe("onchain note signature", () => {
  it("extrait la sig pour réparation de dates", () => {
    const sig =
      "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    const notes = `[onchain:${sig}] [wallet-sync:solana] TRANSFER in USDC`;
    expect(extractOnchainSignature(notes)).toBe(sig);
    expect(extractOnchainSignature("manual note")).toBeNull();
  });
});
