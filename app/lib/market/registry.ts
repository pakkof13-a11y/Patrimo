import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "./types";
import { finnhubProvider } from "./providers/finnhub";
import { yahooProvider } from "./providers/yahoo";
import { coingeckoProvider } from "./providers/coingecko";
import { manualProvider } from "./providers/manual";

function hasFinnhubKey(): boolean {
  const key = (process.env.FINNHUB_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  return Boolean(key && key !== "demo" && key !== "votre-cle-finnhub");
}

/**
 * Stocks: Finnhub (if key) then Yahoo — or Yahoo first when no key.
 * Crypto: **CoinGecko only** (jamais Yahoo / Finnhub).
 */
export async function fetchPriceWithFallback(
  asset: AssetMeta
): Promise<PriceQuoteResult> {
  // CRYPTO classé : ne jamais rester bloqué en MANUAL (spec : auto CoinGecko)
  if (
    asset.priceProvider === "MANUAL" &&
    asset.assetClass !== "CRYPTO"
  ) {
    return manualProvider.fetchPrice(asset);
  }
  if (["IMMOBILIER", "OBLIGATIONS", "CASH", "AUTRE"].includes(asset.assetClass)) {
    return manualProvider.fetchPrice(asset);
  }

  // CRYPTO : toujours CoinGecko (y compris ex-MANUAL / staked) — plus de sticky MANUAL
  if (asset.assetClass === "CRYPTO" || asset.priceProvider === "COINGECKO") {
    return coingeckoProvider.fetchPrice({
      ...asset,
      priceProvider: "COINGECKO",
      assetClass: "CRYPTO",
    });
  }

  // Stocks / ETFs
  const chain: Array<() => Promise<PriceQuoteResult>> = [];

  if (asset.priceProvider === "YAHOO") {
    chain.push(() => yahooProvider.fetchPrice(asset));
    if (hasFinnhubKey()) chain.push(() => finnhubProvider.fetchPrice(asset));
  } else if (hasFinnhubKey()) {
    chain.push(() => finnhubProvider.fetchPrice(asset));
    chain.push(() => yahooProvider.fetchPrice(asset));
  } else {
    chain.push(() => yahooProvider.fetchPrice(asset));
  }

  const errors: string[] = [];
  for (const run of chain) {
    const result = await run();
    if (result.status === "OK") return result;
    if (result.error) errors.push(result.error);
  }

  return {
    priceEur: "0",
    currency: "EUR",
    source: "none",
    status: "ERROR",
    error: errors.join(" | ") || "Aucun fournisseur de prix disponible",
  };
}

export function resolveProvider(asset: AssetMeta): MarketDataProvider {
  if (asset.priceProvider === "YAHOO") return yahooProvider;
  if (asset.priceProvider === "COINGECKO") return coingeckoProvider;
  if (asset.priceProvider === "MANUAL") return manualProvider;
  if (asset.priceProvider === "FINNHUB") return hasFinnhubKey() ? finnhubProvider : yahooProvider;
  if (asset.assetClass === "CRYPTO") return coingeckoProvider;
  if (asset.assetClass === "ACTIONS") return hasFinnhubKey() ? finnhubProvider : yahooProvider;
  return manualProvider;
}

export function listProviders(): MarketDataProvider[] {
  return [finnhubProvider, yahooProvider, coingeckoProvider, manualProvider];
}
