import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { fetchPriceWithFallback } from "./registry";
import type { AssetMeta } from "./types";
import {
  executeOrderTriggers,
  type TriggerExecutionReport,
} from "./triggers";

export type RefreshItemResult = {
  assetId: string;
  name: string;
  ok: boolean;
  source?: string;
  priceEur?: string;
  priceNative?: string;
  nativeCurrency?: string;
  status?: string;
  error?: string;
  stalePreserved?: boolean;
  lastUpdatedAt?: string;
};

export async function refreshEligiblePrices(userId: string): Promise<{
  results: RefreshItemResult[];
  successCount: number;
  failureCount: number;
  /** Simulated SL/TP fills executed during this refresh */
  triggerFills: TriggerExecutionReport[];
}> {
  const assets = await prisma.asset.findMany({
    where: {
      userId,
      OR: [
        { priceProvider: { in: ["FINNHUB", "YAHOO", "COINGECKO"] } },
        { assetClass: { in: ["ACTIONS", "CRYPTO"] } },
      ],
    },
    include: { priceQuote: true },
  });

  const results: RefreshItemResult[] = [];
  /** Successful native quotes for trigger evaluation */
  const freshPrices = new Map<string, { priceNative: string; currency: string }>();

  // Binance (primaire crypto) : cache 30 s + quotas larges → aucun pacing.
  // On ne temporise que les assets qui retomberont sur CoinGecko (free tier
  // ~10–30 rpm) — liquid staking, wrapped, tokens hors Binance.
  const { isBinanceSupported } = await import("./providers/binance-ws");
  let coingeckoCalls = 0;

  for (const asset of assets) {
    if (asset.priceProvider === "MANUAL" && !["ACTIONS", "CRYPTO"].includes(asset.assetClass)) {
      continue;
    }

    const meta: AssetMeta = {
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      assetClass: asset.assetClass,
      priceProvider: asset.priceProvider,
      providerSymbol: asset.providerSymbol,
      currency: asset.currency,
      manualPrice: asset.manualPrice?.toString() ?? null,
    };

    const isCrypto =
      asset.assetClass === "CRYPTO" || asset.priceProvider === "COINGECKO";
    // Pacing uniquement pour le fallback CoinGecko (Binance ne l'exige pas)
    const usesCoingeckoFallback =
      isCrypto && !isBinanceSupported({ ...meta, assetClass: "CRYPTO" });
    if (usesCoingeckoFallback && coingeckoCalls > 0) {
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (usesCoingeckoFallback) coingeckoCalls += 1;

    const quote = await fetchPriceWithFallback(meta);
    const now = new Date();

    if (quote.status === "OK") {
      const priceNative = quote.priceNative ?? quote.priceEur;
      const nativeCurrency = quote.nativeCurrency ?? "EUR";

      // CRYPTO en MANUAL/null : bascule vers le bon provider live selon la source
      // qui a répondu (Binance ou CoinGecko), sans jamais figer sur COINGECKO
      // si Binance est disponible pour ce ticker.
      if (
        asset.assetClass === "CRYPTO" &&
        (asset.priceProvider === "MANUAL" || !asset.priceProvider)
      ) {
        const isBinanceTicker = isBinanceSupported({ ...meta, assetClass: "CRYPTO" });
        if (isBinanceTicker) {
          // Binance couvre ce ticker → ne pas écrire COINGECKO en base,
          // le registry résoudra Binance en primaire à chaque refresh.
          // Aucune mise à jour de priceProvider nécessaire.
        } else {
          // Token hors Binance (liquid staking, wrapped…) → figer sur COINGECKO
          const { resolveCoingeckoId } = await import("./providers/coingecko");
          const cgId = resolveCoingeckoId(
            asset.ticker,
            asset.providerSymbol,
            asset.name
          );
          await prisma.asset.update({
            where: { id: asset.id },
            data: {
              priceProvider: "COINGECKO",
              ...(cgId && !asset.providerSymbol
                ? { providerSymbol: cgId }
                : {}),
            },
          });
        }
      }

      await prisma.priceQuote.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          priceNative: new Prisma.Decimal(priceNative),
          nativeCurrency,
          priceEur: new Prisma.Decimal(quote.priceEur),
          source: quote.source,
          status: "OK",
          lastUpdatedAt: now,
          rawError: null,
        },
        update: {
          priceNative: new Prisma.Decimal(priceNative),
          nativeCurrency,
          priceEur: new Prisma.Decimal(quote.priceEur),
          source: quote.source,
          status: "OK",
          lastUpdatedAt: now,
          rawError: null,
        },
      });

      await prisma.priceHistory.create({
        data: {
          assetId: asset.id,
          priceEur: new Prisma.Decimal(quote.priceEur),
          source: quote.source,
        },
      });

      results.push({
        assetId: asset.id,
        name: asset.name,
        ok: true,
        source: quote.source,
        priceEur: quote.priceEur,
        priceNative,
        nativeCurrency,
        status: "OK",
        lastUpdatedAt: now.toISOString(),
      });

      freshPrices.set(asset.id, {
        priceNative,
        currency: nativeCurrency || asset.currency || "EUR",
      });
    } else if (asset.priceQuote) {
      await prisma.priceQuote.update({
        where: { assetId: asset.id },
        data: {
          status: "STALE",
          rawError: quote.error ?? "Erreur fournisseur",
        },
      });
      results.push({
        assetId: asset.id,
        name: asset.name,
        ok: false,
        source: asset.priceQuote.source,
        priceEur: asset.priceQuote.priceEur.toString(),
        priceNative: asset.priceQuote.priceNative.toString(),
        nativeCurrency: asset.priceQuote.nativeCurrency,
        status: "STALE",
        error: quote.error,
        stalePreserved: true,
        lastUpdatedAt: asset.priceQuote.lastUpdatedAt.toISOString(),
      });
    } else {
      results.push({
        assetId: asset.id,
        name: asset.name,
        ok: false,
        status: "ERROR",
        error: quote.error ?? "Échec actualisation",
      });
    }
  }

  // Simulated SL / TP auto-execution on fresh OK quotes
  let triggerFills: TriggerExecutionReport[] = [];
  try {
    triggerFills = await executeOrderTriggers(userId, freshPrices);
  } catch (e) {
    console.error("executeOrderTriggers after refresh", e);
  }

  return {
    results,
    successCount: results.filter((r) => r.ok).length,
    failureCount: results.filter((r) => !r.ok).length,
    triggerFills,
  };
}
