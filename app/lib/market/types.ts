export type AssetMeta = {
  id: string;
  name: string;
  ticker: string | null;
  assetClass: string;
  priceProvider: string;
  providerSymbol: string | null;
  currency?: string | null;
  manualPrice?: string | null;
  /** @deprecated use manualPrice */
  manualPriceEur?: string | null;
};

export type PriceQuoteResult = {
  priceEur: string;
  priceNative?: string;
  nativeCurrency?: string;
  currency: string;
  source: string;
  status: "OK" | "STALE" | "ERROR";
  error?: string;
};

export interface MarketDataProvider {
  id: string;
  supports(asset: AssetMeta): boolean;
  fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult>;
}
