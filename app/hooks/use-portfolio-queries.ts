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

/** Réponse paginée GET /api/transactions */
export type TransactionsListResponse = {
  transactions: TxRow[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
  pageCount: number;
  typeCounts?: Partial<Record<string, number>>;
};

export type TransactionsListParams = {
  /** Page 1-based (alignée API) */
  page: number;
  pageSize: number;
  typeGroup?: string;
  accountType?: string;
  q?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

/** Clé RQ pour le journal — invalidation `["transactions"]` couvre list + meta. */
export function transactionsListQueryKey(params: TransactionsListParams) {
  return [
    "transactions",
    "list",
    params.page,
    params.pageSize,
    params.typeGroup || "all",
    params.accountType || "",
    params.q?.trim() || "",
    params.sortBy || "date",
    params.sortDir || "desc",
  ] as const;
}

function buildTransactionsListUrl(params: TransactionsListParams): string {
  const sp = new URLSearchParams({
    page: String(Math.max(1, params.page)),
    pageSize: String(params.pageSize),
    typeGroup: params.typeGroup || "all",
  });
  if (params.accountType) sp.set("accountType", params.accountType);
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.sortBy) sp.set("sortBy", params.sortBy);
  if (params.sortDir) sp.set("sortDir", params.sortDir);
  return `/api/transactions?${sp.toString()}`;
}

/**
 * Journal paginé / filtré — source de vérité unique pour TransactionsTab.
 */
export function useTransactionsListQuery(
  params: TransactionsListParams,
  opts?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: transactionsListQueryKey(params),
    queryFn: () =>
      fetchJson<TransactionsListResponse>(buildTransactionsListUrl(params)),
    enabled: opts?.enabled !== false,
    staleTime: TX_STALE_MS,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}

/**
 * Méta légère (totalAll) pour maturité dashboard / KPI — 1 ligne API.
 * Ne charge pas le journal complet.
 */
export function useTransactionsMetaQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["transactions", "meta"] as const,
    queryFn: () =>
      fetchJson<TransactionsListResponse>(
        `/api/transactions?page=1&pageSize=1`
      ),
    enabled: opts?.enabled !== false,
    staleTime: TX_STALE_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/** @deprecated Préférer useTransactionsListQuery / useTransactionsMetaQuery */
export function useTransactionsQuery() {
  return useTransactionsMetaQuery();
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
