import { describe, expect, it, vi } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  estimateFloorPrice,
  providersForChain,
  type FloorPriceProvider,
  type FloorPriceResult,
} from "@/app/lib/crypto/nft-estimate";

function ok(source: FloorPriceResult["source"]): FloorPriceResult {
  return {
    ok: true,
    source,
    floorPriceNative: d(1.5),
    currency: "ETH",
    floorPriceUsd: d(4500),
  };
}
function fail(
  source: FloorPriceResult["source"],
  reason: Extract<FloorPriceResult, { ok: false }>["reason"] = "not-configured"
): FloorPriceResult {
  return { ok: false, source, reason };
}

describe("providersForChain", () => {
  it("route Ethereum/Base/Polygon vers OpenSea, repli Blur", () => {
    expect(providersForChain("ethereum")).toEqual({ primary: "OPENSEA", fallback: "BLUR" });
    expect(providersForChain("base")).toEqual({ primary: "OPENSEA", fallback: "BLUR" });
    expect(providersForChain("polygon")).toEqual({ primary: "OPENSEA", fallback: "BLUR" });
  });

  it("route Solana vers Magic Eden, repli Tensor", () => {
    expect(providersForChain("solana")).toEqual({ primary: "MAGIC_EDEN", fallback: "TENSOR" });
  });

  it("route le reste de l'EVM vers OpenSea, repli Reservoir", () => {
    expect(providersForChain("arbitrum")).toEqual({ primary: "OPENSEA", fallback: "RESERVOIR" });
    expect(providersForChain("optimism")).toEqual({ primary: "OPENSEA", fallback: "RESERVOIR" });
    expect(providersForChain("un_chain_inconnue")).toEqual({ primary: "OPENSEA", fallback: "RESERVOIR" });
  });

  it("n'est pas sensible à la casse", () => {
    expect(providersForChain("Solana")).toEqual({ primary: "MAGIC_EDEN", fallback: "TENSOR" });
  });
});

describe("estimateFloorPrice — sans aucune clé configurée (état actuel de la sandbox)", () => {
  it("renvoie 'not-configured' pour le principal et le repli, sans lever d'exception", async () => {
    const out = await estimateFloorPrice(
      { chain: "ethereum", contractAddr: "0xabc", collectionSlug: null },
      {}
    );
    expect(out.result.ok).toBe(false);
    expect((out.result as { reason: string }).reason).toBe("not-configured");
    expect(out.attempts).toHaveLength(2);
    expect(out.attempts[0].source).toBe("OPENSEA");
    expect(out.attempts[1].source).toBe("BLUR");
  });
});

describe("estimateFloorPrice — bascule sur le repli", () => {
  it("essaie OpenSea puis Blur si OpenSea échoue", async () => {
    const opensea = vi.fn<FloorPriceProvider>().mockResolvedValue(fail("OPENSEA", "network-error"));
    const blur = vi.fn<FloorPriceProvider>().mockResolvedValue(ok("BLUR"));

    const out = await estimateFloorPrice(
      { chain: "ethereum", contractAddr: "0xabc", collectionSlug: null },
      { OPENSEA: opensea, BLUR: blur }
    );

    expect(opensea).toHaveBeenCalledTimes(1);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(out.result.ok).toBe(true);
    expect(out.result.source).toBe("BLUR");
  });

  it("ne retente jamais le provider principal après son échec", async () => {
    const opensea = vi.fn<FloorPriceProvider>().mockResolvedValue(fail("OPENSEA", "rate-limited"));
    const blur = vi.fn<FloorPriceProvider>().mockResolvedValue(fail("BLUR", "not-found"));

    await estimateFloorPrice(
      { chain: "ethereum", contractAddr: "0xabc", collectionSlug: null },
      { OPENSEA: opensea, BLUR: blur }
    );

    expect(opensea).toHaveBeenCalledTimes(1);
  });

  it("n'appelle pas le repli quand le principal réussit", async () => {
    const opensea = vi.fn<FloorPriceProvider>().mockResolvedValue(ok("OPENSEA"));
    const blur = vi.fn<FloorPriceProvider>();

    const out = await estimateFloorPrice(
      { chain: "ethereum", contractAddr: "0xabc", collectionSlug: null },
      { OPENSEA: opensea, BLUR: blur }
    );

    expect(blur).not.toHaveBeenCalled();
    expect(out.result.ok).toBe(true);
    expect(out.attempts).toHaveLength(1);
  });

  it("fonctionne pour la route Solana (Magic Eden → Tensor)", async () => {
    const magicEden = vi.fn<FloorPriceProvider>().mockResolvedValue(fail("MAGIC_EDEN"));
    const tensor = vi.fn<FloorPriceProvider>().mockResolvedValue(ok("TENSOR"));

    const out = await estimateFloorPrice(
      { chain: "solana", contractAddr: null, collectionSlug: "okay-bears" },
      { MAGIC_EDEN: magicEden, TENSOR: tensor }
    );

    expect(out.result.ok).toBe(true);
    expect(out.result.source).toBe("TENSOR");
  });
});
