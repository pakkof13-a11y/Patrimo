"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import { formatCurrency, formatDate, getChangeColor, cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type RecentTx = {
  id: string;
  type: string;
  occurredAt: string;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  currency: string;
  netCashImpactEur: string;
  notes: string | null;
};

const LIMIT = 8;

export function HoldingRecentTxs({
  assetId,
  enabled,
}: {
  assetId: string;
  enabled: boolean;
}) {
  const q = useQuery({
    // Shared with asset detail modal cache when same id is opened
    queryKey: ["asset-detail", assetId],
    enabled: enabled && Boolean(assetId),
    queryFn: () =>
      fetchJson<{ transactions: RecentTx[] }>(`/api/assets/${assetId}`),
    staleTime: 30_000,
    select: (data) => (data.transactions ?? []).slice(0, LIMIT),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 px-2 py-2" data-testid="holding-txs-skeleton">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <p className="px-2 py-3 text-xs text-red-600 dark:text-red-400">
        Impossible de charger les transactions
      </p>
    );
  }

  const txs = q.data ?? [];

  if (txs.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
        Aucune transaction pour cet actif
      </p>
    );
  }

  return (
    <div className="px-1 py-1" data-testid="holding-recent-txs">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Dernières transactions
        </span>
        <span className="text-[10px] text-slate-400">
          {txs.length}
          {txs.length >= LIMIT ? "+" : ""} affiché(s)
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-white/60 dark:bg-slate-900/40">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/80 text-[10px] uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Date</th>
              <th className="px-2.5 py-1.5 font-medium">Type</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Qté</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Prix</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Frais</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Impact €</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums">
                  {formatDate(t.occurredAt)}
                </td>
                <td className="px-2.5 py-1.5">
                  {TRANSACTION_TYPES[t.type as keyof typeof TRANSACTION_TYPES] || t.type}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {t.quantity != null
                    ? Number(t.quantity).toLocaleString("fr-FR", {
                        maximumFractionDigits: 8,
                      })
                    : "—"}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {t.unitPrice != null
                    ? formatCurrency(t.unitPrice, t.currency)
                    : "—"}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {formatCurrency(t.fees, t.currency)}
                </td>
                <td
                  className={cn(
                    "px-2.5 py-1.5 text-right tabular-nums",
                    getChangeColor(t.netCashImpactEur)
                  )}
                >
                  {formatCurrency(t.netCashImpactEur, "EUR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
