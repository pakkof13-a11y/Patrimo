"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnOrderState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Pencil,
  Trash2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyBadge } from "@/components/ui/currency-badge";
import { PlatformLogo } from "@/components/ui/platform-logo";
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
import {
  formatCurrency,
  formatCurrencyPrecise,
  formatDate,
  formatQuantity,
  cn,
} from "@/app/lib/utils";
import type { TxRow } from "@/app/lib/types/ui";
import {
  formatPageLabel,
  formatRangeLabel,
  shouldShowPaginationNav,
} from "@/app/lib/ui/pagination";
import { EmptyPlaceholder } from "@/components/ui/panel";
import {
  ModuleCard,
  moduleTableHeadClass,
  moduleTableRowClass,
} from "@/components/ui/module-shell";
import {
  loadColumnOrder,
  reorderColumnIds,
  saveColumnOrder,
} from "@/app/lib/display-preferences";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const TX_TABLE_KEY = "transactions";
const TX_DEFAULT_ORDER = [
  "date",
  "type",
  "asset",
  "envelope",
  "platform",
  "blockchain",
  "quantity",
  "currency",
  "netPrice",
  "actions",
] as const;

/** Prix net final (EUR) : |qty × prix| × fx − frais×fx pour trades, sinon |impact|. */
function txNetPriceEur(t: TxRow): number | null {
  const qty = Number(t.quantity);
  const px = Number(t.unitPrice);
  const fees = Math.abs(Number(t.fees) || 0);
  const fx = Number(t.fxRateToEur) || 1;
  if (
    Number.isFinite(qty) &&
    Number.isFinite(px) &&
    Math.abs(qty) > 0 &&
    ["ACHAT", "VENTE", "REWARD", "AIRDROP"].includes(t.type)
  ) {
    const gross = Math.abs(qty * px) * fx;
    return Math.max(0, gross - fees * fx);
  }
  const impact = Number(t.netCashImpactEur);
  if (Number.isFinite(impact)) return Math.abs(impact);
  const gross = Number(t.grossAmountEur);
  if (Number.isFinite(gross)) return Math.abs(gross);
  return null;
}

function loadTxColumnOrder(): string[] {
  try {
    const saved = loadColumnOrder(TX_TABLE_KEY, [...TX_DEFAULT_ORDER]);
    // Filtrer ids inconnus si loadColumnOrder a fusionné des colonnes holdings
    const allowed = new Set<string>(TX_DEFAULT_ORDER);
    const filtered = saved.filter((id) => allowed.has(id));
    for (const id of TX_DEFAULT_ORDER) {
      if (!filtered.includes(id)) filtered.push(id);
    }
    return filtered;
  } catch {
    return [...TX_DEFAULT_ORDER];
  }
}

/**
 * Journal des transactions — source de vérité unique : React Query
 * (`useTransactionsListQuery` → GET /api/transactions paginé).
 * Tri serveur + réordonnancement colonnes (drag) comme Positions.
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
  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ]);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() =>
    loadTxColumnOrder()
  );
  const dragColRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const skipSortRef = useRef(false);

  // Reset page quand filtres / tri / pageSize changent
  const filterKey = `${debouncedSearch}|${accountType}|${pageSize}|${typeFilter}|${sorting[0]?.id}|${sorting[0]?.desc}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    if (pageIndex !== 0) setPageIndex(0);
  }

  useEffect(() => {
    saveColumnOrder(TX_TABLE_KEY, columnOrder);
  }, [columnOrder]);

  const sortBy = sorting[0]?.id || "date";
  const sortDir = sorting[0]?.desc ? "desc" : "asc";

  const listQ = useTransactionsListQuery({
    page: pageIndex + 1,
    pageSize,
    typeGroup: typeFilter,
    accountType: accountType || undefined,
    q: debouncedSearch.trim() || undefined,
    sortBy,
    sortDir,
  });

  const pageRows = listQ.data?.transactions ?? [];
  const filteredTotal = listQ.data?.total ?? 0;
  const totalDb = listQ.data?.totalAll ?? 0;
  const pageCount = Math.max(1, listQ.data?.pageCount ?? 1);
  const typeCounts = listQ.data?.typeCounts ?? {};

  // Clamp pageIndex si hors bornes (données chargées)
  const safePageIndex = Math.min(pageIndex, Math.max(0, pageCount - 1));
  if (safePageIndex !== pageIndex && listQ.data) {
    setPageIndex(safePageIndex);
  }

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

  const columns = useMemo<ColumnDef<TxRow>[]>(
    () => [
      {
        id: "date",
        accessorFn: (r) => r.occurredAt,
        header: "Date",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-[var(--foreground)]">
            {formatDate(row.original.occurredAt)}
          </span>
        ),
      },
      {
        id: "type",
        accessorFn: (r) => r.type,
        header: "Type",
        cell: ({ row }) => {
          const typeLabel =
            TRANSACTION_TYPES[
              row.original.type as keyof typeof TRANSACTION_TYPES
            ] || row.original.type;
          return (
            <span
              className={cn(
                "inline-flex max-w-[9rem] truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                txTypeChipClass(row.original.type)
              )}
              title={typeLabel}
            >
              {typeLabel}
            </span>
          );
        },
      },
      {
        id: "asset",
        accessorFn: (r) => r.asset?.name || "",
        header: "Actif",
        cell: ({ row }) => {
          const a = row.original.asset;
          const name = a?.name || "—";
          return (
            <div className="flex min-w-0 max-w-[16rem] items-center gap-2.5">
              <PlatformLogo
                src={a?.logoUrl || null}
                name={name === "—" ? "?" : name}
                size={28}
              />
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--foreground)]">
                  {name}
                </div>
                {(a?.ticker || a?.isin) && (
                  <div className="mt-0.5 truncate font-mono text-[10px] leading-tight text-slate-500">
                    {[a?.ticker, a?.isin].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          );
        },
      },
      {
        id: "envelope",
        accessorFn: (r) => r.asset?.accountType || "",
        header: "Enveloppe",
        cell: ({ row }) => {
          const env = row.original.asset?.accountType;
          const envLabel = env
            ? ACCOUNT_TYPES[env as keyof typeof ACCOUNT_TYPES] || env
            : "—";
          return (
            <span className="text-xs text-[var(--muted-foreground)]">
              {envLabel}
            </span>
          );
        },
      },
      {
        id: "platform",
        accessorFn: (r) => r.platform?.name || "",
        header: "Plateforme",
        cell: ({ row }) => (
          <span className="max-w-[9rem] truncate text-xs text-[var(--muted-foreground)]">
            {row.original.platform?.name || "—"}
            {row.original.toPlatform ? (
              <span className="opacity-70">
                {" "}
                → {row.original.toPlatform.name}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "blockchain",
        accessorFn: (r) => r.blockchainLabel || r.blockchainKey || "",
        header: "Blockchain",
        cell: ({ row }) => {
          const isCrypto =
            row.original.asset?.accountType === "CRYPTO" ||
            row.original.asset?.assetClass === "CRYPTO";
          if (!isCrypto) {
            return (
              <span className="text-xs text-[var(--muted-foreground)]">—</span>
            );
          }
          const label =
            row.original.blockchainLabel ||
            row.original.blockchainKey ||
            "—";
          return (
            <span
              className="inline-flex max-w-[8rem] truncate rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-950 dark:text-amber-100"
              title={label}
              data-testid="tx-blockchain-badge"
            >
              {label}
            </span>
          );
        },
      },
      {
        id: "quantity",
        accessorFn: (r) => {
          const q = Number(r.quantity);
          return Number.isFinite(q) ? q : null;
        },
        header: "Quantité",
        cell: ({ row }) => {
          const raw = row.original.quantity;
          if (raw == null || raw === "") {
            return (
              <span className="text-xs text-[var(--muted-foreground)]">—</span>
            );
          }
          return (
            <span
              className="font-mono text-xs tabular-nums text-[var(--foreground)]"
              data-testid="tx-quantity"
            >
              {formatQuantity(raw)}
            </span>
          );
        },
      },
      {
        id: "currency",
        accessorFn: (r) => r.currency,
        header: "Devise",
        cell: ({ row }) => <CurrencyBadge code={row.original.currency} />,
      },
      {
        id: "netPrice",
        accessorFn: (r) => txNetPriceEur(r) ?? 0,
        header: "Prix net uniquement",
        cell: ({ row }) => {
          const net = txNetPriceEur(row.original);
          return (
            <span className="font-medium tabular-nums text-[var(--foreground)]">
              {net != null
                ? Math.abs(net) < 0.01
                  ? formatCurrencyPrecise(net, "EUR")
                  : formatCurrency(net, "EUR")
                : "—"}
            </span>
          );
        },
      },
      {
        id: "actions",
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div
            className="inline-flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              className="!h-7 !w-7 !px-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              onClick={() => onEdit(row.original)}
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
                  onDelete(row.original.id);
                }
              }}
              title="Supprimer"
              aria-label="Supprimer la transaction"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [onEdit, onDelete]
  );

  const table = useReactTable({
    data: pageRows,
    columns,
    state: { sorting, columnOrder },
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    getRowId: (r) => r.id,
  });

  const applyColumnDrop = useCallback((targetId: string) => {
    const fromId = dragColRef.current;
    dragColRef.current = null;
    setDraggingCol(null);
    setDragOverCol(null);
    if (!fromId || fromId === targetId || targetId === "actions") return;
    if (fromId === "actions") return;
    setColumnOrder((prev) => reorderColumnIds(prev, fromId, targetId));
    skipSortRef.current = true;
  }, []);

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
      <div className="flex min-w-0 flex-col gap-3.5 border-b border-[var(--border)] px-4 py-4 sm:gap-4 sm:px-5 sm:py-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold leading-snug tracking-tight text-[var(--foreground)]">
              Journal des transactions
            </h2>
            <p className="module-intro text-meta">
              Source de vérité pour positions, cash et fiscalité — édition,
              filtres et import
            </p>
            <p
              className="kpi-value mt-2 text-sm text-[var(--primary)]"
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
            "flex w-full min-w-0 flex-col gap-2",
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
        <table
          className="table-fluid text-sm"
          data-testid="transactions-table"
        >
          <thead className={moduleTableHeadClass}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const colId = h.column.id;
                  const canSort = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  const isActions = colId === "actions";
                  return (
                    <th
                      key={h.id}
                      className={cn(
                        "px-3 py-2.5 sm:px-4",
                        colId === "date" && "col-sticky-first text-left",
                        colId === "asset" && "col-wide text-left",
                        colId === "envelope" && "col-hide-sm text-left",
                        colId === "platform" && "col-hide-md text-left",
                        colId === "currency" && "col-hide-sm col-tight text-left",
                        colId === "netPrice" && "text-right",
                        colId === "actions" && "col-actions text-right",
                        colId === "type" && "text-left",
                        dragOverCol === colId &&
                          "bg-[var(--primary-soft)]/40 ring-1 ring-inset ring-[var(--primary)]/30",
                        draggingCol === colId && "opacity-60"
                      )}
                      draggable={!isActions}
                      onDragStart={(e) => {
                        if (isActions) return;
                        dragColRef.current = colId;
                        setDraggingCol(colId);
                        e.dataTransfer.effectAllowed = "move";
                        try {
                          e.dataTransfer.setData("text/plain", colId);
                        } catch {
                          /* ignore */
                        }
                      }}
                      onDragOver={(e) => {
                        if (isActions) return;
                        e.preventDefault();
                        setDragOverCol(colId);
                      }}
                      onDragLeave={() => {
                        setDragOverCol((c) => (c === colId ? null : c));
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        applyColumnDrop(colId);
                      }}
                      onDragEnd={() => {
                        dragColRef.current = null;
                        setDraggingCol(null);
                        setDragOverCol(null);
                      }}
                    >
                      <div
                        className={cn(
                          "flex items-center gap-1",
                          colId === "netPrice" || isActions
                            ? "justify-end"
                            : "justify-start"
                        )}
                      >
                        {!isActions && (
                          <GripVertical
                            className="h-3 w-3 shrink-0 cursor-grab text-[var(--muted-foreground)] opacity-50"
                            aria-hidden
                          />
                        )}
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wide",
                            canSort &&
                              "cursor-pointer hover:text-[var(--foreground)]",
                            !canSort && "cursor-default"
                          )}
                          disabled={!canSort}
                          onClick={() => {
                            if (skipSortRef.current) {
                              skipSortRef.current = false;
                              return;
                            }
                            if (!canSort) return;
                            h.column.toggleSorting(
                              sorted === "asc" ? true : false
                            );
                          }}
                        >
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext()
                          )}
                          {sorted === "asc" && (
                            <span className="text-[var(--primary)]">↑</span>
                          )}
                          {sorted === "desc" && (
                            <span className="text-[var(--primary)]">↓</span>
                          )}
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  moduleTableRowClass,
                  "cursor-pointer"
                )}
                title="Double-clic pour modifier"
                onDoubleClick={() => onEdit(row.original)}
                data-testid={`tx-row-${row.original.id}`}
              >
                {row.getVisibleCells().map((cell) => {
                  const colId = cell.column.id;
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 py-2 sm:px-4",
                        colId === "date" && "col-sticky-first",
                        colId === "asset" && "col-wide min-w-0",
                        colId === "envelope" && "col-hide-sm",
                        colId === "platform" && "col-hide-md max-w-[9rem]",
                        colId === "currency" && "col-hide-sm col-tight",
                        colId === "netPrice" && "text-right",
                        colId === "actions" && "col-actions text-right"
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredTotal === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  {totalDb === 0 ? (
                    <EmptyPlaceholder
                      title="Aucune transaction pour l’instant"
                      description="Importez un CSV courtier ou saisissez une opération (achat, vente, dividende…) pour démarrer le journal."
                      action={
                        onImport ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={onImport}
                          >
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
                <td colSpan={8} className="p-0">
                  <div
                    className="divide-y divide-[var(--border)]"
                    data-testid="tx-loading-skeleton"
                    aria-busy="true"
                  >
                    {Array.from({ length: 8 }).map((_, r) => (
                      <div
                        key={r}
                        className="flex items-center gap-3 px-3 py-2.5 sm:px-4"
                      >
                        <div className="h-3 w-20 animate-pulse rounded bg-[var(--muted)]" />
                        <div className="h-5 w-16 animate-pulse rounded-md bg-[var(--muted)]" />
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[var(--muted)]" />
                          <div className="h-3 w-28 animate-pulse rounded bg-[var(--muted)]" />
                        </div>
                        <div className="hidden h-3 w-16 animate-pulse rounded bg-[var(--muted)] sm:block" />
                        <div className="ml-auto h-3 w-16 animate-pulse rounded bg-[var(--muted)]" />
                      </div>
                    ))}
                  </div>
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
