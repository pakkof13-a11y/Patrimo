import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "../prisma";
import { d, toFixed } from "../money/decimal";
import { fetchPriceWithFallback } from "./registry";
import { isBinanceSupported } from "./providers/binance-ws";
import { resolveCoingeckoId, fetchCoingeckoSimplePrices } from "./providers/coingecko";
import { pricePrecision } from "./price-utils";
import type { AssetMeta, PriceQuoteResult } from "./types";
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

/** Délai entre deux CHUNKS CoinGecko consécutifs (free tier ~10-30 rpm). */
const COINGECKO_PACE_MS = 1200;
/** /simple/price accepte de nombreux ids par appel — on charge par lots. */
const COINGECKO_CHUNK_SIZE = 30;

type AssetRow = Awaited<
  ReturnType<typeof prisma.asset.findMany<{ include: { priceQuote: true } }>>
>[number];

function buildAssetMeta(asset: AssetRow): AssetMeta {
  return {
    id: asset.id,
    name: asset.name,
    ticker: asset.ticker,
    assetClass: asset.assetClass,
    priceProvider: asset.priceProvider,
    providerSymbol: asset.providerSymbol,
    currency: asset.currency,
    manualPrice: asset.manualPrice?.toString() ?? null,
  };
}

export async function refreshEligiblePrices(userId: string): Promise<{
  results: RefreshItemResult[];
  successCount: number;
  failureCount: number;
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

  // --- Séparer les assets en deux groupes (meta construit UNE seule fois ici) ---
  // Groupe A : Binance + Yahoo + Finnhub → pas de pacing, parallélisables
  // Groupe B : CoinGecko fallback (liquid staking, wrapped…) → batché
  const groupA: Array<{ asset: AssetRow; meta: AssetMeta }> = [];
  const groupB: Array<{ asset: AssetRow; meta: AssetMeta }> = [];

  for (const asset of assets) {
    if (
      asset.priceProvider === "MANUAL" &&
      !["ACTIONS", "CRYPTO"].includes(asset.assetClass)
    ) {
      continue;
    }
    const meta = buildAssetMeta(asset);
    const isCrypto = asset.assetClass === "CRYPTO" || asset.priceProvider === "COINGECKO";
    const needsCoingecko = isCrypto && !isBinanceSupported({ ...meta, assetClass: "CRYPTO" });
    if (needsCoingecko) {
      groupB.push({ asset, meta });
    } else {
      groupA.push({ asset, meta });
    }
  }

  const now = new Date();
  const results: RefreshItemResult[] = [];
  const resultIndexByAssetId = new Map<string, number>();
  const freshPrices = new Map<string, { priceNative: string; currency: string }>();

  type DbWriteEntry = {
    promise: Promise<unknown>;
    kind: "priceQuote" | "priceHistory" | "assetProvider";
    assetId: string;
  };
  const dbWriteEntries: DbWriteEntry[] = [];

  // --- Groupe A : fetch en parallèle (Binance/Yahoo/Finnhub — pas de quota agressif) ---
  const groupAResults = await Promise.all(
    groupA.map(async ({ asset, meta }) => {
      const quote = await fetchPriceWithFallback(meta);
      return { asset, meta, quote };
    })
  );

  // --- Groupe B : CoinGecko en lots batchés (un seul appel /simple/price par
  // lot de 30 ids max, au lieu d'un appel séquentiel pacé de 1200ms PAR ASSET
  // — pour 20 tokens CoinGecko ça ramène ~24s de refresh à un ou deux appels). ---
  const groupBResults: Array<{ asset: AssetRow; meta: AssetMeta; quote: PriceQuoteResult }> = [];
  if (groupB.length > 0) {
    const coinIdByAssetId = new Map<string, string>();
    for (const { asset } of groupB) {
      const coinId = resolveCoingeckoId(asset.ticker, asset.providerSymbol, asset.name);
      if (coinId) coinIdByAssetId.set(asset.id, coinId);
    }

    const uniqueCoinIds = [...new Set(coinIdByAssetId.values())];
    const priceByCoinId = new Map<string, number>();

    for (let i = 0; i < uniqueCoinIds.length; i += COINGECKO_CHUNK_SIZE) {
      if (i > 0) await new Promise((r) => setTimeout(r, COINGECKO_PACE_MS));
      const chunk = uniqueCoinIds.slice(i, i + COINGECKO_CHUNK_SIZE);
      try {
        const data = await fetchCoingeckoSimplePrices(chunk, ["eur"]);
        for (const [id, row] of Object.entries(data)) {
          const price = row?.eur;
          if (typeof price === "number" && Number.isFinite(price)) {
            priceByCoinId.set(id, price);
          }
        }
      } catch (e) {
        console.warn(
          "[refresh] CoinGecko batch failed",
          chunk.length,
          "ids",
          e instanceof Error ? e.message : e
        );
      }
    }

    for (const { asset, meta } of groupB) {
      const coinId = coinIdByAssetId.get(asset.id);
      let quote: PriceQuoteResult;
      if (!coinId) {
        quote = {
          priceEur: "0",
          currency: "EUR",
          source: "coingecko",
          status: "ERROR",
          error: "Symbole crypto manquant",
        };
      } else {
        const price = priceByCoinId.get(coinId);
        if (typeof price !== "number") {
          quote = {
            priceEur: "0",
            currency: "EUR",
            source: "coingecko",
            status: "ERROR",
            error: `Prix introuvable pour ${coinId}`,
          };
        } else {
          const prec = pricePrecision(price);
          const priceStr = toFixed(d(price), prec);
          quote = {
            priceEur: priceStr,
            priceNative: priceStr,
            nativeCurrency: "EUR",
            currency: "EUR",
            source: "coingecko",
            status: "OK",
          };
        }
      }
      groupBResults.push({ asset, meta, quote });
    }
  }

  // --- Traitement des résultats + préparation des écritures DB ---
  for (const { asset, meta, quote } of [...groupAResults, ...groupBResults]) {
    if (quote.status === "OK") {
      const priceNative = quote.priceNative ?? quote.priceEur;
      const nativeCurrency = quote.nativeCurrency ?? "EUR";

      // Auto-assign provider pour les CRYPTO en MANUAL/null
      if (
        asset.assetClass === "CRYPTO" &&
        (asset.priceProvider === "MANUAL" || !asset.priceProvider)
      ) {
        const isBinanceTicker = isBinanceSupported({ ...meta, assetClass: "CRYPTO" });
        if (!isBinanceTicker) {
          const cgId = resolveCoingeckoId(asset.ticker, asset.providerSymbol, asset.name);
          dbWriteEntries.push({
            kind: "assetProvider",
            assetId: asset.id,
            promise: prisma.asset.update({
              where: { id: asset.id },
              data: {
                priceProvider: "COINGECKO",
                ...(cgId && !asset.providerSymbol ? { providerSymbol: cgId } : {}),
              },
            }),
          });
        }
      }

      dbWriteEntries.push({
        kind: "priceQuote",
        assetId: asset.id,
        promise: prisma.priceQuote.upsert({
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
        }),
      });

      dbWriteEntries.push({
        kind: "priceHistory",
        assetId: asset.id,
        promise: prisma.priceHistory.create({
          data: {
            assetId: asset.id,
            priceEur: new Prisma.Decimal(quote.priceEur),
            source: quote.source,
          },
        }),
      });

      resultIndexByAssetId.set(asset.id, results.length);
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
      dbWriteEntries.push({
        kind: "priceQuote",
        assetId: asset.id,
        promise: prisma.priceQuote.update({
          where: { assetId: asset.id },
          data: {
            status: "STALE",
            rawError: quote.error ?? "Erreur fournisseur",
          },
        }),
      });
      resultIndexByAssetId.set(asset.id, results.length);
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
      resultIndexByAssetId.set(asset.id, results.length);
      results.push({
        assetId: asset.id,
        name: asset.name,
        ok: false,
        status: "ERROR",
        error: quote.error ?? "Échec actualisation",
      });
    }
  }

  // --- Flush toutes les écritures DB en parallèle ---
  const settled = await Promise.allSettled(dbWriteEntries.map((e) => e.promise));
  const dbErrors = settled
    .map((r, i) => ({ r, entry: dbWriteEntries[i]! }))
    .filter(({ r }) => r.status === "rejected");

  if (dbErrors.length > 0) {
    console.error(
      `[refresh] ${dbErrors.length} DB write(s) failed`,
      dbErrors.map(({ r, entry }) => ({
        assetId: entry.assetId,
        kind: entry.kind,
        reason: (r as PromiseRejectedResult).reason,
      }))
    );
  }

  // Un prix "OK" dont l'écriture priceQuote a échoué n'a PAS été persisté —
  // ne pas le déclarer réussi (Promise.allSettled masquerait sinon l'échec).
  for (const { entry } of dbErrors) {
    if (entry.kind !== "priceQuote") continue;
    const idx = resultIndexByAssetId.get(entry.assetId);
    if (idx == null) continue;
    const res = results[idx]!;
    if (res.status === "OK") {
      res.ok = false;
      res.status = "STALE";
      res.error = "Échec écriture prix en base";
      freshPrices.delete(entry.assetId);
    }
  }

  // --- SL/TP triggers ---
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
