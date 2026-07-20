import { describe, expect, it } from "vitest";
import { isSolanaAddress, shortSolanaAddress } from "@/app/lib/solana/address";
import { parseSolanaTransaction } from "@/app/lib/solana/transaction-parse";

describe("isSolanaAddress", () => {
  it("accepte une adresse base58 typique", () => {
    expect(
      isSolanaAddress("5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf")
    ).toBe(true);
  });

  it("rejette EVM et chaînes courtes", () => {
    expect(isSolanaAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb")).toBe(
      false
    );
    expect(isSolanaAddress("abc")).toBe(false);
  });
});

describe("shortSolanaAddress", () => {
  it("tronque", () => {
    expect(shortSolanaAddress("5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf")).toMatch(
      /…/
    );
  });
});

describe("parseSolanaTransaction", () => {
  it("gère null (tx introuvable)", () => {
    const p = parseSolanaTransaction("sig123", "WalletX", null);
    expect(p.status).toBe("unknown");
    expect(p.err).toBe("transaction_not_found");
    expect(p.functionalType).toBe("UNKNOWN");
  });
});
