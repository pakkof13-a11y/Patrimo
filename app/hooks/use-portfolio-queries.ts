"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import type {
  HistoryPoint,
  HoldingsResponse,
  PlatformRow,
  TxRow,
} from "@/app/lib/types/ui";

/** Holdings : cache court, invalidation après mutations (pas de bust Date.now). */
const HOLDINGS_STALE_MS = 20_000;
const TX_STALE_MS = 15_000;
const HISTORY_STALE_MS = 60_000;
const PLATFORMS_STALE_MS = 30_000;

export function useHoldingsQuery(baseCurrency: string) {
  return useQuery({
    queryKey: ["holdings", baseCurrency],
    queryFn: () =>
      fetchJson<HoldingsResponse>(
        `/api/holdings?base=${encodeURIComponent(baseCurrency)}`
      ),
    placeholderData: keepPreviousData,
    staleTime: HOLDINGS_STALE_MS,
    gcTime: 5 * 60_000,
    retry: 1,
    // Évite un flash au focus / remount : le refresh prix pousse déjà les données
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function usePortfolioHistoryQuery(baseCurrency: string) {
  return useQuery({
    queryKey: ["portfolio-history", baseCurrency],
    queryFn: () =>
      fetchJson<{ history: HistoryPoint[]; baseCurrency: string }>(
        `/api/portfolio?base=${encodeURIComponent(baseCurrency)}`
      ),
    staleTime: HISTORY_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

export function usePlatformsQuery(baseCurrency: string) {
  return useQuery({
    queryKey: ["platforms", baseCurrency],
    queryFn: () => fetchJson<{ platforms: PlatformRow[] }>(`/api/platforms`),
    staleTime: PLATFORMS_STALE_MS,
  });
}

export function useTransactionsQuery() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: () =>
      fetchJson<{ transactions: TxRow[]; total?: number }>(`/api/transactions`),
    staleTime: TX_STALE_MS,
    placeholderData: keepPreviousData,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function useAssetDetailQuery(detailAssetId: string | null) {
  return useQuery({
    queryKey: ["asset-detail", detailAssetId],
    enabled: !!detailAssetId,
    queryFn: () =>
      fetchJson<{
        asset: {
          id: string;
          name: string;
          ticker: string | null;
          assetClass: string;
          currency: string;
          platformName: string;
          platformLogoUrl: string | null;
          assetLogoUrl: string | null;
          priceQuote: {
            priceNative: string;
            priceEur: string;
            nativeCurrency: string;
            source: string;
            status: string;
            lastUpdatedAt: string;
          } | null;
        };
        holding: {
          quantity: string;
          avgCostEur: string;
          marketValueEur: string;
        } | null;
        transactions: Array<{
          id: string;
          type: string;
          occurredAt: string;
          quantity: string | null;
          unitPrice: string | null;
          fees: string;
          currency: string;
          fxRateToEur: string;
          grossAmountEur: string;
          netCashImpactEur: string;
          notes: string | null;
          platformId: string;
          toPlatformId?: string | null;
          assetId?: string | null;
          feesEur?: string;
          withholdingTaxEur?: string;
          withholdingTaxRate?: string | null;
          paymentDate?: string | null;
          exDate?: string | null;
        }>;
      }>(`/api/assets/${detailAssetId}`),
    staleTime: 15_000,
  });
}
