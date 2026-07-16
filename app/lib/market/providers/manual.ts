import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";
import { toEurAmount } from "../fx";

export const manualProvider: MarketDataProvider = {
  id: "manual",
  supports(asset) {
    return (
      asset.priceProvider === "MANUAL" ||
      ["IMMOBILIER", "OBLIGATIONS", "CASH", "AUTRE"].includes(asset.assetClass)
    );
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    const raw = asset.manualPrice ?? asset.manualPriceEur;
    if (raw == null || raw === "") {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "manual",
        status: "ERROR",
        error: "Aucune valorisation manuelle définie",
      };
    }
    const nativeCurrency = (asset.currency || "EUR").toUpperCase();
    const priceNative = d(raw);
    const priceEur = await toEurAmount(priceNative, nativeCurrency);
    return {
      priceEur,
      priceNative: toFixed(priceNative, 8),
      nativeCurrency,
      currency: "EUR",
      source: "manual",
      status: "OK",
    };
  },
};
