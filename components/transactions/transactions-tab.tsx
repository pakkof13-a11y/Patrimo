"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyBadge } from "@/components/ui/currency-badge";
import { TableFilters } from "@/components/ui/table-filters";
import { PageJump } from "@/components/ui/page-jump";
import {
  TxTypeFilters,
  txTypeFilterEmptyHint,
  txTypeChipClass,
  type TxTypeFilterId,
} from "@/components/transactions/tx-type-filters";
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from "@/app/lib/constants";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { useTransactionsListQuery } from "@/app/hooks/use-portfolio-queries";
import { formatCurrency, formatDate, getChangeColor, cn } from "@/app/lib/utils";
import type { TxRow } from "@/app/lib/types/ui";
import {
  formatPageLabel,
  formatRangeLabel,
  shouldShowPaginationNav,
} from "@/app/lib/ui/pagination";
import {
  EmptyPlaceholder,
} from "@/components/ui/panel";
import {
  ModuleCard,
  moduleTableHeadClass,
  moduleTableRowClass,
} from "@/components/ui/module-shell";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/**
 * Journal des transactions — source de vérité unique : React Query
 * (`useTransactionsListQuery` → GET /api/transactions paginé).
 */
export function TransactionsTab({
  onEdit,
  onDelete,
  onImport,
}: {
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

  // Reset page when filters / page size change
  useEffect(() => {
    setPageIndex(0);
  }, [debouncedSearch, accountType, pageSize, typeFilter]);

  const listQ = useTransactionsListQuery({
    page: pageIndex + 1,
    pageSize,
    typeGroup: typeFilter,
    accountType: accountType || undefined,
    q: debouncedSearch.trim() || undefined,
  });

  const pageRows = listQ.data?.transactions ?? [];
  const filteredTotal = listQ.data?.total ?? 0;
  const totalDb = listQ.data?.totalAll ?? 0;
  const pageCount = Math.max(1, listQ.data?.pageCount ?? 1);
  const typeCounts = listQ.data?.typeCounts ?? {};

  // Clamp page if server has fewer pages
  useEffect(() => {
    if (pageIndex > pageCount - 1) {
      setPageIndex(Math.max(0, pageCount - 1));
    }
  }, [pageIndex, pageCount]);

  const loading = listQ.isPending || listQ.isFetching;
  const hasLoadedOnce = Boolean(listQ.data) || listQ.isFetched;
  const errorMessage =
    listQ.error instanceof Error
      ? listQ.error.message
      : listQ.isError
        ? "Erreur de chargement"
        : null;

  const hasRows = shouldShowPaginationNav(filteredTotal);
  const hasActiveFilters =
    typeFilter !== "all" ||
    Boolean(accountType) ||
    Boolean(debouncedSearch.trim());

  function formatCountSummary(): string {
    if (loading && !hasLoadedOnce) return "Chargement…";
    if (totalDb === 0 && filteredTotal === 0) return "Aucune transaction";
    const base = `${totalDb} transaction${totalDb !== 1 ? "s" : ""}`;
    if (filteredTotal !== totalDb) {
      return `${base} · ${filteredTotal} affichée${filteredTotal !== 1 ? "s" : ""}`;
    }
    return base;
  }

  return (
    <ModuleCard testId="transactions-tab">
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight leading-snug break-words text-[var(--foreground)]">
              Journal des transactions
            </h2>
            <p className="text-meta mt-0.5">
              Source de vérité pour positions, cash et fiscalité — édition,
              filtres et import
            </p>
            <p
              className="kpi-value mt-1.5 text-sm text-[var(--primary)]"
              data-testid="tx-total-count"
            >
              {formatCountSummary()}
            </p>
            {errorMessage && (
              <p className="mt-1 text-xs text-[var(--danger)]">
                Impossible de charger le journal —{" "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => void listQ.refetch()}
                >
                  réessayer
                </button>
              </p>
            )}
          </div>
        </div>

        <div
          className={cn(
            "flex min-w-0 w-full flex-col gap-2",
            "sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
          )}
          data-testid="tx-toolbar"
        >
          <TableFilters
            className="min-w-0 w-full sm:min-w-[14rem] sm:flex-1"
            search={search}
            onSearchChange={setSearch}
            accountType={accountType}
            onAccountTypeChange={setAccountType}
            accountFilterLabel="Enveloppe"
            placeholder="Nom, ticker, ISIN, plateforme…"
          />

          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void listQ.refetch()}
              disabled={listQ.isFetching}
              title="Recharger le journal"
              aria-label="Actualiser le journal"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", listQ.isFetching && "animate-spin")}
              />
              <span className="hidden sm:inline">Actualiser</span>
            </Button>
            {onImport && (
              <Button variant="outline" size="sm" onClick={onImport}>
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-2 sm:px-5">
        <TxTypeFilters
          value={typeFilter}
          onChange={setTypeFilter}
          counts={typeCounts as Partial<Record<TxTypeFilterId, number>>}
        />
      </div>

      {hasRows ? (
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--muted-foreground)] sm:px-5"
          data-testid="tx-pagination-top"
          data-empty="false"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">
              {formatRangeLabel(pageIndex, pageSize, filteredTotal)}
            </span>
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
              <span className="sr-only sm:not-sr-only sm:inline">Par page</span>
              <select
                className="input !h-7 !w-auto !min-w-0 !py-0 !pl-1.5 !pr-6 text-[11px] tabular-nums"
                value={pageSize}
                onChange={(e) =>
                  setPageSize(Number(e.target.value) as PageSize)
                }
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
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tabular-nums" data-testid="tx-page-label">
              {formatPageLabel(pageIndex, pageCount, filteredTotal)}
            </span>
            <PageJump
              pageIndex={pageIndex}
              pageCount={pageCount}
              onGoToPage={setPageIndex}
            />
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="!h-7 !px-1.5 text-[var(--muted-foreground)]"
                disabled={pageIndex <= 0}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                data-testid="tx-page-prev"
                aria-label="Page précédente"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="!h-7 !px-1.5 text-[var(--muted-foreground)]"
                disabled={pageIndex >= pageCount - 1}
                onClick={() =>
                  setPageIndex((p) => Math.min(pageCount - 1, p + 1))
                }
                data-testid="tx-page-next"
                aria-label="Page suivante"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="border-b border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--muted-foreground)] sm:px-5"
          data-testid="tx-pagination-top"
          data-empty="true"
        >
          <span className="tabular-nums" data-testid="tx-page-label">
            {loading && !hasLoadedOnce
              ? "Chargement…"
              : totalDb === 0
                ? "Aucune transaction"
                : "Aucun résultat pour ces filtres"}
          </span>
        </div>
      )}

      <div className="table-container-responsive table-fluid-wrap">
        <table className="table-fluid text-sm">
          <thead className={moduleTableHeadClass}>
            <tr>
              <th className="col-sticky-first px-3 py-2.5 text-left sm:px-4">
                Date
              </th>
              <th className="px-3 py-2.5 text-left sm:px-4">Type</th>
              <th className="col-wide px-3 py-2.5 text-left sm:px-4">Actif</th>
              <th className="col-hide-sm px-3 py-2.5 text-left sm:px-4">
                Enveloppe
              </th>
              <th className="col-hide-md px-3 py-2.5 text-left sm:px-4">
                Plateforme
              </th>
              <th className="col-hide-sm col-tight px-3 py-2.5 text-left sm:px-4">
                Devise
              </th>
              <th className="px-3 py-2.5 text-right sm:px-4">Impact €</th>
              <th className="col-actions px-3 py-2.5 text-right sm:px-4">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((t) => {
              const typeLabel =
                TRANSACTION_TYPES[t.type as keyof typeof TRANSACTION_TYPES] ||
                t.type;
              const envLabel = t.asset?.accountType
                ? ACCOUNT_TYPES[
                    t.asset.accountType as keyof typeof ACCOUNT_TYPES
                  ] || t.asset.accountType
                : "—";
              return (
                <tr key={t.id} className={moduleTableRowClass}>
                  <td className="col-sticky-first whitespace-nowrap px-3 py-2 tabular-nums text-[var(--foreground)] sm:px-4">
                    {formatDate(t.occurredAt)}
                  </td>
                  <td className="px-3 py-2 sm:px-4">
                    <span
                      className={cn(
                        "inline-flex max-w-[9rem] truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                        txTypeChipClass(t.type)
                      )}
                      title={typeLabel}
                    >
                      {typeLabel}
                    </span>
                  </td>
                  <td className="col-wide min-w-0 max-w-[14rem] px-3 py-2 sm:px-4">
                    <div className="truncate font-medium text-[var(--foreground)]">
                      {t.asset?.name || "—"}
                    </div>
                    {(t.asset?.ticker || t.asset?.isin) && (
                      <div className="text-meta mt-0.5 truncate font-mono text-[10px] leading-tight">
                        {[t.asset?.ticker, t.asset?.isin]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="col-hide-sm px-3 py-2 text-xs text-[var(--muted-foreground)] sm:px-4">
                    {envLabel}
                  </td>
                  <td className="col-hide-md max-w-[9rem] truncate px-3 py-2 text-xs text-[var(--muted-foreground)] sm:px-4">
                    {t.platform?.name || "—"}
                    {t.toPlatform ? (
                      <span className="opacity-70">
                        {" "}
                        → {t.toPlatform.name}
                      </span>
                    ) : null}
                  </td>
                  <td className="col-hide-sm col-tight px-3 py-2 sm:px-4">
                    <CurrencyBadge code={t.currency} />
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-medium tabular-nums sm:px-4",
                      getChangeColor(t.netCashImpactEur)
                    )}
                  >
                    {formatCurrency(t.netCashImpactEur, "EUR")}
                  </td>
                  <td className="col-actions px-2 py-1.5 text-right sm:px-3">
                    <div className="inline-flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="!h-7 !w-7 !px-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        onClick={() => onEdit(t)}
                        title="Modifier"
                        aria-label="Modifier la transaction"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="!h-7 !w-7 !px-0 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                        onClick={() => {
                          if (confirm("Supprimer cette transaction ?")) {
                            onDelete(t.id);
                          }
                        }}
                        title="Supprimer"
                        aria-label="Supprimer la transaction"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredTotal === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  {totalDb === 0 ? (
                    <EmptyPlaceholder
                      title="Aucune transaction pour l’instant"
                      description="Importez un CSV courtier ou saisissez une opération (achat, vente, dividende…) pour démarrer le journal."
                      action={
                        onImport ? (
                          <Button variant="outline" size="sm" onClick={onImport}>
                            <Upload className="h-3.5 w-3.5" />
                            Importer un CSV
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <EmptyPlaceholder
                      compact
                      title={
                        typeFilter !== "all"
                          ? txTypeFilterEmptyHint(typeFilter)
                          : hasActiveFilters
                            ? "Aucun résultat pour ces filtres"
                            : "Aucun résultat"
                      }
                      description={
                        hasActiveFilters
                          ? "Élargissez la recherche, le type ou l’enveloppe."
                          : undefined
                      }
                    />
                  )}
                </td>
              </tr>
            )}
            {loading && !hasLoadedOnce && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]"
                >
                  Chargement du journal…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasRows ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--muted-foreground)] sm:px-5"
          data-testid="tx-pagination-bottom"
          data-empty="false"
        >
          <span className="tabular-nums">
            {formatRangeLabel(pageIndex, pageSize, filteredTotal)}
            {totalDb > 0 && filteredTotal !== totalDb
              ? ` · ${totalDb} au total`
              : ""}
          </span>
          <span className="tabular-nums">
            {formatPageLabel(pageIndex, pageCount, filteredTotal)}
          </span>
        </div>
      ) : (
        <div
          className="border-t border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--muted-foreground)] sm:px-5"
          data-testid="tx-pagination-bottom"
          data-empty="true"
        >
          <span className="tabular-nums">
            {totalDb === 0
              ? "Ajoutez une transaction ou importez un CSV pour commencer."
              : "—"}
          </span>
        </div>
      )}
    </ModuleCard>
  );
}
