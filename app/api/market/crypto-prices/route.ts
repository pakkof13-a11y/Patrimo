import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  binanceProvider,
  isBinanceEnabled,
  resolveBinancePlan,
} from "@/app/lib/market/providers/binance-ws";

/**
 * GET /api/market/crypto-prices?tickers=BTC,ETH,SOL
 * Prix crypto temps réel (Binance, cache serveur 30 s). Fallback CoinGecko
 * pour les tickers non couverts est géré par le refresh serveur, pas ici :
 * cette route sert le flux live léger côté client (polling 30 s).
 *
 * Réponse : { prices: { [ticker]: { priceEur, source, status } }, at }
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  if (!isBinanceEnabled()) {
    return NextResponse.json(
      { error: "Binance désactivé (BINANCE_WS_ENABLED)", prices: {} },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("tickers") || "").trim();
  const tickers = [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 100)
    ),
  ];

  if (tickers.length === 0) {
    return NextResponse.json({ prices: {}, at: new Date().toISOString() });
  }

  const prices: Record<
    string,
    { priceEur: string; source: string; status: string; error?: string }
  > = {};

  await Promise.all(
    tickers.map(async (ticker) => {
      // Tickers non couverts par Binance : signalés, le client peut ignorer
      if (!resolveBinancePlan(ticker, null)) {
        prices[ticker] = {
          priceEur: "0",
          source: "binance",
          status: "UNSUPPORTED",
        };
        return;
      }
      const quote = await binanceProvider.fetchPrice({
        id: ticker,
        name: ticker,
        ticker,
        assetClass: "CRYPTO",
        priceProvider: "COINGECKO",
        providerSymbol: null,
      });
      prices[ticker] = {
        priceEur: quote.priceEur,
        source: quote.source,
        status: quote.status,
        error: quote.error,
      };
    })
  );

  return NextResponse.json({ prices, at: new Date().toISOString() });
}
