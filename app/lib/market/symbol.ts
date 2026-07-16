/**
 * Normalize tickers for Finnhub / Yahoo (suffixes .PA, .SW, .DE, .L, …).
 */
export function normalizeTicker(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toUpperCase();
}

/** Yahoo-style symbol (MC.PA, AIR.PA, NESN.SW) */
export function toYahooSymbol(ticker: string, providerSymbol?: string | null): string {
  if (providerSymbol?.includes(".")) return providerSymbol.trim().toUpperCase();
  if (providerSymbol && !providerSymbol.includes(":")) return providerSymbol.trim().toUpperCase();
  return normalizeTicker(ticker);
}

/**
 * Finnhub stock symbols often match Yahoo for EU: MC.PA, AIR.PA.
 * US symbols are bare: AAPL.
 * Crypto on Finnhub: BINANCE:BTCUSDT or COINBASE:BTC-USD
 */
export function toFinnhubSymbol(
  ticker: string,
  providerSymbol?: string | null,
  assetClass?: string
): string {
  if (providerSymbol) {
    // Allow explicit FINNHUB form EXCHANGE:SYMBOL
    return providerSymbol.trim().toUpperCase();
  }
  const t = normalizeTicker(ticker);
  if (!t) return "";

  if (assetClass === "CRYPTO") {
    // Default pair vs USDT on Binance
    const base = t.replace(/USDT$|USD$|EUR$/, "");
    return `BINANCE:${base}USDT`;
  }

  // Already has exchange suffix
  if (t.includes(".")) return t;

  // Swiss-style default not assumed — bare ticker
  return t;
}

/** Guess quote currency from exchange suffix */
export function guessQuoteCurrency(symbol: string, assetClass?: string): string {
  const s = symbol.toUpperCase();
  if (assetClass === "CRYPTO") {
    if (s.endsWith("EUR") || s.includes("EUREUR")) return "EUR";
    return "USD";
  }
  if (s.endsWith(".PA") || s.endsWith(".DE") || s.endsWith(".AS") || s.endsWith(".BR") || s.endsWith(".MI")) {
    return "EUR";
  }
  if (s.endsWith(".SW") || s.endsWith(".VX")) return "CHF";
  if (s.endsWith(".L") || s.endsWith(".LON")) return "GBP";
  if (s.endsWith(".T") || s.endsWith(".TYO")) return "JPY";
  return "USD";
}
