import { describe, expect, it } from "vitest";
import {
  buildCoinCards,
  coinSymbolOf,
  topCoinDominancePct,
  type CoinCardHolding,
} from "@/app/lib/crypto/coin-cards";

function h(o: Partial<CoinCardHolding> & { assetId: string }): CoinCardHolding {
  return {
    name: "Bitcoin",
    ticker: "BTC",
    quantity: "1",
    costBasisEur: "1000",
    marketValueEur: "1200",
    platformId: "p1",
    platformName: "Binance",
    ...o,
  };
}

describe("coinSymbolOf", () => {
  it("normalise en majuscules et coupe les suffixes de place", () => {
    expect(coinSymbolOf(h({ assetId: "a", ticker: "btc" }))).toBe("BTC");
    expect(coinSymbolOf(h({ assetId: "a", ticker: "BTC.X" }))).toBe("BTC");
    expect(coinSymbolOf(h({ assetId: "a", ticker: "ETH-EUR" }))).toBe("ETH");
    expect(coinSymbolOf(h({ assetId: "a", ticker: "SOL/USDT" }))).toBe("SOL");
  });

  it("retombe sur le nom quand le ticker manque", () => {
    expect(
      coinSymbolOf(h({ assetId: "a", ticker: null, name: "Monero" }))
    ).toBe("MONERO");
  });
});

describe("buildCoinCards — consolidation multi-exchange", () => {
  it("regroupe un même coin détenu sur plusieurs plateformes", () => {
    const cards = buildCoinCards([
      h({
        assetId: "a1",
        ticker: "BTC",
        quantity: "0.18",
        costBasisEur: "6000",
        marketValueEur: "8000",
        platformId: "binance",
        platformName: "Binance",
      }),
      h({
        assetId: "a2",
        ticker: "BTC",
        quantity: "0.05",
        costBasisEur: "2000",
        marketValueEur: "2200",
        platformId: "ledger",
        platformName: "Ledger",
      }),
    ]);

    expect(cards).toHaveLength(1);
    const btc = cards[0]!;
    expect(btc.symbol).toBe("BTC");
    expect(btc.quantity).toBeCloseTo(0.23, 8);
    expect(btc.costBasisEur).toBe(8000);
    expect(btc.marketValueEur).toBe(10200);
    expect(btc.unrealizedPnlEur).toBe(2200);
    expect(btc.unrealizedPnlPct).toBeCloseTo(27.5, 6);
    expect(btc.venues.map((v) => v.platformName)).toEqual([
      "Binance",
      "Ledger",
    ]);
  });

  it("PRU consolidé = coût total / quantité totale", () => {
    const cards = buildCoinCards([
      h({ assetId: "a1", quantity: "1", costBasisEur: "100", marketValueEur: "150" }),
      h({
        assetId: "a2",
        quantity: "3",
        costBasisEur: "900",
        marketValueEur: "450",
        platformId: "p2",
        platformName: "Kraken",
      }),
    ]);
    // (100 + 900) / (1 + 3) = 250
    expect(cards[0]!.avgCostEur).toBe(250);
    // (150 + 450) / 4 = 150
    expect(cards[0]!.currentPriceEur).toBe(150);
  });

  it("utilise platformSlices quand ils existent (multi-custody)", () => {
    const cards = buildCoinCards([
      h({
        assetId: "a1",
        ticker: "ETH",
        quantity: "3",
        costBasisEur: "3000",
        marketValueEur: "4000",
        platformSlices: [
          {
            platformId: "binance",
            platformName: "Binance",
            quantity: "1.8",
            costBasisEur: "1800",
            marketValueEur: "2400",
          },
          {
            platformId: "ledger",
            platformName: "Ledger",
            quantity: "1.2",
            costBasisEur: "1200",
            marketValueEur: "1600",
          },
        ],
      }),
    ]);
    const eth = cards[0]!;
    expect(eth.venues).toHaveLength(2);
    expect(eth.venues[0]).toMatchObject({
      platformName: "Binance",
      quantity: 1.8,
      marketValueEur: 2400,
    });
    // Les totaux restent ceux du holding, pas la somme des slices.
    expect(eth.quantity).toBe(3);
  });

  it("trie par valeur décroissante et calcule l'allocation", () => {
    const cards = buildCoinCards([
      h({
        assetId: "a1",
        ticker: "ETH",
        name: "Ethereum",
        marketValueEur: "2500",
        costBasisEur: "2000",
      }),
      h({
        assetId: "a2",
        ticker: "BTC",
        name: "Bitcoin",
        marketValueEur: "7500",
        costBasisEur: "5000",
        platformId: "p2",
      }),
    ]);
    expect(cards.map((c) => c.symbol)).toEqual(["BTC", "ETH"]);
    expect(cards[0]!.allocationPct).toBe(75);
    expect(cards[1]!.allocationPct).toBe(25);
  });

  it("coût nul (airdrop) → pas de pourcentage trompeur", () => {
    const cards = buildCoinCards([
      h({ assetId: "a1", costBasisEur: "0", marketValueEur: "500" }),
    ]);
    expect(cards[0]!.unrealizedPnlEur).toBe(500);
    expect(cards[0]!.unrealizedPnlPct).toBeNull();
  });

  it("liste vide → aucune carte, pas de division par zéro", () => {
    expect(buildCoinCards([])).toEqual([]);
    expect(topCoinDominancePct([])).toBeNull();
  });

  it("dominance = poids du premier coin", () => {
    const cards = buildCoinCards([
      h({ assetId: "a1", ticker: "BTC", marketValueEur: "9000", costBasisEur: "1" }),
      h({
        assetId: "a2",
        ticker: "ETH",
        marketValueEur: "1000",
        costBasisEur: "1",
        platformId: "p2",
      }),
    ]);
    expect(topCoinDominancePct(cards)).toBe(90);
  });
});
