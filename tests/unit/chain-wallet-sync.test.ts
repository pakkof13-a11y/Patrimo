import { describe, expect, it } from "vitest";
import {
  availableApiStatusMessage,
  blockchainCatalogPresets,
  describeChainSyncFeatures,
  getChainSyncCapability,
  hasChainSyncApi,
  missingApiStatusMessage,
  missingApiWarning,
  resolveChainSyncForPlatform,
} from "@/app/lib/market/chain-wallet-sync";

describe("chain-wallet-sync", () => {
  it("expose Solana (Helius) et EVM (Zerion) comme API réelles", () => {
    expect(hasChainSyncApi("SOLANA")).toBe(true);
    expect(hasChainSyncApi("ETHEREUM")).toBe(true);
    expect(hasChainSyncApi("POLYGON")).toBe(true);
    expect(hasChainSyncApi("MONERO")).toBe(true);
    // Chaînes non branchées (BTC natif hors Zerion EVM)
    expect(hasChainSyncApi("BITCOIN")).toBe(false);
    expect(getChainSyncCapability("SOLANA")?.syncPath).toBe(
      "/api/wallets/solana/sync"
    );
    expect(getChainSyncCapability("ETHEREUM")?.syncPath).toBe(
      "/api/wallets/zerion/sync"
    );
    expect(getChainSyncCapability("SOLANA")?.provider).toBe("helius-solana");
    expect(getChainSyncCapability("ETHEREUM")?.provider).toBe("zerion");
  });

  it("valide une adresse Solana", () => {
    const cap = getChainSyncCapability("SOLANA")!;
    expect(
      cap.validateAddress("5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf")
    ).toBe(true);
    expect(cap.validateAddress("0xabc")).toBe(false);
  });

  it("valide une adresse EVM Zerion", () => {
    const cap = getChainSyncCapability("ETHEREUM")!;
    expect(
      cap.validateAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")
    ).toBe(true);
    expect(cap.validateAddress("not-an-address")).toBe(false);
  });

  it("catalogue blockchain non vide et messages de statut clairs", () => {
    expect(blockchainCatalogPresets().length).toBeGreaterThan(5);
    expect(missingApiStatusMessage()).toMatch(/API non disponible/i);
    expect(missingApiStatusMessage()).toMatch(/manuel/i);
    expect(availableApiStatusMessage()).toMatch(/synchronisation disponible/i);
    expect(missingApiWarning("Bitcoin (BTC)")).toMatch(/API non disponible/i);
  });

  it("décrit les capacités Solana (positions + historique on-chain)", () => {
    const cap = getChainSyncCapability("SOLANA")!;
    const d = describeChainSyncFeatures(cap);
    expect(d).toMatch(/Helius|Solana/i);
    expect(d).toMatch(/tokens/i);
    expect(d).toMatch(/positions|patrimoine/i);
    expect(d).toMatch(/historique on-chain/i);
  });

  it("décrit les capacités Ethereum via Zerion", () => {
    const cap = getChainSyncCapability("ETHEREUM")!;
    const d = describeChainSyncFeatures(cap);
    expect(d).toMatch(/Zerion/i);
    expect(d).toMatch(/tokens/i);
    expect(cap.showApiKeyField).toBe(true);
    // Clé réelle uniquement via env serveur — jamais pré-remplie dans le client
    expect(cap.defaultApiKey || "").toBe("");
  });

  it("résout Solana / Ethereum depuis nom / logoKey", () => {
    expect(
      resolveChainSyncForPlatform({ logoKey: "SOLANA" })?.presetKey
    ).toBe("SOLANA");
    expect(
      resolveChainSyncForPlatform({ name: "Solana (SOL)" })?.presetKey
    ).toBe("SOLANA");
    expect(
      resolveChainSyncForPlatform({ name: "Ethereum (ETH)" })?.presetKey
    ).toBe("ETHEREUM");
    expect(
      resolveChainSyncForPlatform({ logoKey: "ETHEREUM" })?.provider
    ).toBe("zerion");
    expect(
      resolveChainSyncForPlatform({ name: "Monero (XMR)" })?.provider
    ).toBe("monero-manual");
  });
});
