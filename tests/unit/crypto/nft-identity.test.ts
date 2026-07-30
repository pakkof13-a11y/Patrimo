import { describe, expect, it } from "vitest";
import {
  buildNftIdentity,
  collectionDedupKey,
  normalizeChainId,
  normalizeEvmAddress,
  normalizeSolanaMint,
  normalizeTokenId,
} from "@/app/lib/crypto/nft-identity";

describe("normalizeEvmAddress", () => {
  it("passe en minuscules et retire les espaces", () => {
    expect(normalizeEvmAddress("  0xABC123  ")).toBe("0xabc123");
  });
  it("renvoie null pour une valeur vide", () => {
    expect(normalizeEvmAddress(null)).toBeNull();
    expect(normalizeEvmAddress("")).toBeNull();
    expect(normalizeEvmAddress("   ")).toBeNull();
  });
});

describe("normalizeSolanaMint", () => {
  it("conserve la casse (base58 sensible à la casse)", () => {
    expect(normalizeSolanaMint("  AbCxYz123  ")).toBe("AbCxYz123");
  });
  it("renvoie null pour une valeur vide", () => {
    expect(normalizeSolanaMint(undefined)).toBeNull();
  });
});

describe("normalizeTokenId / normalizeChainId", () => {
  it("garde le tokenId en chaîne", () => {
    expect(normalizeTokenId("1234567890123456789")).toBe("1234567890123456789");
  });
  it("normalise la chaîne en minuscules", () => {
    expect(normalizeChainId("  Ethereum  ")).toBe("ethereum");
  });
});

describe("buildNftIdentity — EVM (cas 1 : ERC-721 classique)", () => {
  it("construit une clé evm:chain:contract:tokenId, contrat en minuscules", () => {
    const id = buildNftIdentity(
      { standard: "ERC_721", chainId: "Ethereum", contractAddress: "0xABC", tokenId: "42" },
      "fallback"
    );
    expect(id.uniqueKey).toBe("evm:ethereum:0xabc:42");
    expect(id.contractAddress).toBe("0xabc");
    expect(id.tokenId).toBe("42");
    expect(id.mintAddress).toBeNull();
  });

  it("ERC-1155 (cas 2 : quantité) suit la même identité que ERC-721", () => {
    const id = buildNftIdentity(
      { standard: "ERC_1155", chainId: "polygon", contractAddress: "0xDEF", tokenId: "7" },
      "fallback"
    );
    expect(id.uniqueKey).toBe("evm:polygon:0xdef:7");
    expect(id.standard).toBe("ERC_1155");
  });
});

describe("buildNftIdentity — Solana", () => {
  it("construit une clé sol:chain:mint, jamais fusionnée avec l'identité EVM", () => {
    const id = buildNftIdentity(
      { standard: "SPL", chainId: "solana", mintAddress: "AbCxYz123" },
      "fallback"
    );
    expect(id.uniqueKey).toBe("sol:solana:AbCxYz123");
    expect(id.contractAddress).toBeNull();
    expect(id.tokenId).toBeNull();
    expect(id.mintAddress).toBe("AbCxYz123");
  });

  it("compressed NFT (SPL_COMPRESSED) suit la même identité mint", () => {
    const id = buildNftIdentity(
      { standard: "SPL_COMPRESSED", chainId: "solana", mintAddress: "Compressed1" },
      "fallback"
    );
    expect(id.uniqueKey).toBe("sol:solana:Compressed1");
  });

  it("ignore un éventuel tokenId/contractAddress fourni par erreur sur Solana", () => {
    const id = buildNftIdentity(
      {
        standard: "SPL",
        chainId: "solana",
        mintAddress: "Mint1",
        contractAddress: "0xnotused",
        tokenId: "99",
      },
      "fallback"
    );
    expect(id.contractAddress).toBeNull();
    expect(id.tokenId).toBeNull();
    expect(id.uniqueKey).toBe("sol:solana:Mint1");
  });
});

describe("buildNftIdentity — repli manuel (saisie incomplète)", () => {
  it("retombe sur manual:{fallbackKey} sans contrat EVM", () => {
    const id = buildNftIdentity({ standard: "ERC_721", chainId: "ethereum" }, "asset-123");
    expect(id.uniqueKey).toBe("manual:asset-123");
  });

  it("retombe sur manual:{fallbackKey} sans mint Solana", () => {
    const id = buildNftIdentity({ standard: "SPL", chainId: "solana" }, "asset-456");
    expect(id.uniqueKey).toBe("manual:asset-456");
  });

  it("deux NFT sans identifiant technique ne collisionnent jamais (fallbackKey distincts)", () => {
    const a = buildNftIdentity({ standard: "ERC_721", chainId: "ethereum" }, "asset-1");
    const b = buildNftIdentity({ standard: "ERC_721", chainId: "ethereum" }, "asset-2");
    expect(a.uniqueKey).not.toBe(b.uniqueKey);
  });
});

describe("collectionDedupKey", () => {
  it("priorise le contrat sur le slug", () => {
    expect(
      collectionDedupKey({ chainId: "ethereum", contractAddress: "0xABC", slug: "boredapes" })
    ).toBe("ethereum:contract:0xabc");
  });

  it("retombe sur le slug sans contrat (collection Solana)", () => {
    expect(collectionDedupKey({ chainId: "solana", slug: "okay-bears" })).toBe(
      "solana:slug:okay-bears"
    );
  });

  it("renvoie null sans collection connue (cas 7 : sans collection)", () => {
    expect(collectionDedupKey({ chainId: "ethereum" })).toBeNull();
  });
});
