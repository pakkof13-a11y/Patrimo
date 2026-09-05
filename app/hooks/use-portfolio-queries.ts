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

const DAILY_NAV_STALE_MS = 60_000;

export type DailyNavQueryResult = import("@/app/lib/portfolio/historical/get-daily-nav").DailyNavResult;

/**
 * Série dense T-05 — `GET /api/portfolio/daily-nav?scope=financier`.
 *
 * Un seul aller-retour : chaque point porte déjà brut / net / financier /
 * listed. Cliquer une carte ne refetch pas — ça lit un autre champ.
 * `from`/`to` ne changent que la fenêtre, jamais la texture (1 pt/jour).
 */
export function useDailyNavQuery(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["portfolio-daily-nav", from, to],
    queryFn: () => {
      const params = new URLSearchParams({
        scope: "financier",
        from,
        to,
      });
      return fetchJson<DailyNavQueryResult>(
        `/api/portfolio/daily-nav?${params.toString()}`
      );
    },
    enabled: enabled && Boolean(from && to),
    staleTime: DAILY_NAV_STALE_MS,
    placeholderData: keepPreviousData,
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
  kpis?: {
    buysEur: number;
    sellsEur: number;
    feesEur: number;
    incomeEur: number;
  };
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
  /** Bornes "YYYY-MM-DD" (inclusives) */
  dateFrom?: string;
  dateTo?: string;
  platformId?: string;
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
    params.dateFrom || "",
    params.dateTo || "",
    params.platformId || "",
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
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  if (params.platformId) sp.set("platformId", params.platformId);
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

/**
 * P&L journalier par classe d'actifs — alimente les courbes et la variation
 * du jour des en-têtes de groupe du portefeuille.
 *
 * Requête à part, jamais fusionnée dans `usePortfolioHistoryQuery` : le calcul
 * peut déclencher des appels fournisseurs pour compléter le cache de clôtures
 * (voir `class-pnl-service`). Le cache est donc volontairement long, et la
 * requête ne se relance ni au montage ni au retour de focus — un tableau qui
 * reste lisible vaut mieux qu'une courbe rafraîchie à la seconde.
 */
const CLASS_PNL_STALE_MS = 5 * 60_000;

export type ClassPnlPoint = {
  day: string;
  valueByClass: Record<string, number>;
  pnlByClass: Record<string, number>;
  incompleteClasses: string[];
};

export function useClassPnlQuery(range: string, enabled: boolean) {
  return useQuery({
    queryKey: ["portfolio-class-pnl", range],
    queryFn: () =>
      fetchJson<{
        points: ClassPnlPoint[];
        classes: string[];
        estimated: boolean;
      }>(`/api/portfolio/class-pnl?range=${encodeURIComponent(range)}`),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: CLASS_PNL_STALE_MS,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Le compte porte-t-il la moindre donnée patrimoniale ?
 *
 * Seule cette réponse décide entre le cockpit d'accueil et le tableau de bord.
 * Elle n'est jamais servie depuis le cache : après une remise à zéro ou la
 * création d'une première ligne, l'écran doit basculer immédiatement, et une
 * valeur gardée quelques secondes montrerait le mauvais des deux.
 */
export function usePatrimonyStateQuery() {
  return useQuery({
    queryKey: PATRIMONY_STATE_KEY,
    queryFn: () =>
      fetchJson<{ isEmpty: boolean; families: string[] }>(
        "/api/patrimony-state"
      ),
    staleTime: 0,
    gcTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/** Clé partagée — l'invalidation vit chez les écrans qui créent des données. */
export const PATRIMONY_STATE_KEY = ["patrimony-state"] as const;
