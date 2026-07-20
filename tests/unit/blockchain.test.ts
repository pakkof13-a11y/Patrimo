import { describe, expect, it } from "vitest";
import {
  buildCustodyDistribution,
  groupPositionsByBlockchain,
  resolveBlockchainKey,
} from "@/app/lib/assets/blockchain";

describe("resolveBlockchainKey", () => {
  it("lit chain= dans les notes Zerion", () => {
    expect(
      resolveBlockchainKey({
        assetNotes: "[zerion-sync] chain=ethereum",
        accountType: "CRYPTO",
      })
    ).toBe("ethereum");
  });

  it("mappe logoKey plateforme blockchain", () => {
    expect(
      resolveBlockchainKey({
        platformType: "BLOCKCHAIN",
        platformLogoKey: "SOLANA",
        platformName: "Solana",
        accountType: "CRYPTO",
      })
    ).toBe("solana");
  });

  it("classe les exchanges crypto", () => {
    expect(
      resolveBlockchainKey({
        platformType: "EXCHANGE_CRYPTO",
        platformLogoKey: "BINANCE",
        platformName: "Binance",
        accountType: "CRYPTO",
      })
    ).toBe("exchange");
  });
});

describe("buildCustodyDistribution", () => {
  it("calcule quantités et %", () => {
    const slices = buildCustodyDistribution([
      {
        assetId: "a1",
        platformId: "p1",
        platformName: "Kraken",
        blockchainKey: "exchange",
        quantity: "0.5",
        marketValueEur: "1000",
      },
      {
        assetId: "a2",
        platformId: "p2",
        platformName: "Ethereum",
        blockchainKey: "ethereum",
        quantity: "0.5",
        marketValueEur: "1000",
      },
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0]!.quantityPct + slices[1]!.quantityPct).toBeCloseTo(100, 0);
    expect(slices[0]!.valuePct + slices[1]!.valuePct).toBeCloseTo(100, 0);
  });
});

describe("groupPositionsByBlockchain", () => {
  it("regroupe par clé", () => {
    const groups = groupPositionsByBlockchain([
      {
        assetId: "1",
        blockchainKey: "solana",
        marketValueBase: "100",
        unrealizedPnlBase: "0",
      },
      {
        assetId: "2",
        blockchainKey: "solana",
        marketValueBase: "50",
        unrealizedPnlBase: "5",
      },
      {
        assetId: "3",
        blockchainKey: "ethereum",
        marketValueBase: "50",
        unrealizedPnlBase: "0",
      },
    ]);
    expect(groups.map((g) => g.blockchainKey)).toEqual(["ethereum", "solana"]);
    const sol = groups.find((g) => g.blockchainKey === "solana")!;
    expect(sol.count).toBe(2);
    expect(sol.totalMarketValue).toBe(150);
  });
});
