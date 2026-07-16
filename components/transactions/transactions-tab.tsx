"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyBadge } from "@/components/ui/currency-badge";
import { TableFilters, matchesSearchQuery } from "@/components/ui/table-filters";
import { PageJump } from "@/components/ui/page-jump";
import {
  TxTypeFilters,
  matchesTxTypeFilter,
  txTypeFilterEmptyHint,
  type TxTypeFilterId,
  TX_TYPE_FILTERS,
} from "@/components/transactions/tx-type-filters";
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from "@/app/lib/constants";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { formatCurrency, formatDate, getChangeColor, cn } from "@/app/lib/utils";
import type { TxRow } from "@/app/lib/types/ui";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type ApiPayload = { transactions: TxRow[]; total?: number };

/**
 * Journal des transactions — charge l’API en direct (pas seulement via le parent)
 * pour éviter un cache RQ vide / obsolète.
 */
export function TransactionsTab({
  transactions: transactionsFromParent,
  totalFromApi,
  loading: loadingFromParent,
  onEdit,
  onDelete,
  onImport,
}: {
  transactions: TxRow[];
  totalFromApi?: number;
  loading?: boolean;
  onEdit: (t: TxRow) => void;
  onDelete: (id: string) => void;
  onImport?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState("");
  const [typeFilter, setTypeFilter] = useState<TxTypeFilterId>("all");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [pageIndex, setPageIndex] = useState(0);

  // Local fetch — source de vérité pour cet onglet
  const [localTx, setLocalTx] = useState<TxRow[] | null>(null);
  const [localTotal, setLocalTotal] = useState<number | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  async function loadTransactions() {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const res = await fetch(`/api/transactions?_=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiPayload;
      const list = Array.isArray(data.transactions) ? data.transactions : [];
      setLocalTx(list);
      setLocalTotal(
        typeof data.total === "number" ? data.total : list.length
      );
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Erreur de chargement");
      setLocalTx(null);
      setLocalTotal(null);
    } finally {
      setLocalLoading(false);
    }
  }

  useEffect(() => {
    void loadTransactions();
  }, []);

  // Prefer local fetch; fall back to parent props while first load
  const transactions = useMemo(
    () => localTx ?? transactionsFromParent ?? [],
    [localTx, transactionsFromParent]
  );
  const totalDb =
    localTotal ?? totalFromApi ?? transactionsFromParent?.length ?? 0;
  const loading = localLoading || Boolean(loadingFromParent);
  const totalLoaded = transactions.length;

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<TxTypeFilterId, number>> = { all: transactions.length };
    for (const f of TX_TYPE_FILTERS) {
      if (f.id === "all") continue;
      counts[f.id] = transactions.filter((t) => matchesTxTypeFilter(t.type, f.id)).length;
    }
    return counts;
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions
      .filter((t) => {
        if (!matchesTxTypeFilter(t.type, typeFilter)) return false;
        if (accountType) {
          const at = t.asset?.accountType || "";
          if (!at || at !== accountType) return false;
        }
        return matchesSearchQuery(debouncedSearch, [
          t.asset?.name,
          t.asset?.ticker,
          t.asset?.isin,
          t.platform?.name,
          t.toPlatform?.name,
          t.notes,
          t.type,
          TRANSACTION_TYPES[t.type as keyof typeof TRANSACTION_TYPES],
        ]);
      })
      .slice()
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      );
  }, [transactions, debouncedSearch, accountType, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);

  useEffect(() => {
    setPageIndex(0);
  }, [debouncedSearch, accountType, pageSize, typeFilter]);

  useEffect(() => {
    if (pageIndex > pageCount - 1) {
      setPageIndex(Math.max(0, pageCount - 1));
    }
  }, [pageIndex, pageCount]);

  const pageRows = useMemo(() => {
    const start = pageIndex * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, pageIndex, pageSize]);

  const from = filtered.length === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(filtered.length, (pageIndex + 1) * pageSize);

  const pageSizeSelect = (
    <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-slate-600 dark:text-slate-300 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:whitespace-nowrap">
      <span className="shrink-0 font-medium">Transactions par page</span>
      <select
        className="input !w-full min-w-0 !py-1.5 text-sm font-semibold tabular-nums sm:!w-auto sm:min-w-[4.5rem]"
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
        data-testid="tx-page-size"
        aria-label="Nombre de transactions par page"
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="card min-w-0 overflow-hidden" data-testid="transactions-tab">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--border)] px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-snug break-words">
            Journal des transactions
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Édition / suppression · recalcul des positions
          </p>
          <p
            className="mt-1 text-sm font-semibold tabular-nums text-teal-700 dark:text-teal-400"
            data-testid="tx-total-count"
          >
            {loading && localTx === null
              ? "Chargement des transactions…"
              : `${totalDb} transaction${totalDb !== 1 ? "s" : ""} en base`}
            {!loading && totalLoaded !== totalDb && (
              <span className="ml-1 font-normal text-amber-600">
                ({totalLoaded} chargées)
              </span>
            )}
            {filtered.length !== totalLoaded && !loading && (
              <span className="ml-1 font-normal text-slate-500">
                · {filtered.length} après filtre
              </span>
            )}
          </p>
          {localError && (
            <p className="mt-1 text-xs text-red-600">
              Erreur API : {localError} —{" "}
              <button type="button" className="underline" onClick={() => void loadTransactions()}>
                réessayer
              </button>
            </p>
          )}
        </div>

        {/* Contrôles : colonne mobile → ligne wrap ordonnée dès sm */}
        <div
          className={cn(
            "flex min-w-0 w-full flex-col gap-2",
            "sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
          )}
          data-testid="tx-toolbar"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadTransactions()}
              disabled={localLoading}
              title="Recharger depuis l’API"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", localLoading && "animate-spin")} />
              <span className="hidden sm:inline">Actualiser</span>
            </Button>
            {pageSizeSelect}
            {onImport && (
              <Button variant="outline" size="sm" onClick={onImport}>
                Import CSV
              </Button>
            )}
          </div>
          <TableFilters
            className="min-w-0 w-full sm:flex-1"
            search={search}
            onSearchChange={setSearch}
            accountType={accountType}
            onAccountTypeChange={setAccountType}
            placeholder="Nom, ticker, ISIN, plateforme…"
          />
        </div>
      </div>

      <div className="border-b border-[var(--border)] px-4 py-2.5">
        <TxTypeFilters
          value={typeFilter}
          onChange={setTypeFilter}
          counts={typeCounts}
        />
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2 text-xs text-slate-600 dark:text-slate-300"
        data-testid="tx-pagination-top"
      >
        <div className="flex flex-wrap items-center gap-3">
          {pageSizeSelect}
          <span className="tabular-nums font-medium">
            {filtered.length === 0
              ? loading
                ? "Chargement…"
                : "Aucune ligne"
              : `${from}–${to} sur ${filtered.length}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums font-medium" data-testid="tx-page-label">
            Page {filtered.length === 0 ? 0 : pageIndex + 1} /{" "}
            {filtered.length === 0 ? 0 : pageCount}
          </span>
          <PageJump
            pageIndex={pageIndex}
            pageCount={filtered.length === 0 ? 0 : pageCount}
            onGoToPage={setPageIndex}
          />
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={pageIndex <= 0 || filtered.length === 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              data-testid="tx-page-prev"
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Préc.
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pageIndex >= pageCount - 1 || filtered.length === 0}
              onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              data-testid="tx-page-next"
              aria-label="Page suivante"
            >
              Suiv.
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="table-container-responsive table-fluid-wrap">
        <table className="table-fluid text-sm">
          <thead className="table-head text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Actif</th>
              <th className="px-4 py-3 text-left">Compte</th>
              <th className="px-4 py-3 text-left">Plateforme</th>
              <th className="px-4 py-3 text-left">Devise</th>
              <th className="px-4 py-3 text-right">Impact €</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-2">{formatDate(t.occurredAt)}</td>
                <td className="px-4 py-2">
                  {TRANSACTION_TYPES[t.type as keyof typeof TRANSACTION_TYPES] || t.type}
                </td>
                <td className="px-4 py-2">
                  <div>{t.asset?.name || "—"}</div>
                  {(t.asset?.ticker || t.asset?.isin) && (
                    <div className="font-mono text-[10px] text-slate-500">
                      {[t.asset?.ticker, t.asset?.isin].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">
                  {t.asset?.accountType
                    ? ACCOUNT_TYPES[t.asset.accountType as keyof typeof ACCOUNT_TYPES] ||
                      t.asset.accountType
                    : "—"}
                </td>
                <td className="px-4 py-2">
                  {t.platform?.name || "—"}
                  {t.toPlatform ? ` → ${t.toPlatform.name}` : ""}
                </td>
                <td className="px-4 py-2">
                  <CurrencyBadge code={t.currency} />
                </td>
                <td
                  className={cn(
                    "px-4 py-2 text-right tabular-nums",
                    getChangeColor(t.netCashImpactEur)
                  )}
                >
                  {formatCurrency(t.netCashImpactEur, "EUR")}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm("Supprimer cette transaction ?")) onDelete(t.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  {totalDb === 0
                    ? "Aucune transaction en base — lancez npm run db:seed"
                    : typeFilter !== "all"
                      ? txTypeFilterEmptyHint(typeFilter)
                      : "Aucun résultat pour ces filtres"}
                </td>
              </tr>
            )}
            {loading && localTx === null && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  Chargement…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2 text-xs text-slate-500 dark:text-slate-400"
        data-testid="tx-pagination-bottom"
      >
        <span className="tabular-nums">
          {filtered.length === 0
            ? "—"
            : `${from}–${to} sur ${filtered.length} · total base ${totalDb}`}
        </span>
        <span className="tabular-nums">
          Page {filtered.length === 0 ? 0 : pageIndex + 1} /{" "}
          {filtered.length === 0 ? 0 : pageCount}
        </span>
      </div>
    </section>
  );
}
