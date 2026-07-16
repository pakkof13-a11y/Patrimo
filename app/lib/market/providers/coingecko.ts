import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";

const ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  USDT: "tether",
  USDC: "usd-coin",
};

export const coingeckoProvider: MarketDataProvider = {
  id: "coingecko",
  supports(asset) {
    return (
      asset.priceProvider === "COINGECKO" ||
      (asset.assetClass === "CRYPTO" && !!(asset.providerSymbol || asset.ticker))
    );
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    const symbol = (asset.providerSymbol || asset.ticker || "").toUpperCase();
    if (!symbol) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "coingecko",
        status: "ERROR",
        error: "Symbole crypto manquant",
      };
    }

    const coinId = ID_MAP[symbol] || asset.providerSymbol || symbol.toLowerCase();
    const apiKey = process.env.COINGECKO_API_KEY;

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=eur`;
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) {
        return {
          priceEur: "0",
          currency: "EUR",
          source: "coingecko",
          status: "ERROR",
          error: `CoinGecko HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as Record<string, { eur?: number }>;
      const price = data[coinId]?.eur;
      if (typeof price !== "number") {
        return {
          priceEur: "0",
          currency: "EUR",
          source: "coingecko",
          status: "ERROR",
          error: `Prix introuvable pour ${coinId}`,
        };
      }

      return {
        priceEur: toFixed(d(price), 8),
        priceNative: toFixed(d(price), 8),
        nativeCurrency: "EUR",
        currency: "EUR",
        source: "coingecko",
        status: "OK",
      };
    } catch (e) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "coingecko",
        status: "ERROR",
        error: e instanceof Error ? e.message : "Erreur CoinGecko",
      };
    }
  },
};
