import { describe, it, expect } from "vitest";
import {
  tickerBase,
  nameTokens,
  buildAssetMatcher,
  isNewsRelevantToAsset,
  assetNewsQuery,
} from "@/app/lib/news/asset-news-live";

describe("tickerBase", () => {
  it("strips exchange and crypto-quote suffixes", () => {
    expect(tickerBase("MC.PA")).toBe("MC");
    expect(tickerBase("ETH-USD")).toBe("ETH");
    expect(tickerBase("BTCUSD")).toBe("BTC");
    expect(tickerBase("ETHUSDT")).toBe("ETH");
    expect(tickerBase("AAPL")).toBe("AAPL");
    expect(tickerBase("USDC")).toBe("USDC");
  });
});

describe("nameTokens", () => {
  it("keeps significant words, drops generic ones", () => {
    expect(nameTokens("Apple Inc.")).toEqual(["apple"]);
    expect(nameTokens("LVMH Moët Hennessy")).toEqual([
      "lvmh",
      "moet",
      "hennessy",
    ]);
    expect(nameTokens("USD Coin")).toEqual([]); // both generic → no token
  });
});

describe("isNewsRelevantToAsset", () => {
  const apple = buildAssetMatcher("AAPL", "Apple Inc.");
  const lvmh = buildAssetMatcher("MC.PA", "LVMH Moët Hennessy Louis Vuitton");
  const usdc = buildAssetMatcher("USDC", "USD Coin");

  it("keeps a headline that actually names the company", () => {
    expect(
      isNewsRelevantToAsset("Apple dévoile ses résultats trimestriels", apple)
    ).toBe(true);
  });

  it("keeps a headline matching the ticker (>=3 chars)", () => {
    expect(isNewsRelevantToAsset("AAPL grimpe en bourse", apple)).toBe(true);
  });

  it("rejects an unrelated headline", () => {
    expect(
      isNewsRelevantToAsset("La BCE maintient ses taux directeurs", apple)
    ).toBe(false);
  });

  it("does not match a short ticker embedded in another word", () => {
    // MC (LVMH) must not match 'commerce' or unrelated 'MC'
    expect(
      isNewsRelevantToAsset("Le commerce mondial ralentit", lvmh)
    ).toBe(false);
  });

  it("matches LVMH by name token", () => {
    expect(
      isNewsRelevantToAsset("LVMH: le luxe résiste malgré la Chine", lvmh)
    ).toBe(true);
  });

  it("USDC: rejects generic USD/economy headlines (the reported bug)", () => {
    // 'USD Coin' → no significant name token; ticker USDC must be present as a word
    expect(
      isNewsRelevantToAsset("Le dollar US se renforce face à l'euro", usdc)
    ).toBe(false);
    expect(
      isNewsRelevantToAsset("USDC dépasse les 30 milliards de capitalisation", usdc)
    ).toBe(true);
  });
});

describe("assetNewsQuery", () => {
  it("quotes the name and adds the ticker + recency window", () => {
    expect(assetNewsQuery("AAPL", "Apple Inc.")).toBe(
      '"Apple Inc." OR AAPL when:14d'
    );
  });
  it("falls back to ticker when no name", () => {
    expect(assetNewsQuery("USDC", null)).toBe("USDC when:14d");
  });
});
