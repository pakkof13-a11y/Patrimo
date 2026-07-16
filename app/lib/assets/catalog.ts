/**
 * Static catalog of major Euronext / US equities for autocomplete.
 * Crypto is resolved live via CoinGecko search.
 */

export type CatalogAsset = {
  name: string;
  ticker: string;
  assetClass: "ACTIONS" | "CRYPTO" | "IMMOBILIER" | "OBLIGATIONS" | "CASH" | "AUTRE";
  currency: string;
  priceProvider: "FINNHUB" | "YAHOO" | "COINGECKO" | "MANUAL";
  providerSymbol?: string;
  logoUrl?: string | null;
  exchange?: string;
};

export const EQUITY_CATALOG: CatalogAsset[] = [
  // Euronext Paris
  { name: "LVMH", ticker: "MC.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "MC.PA", exchange: "EPA" },
  { name: "Airbus", ticker: "AIR.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "AIR.PA", exchange: "EPA" },
  { name: "L'Oréal", ticker: "OR.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "OR.PA", exchange: "EPA" },
  { name: "TotalEnergies", ticker: "TTE.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "TTE.PA", exchange: "EPA" },
  { name: "Sanofi", ticker: "SAN.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "SAN.PA", exchange: "EPA" },
  { name: "BNP Paribas", ticker: "BNP.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "BNP.PA", exchange: "EPA" },
  { name: "Air Liquide", ticker: "AI.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "AI.PA", exchange: "EPA" },
  { name: "Schneider Electric", ticker: "SU.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "SU.PA", exchange: "EPA" },
  { name: "Vinci", ticker: "DG.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "DG.PA", exchange: "EPA" },
  { name: "Kering", ticker: "KER.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "KER.PA", exchange: "EPA" },
  { name: "Hermès", ticker: "RMS.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "RMS.PA", exchange: "EPA" },
  { name: "Société Générale", ticker: "GLE.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "GLE.PA", exchange: "EPA" },
  { name: "AXA", ticker: "CS.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "CS.PA", exchange: "EPA" },
  { name: "Danone", ticker: "BN.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "BN.PA", exchange: "EPA" },
  { name: "Stellantis", ticker: "STLAP.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "STLAP.PA", exchange: "EPA" },
  { name: "Capgemini", ticker: "CAP.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "CAP.PA", exchange: "EPA" },
  { name: "Thales", ticker: "HO.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "HO.PA", exchange: "EPA" },
  { name: "Safran", ticker: "SAF.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "SAF.PA", exchange: "EPA" },
  { name: "EssilorLuxottica", ticker: "EL.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "EL.PA", exchange: "EPA" },
  { name: "Pernod Ricard", ticker: "RI.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "RI.PA", exchange: "EPA" },
  { name: "Orange", ticker: "ORA.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "ORA.PA", exchange: "EPA" },
  { name: "Engie", ticker: "ENGI.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "ENGI.PA", exchange: "EPA" },
  { name: "Michelin", ticker: "ML.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "ML.PA", exchange: "EPA" },
  { name: "Renault", ticker: "RNO.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "RNO.PA", exchange: "EPA" },
  { name: "Crédit Agricole", ticker: "ACA.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "ACA.PA", exchange: "EPA" },
  { name: "Publicis", ticker: "PUB.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "PUB.PA", exchange: "EPA" },
  { name: "Veolia", ticker: "VIE.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "VIE.PA", exchange: "EPA" },
  { name: "Bouygues", ticker: "EN.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "EN.PA", exchange: "EPA" },
  { name: "Carrefour", ticker: "CA.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "CA.PA", exchange: "EPA" },
  { name: "Accor", ticker: "AC.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "AC.PA", exchange: "EPA" },
  { name: "Amundi MSCI World", ticker: "CW8.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "CW8.PA", exchange: "EPA" },
  { name: "Lyxor CAC 40", ticker: "CAC.PA", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "CAC.PA", exchange: "EPA" },
  // Amsterdam / Brussels / Lisbon
  { name: "ASML", ticker: "ASML.AS", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "ASML.AS", exchange: "AMS" },
  { name: "Prosus", ticker: "PRX.AS", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "PRX.AS", exchange: "AMS" },
  { name: "ING", ticker: "INGA.AS", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "INGA.AS", exchange: "AMS" },
  { name: "Adyen", ticker: "ADYEN.AS", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "ADYEN.AS", exchange: "AMS" },
  { name: "Shell", ticker: "SHELL.AS", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "SHELL.AS", exchange: "AMS" },
  { name: "Anheuser-Busch InBev", ticker: "ABI.BR", assetClass: "ACTIONS", currency: "EUR", priceProvider: "YAHOO", providerSymbol: "ABI.BR", exchange: "BRU" },
  // US majors
  { name: "Apple", ticker: "AAPL", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "AAPL", exchange: "NASDAQ" },
  { name: "Microsoft", ticker: "MSFT", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "MSFT", exchange: "NASDAQ" },
  { name: "NVIDIA", ticker: "NVDA", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "NVDA", exchange: "NASDAQ" },
  { name: "Amazon", ticker: "AMZN", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "AMZN", exchange: "NASDAQ" },
  { name: "Alphabet (Google)", ticker: "GOOGL", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "GOOGL", exchange: "NASDAQ" },
  { name: "Meta Platforms", ticker: "META", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "META", exchange: "NASDAQ" },
  { name: "Tesla", ticker: "TSLA", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "TSLA", exchange: "NASDAQ" },
  { name: "Berkshire Hathaway B", ticker: "BRK-B", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "BRK-B", exchange: "NYSE" },
  { name: "JPMorgan Chase", ticker: "JPM", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "JPM", exchange: "NYSE" },
  { name: "Visa", ticker: "V", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "V", exchange: "NYSE" },
  { name: "UnitedHealth", ticker: "UNH", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "UNH", exchange: "NYSE" },
  { name: "Exxon Mobil", ticker: "XOM", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "XOM", exchange: "NYSE" },
  { name: "Johnson & Johnson", ticker: "JNJ", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "JNJ", exchange: "NYSE" },
  { name: "Walmart", ticker: "WMT", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "WMT", exchange: "NYSE" },
  { name: "Procter & Gamble", ticker: "PG", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "PG", exchange: "NYSE" },
  { name: "Mastercard", ticker: "MA", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "MA", exchange: "NYSE" },
  { name: "Home Depot", ticker: "HD", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "HD", exchange: "NYSE" },
  { name: "Costco", ticker: "COST", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "COST", exchange: "NASDAQ" },
  { name: "Netflix", ticker: "NFLX", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "NFLX", exchange: "NASDAQ" },
  { name: "Adobe", ticker: "ADBE", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "ADBE", exchange: "NASDAQ" },
  { name: "Salesforce", ticker: "CRM", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "CRM", exchange: "NYSE" },
  { name: "AMD", ticker: "AMD", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "AMD", exchange: "NASDAQ" },
  { name: "Intel", ticker: "INTC", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "INTC", exchange: "NASDAQ" },
  { name: "Coca-Cola", ticker: "KO", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "KO", exchange: "NYSE" },
  { name: "PepsiCo", ticker: "PEP", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "PEP", exchange: "NASDAQ" },
  { name: "Disney", ticker: "DIS", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "DIS", exchange: "NYSE" },
  { name: "SPDR S&P 500 ETF", ticker: "SPY", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "SPY", exchange: "NYSEARCA" },
  { name: "Invesco QQQ", ticker: "QQQ", assetClass: "ACTIONS", currency: "USD", priceProvider: "YAHOO", providerSymbol: "QQQ", exchange: "NASDAQ" },
  // Crypto (common)
  { name: "Bitcoin", ticker: "BTC", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "bitcoin" },
  { name: "Ethereum", ticker: "ETH", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "ethereum" },
  { name: "Solana", ticker: "SOL", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "solana" },
  { name: "BNB", ticker: "BNB", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "binancecoin" },
  { name: "XRP", ticker: "XRP", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "ripple" },
  { name: "Cardano", ticker: "ADA", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "cardano" },
  { name: "Dogecoin", ticker: "DOGE", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "dogecoin" },
  { name: "Avalanche", ticker: "AVAX", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "avalanche-2" },
  { name: "Polkadot", ticker: "DOT", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "polkadot" },
  { name: "Chainlink", ticker: "LINK", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "chainlink" },
  { name: "Tether", ticker: "USDT", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "tether" },
  { name: "USD Coin", ticker: "USDC", assetClass: "CRYPTO", currency: "EUR", priceProvider: "COINGECKO", providerSymbol: "usd-coin" },
];

export function searchCatalog(query: string, limit = 25): CatalogAsset[] {
  const q = query.trim().toLowerCase();
  if (!q) return EQUITY_CATALOG.slice(0, limit);
  const scored = EQUITY_CATALOG.map((item) => {
    const name = item.name.toLowerCase();
    const ticker = item.ticker.toLowerCase();
    let score = 0;
    if (ticker === q) score = 100;
    else if (ticker.startsWith(q)) score = 80;
    else if (ticker.includes(q)) score = 60;
    else if (name.startsWith(q)) score = 50;
    else if (name.includes(q)) score = 30;
    return { item, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}
