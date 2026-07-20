import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";
import { toFinnhubSymbol, guessQuoteCurrency } from "../symbol";
import { toEurAmount } from "../fx";

function getApiKey(): string | null {
  const key = (process.env.FINNHUB_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!key || key === "demo" || key === "votre-cle-finnhub") return null;
  return key;
}

export const finnhubProvider: MarketDataProvider = {
  id: "finnhub",
  supports(asset) {
    // CRYPTO : CoinGecko exclusif — jamais Finnhub
    if (asset.assetClass === "CRYPTO") return false;
    return (
      asset.priceProvider === "FINNHUB" ||
      asset.assetClass === "ACTIONS"
    );
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "finnhub",
        status: "ERROR",
        error: "FINNHUB_API_KEY manquante ou invalide",
      };
    }

    const symbol = toFinnhubSymbol(
      asset.ticker || "",
      asset.providerSymbol,
      asset.assetClass
    );
    if (!symbol) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "finnhub",
        status: "ERROR",
        error: "Symbole manquant",
      };
    }

    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        return {
          priceEur: "0",
          currency: "EUR",
          source: "finnhub",
          status: "ERROR",
          error: `Finnhub HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as { c?: number };
      if (typeof data.c !== "number" || data.c <= 0) {
        return {
          priceEur: "0",
          currency: "EUR",
          source: "finnhub",
          status: "ERROR",
          error: `Cours indisponible Finnhub (${symbol})`,
        };
      }

      const nativeCurrency = guessQuoteCurrency(symbol, asset.assetClass);
      const priceNative = d(data.c);
      const priceEur = await toEurAmount(priceNative, nativeCurrency);

      return {
        priceEur,
        priceNative: toFixed(priceNative, 8),
        nativeCurrency,
        currency: "EUR",
        source: "finnhub",
        status: "OK",
      };
    } catch (e) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "finnhub",
        status: "ERROR",
        error: e instanceof Error ? e.message : "Erreur Finnhub",
      };
    }
  },
};
