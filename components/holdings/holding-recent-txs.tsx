"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Tags } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import {
  formatCurrencyPrecise,
  formatDate,
  formatQuantity,
} from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

type RecentTx = {
  id: string;
  type: string;
  occurredAt: string;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  currency: string;
  fxRateToEur?: string;
  netCashImpactEur: string;
  notes: string | null;
};

const LIMIT = 8;

const TX_QUICK: { type: string; label: string }[] = [
  { type: "ACHAT", label: "Achat" },
  { type: "VENTE", label: "Vente" },
  { type: "DIVIDENDE", label: "Dividende" },
  { type: "FRAIS", label: "Frais" },
];

function tradePriceMath(tx: RecentTx): {
  gross: number;
  fees: number;
  net: number;
} | null {
  const qty = Number(tx.quantity);
  const px = Number(tx.unitPrice);
  const feesN = Number(tx.fees) || 0;
  const fx = Number(tx.fxRateToEur) || 1;
  if (
    !Number.isFinite(qty) ||
    !Number.isFinite(px) ||
    Math.abs(qty) <= 0 ||
    !["ACHAT", "VENTE", "REWARD"].includes(tx.type)
  ) {
    return null;
  }
  const gross = Math.abs(qty * px) * fx;
  const fees = Math.abs(feesN) * fx;
  const net = Math.max(0, gross - fees);
  return { gross, fees, net };
}

/**
 * Aperçu rapide de l’historique d’une position (expansion ligne).
 * Layout : « Achat - Date | Qté »  ·  « brut − frais = net » (bleu/rouge/vert).
 */
export function HoldingRecentTxs({
  assetId,
  enabled,
  onOpenTransaction,
  onEditCategory,
  onOpenDetail,
}: {
  assetId: string;
  enabled: boolean;
  onOpenTransaction?: (type?: string) => void;
  onEditCategory?: () => void;
  onOpenDetail?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ["asset-detail", assetId],
    enabled: enabled && Boolean(assetId),
    queryFn: () =>
      fetchJson<{ transactions: RecentTx[] }>(`/api/assets/${assetId}`),
    staleTime: 30_000,
    select: (data) => (data.transactions ?? []).slice(0, LIMIT),
  });

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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

  return (
    <div className="px-1 py-1" data-testid="holding-recent-txs">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)]/70 px-1 pb-2">
        <div className="min-w-0">
          <span className="text-label">Dernières transactions</span>
          <p className="text-meta mt-0.5">
            {txs.length === 0
              ? "Aucune opération pour l’instant"
              : `${txs.length}${txs.length >= LIMIT ? "+" : ""} · journal = source de vérité`}
          </p>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid={`holding-inline-actions-${assetId}`}
        >
          {onOpenTransaction && (
            <div
              ref={menuRef}
              className="relative inline-flex shadow-sm"
              data-testid={`holding-tx-actions-${assetId}`}
            >
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-r-none text-[11px]"
                data-testid={`holding-add-tx-${assetId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTransaction("ACHAT");
                }}
                title="Nouvelle transaction sur cet actif"
              >
                <Plus className="h-3.5 w-3.5" />
                Transaction
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-l-none border-l border-teal-900/20 px-1.5 dark:border-teal-950/40"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Type d'opération"
                data-testid={`holding-add-tx-menu-${assetId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-1 min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
                >
                  {TX_QUICK.map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--muted)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onOpenTransaction(t.type);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {onOpenDetail && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              data-testid={`holding-open-detail-${assetId}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail();
              }}
            >
              Fiche complète
            </Button>
          )}

          {onEditCategory && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-[11px] text-[var(--muted-foreground)]"
              data-testid={`holding-edit-category-${assetId}`}
              onClick={(e) => {
                e.stopPropagation();
                onEditCategory();
              }}
              title="Classification UI (sans impact sur le ledger)"
            >
              <Tags className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Catégorie</span>
            </Button>
          )}
        </div>
      </div>

      {txs.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-[var(--muted-foreground)]">
          Enregistrez un achat pour démarrer l&apos;historique.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]" data-testid="holding-tx-list">
          {txs.map((tx) => {
            const typeLabel =
              TRANSACTION_TYPES[tx.type as keyof typeof TRANSACTION_TYPES] ??
              tx.type;
            const qtyStr =
              tx.quantity != null && tx.quantity !== ""
                ? formatQuantity(tx.quantity)
                : null;
            const math = tradePriceMath(tx);

            return (
              <li
                key={tx.id}
                className="flex items-center justify-between gap-3 px-1 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-[var(--foreground)]">
                    {typeLabel}
                  </span>
                  <span className="text-[var(--muted-foreground)]">
                    {" "}
                    - {formatDate(tx.occurredAt)}
                  </span>
                  {qtyStr != null && (
                    <>
                      <span className="text-[var(--muted-foreground)]">
                        {" "}
                        |{" "}
                      </span>
                      <span className="font-mono tabular-nums text-[var(--foreground)]">
                        {qtyStr}
                      </span>
                    </>
                  )}
                </div>
                <div
                  className="shrink-0 text-right tabular-nums"
                  data-testid="holding-tx-price-math"
                >
                  {math ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
                      <span className="font-medium text-sky-700 dark:text-sky-300">
                        {formatCurrencyPrecise(math.gross, "EUR")}
                      </span>
                      <span className="text-[var(--muted-foreground)]">−</span>
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {formatCurrencyPrecise(math.fees, "EUR")}
                      </span>
                      <span className="text-[var(--muted-foreground)]">=</span>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatCurrencyPrecise(math.net, "EUR")}
                      </span>
                    </span>
                  ) : (
                    <span className="font-medium text-[var(--foreground)]">
                      {formatCurrencyPrecise(tx.netCashImpactEur, "EUR")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
