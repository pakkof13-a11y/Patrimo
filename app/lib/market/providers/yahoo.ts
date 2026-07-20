import YahooFinance from "yahoo-finance2";
import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";
import { toYahooSymbol, guessQuoteCurrency } from "../symbol";
import { toEurAmount } from "../fx";

/** yahoo-finance2 v4 requires a client instance */
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export const yahooProvider: MarketDataProvider = {
  id: "yahoo",
  supports(asset) {
    // CRYPTO : CoinGecko exclusif — jamais Yahoo
    if (asset.assetClass === "CRYPTO") return false;
    return (
      asset.priceProvider === "YAHOO" ||
      asset.priceProvider === "FINNHUB" ||
      (asset.assetClass === "ACTIONS" && !!(asset.providerSymbol || asset.ticker))
    );
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    const symbol = toYahooSymbol(asset.ticker || "", asset.providerSymbol);
    if (!symbol) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "yahoo",
        status: "ERROR",
        error: "Ticker manquant",
      };
    }

    try {
      const quote = (await yahooFinance.quote(symbol)) as {
        regularMarketPrice?: number;
        postMarketPrice?: number;
        preMarketPrice?: number;
        currency?: string;
      };

      const rawPrice =
        quote?.regularMarketPrice ?? quote?.postMarketPrice ?? quote?.preMarketPrice;

      if (typeof rawPrice !== "number" || rawPrice <= 0) {
        return {
          priceEur: "0",
          currency: "EUR",
          source: "yahoo",
          status: "ERROR",
          error: `Cours indisponible Yahoo (${symbol})`,
        };
      }

      const nativeCurrency = (
        quote.currency || guessQuoteCurrency(symbol, asset.assetClass)
      ).toUpperCase();
      const priceNative = d(rawPrice);
      const priceEur = await toEurAmount(priceNative, nativeCurrency);

      return {
        priceEur,
        priceNative: toFixed(priceNative, 8),
        nativeCurrency,
        currency: "EUR",
        source: "yahoo",
        status: "OK",
      };
    } catch (e) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "yahoo",
        status: "ERROR",
        error: e instanceof Error ? e.message : "Erreur Yahoo Finance",
      };
    }
  },
};
