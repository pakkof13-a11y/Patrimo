"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type Row,
  type SortingState,
  type PaginationState,
  type VisibilityState,
  type ColumnOrderState,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, GripVertical, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyBadge } from "@/components/ui/currency-badge";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { ColumnPicker } from "@/components/ui/column-picker";
import { EnvelopeCashPanel } from "@/components/tabs/envelope-cash-panel";
import { LifeInsuranceTab } from "@/components/tabs/life-insurance-tab";
import { HoldingRecentTxs } from "@/components/holdings/holding-recent-txs";
import { PositionCategoryGroupHeader } from "@/components/holdings/position-category-group-header";
import { EditAssetCategoryModal } from "@/components/holdings/edit-asset-category-modal";
import { PageJump } from "@/components/ui/page-jump";
import {
  ACCOUNT_TYPES,
  ASSET_CLASS_COLORS,
  type AccountType,
  type AssetClass,
} from "@/app/lib/constants";
import {
  formatCurrency,
  formatPercent,
  getAssetClassLabel,
  getChangeColor,
  cn,
} from "@/app/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { type Holding, type MainTab } from "@/app/lib/types/ui";
import {
  HOLDINGS_GROUP_BY_KEY,
  HOLDINGS_GROUP_COLLAPSED_KEY,
  loadSavedViews,
  loadUiPref,
  saveSavedViews,
  saveUiPref,
  type SavedHoldingsView,
} from "@/app/lib/ui-preferences";
import {
  groupPositionsByAssetCategory,
  parseAssetCategory,
  parseHoldingsGroupBy,
  type HoldingsGroupBy,
} from "@/app/lib/assets/categories";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSizeOption = 20;
import {
  COLUMN_RESIZE_MAX,
  COLUMN_RESIZE_MIN,
  HOLDINGS_COLUMN_META,
  resetHoldingsColumns,
  defaultColumnOrder,
  defaultColumnSizing,
  defaultHoldingsVisibility,
  loadColumnOrder,
  loadColumnSizing,
  loadColumnVisibility,
  compareAssetNames,
  columnMinWidth,
  computeFlexColumnLayout,
  measureColumnAutosize,
  reorderColumnIds,
  saveColumnOrder,
  saveColumnSizing,
  saveColumnVisibility,
} from "@/app/lib/display-preferences";
import { useDisplay } from "@/components/layout/display-provider";
import { TableFilters, matchesSearchQuery } from "@/components/ui/table-filters";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";

const TABLE_KEY = "holdings";
/** Fixed first column for expand/collapse (must be added to table total width). */
const EXPAND_COL_PX = 44;
/** Fixed trailing actions column (⋯ menu). */
const ACTIONS_COL_PX = 44;

/** Label + control : stack mobile, ligne compacte dès sm */
const CTRL_LABEL =
  "flex w-full min-w-0 flex-col gap-1 text-xs text-slate-600 dark:text-slate-300 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:whitespace-nowrap";
const CTRL_SELECT =
  "input !w-full min-w-0 max-w-full !py-1.5 text-sm sm:!w-auto";

function formatRelativeUpdate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d0 = new Date(iso);
    if (Number.isNaN(d0.getTime())) return "—";
    return formatDistanceToNow(d0, { addSuffix: true, locale: fr });
  } catch {
    return "—";
  }
}

type TriggerField = "stopLoss" | "tp1" | "tp2" | "tp3" | "tp4";

function TriggerLevelInput({
  assetId,
  field,
  value,
  onCommit,
}: {
  assetId: string;
  field: TriggerField;
  value: string | null | undefined;
  onCommit: (assetId: string, field: TriggerField, value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value, assetId, field]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className="input !w-full min-w-[4.5rem] !px-1.5 !py-1 text-right text-xs tabular-nums"
      placeholder="—"
      value={draft}
      title="Seuil en devise native · vide = désactivé · exécution auto au refresh des prix"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim().replace(",", ".");
        const prev = (value ?? "").trim();
        if (next === prev) return;
        if (next === "" || next === "—") {
          onCommit(assetId, field, null);
          return;
        }
        const n = Number(next);
        if (!Number.isFinite(n) || n < 0) {
          setDraft(value ?? "");
          return;
        }
        onCommit(assetId, field, next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function HoldingsSection({
  tab,
  holdings,
  loading,
  baseCurrency,
  envelopeFilter,
  onAccountTypeChange,
  onTriggerLevelChange,
  onRowDoubleClick,
  onEnvelopeChange,
  onOpenTransactionForAsset,
  onCategoryChange,
}: {
  tab: MainTab;
  holdings: Holding[];
  loading: boolean;
  baseCurrency: string;
  envelopeFilter: AccountType | null;
  onAccountTypeChange: (assetId: string, accountType: string) => void;
  onTriggerLevelChange?: (
    assetId: string,
    field: TriggerField,
    value: string | null
  ) => void;
  onRowDoubleClick: (assetId: string) => void;
  /** Select enveloppe → parent met à jour l'URL */
  onEnvelopeChange?: (accountType: AccountType | null) => void;
  /** Menu contextuel ligne : type tx + holding */
  onOpenTransactionForAsset?: (
    type: string,
    holding: Holding
  ) => void;
  /** Après changement de sous-catégorie (rechargement holdings) */
  onCategoryChange?: (assetId: string, category: string) => void;
}) {
  const { layoutWidth } = useDisplay();
  const router = useRouter();
  const pathname = usePathname() || "/positions";
  const searchParams = useSearchParams();
  const [savedViews, setSavedViews] = useState<SavedHoldingsView[]>([]);
  useEffect(() => {
    setSavedViews(loadSavedViews());
  }, []);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "marketValueBase", desc: true },
  ]);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [accountFilter, setAccountFilter] = useState("");
  /** Asset ids with expanded recent-transactions panel */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // ── Regroupement par sous-catégorie ──────────────────────────────────────
  const [groupBy, setGroupByState] = useState<HoldingsGroupBy>("none");
  const [groupPrefsReady, setGroupPrefsReady] = useState(false);
  /** envelopeKey → category → collapsed */
  const [collapsedByEnvelope, setCollapsedByEnvelope] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [categoryOverrides, setCategoryOverrides] = useState<
    Record<string, string>
  >({});
  const [editCategoryHolding, setEditCategoryHolding] =
    useState<Holding | null>(null);

  const envelopeKey = envelopeFilter || "ALL";

  useEffect(() => {
    const fromUrl = searchParams.get("groupBy");
    if (fromUrl != null) {
      setGroupByState(parseHoldingsGroupBy(fromUrl));
    } else {
      setGroupByState(
        parseHoldingsGroupBy(loadUiPref(HOLDINGS_GROUP_BY_KEY, "none"))
      );
    }
    setCollapsedByEnvelope(
      loadUiPref<Record<string, Record<string, boolean>>>(
        HOLDINGS_GROUP_COLLAPSED_KEY,
        {}
      )
    );
    setGroupPrefsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from URL/prefs
  }, []);

  const setGroupBy = useCallback(
    (next: HoldingsGroupBy) => {
      setGroupByState(next);
      saveUiPref(HOLDINGS_GROUP_BY_KEY, next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === "none") params.delete("groupBy");
      else params.set("groupBy", "assetCategory");
      const q = params.toString();
      const target = q ? `${pathname}?${q}` : pathname;
      router.replace(target, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!groupPrefsReady) return;
    saveUiPref(HOLDINGS_GROUP_COLLAPSED_KEY, collapsedByEnvelope);
  }, [collapsedByEnvelope, groupPrefsReady]);

  const isGroupCollapsed = useCallback(
    (category: string) => {
      // Recherche active → forcer ouvert pour ne pas cacher des résultats
      if (debouncedSearch.trim()) return false;
      return Boolean(collapsedByEnvelope[envelopeKey]?.[category]);
    },
    [collapsedByEnvelope, envelopeKey, debouncedSearch]
  );

  const toggleGroupCollapsed = useCallback(
    (category: string) => {
      setCollapsedByEnvelope((prev) => {
        const env = { ...(prev[envelopeKey] || {}) };
        env[category] = !env[category];
        return { ...prev, [envelopeKey]: env };
      });
    },
    [envelopeKey]
  );

  const expandAllGroups = useCallback(() => {
    setCollapsedByEnvelope((prev) => ({ ...prev, [envelopeKey]: {} }));
  }, [envelopeKey]);

  const collapseAllGroups = useCallback(
    (categories: string[]) => {
      const all: Record<string, boolean> = {};
      for (const c of categories) all[c] = true;
      setCollapsedByEnvelope((prev) => ({ ...prev, [envelopeKey]: all }));
    },
    [envelopeKey]
  );

  function toggleExpanded(assetId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    defaultHoldingsVisibility("fluid")
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() =>
    defaultColumnOrder()
  );
  /**
   * Largeurs *verrouillées* (resize manuel / double-clic autosize).
   * Les colonnes absentes de ce map s’étirent (flex-fill) pour remplir le conteneur.
   */
  const [lockedSizing, setLockedSizing] = useState<Record<string, number>>(() =>
    defaultColumnSizing()
  );
  /** Largeurs affichées (locks + flex) — alimente TanStack getSize / resize */
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [tableWidthPx, setTableWidthPx] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [prefsReady, setPrefsReady] = useState(false);
  const tableRootRef = useRef<HTMLTableElement | null>(null);
  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const dragColRef = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  /** Skip sort click when a drag just ended */
  const skipSortRef = useRef(false);

  // Load saved column prefs (visibility + order + locked widths)
  useEffect(() => {
    const fallback = defaultHoldingsVisibility(layoutWidth);
    setColumnVisibility(loadColumnVisibility(TABLE_KEY, fallback));
    setColumnOrder(loadColumnOrder(TABLE_KEY));
    setLockedSizing(loadColumnSizing(TABLE_KEY));
    setPrefsReady(true);
  }, [layoutWidth]);

  useEffect(() => {
    if (!prefsReady) return;
    saveColumnVisibility(TABLE_KEY, columnVisibility as Record<string, boolean>);
  }, [columnVisibility, prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    saveColumnOrder(TABLE_KEY, columnOrder);
  }, [columnOrder, prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    saveColumnSizing(TABLE_KEY, lockedSizing);
  }, [lockedSizing, prefsReady]);

  // Observe scroll container width for flex-fill layout
  useLayoutEffect(() => {
    const el = scrollWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      if (el) setContainerWidth(el.clientWidth);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w != null && Number.isFinite(w)) {
        setContainerWidth(Math.max(0, Math.floor(w)));
      }
    });
    ro.observe(el);
    setContainerWidth(Math.max(0, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [
    tab,
    envelopeFilter,
    holdings.length,
    debouncedSearch,
    accountFilter,
    groupBy,
  ]);

  const holdingsWithCategory = useMemo(() => {
    return holdings.map((h) => ({
      ...h,
      category:
        categoryOverrides[h.assetId] ??
        h.category ??
        "UNCLASSIFIED",
    }));
  }, [holdings, categoryOverrides]);

  const filteredHoldings = useMemo(() => {
    return holdingsWithCategory.filter((h) => {
      if (accountFilter && (h.accountType || "CTO") !== accountFilter) return false;
      return matchesSearchQuery(debouncedSearch, [
        h.name,
        h.ticker,
        h.isin,
        h.platformName,
        h.assetClass,
        h.category,
      ]);
    });
  }, [holdingsWithCategory, debouncedSearch, accountFilter]);

  const groupMode = groupBy === "assetCategory";

  const columns = useMemo<ColumnDef<Holding>[]>(
    () => [
      {
        accessorKey: "name",
        id: "name",
        header: "Actif",
        sortingFn: (rowA, rowB, columnId) => {
          const a = String(rowA.getValue(columnId) ?? rowA.original.name ?? "");
          const b = String(rowB.getValue(columnId) ?? rowB.original.name ?? "");
          return compareAssetNames(a, b);
        },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <PlatformLogo
              src={row.original.assetLogoUrl || row.original.logoUrl}
              name={row.original.name}
              size={28}
            />
            <div>
              <div className="font-medium">{row.original.name}</div>
              {row.original.isin && (
                <div className="font-mono text-[10px] text-slate-500">{row.original.isin}</div>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "ticker",
        id: "ticker",
        header: "Ticker",
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
            {row.original.ticker || "—"}
          </span>
        ),
      },
      {
        accessorKey: "accountType",
        id: "accountType",
        header: "Type de compte",
        cell: ({ row }) => (
          <select
            className="input !w-auto !py-1 text-xs"
            value={row.original.accountType || "CTO"}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              onAccountTypeChange(row.original.assetId, e.target.value);
            }}
          >
            {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_TYPES[k]}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "platformName",
        id: "platformName",
        header: "Plateforme",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <PlatformLogo
              src={row.original.platformLogoUrl}
              name={row.original.platformName}
              size={22}
            />
            <span className="text-sm">{row.original.platformName}</span>
          </div>
        ),
      },
      {
        accessorKey: "currency",
        id: "currency",
        header: "Devise",
        cell: ({ getValue }) => <CurrencyBadge code={getValue<string>()} />,
      },
      {
        accessorKey: "assetClass",
        id: "assetClass",
        header: "Classe",
        cell: ({ getValue }) => {
          const v = getValue<string>() as AssetClass;
          return (
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                ASSET_CLASS_COLORS[v] ||
                  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              )}
            >
              {getAssetClassLabel(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "quantity",
        id: "quantity",
        header: "Quantité",
        cell: ({ getValue }) => (
          <span className="font-semibold tabular-nums text-base">
            {Number(getValue<string>()).toLocaleString("fr-FR", {
              maximumFractionDigits: 8,
            })}
          </span>
        ),
      },
      {
        accessorKey: "avgCostEur",
        id: "avgCostEur",
        header: "PRU",
        cell: ({ getValue }) => (
          <span className="tabular-nums" title="Prix de revient unitaire (frais inclus)">
            {formatCurrency(getValue<string>(), "EUR")}
          </span>
        ),
      },
      {
        accessorKey: "currentPriceNative",
        id: "currentPriceNative",
        header: "Cours actuel",
        cell: ({ row }) => (
          <div>
            <div className="tabular-nums">
              {formatCurrency(row.original.currentPriceNative, row.original.currency)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              {row.original.priceSource || "n/a"}
              {row.original.priceStatus === "STALE" && (
                <span className="ml-1 text-amber-500">· périmé</span>
              )}
              {row.original.priceStatus === "OK" &&
                row.original.priceSource &&
                row.original.priceSource !== "seed" &&
                row.original.priceSource !== "coût" && (
                  <span className="ml-1 text-emerald-500">· live</span>
                )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "marketValueBase",
        id: "marketValueBase",
        header: `Valeur totale (${baseCurrency})`,
        cell: ({ row }) => (
          <div>
            <span className="font-medium tabular-nums">
              {formatCurrency(
                row.original.marketValueBase || row.original.marketValueEur,
                baseCurrency
              )}
            </span>
            <div className="text-[10px] text-slate-400">qté × cours</div>
          </div>
        ),
      },
      {
        accessorKey: "unrealizedPnlBase",
        id: "unrealizedPnlBase",
        header: "P&L latent (€)",
        cell: ({ row }) => (
          <span className={cn("tabular-nums font-medium", getChangeColor(row.original.unrealizedPnlBase))}>
            {formatCurrency(
              row.original.unrealizedPnlBase || row.original.unrealizedPnlEur,
              baseCurrency
            )}
          </span>
        ),
      },
      {
        accessorKey: "unrealizedPnlPct",
        id: "unrealizedPnlPct",
        header: "P&L latent (%)",
        cell: ({ row }) => (
          <span className={cn("tabular-nums", getChangeColor(row.original.unrealizedPnlPct))}>
            {formatPercent(row.original.unrealizedPnlPct)}
          </span>
        ),
      },
      {
        accessorKey: "allocationPctOfClass",
        id: "allocationPctOfClass",
        header: "Allocation (%)",
        cell: ({ row }) => (
          <div className="tabular-nums">
            <span className="font-medium">
              {Number(row.original.allocationPctOfClass || 0).toLocaleString("fr-FR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              %
            </span>
            <div className="text-[10px] text-zinc-400">
              de la classe {getAssetClassLabel(row.original.assetClass)}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "allocationPct",
        id: "allocationPct",
        header: "Alloc. portefeuille",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {Number(row.original.allocationPct || 0).toLocaleString("fr-FR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            %
          </span>
        ),
      },
      {
        accessorKey: "acquisitionFeesBase",
        id: "acquisitionFeesBase",
        header: "Frais de transaction",
        cell: ({ row }) => (
          <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
            {formatCurrency(
              row.original.acquisitionFeesBase || row.original.acquisitionFeesEur || "0",
              baseCurrency
            )}
          </span>
        ),
      },
      {
        accessorKey: "lastUpdatedAt",
        id: "lastUpdatedAt",
        header: "Dernière mise à jour",
        cell: ({ row }) => {
          const rel = formatRelativeUpdate(row.original.lastUpdatedAt);
          const stale = row.original.priceStatus === "STALE";
          return (
            <div className="text-xs">
              <span className={cn("tabular-nums", stale ? "text-amber-600" : "text-zinc-500")}>
                {rel}
              </span>
              {stale && <div className="text-[10px] text-amber-500">prix périmé</div>}
            </div>
          );
        },
      },
      {
        accessorKey: "passiveIncomeBase",
        id: "passiveIncomeBase",
        header: "Dividendes / Rendement",
        cell: ({ row }) => {
          const v = Number(row.original.passiveIncomeBase || row.original.passiveIncomeEur || 0);
          return (
            <span
              className={cn(
                "tabular-nums",
                v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"
              )}
            >
              {formatCurrency(
                row.original.passiveIncomeBase || row.original.passiveIncomeEur || "0",
                baseCurrency
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "breakEvenBase",
        id: "breakEvenBase",
        header: "Break-even",
        cell: ({ row }) => (
          <div className="tabular-nums" title="Seuil de rentabilité = PRU frais inclus">
            {formatCurrency(
              row.original.breakEvenBase || row.original.breakEvenEur || row.original.avgCostEur,
              baseCurrency
            )}
            <div className="text-[10px] text-zinc-400">seuil de revente</div>
          </div>
        ),
      },
      {
        accessorKey: "costBasisEur",
        id: "costBasisEur",
        header: "Capital investi",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(
              row.original.costBasisBase || row.original.costBasisEur,
              baseCurrency
            )}
          </span>
        ),
      },
      {
        id: "stopLoss",
        accessorKey: "stopLoss",
        header: "Stop Loss",
        enableSorting: false,
        cell: ({ row }) =>
          onTriggerLevelChange ? (
            <TriggerLevelInput
              assetId={row.original.assetId}
              field="stopLoss"
              value={row.original.stopLoss}
              onCommit={onTriggerLevelChange}
            />
          ) : (
            <span className="tabular-nums text-xs text-zinc-500">
              {row.original.stopLoss || "—"}
            </span>
          ),
      },
      {
        id: "tp1",
        accessorKey: "tp1",
        header: "TP1",
        enableSorting: false,
        cell: ({ row }) =>
          onTriggerLevelChange ? (
            <TriggerLevelInput
              assetId={row.original.assetId}
              field="tp1"
              value={row.original.tp1}
              onCommit={onTriggerLevelChange}
            />
          ) : (
            <span className="tabular-nums text-xs text-zinc-500">
              {row.original.tp1 || "—"}
            </span>
          ),
      },
      {
        id: "tp2",
        accessorKey: "tp2",
        header: "TP2",
        enableSorting: false,
        cell: ({ row }) =>
          onTriggerLevelChange ? (
            <TriggerLevelInput
              assetId={row.original.assetId}
              field="tp2"
              value={row.original.tp2}
              onCommit={onTriggerLevelChange}
            />
          ) : (
            <span className="tabular-nums text-xs text-zinc-500">
              {row.original.tp2 || "—"}
            </span>
          ),
      },
      {
        id: "tp3",
        accessorKey: "tp3",
        header: "TP3",
        enableSorting: false,
        cell: ({ row }) =>
          onTriggerLevelChange ? (
            <TriggerLevelInput
              assetId={row.original.assetId}
              field="tp3"
              value={row.original.tp3}
              onCommit={onTriggerLevelChange}
            />
          ) : (
            <span className="tabular-nums text-xs text-zinc-500">
              {row.original.tp3 || "—"}
            </span>
          ),
      },
      {
        id: "tp4",
        accessorKey: "tp4",
        header: "TP4",
        enableSorting: false,
        cell: ({ row }) =>
          onTriggerLevelChange ? (
            <TriggerLevelInput
              assetId={row.original.assetId}
              field="tp4"
              value={row.original.tp4}
              onCommit={onTriggerLevelChange}
            />
          ) : (
            <span className="tabular-nums text-xs text-zinc-500">
              {row.original.tp4 || "—"}
            </span>
          ),
      },
    ],
    [baseCurrency, onAccountTypeChange, onTriggerLevelChange]
  );

  const table = useReactTable({
    data: filteredHoldings,
    columns,
    defaultColumn: {
      minSize: COLUMN_RESIZE_MIN,
      maxSize: COLUMN_RESIZE_MAX,
      enableResizing: true,
      size: 120,
    },
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    state: {
      sorting,
      pagination,
      columnVisibility,
      columnOrder,
      columnSizing,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: (updater) => {
      setColumnSizing((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        const clamped: ColumnSizingState = { ...prev };
        const newlyLocked: Record<string, number> = {};
        for (const [id, raw] of Object.entries(next)) {
          const n = Number(raw);
          if (!Number.isFinite(n)) continue;
          const floor = columnMinWidth(id);
          const size = Math.min(
            COLUMN_RESIZE_MAX,
            Math.max(floor, Math.round(n))
          );
          clamped[id] = size;
          // Toute modification via drag = verrouillage de cette colonne
          if (prev[id] !== size) {
            newlyLocked[id] = size;
          }
        }
        if (Object.keys(newlyLocked).length > 0) {
          setLockedSizing((ls) => ({ ...ls, ...newlyLocked }));
        }
        return clamped;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Mode regroupement : page unique = toutes les lignes triées (totaux de groupe = périmètre filtré)
  useEffect(() => {
    if (!groupMode) return;
    setPagination({
      pageIndex: 0,
      pageSize: Math.max(filteredHoldings.length, 1),
    });
  }, [groupMode, filteredHoldings.length]);

  /** Lignes triées (pré-pagination) pour regroupement — order = tri tableau */
  const sortedAllRows = table.getPrePaginationRowModel().rows;
  const categoryGroups = groupMode
    ? groupPositionsByAssetCategory(sortedAllRows.map((r) => r.original))
    : [];
  const rowByAssetId = useMemo(() => {
    const m = new Map<string, Row<Holding>>();
    for (const r of sortedAllRows) m.set(r.original.assetId, r);
    return m;
     
  }, [sortedAllRows]);

  const positionsTitle = envelopeFilter
    ? `Positions — ${ACCOUNT_TYPES[envelopeFilter]}`
    : "Positions (toutes les enveloppes)";

  /** +1 expand · +1 actions (menu ⋯) */
  const visibleLeafIds = table.getVisibleLeafColumns().map((c) => c.id);
  const visibleColCount = visibleLeafIds.length + 2;
  const isResizingColumn = table.getState().columnSizingInfo.isResizingColumn;

  useEffect(() => {
    if (isResizingColumn) {
      document.body.classList.add("col-resizing");
    } else {
      document.body.classList.remove("col-resizing");
    }
    return () => document.body.classList.remove("col-resizing");
  }, [isResizingColumn]);

  /**
   * Auto-fit : les colonnes non verrouillées se partagent l’espace restant.
   * Pause pendant un drag de resize (évite de combattre le gestuel TanStack).
   */
  useLayoutEffect(() => {
    if (isResizingColumn) return;
    if (containerWidth <= 0) return;
    if (visibleLeafIds.length === 0) return;

    const { sizes, tableWidth } = computeFlexColumnLayout({
      containerWidth,
      expandPx: EXPAND_COL_PX + ACTIONS_COL_PX,
      columnIds: visibleLeafIds,
      locked: lockedSizing,
      minWidthOf: columnMinWidth,
    });

    setColumnSizing((prev) => {
      let changed = false;
      for (const id of visibleLeafIds) {
        if (prev[id] !== sizes[id]) {
          changed = true;
          break;
        }
      }
      if (!changed && Object.keys(prev).length === visibleLeafIds.length) {
        return prev;
      }
      return sizes;
    });
    setTableWidthPx(tableWidth);
  }, [
    containerWidth,
    lockedSizing,
    isResizingColumn,
    // string key avoids identity thrash on the id array
    visibleLeafIds.join("|"),
  ]);

  function applyColumnDrop(targetId: string) {
    const fromId = dragColRef.current;
    dragColRef.current = null;
    setDraggingCol(null);
    setDragOverCol(null);
    if (!fromId || fromId === targetId) return;
    setColumnOrder((prev) => reorderColumnIds(prev, fromId, targetId));
    skipSortRef.current = true;
  }

  return (
    <section className="space-y-0">
      {tab === "cto" && <EnvelopeCashPanel envelope="CTO" />}
      {tab === "pea" && <EnvelopeCashPanel envelope="PEA" lockCurrencyToEur />}
      {tab === "av" && (
        <>
          <EnvelopeCashPanel envelope="AV" />
          <div className="mb-4">
            <LifeInsuranceTab />
          </div>
        </>
      )}
      <div className="card min-w-0 overflow-hidden">
        {/* En-tête Positions : titre + barre de contrôles fluide (wrap, pas de débordement) */}
        <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--border)] px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug break-words">
              {positionsTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {envelopeFilter
                ? `Filtre Type de compte = ${ACCOUNT_TYPES[envelopeFilter]} · ${holdings.length} ligne(s)`
                : "CUMP · type de compte · logos · prix auto 10s"}
            </p>
          </div>

          {/*
            Toolbar structurée (groupes logiques) :
            - Mobile  : colonne verticale (flex-col)
            - md      : grille 2 cols (A | B, C pleine largeur aligné droite)
            - lg+     : une ligne (A · B · C) justify-between
          */}
          <div
            className={cn(
              "min-w-0 w-full gap-3",
              "flex flex-col",
              "md:grid md:grid-cols-2 md:items-start md:gap-4",
              "lg:flex lg:flex-row lg:items-center lg:justify-between lg:gap-4"
            )}
            data-testid="holdings-toolbar"
          >
            {/* Groupe A — Paramètres de table */}
            <div
              className={cn(
                "flex min-w-0 w-full flex-col gap-2",
                "sm:flex-row sm:flex-wrap sm:items-center sm:gap-3",
                "md:col-start-1 md:row-start-1",
                "lg:w-auto lg:min-w-0 lg:flex-1 lg:basis-0"
              )}
              data-testid="holdings-toolbar-group-a"
            >
              <label className={CTRL_LABEL}>
                <span className="shrink-0 font-medium">Positions par page</span>
                <select
                  className={cn(CTRL_SELECT, "font-semibold tabular-nums sm:!min-w-[4.25rem]")}
                  value={pagination.pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value) as PageSizeOption;
                    setPagination({
                      pageIndex: 0,
                      pageSize: next,
                    });
                  }}
                  data-testid="holdings-page-size"
                  aria-label="Nombre de lignes par page"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {onEnvelopeChange && (
                <label className={CTRL_LABEL}>
                  <span className="shrink-0 font-medium">Enveloppe :</span>
                  <select
                    className={cn(CTRL_SELECT, "sm:min-w-[10rem]")}
                    value={envelopeFilter ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      onEnvelopeChange(v ? (v as AccountType) : null);
                    }}
                    data-testid="envelope-select"
                    aria-label="Filtrer par enveloppe"
                  >
                    <option value="">Toutes les enveloppes</option>
                    {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => (
                      <option key={k} value={k}>
                        {ACCOUNT_TYPES[k]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={CTRL_LABEL}>
                <span className="shrink-0 font-medium">Regrouper par :</span>
                <select
                  className={cn(CTRL_SELECT, "sm:min-w-[11rem]")}
                  value={groupBy}
                  onChange={(e) =>
                    setGroupBy(parseHoldingsGroupBy(e.target.value))
                  }
                  data-testid="holdings-group-by"
                  aria-label="Regrouper les positions"
                >
                  <option value="none">Aucun</option>
                  <option value="assetCategory">
                    Sous-catégorie d&apos;actif
                  </option>
                </select>
              </label>
              {groupMode && categoryGroups.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-[11px]"
                    onClick={expandAllGroups}
                    data-testid="holdings-expand-all-groups"
                  >
                    Tout déplier
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-[11px]"
                    onClick={() =>
                      collapseAllGroups(categoryGroups.map((g) => g.category))
                    }
                    data-testid="holdings-collapse-all-groups"
                  >
                    Tout replier
                  </Button>
                </div>
              )}
            </div>

            {/* Groupe B — Vue, comptes, recherche */}
            <div
              className={cn(
                "flex min-w-0 w-full flex-col gap-2",
                "sm:flex-row sm:flex-wrap sm:items-center sm:gap-3",
                "md:col-start-2 md:row-start-1",
                "lg:w-auto lg:min-w-0 lg:flex-1 lg:basis-0 lg:justify-center"
              )}
              data-testid="holdings-toolbar-group-b"
            >
              <label className={CTRL_LABEL}>
                <span className="shrink-0 font-medium">Vue</span>
                <select
                  className={cn(CTRL_SELECT, "sm:min-w-[8rem]")}
                  defaultValue=""
                  aria-label="Vues enregistrées"
                  data-testid="holdings-saved-views"
                  onChange={(e) => {
                    const id = e.target.value;
                    e.target.value = "";
                    if (id === "__save__") {
                      const name = window.prompt("Nom de la vue :");
                      if (!name?.trim()) return;
                      const view: SavedHoldingsView = {
                        id: `v-${Date.now()}`,
                        name: name.trim(),
                        envelope: envelopeFilter || "",
                        accountType: accountFilter || "",
                        search: searchInput,
                        visibility: columnVisibility as Record<string, boolean>,
                        pageSize: pagination.pageSize,
                        createdAt: new Date().toISOString(),
                      };
                      const next = [...savedViews, view];
                      setSavedViews(next);
                      saveSavedViews(next);
                      return;
                    }
                    const view = savedViews.find((v) => v.id === id);
                    if (!view) return;
                    setSearchInput(view.search);
                    setAccountFilter(view.accountType);
                    if (view.pageSize) {
                      setPagination((prev) => ({
                        ...prev,
                        pageIndex: 0,
                        pageSize: view.pageSize!,
                      }));
                    }
                    if (view.visibility) {
                      setColumnVisibility(view.visibility as VisibilityState);
                    }
                    if (onEnvelopeChange) {
                      onEnvelopeChange(
                        view.envelope ? (view.envelope as AccountType) : null
                      );
                    }
                  }}
                >
                  <option value="">Vues…</option>
                  <option value="__save__">+ Enregistrer la vue actuelle</option>
                  {savedViews.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <TableFilters
                className="min-w-0 w-full sm:w-auto sm:flex-1"
                search={searchInput}
                onSearchChange={setSearchInput}
                accountType={accountFilter}
                onAccountTypeChange={setAccountFilter}
                showAccountFilter={!envelopeFilter}
                placeholder="Nom, ticker, ISIN…"
              />
            </div>

            {/* Groupe C — Actions (Colonnes) */}
            <div
              className={cn(
                "flex w-full shrink-0 items-center",
                "md:col-span-2 md:row-start-2 md:justify-end",
                "lg:col-auto lg:w-auto lg:justify-end lg:self-center"
              )}
              data-testid="holdings-toolbar-group-c"
            >
              <ColumnPicker
                columns={HOLDINGS_COLUMN_META.map((c) => ({
                  id: c.id,
                  label: c.label,
                  locked: c.group === "mandatory" || Boolean(c.locked),
                  group: c.group,
                }))}
                visibility={columnVisibility as Record<string, boolean>}
                order={columnOrder}
                onChange={(id, visible) => {
                  const meta = HOLDINGS_COLUMN_META.find((c) => c.id === id);
                  // Mandatory columns cannot be unchecked
                  if (meta?.group === "mandatory" || meta?.locked) {
                    setColumnVisibility((prev) => ({ ...prev, [id]: true }));
                    return;
                  }
                  setColumnVisibility((prev) => ({ ...prev, [id]: visible }));
                }}
                onOrderChange={(next) => setColumnOrder(next)}
                onReset={() => {
                  const reset = resetHoldingsColumns();
                  setColumnVisibility(reset.visibility);
                  setColumnOrder(reset.order);
                  setLockedSizing(reset.sizing);
                  setColumnSizing({});
                }}
              />
            </div>
          </div>
        </div>
        <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          Flèche = dernières transactions · double-clic ligne = détail · poignée ⋮⋮ =
          déplacer · bord droit = redimensionner (double-clic = autosize) ·{" "}
          {Math.max(visibleColCount - 1, 0)} colonne(s)
          {filteredHoldings.length > 0 && (
            <span className="ml-1 tabular-nums">
              · {filteredHoldings.length} ligne
              {filteredHoldings.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div
          ref={scrollWrapRef}
          className="table-container-responsive table-fluid-wrap holdings-table-scroll"
          data-testid="holdings-table-scroll"
        >
          <table
            ref={tableRootRef}
            className="table-fluid table-col-resize text-left text-sm"
            data-testid="holdings-table"
            style={{
              /* fill parent when content ≤ container; grow past it → overflow-x */
              width: tableWidthPx || undefined,
              minWidth:
                tableWidthPx > 0
                  ? tableWidthPx
                  : "100%",
            }}
          >
            <thead className="table-head text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  <th
                    className="holdings-expand-col px-0 py-3 text-center"
                    style={{
                      width: EXPAND_COL_PX,
                      minWidth: EXPAND_COL_PX,
                      maxWidth: EXPAND_COL_PX,
                    }}
                    aria-label="Déplier les transactions"
                  />
                  {hg.headers.map((h) => {
                    const colId = h.column.id;
                    const size = h.getSize();
                    const floor = columnMinWidth(colId);
                    const isResizing = h.column.getIsResizing();
                    const isLocked = lockedSizing[colId] != null;
                    return (
                      <th
                        key={h.id}
                        data-column-id={colId}
                        data-col-locked={isLocked ? "true" : "false"}
                        className={cn(
                          "col-header-resizable whitespace-nowrap px-3 py-3 font-medium sm:px-4",
                          draggingCol === colId && "col-dragging",
                          dragOverCol === colId && draggingCol !== colId && "col-drag-over"
                        )}
                        style={{
                          width: size,
                          minWidth: floor,
                        }}
                        title="Clic = trier · ⋮⋮ = déplacer · bord droit = largeur (dbl-clic = auto)"
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragOverCol !== colId) setDragOverCol(colId);
                        }}
                        onDragLeave={() => {
                          if (dragOverCol === colId) setDragOverCol(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          applyColumnDrop(colId);
                        }}
                        onClick={(e) => {
                          if (skipSortRef.current) {
                            skipSortRef.current = false;
                            e.preventDefault();
                            return;
                          }
                          // ignore clicks originating from resize handle
                          if ((e.target as HTMLElement).closest(".col-resize-handle")) {
                            return;
                          }
                          h.column.getToggleSortingHandler()?.(e);
                        }}
                      >
                        <span className="inline-flex max-w-full items-center gap-0.5 overflow-hidden">
                          <span
                            draggable
                            className="col-drag-hint inline-flex shrink-0"
                            title="Glisser pour réordonner"
                            onDragStart={(e) => {
                              dragColRef.current = colId;
                              setDraggingCol(colId);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", colId);
                              e.stopPropagation();
                            }}
                            onDragEnd={() => {
                              dragColRef.current = null;
                              setDraggingCol(null);
                              setDragOverCol(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <GripVertical className="h-3 w-3" aria-hidden />
                          </span>
                          <span className="truncate" data-column-label>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ??
                              null}
                          </span>
                        </span>
                        {h.column.getCanResize() && (
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Redimensionner ${colId}`}
                            data-testid={`col-resize-${colId}`}
                            className={cn(
                              "col-resize-handle",
                              isResizing && "is-resizing"
                            )}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              // Second click of a double-click: don't start a drag resize
                              if (e.detail > 1) {
                                e.preventDefault();
                                return;
                              }
                              document.body.classList.add("col-resizing");
                              h.getResizeHandler()(e);
                            }}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              document.body.classList.add("col-resizing");
                              h.getResizeHandler()(e);
                            }}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              document.body.classList.remove("col-resizing");
                              const next = measureColumnAutosize(
                                tableRootRef.current,
                                colId
                              );
                              // Autosize = largeur verrouillée
                              setLockedSizing((prev) => ({
                                ...prev,
                                [colId]: next,
                              }));
                              setColumnSizing((prev) => ({
                                ...prev,
                                [colId]: next,
                              }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </th>
                    );
                  })}
                  <th
                    className="px-1 py-3"
                    style={{
                      width: ACTIONS_COL_PX,
                      minWidth: ACTIONS_COL_PX,
                      maxWidth: ACTIONS_COL_PX,
                    }}
                    aria-label="Actions"
                  />
                </tr>
              ))}
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={Math.max(visibleColCount, 1)}
                    className="px-4 py-8 text-center text-slate-400"
                  >
                    Chargement…
                  </td>
                </tr>
              )}
              {!loading && filteredHoldings.length === 0 && (
                <tr>
                  <td
                    colSpan={Math.max(visibleColCount, 1)}
                    className="px-4 py-10 text-center"
                    data-testid="holdings-empty"
                  >
                    <div className="mx-auto max-w-md space-y-1.5">
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        {envelopeFilter
                          ? `Aucune position en ${ACCOUNT_TYPES[envelopeFilter]}`
                          : debouncedSearch
                            ? "Aucun résultat pour cette recherche"
                            : "Aucune position cotée"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {envelopeFilter
                          ? "Changez d’enveloppe ou enregistrez un achat sur ce type de compte."
                          : debouncedSearch
                            ? "Modifiez les filtres ou effacez la recherche."
                            : "Ajoutez une transaction d’achat, ou importez un CSV courtier."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {!loading &&
                !groupMode &&
                table.getRowModel().rows.map((row) =>
                  renderHoldingRow(row, {
                    expandedIds,
                    toggleExpanded,
                    visibleColCount,
                    onRowDoubleClick,
                    onOpenTransactionForAsset,
                    onEditCategory: setEditCategoryHolding,
                  })
                )}
              {!loading &&
                groupMode &&
                categoryGroups.map((group) => {
                  const expanded = !isGroupCollapsed(group.category);
                  return (
                    <Fragment key={group.category}>
                      <PositionCategoryGroupHeader
                        label={group.label}
                        count={group.count}
                        totalMarketValue={group.totalMarketValue}
                        totalUnrealizedPnl={group.totalUnrealizedPnl}
                        weightPct={group.weightPct}
                        baseCurrency={baseCurrency}
                        expanded={expanded}
                        onToggle={() => toggleGroupCollapsed(group.category)}
                        colSpan={Math.max(visibleColCount, 1)}
                      />
                      {expanded &&
                        group.positions.map((pos) => {
                          const row = rowByAssetId.get(pos.assetId);
                          if (!row) return null;
                          return renderHoldingRow(row, {
                            expandedIds,
                            toggleExpanded,
                            visibleColCount,
                            onRowDoubleClick,
                            onOpenTransactionForAsset,
                            onEditCategory: setEditCategoryHolding,
                          });
                        })}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
        {(() => {
          const total = filteredHoldings.length;
          if (groupMode) {
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400"
                data-testid="holdings-pagination"
              >
                <span className="tabular-nums" data-testid="holdings-group-summary">
                  {total === 0
                    ? "Aucune ligne"
                    : `${total} position${total !== 1 ? "s" : ""} · ${categoryGroups.length} groupe${categoryGroups.length !== 1 ? "s" : ""} (pagination désactivée en mode regroupement)`}
                </span>
              </div>
            );
          }
          const pageCount = Math.max(1, table.getPageCount() || 1);
          const pageIndex = table.getState().pagination.pageIndex;
          const pageSize = table.getState().pagination.pageSize;
          const from = total === 0 ? 0 : pageIndex * pageSize + 1;
          const to = Math.min(total, (pageIndex + 1) * pageSize);
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400"
              data-testid="holdings-pagination"
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5">
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    Positions par page
                  </span>
                  <select
                    className="input !w-auto !min-w-[4.25rem] !py-1 text-sm font-semibold tabular-nums"
                    value={pageSize}
                    onChange={(e) => {
                      const next = Number(e.target.value) as PageSizeOption;
                      setPagination({ pageIndex: 0, pageSize: next });
                    }}
                    data-testid="holdings-page-size-footer"
                    aria-label="Nombre de lignes par page"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="tabular-nums">
                  {total === 0 ? "Aucune ligne" : `${from}–${to} sur ${total}`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums font-medium" data-testid="holdings-page-label">
                  Page {total === 0 ? 0 : pageIndex + 1} / {total === 0 ? 0 : pageCount}
                </span>
                <PageJump
                  pageIndex={pageIndex}
                  pageCount={pageCount}
                  onGoToPage={(i) =>
                    setPagination((p) => ({ ...p, pageIndex: i }))
                  }
                />
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!table.getCanPreviousPage()}
                    onClick={() => table.previousPage()}
                    data-testid="holdings-page-prev"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Préc.
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!table.getCanNextPage()}
                    onClick={() => table.nextPage()}
                    data-testid="holdings-page-next"
                  >
                    Suiv.
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {editCategoryHolding && (
        <EditAssetCategoryModal
          open
          assetId={editCategoryHolding.assetId}
          assetName={editCategoryHolding.name}
          ticker={editCategoryHolding.ticker}
          accountType={editCategoryHolding.accountType}
          currentCategory={editCategoryHolding.category}
          onClose={() => setEditCategoryHolding(null)}
          onSaved={(category) => {
            setCategoryOverrides((prev) => ({
              ...prev,
              [editCategoryHolding.assetId]: category,
            }));
            onCategoryChange?.(editCategoryHolding.assetId, category);
            setEditCategoryHolding(null);
          }}
        />
      )}
    </section>
  );
}

function renderHoldingRow(
  row: Row<Holding>,
  opts: {
    expandedIds: Set<string>;
    toggleExpanded: (id: string) => void;
    visibleColCount: number;
    onRowDoubleClick: (id: string) => void;
    onOpenTransactionForAsset?: (type: string, holding: Holding) => void;
    onEditCategory: (holding: Holding) => void;
  }
) {
  const assetId = row.original.assetId;
  const expanded = opts.expandedIds.has(assetId);
  return (
    <Fragment key={row.id}>
      <tr
        className="holdings-row border-t border-[var(--border)]"
        title="Double-clic pour le détail · flèche pour les transactions"
        onDoubleClick={() => opts.onRowDoubleClick(assetId)}
        data-expanded={expanded ? "true" : "false"}
        data-category={parseAssetCategory(row.original.category)}
      >
        <td
          className="holdings-expand-col px-0 py-2 align-middle text-center"
          style={{
            width: EXPAND_COL_PX,
            minWidth: EXPAND_COL_PX,
            maxWidth: EXPAND_COL_PX,
          }}
        >
          <button
            type="button"
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded border border-slate-200 bg-white p-0 text-slate-700 shadow-sm transition hover:border-teal-600 hover:bg-teal-50 hover:text-teal-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-teal-400 dark:hover:bg-slate-700 dark:hover:text-teal-300",
              expanded &&
                "border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-400 dark:bg-teal-950/50 dark:text-teal-300"
            )}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? "Masquer les transactions"
                : "Afficher les dernières transactions"
            }
            data-testid={`holding-expand-${assetId}`}
            onClick={(e) => {
              e.stopPropagation();
              opts.toggleExpanded(assetId);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ChevronRight
              className={cn(
                "h-[10px] w-[10px] shrink-0 transition-transform duration-150",
                expanded && "rotate-90"
              )}
              strokeWidth={2.5}
              aria-hidden
            />
          </button>
        </td>
        {row.getVisibleCells().map((cell) => {
          const size = cell.column.getSize();
          const floor = columnMinWidth(cell.column.id);
          return (
            <td
              key={cell.id}
              data-column-id={cell.column.id}
              className="col-cell-sized px-3 py-3 align-top sm:px-4"
              style={{
                width: size,
                minWidth: floor,
              }}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          );
        })}
        <td
          className="px-1 py-2 align-middle"
          style={{
            width: ACTIONS_COL_PX,
            minWidth: ACTIONS_COL_PX,
            maxWidth: ACTIONS_COL_PX,
          }}
        >
          <HoldingRowActions
            holding={row.original}
            onAction={
              opts.onOpenTransactionForAsset
                ? (type) => opts.onOpenTransactionForAsset!(type, row.original)
                : undefined
            }
            onDetail={() => opts.onRowDoubleClick(assetId)}
            onEditCategory={() => opts.onEditCategory(row.original)}
          />
        </td>
      </tr>
      {expanded && (
        <tr
          className="border-t border-[var(--border)] bg-slate-50/70 dark:bg-slate-900/50"
          data-testid={`holding-expand-panel-${assetId}`}
        >
          <td colSpan={opts.visibleColCount} className="px-3 py-2 sm:px-4">
            <div className="ml-2 border-l-2 border-teal-600/40 pl-3 dark:border-teal-500/40">
              <HoldingRecentTxs assetId={assetId} enabled={expanded} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function HoldingRowActions({
  holding,
  onAction,
  onDetail,
  onEditCategory,
}: {
  holding: Holding;
  onAction?: (type: string) => void;
  onDetail: () => void;
  onEditCategory?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] text-slate-500 hover:bg-[var(--muted)]"
        aria-label={`Actions pour ${holding.name}`}
        aria-expanded={open}
        data-testid={`holding-actions-${holding.assetId}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 z-40 mt-1 min-w-[12rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 text-sm shadow-xl"
          role="menu"
        >
          {onAction &&
            (
              [
                ["ACHAT", "Acheter"],
                ["VENTE", "Vendre"],
                ["DIVIDENDE", "Enregistrer un dividende"],
                ["FRAIS", "Ajouter des frais"],
              ] as const
            ).map(([type, label]) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left hover:bg-[var(--muted)]"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onAction(type);
                }}
              >
                {label}
              </button>
            ))}
          {onEditCategory && (
            <button
              type="button"
              role="menuitem"
              className="block w-full border-t border-[var(--border)] px-3 py-1.5 text-left hover:bg-[var(--muted)]"
              data-testid={`holding-edit-category-${holding.assetId}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onEditCategory();
              }}
            >
              Modifier la catégorie
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="block w-full border-t border-[var(--border)] px-3 py-1.5 text-left hover:bg-[var(--muted)]"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDetail();
            }}
          >
            Voir le détail / transactions
          </button>
        </div>
      )}
    </div>
  );
}
