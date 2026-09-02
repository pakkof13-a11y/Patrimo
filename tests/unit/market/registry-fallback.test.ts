import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFinnhubCache,
  FINNHUB_BUDGET_EXHAUSTED,
  finnhubProvider,
} from "@/app/lib/market/providers/finnhub";
import { finnhubRestLimiter } from "@/app/lib/market/rate-limit";
import { fetchPriceWithFallback } from "@/app/lib/market/registry";
import { yahooProvider } from "@/app/lib/market/providers/yahoo";
import { binanceProvider } from "@/app/lib/market/providers/binance";
import { coingeckoProvider } from "@/app/lib/market/providers/coingecko";
import type { AssetMeta, PriceQuoteResult } from "@/app/lib/market/types";

const ORIGINAL_KEY = process.env.FINNHUB_API_KEY;

function asset(partial: Partial<AssetMeta> = {}): AssetMeta {
  return {
    id: "a1",
    name: "Apple",
    ticker: "AAPL",
    assetClass: "ACTIONS",
    priceProvider: "FINNHUB",
    providerSymbol: null,
    currency: "USD",
    ...partial,
  };
}

const YAHOO_OK: PriceQuoteResult = {
  priceEur: "150.00",
  priceNative: "160.00",
  nativeCurrency: "USD",
  currency: "EUR",
  source: "yahoo",
  status: "OK",
};

beforeEach(() => {
  process.env.FINNHUB_API_KEY = "test-key";
  __resetFinnhubCache();
  finnhubRestLimiter.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_KEY === undefined) delete process.env.FINNHUB_API_KEY;
  else process.env.FINNHUB_API_KEY = ORIGINAL_KEY;
});

describe("fetchPriceWithFallback — actions / ETF", () => {
  it("sert Finnhub en premier quand la clé est présente", async () => {
    const finnhub = vi.spyOn(finnhubProvider, "fetchPrice").mockResolvedValue({
      priceEur: "140.00",
      currency: "EUR",
      source: "finnhub",
      status: "OK",
    });
    const yahoo = vi.spyOn(yahooProvider, "fetchPrice").mockResolvedValue(YAHOO_OK);

    const out = await fetchPriceWithFallback(asset());
    expect(out.source).toBe("finnhub");
    expect(finnhub).toHaveBeenCalledTimes(1);
    expect(yahoo).not.toHaveBeenCalled();
  });

  it("bascule sur Yahoo quand le quota Finnhub est atteint", async () => {
    // C'est le comportement qui rend le plafond de 60 appels/minute supportable :
    // les lignes au-delà du quota doivent être servies, pas mises en attente.
    const finnhub = vi.spyOn(finnhubProvider, "fetchPrice").mockResolvedValue({
      priceEur: "0",
      currency: "EUR",
      source: "finnhub",
      status: "ERROR",
      error: FINNHUB_BUDGET_EXHAUSTED,
    });
    const yahoo = vi.spyOn(yahooProvider, "fetchPrice").mockResolvedValue(YAHOO_OK);

    const out = await fetchPriceWithFallback(asset());
    expect(finnhub).toHaveBeenCalledTimes(1);
    expect(yahoo).toHaveBeenCalledTimes(1);
    expect(out.status).toBe("OK");
    expect(out.source).toBe("yahoo");
  });

  it("remonte les deux erreurs quand aucun fournisseur ne répond", async () => {
    vi.spyOn(finnhubProvider, "fetchPrice").mockResolvedValue({
      priceEur: "0",
      currency: "EUR",
      source: "finnhub",
      status: "ERROR",
      error: FINNHUB_BUDGET_EXHAUSTED,
    });
    vi.spyOn(yahooProvider, "fetchPrice").mockResolvedValue({
      priceEur: "0",
      currency: "EUR",
      source: "yahoo",
      status: "ERROR",
      error: "Yahoo indisponible",
    });

    const out = await fetchPriceWithFallback(asset());
    expect(out.status).toBe("ERROR");
    // Le prix reste à 0 : c'est refresh.ts qui préserve le dernier cours connu.
    expect(out.priceEur).toBe("0");
    expect(out.error).toContain(FINNHUB_BUDGET_EXHAUSTED);
    expect(out.error).toContain("Yahoo indisponible");
  });

  it("n'appelle jamais Finnhub sans clé exploitable", async () => {
    process.env.FINNHUB_API_KEY = "votre-cle-finnhub";
    const finnhub = vi.spyOn(finnhubProvider, "fetchPrice");
    const yahoo = vi.spyOn(yahooProvider, "fetchPrice").mockResolvedValue(YAHOO_OK);

    const out = await fetchPriceWithFallback(asset());
    expect(finnhub).not.toHaveBeenCalled();
    expect(yahoo).toHaveBeenCalledTimes(1);
    expect(out.source).toBe("yahoo");
  });

  it("respecte un choix explicite de Yahoo, Finnhub en second", async () => {
    const finnhub = vi.spyOn(finnhubProvider, "fetchPrice");
    const yahoo = vi.spyOn(yahooProvider, "fetchPrice").mockResolvedValue(YAHOO_OK);

    const out = await fetchPriceWithFallback(asset({ priceProvider: "YAHOO" }));
    expect(yahoo).toHaveBeenCalledTimes(1);
    expect(finnhub).not.toHaveBeenCalled();
    expect(out.source).toBe("yahoo");
  });
});

describe("fetchPriceWithFallback — les autres classes ne changent pas", () => {
  it("n'envoie jamais une crypto vers Finnhub", async () => {
    const finnhub = vi.spyOn(finnhubProvider, "fetchPrice");
    const out = await fetchPriceWithFallback(
      asset({ assetClass: "CRYPTO", ticker: "BTC", priceProvider: "COINGECKO" })
    );
    expect(finnhub).not.toHaveBeenCalled();
    expect(["binance", "coingecko"]).toContain(out.source);
  });

  it("laisse l'immobilier en saisie manuelle", async () => {
    const finnhub = vi.spyOn(finnhubProvider, "fetchPrice");
    const yahoo = vi.spyOn(yahooProvider, "fetchPrice");
    const out = await fetchPriceWithFallback(
      asset({ assetClass: "IMMOBILIER", priceProvider: "MANUAL", manualPrice: "250000" })
    );
    expect(finnhub).not.toHaveBeenCalled();
    expect(yahoo).not.toHaveBeenCalled();
    expect(out.source).toBe("manual");
  });
});

describe("fetchPriceWithFallback — crypto : repli Binance → CoinGecko", () => {
  it("un ticker couvert par Binance bascule réellement sur CoinGecko quand Binance échoue", async () => {
    // BTC : couvert par Binance (paire EUR directe, BINANCE_EUR_PAIRS).
    // Sans ce mock, l'échec simulé ci-dessous prouverait un vrai comportement
    // de repli — pas un hasard de configuration.
    const binance = vi.spyOn(binanceProvider, "fetchPrice").mockResolvedValue({
      priceEur: "0",
      currency: "EUR",
      source: "binance",
      status: "ERROR",
      error: "Binance HTTP 503",
    });
    const coingecko = vi.spyOn(coingeckoProvider, "fetchPrice").mockResolvedValue({
      priceEur: "61234.56",
      currency: "EUR",
      source: "coingecko",
      status: "OK",
    });

    const out = await fetchPriceWithFallback(
      asset({ assetClass: "CRYPTO", ticker: "BTC", priceProvider: "COINGECKO" })
    );

    // Binance a bien été tenté (le registry n'a pas court-circuité le primaire).
    expect(binance).toHaveBeenCalledTimes(1);
    // Et c'est bien CoinGecko qui a pris le relais — pas resté silencieux.
    expect(coingecko).toHaveBeenCalledTimes(1);

    // Le résultat final provient réellement de CoinGecko, pas de Binance.
    expect(out.source).toBe("coingecko");
    expect(out.status).toBe("OK");
    // Un prix exploitable, celui de CoinGecko — jamais un zéro fabriqué à
    // partir de l'échec Binance (UNKNOWN ≠ ZERO ≠ ERROR).
    expect(out.priceEur).toBe("61234.56");
    expect(out.priceEur).not.toBe("0");
  });
});
