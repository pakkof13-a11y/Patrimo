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
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyBadge } from "@/components/ui/currency-badge";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { EnvelopeCashPanel } from "@/components/tabs/envelope-cash-panel";
import { LifeInsuranceTab } from "@/components/tabs/life-insurance-tab";
import { PositionCategoryGroupHeader } from "@/components/holdings/position-category-group-header";
import { EditAssetCategoryModal } from "@/components/holdings/edit-asset-category-modal";
import {
  HoldingsToolbar,
  type HoldingsPageSize,
} from "@/components/holdings/holdings-toolbar";
import { HoldingsEmptyState } from "@/components/holdings/holdings-empty-state";
import {
  applyPlatformFilterToHolding,
  holdingMatchesPlatform,
  recomputeAllocationsForFiltered,
} from "@/app/lib/portfolio/holdings-platform-slice";
import {
  formatRelativeUpdate,
  HOLDINGS_EXPAND_COL_PX,
  renderHoldingRow,
  TriggerLevelInput,
  type TriggerField,
} from "@/components/holdings/holding-table-row";
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
  formatUnitPrice,
  getAssetClassLabel,
  getChangeColor,
  cn,
} from "@/app/lib/utils";
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
  parseHoldingsGroupBy,
  type HoldingsGroupBy,
} from "@/app/lib/assets/categories";
import { groupPositionsByBlockchain } from "@/app/lib/assets/blockchain";

const DEFAULT_PAGE_SIZE: HoldingsPageSize = 20;
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
import { matchesSearchQuery } from "@/components/ui/table-filters";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import {
  formatPageLabel,
  formatRangeLabel,
  shouldShowPaginationNav,
} from "@/app/lib/ui/pagination";

const TABLE_KEY = "holdings";
const EXPAND_COL_PX = HOLDINGS_EXPAND_COL_PX;

export function HoldingsSection({
  tab,
  holdings,
  loading,
  baseCurrency,
  envelopeFilters,
  onEnvelopeFiltersChange,
  onAccountTypeChange,
  onTriggerLevelChange,
  onRowDoubleClick,
  onOpenTransactionForAsset,
  onCategoryChange,
  onAddTransaction,
  onImport,
}: {
  tab: MainTab;
  holdings: Holding[];
  loading: boolean;
  baseCurrency: string;
  /** Multi-sélection d’enveloppes (filtrage déjà appliqué côté parent ou ici) */
  envelopeFilters: AccountType[];
  onEnvelopeFiltersChange?: (types: AccountType[]) => void;
  onAccountTypeChange: (assetId: string, accountType: string) => void;
  onTriggerLevelChange?: (
    assetId: string,
    field: TriggerField,
    value: string | null
  ) => void;
  onRowDoubleClick: (assetId: string) => void;
  /** CTA empty state */
  onAddTransaction?: () => void;
  onImport?: () => void;
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
  /** Filtre plateforme (deep-link depuis Mes plateformes : ?platformId=) */
  const platformIdFromUrl = searchParams.get("platformId") || "";
  const platformFilterId = platformIdFromUrl.trim();
  const platformNameFromUrl = (searchParams.get("platformName") || "").trim();
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

  const envelopeKey =
    envelopeFilters.length === 0
      ? "NONE"
      : envelopeFilters.length === 1
        ? envelopeFilters[0]!
        : [...envelopeFilters].sort().join("+");

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
      else params.set("groupBy", next);
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

  // Reset page quand tab/filtres/tri changent (adjust state while rendering)
  const paginationResetKey = `${tab}:${envelopeKey}:${holdings.length}:${debouncedSearch}:${accountFilter}:${platformFilterId}:${groupBy}`;
  const [prevPaginationResetKey, setPrevPaginationResetKey] = useState(
    paginationResetKey
  );
  if (paginationResetKey !== prevPaginationResetKey) {
    setPrevPaginationResetKey(paginationResetKey);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }

  function clearPlatformFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("platformId");
    params.delete("platformName");
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

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
    const visible = holdingsWithCategory.filter((h) => {
      if (
        platformFilterId &&
        !holdingMatchesPlatform(h, platformFilterId)
      ) {
        return false;
      }
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

    // Sans filtre plateforme → vue agrégée inchangée
    if (!platformFilterId) return visible;

    // Reslice métriques (qty / MV / P&L) sur la jambe filtrée uniquement
    const sliced = visible.map((h) =>
      applyPlatformFilterToHolding(h, platformFilterId)
    );
    return recomputeAllocationsForFiltered(sliced);
  }, [
    holdingsWithCategory,
    debouncedSearch,
    accountFilter,
    platformFilterId,
  ]);

  const platformFilterLabel = useMemo(() => {
    if (!platformFilterId) return null;
    const hit = holdings.find((h) => {
      const ids =
        h.platformIds && h.platformIds.length > 0
          ? h.platformIds
          : [h.platformId];
      return ids.includes(platformFilterId);
    });
    if (hit) {
      // Si multi-custody, préférer le libellé URL (plateforme cliquée)
      if (
        hit.platformIds &&
        hit.platformIds.length > 1 &&
        platformNameFromUrl
      ) {
        return platformNameFromUrl;
      }
      // platformName peut être "A, B" — extraire le segment si possible
      if (hit.platformId === platformFilterId) return hit.platformName.split(",")[0]!.trim();
      return platformNameFromUrl || hit.platformName;
    }
    return platformNameFromUrl || "Plateforme sélectionnée";
  }, [platformFilterId, platformNameFromUrl, holdings]);

  const groupMode =
    groupBy === "assetCategory" || groupBy === "blockchain";

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
          <div className="flex min-w-0 items-center gap-2">
            <PlatformLogo
              src={row.original.platformLogoUrl}
              name={row.original.platformName}
              size={22}
            />
            <span className="truncate text-sm">{row.original.platformName}</span>
          </div>
        ),
      },
      {
        accessorKey: "blockchainLabel",
        id: "blockchain",
        header: "Blockchain",
        cell: ({ row }) => {
          const isCrypto =
            row.original.assetClass === "CRYPTO" ||
            row.original.accountType === "CRYPTO";
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
              className="inline-flex max-w-[9rem] truncate rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-950 dark:text-amber-100"
              title={label}
              data-testid="holding-blockchain-badge"
            >
              {label}
            </span>
          );
        },
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
              {formatUnitPrice(
                row.original.currentPriceNative,
                row.original.currency,
                { crypto: row.original.assetClass === "CRYPTO" }
              )}
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
        cell: ({ row }) => (
          <div className="flex flex-col items-end gap-0.5">
            {onTriggerLevelChange ? (
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
            )}
            {row.original.hasSecondaryLevels && (
              <span
                className="text-[10px] leading-tight text-zinc-400"
                title="Niveaux SL/TP présents sur une jambe secondaire (autre plateforme) — la jambe principale est affichée en priorité"
              >
                Niveaux sur jambe secondaire inclus
              </span>
            )}
          </div>
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
  // (adjust state while rendering)
  const groupPaginationKey = `${groupMode}:${filteredHoldings.length}`;
  const [prevGroupPaginationKey, setPrevGroupPaginationKey] = useState(
    groupPaginationKey
  );
  if (groupPaginationKey !== prevGroupPaginationKey) {
    setPrevGroupPaginationKey(groupPaginationKey);
    if (groupMode) {
      setPagination({
        pageIndex: 0,
        pageSize: Math.max(filteredHoldings.length, 1),
      });
    }
  }

  /** Lignes triées (pré-pagination) pour regroupement — order = tri tableau */
  const sortedAllRows = table.getPrePaginationRowModel().rows;
  const categoryGroups =
    groupBy === "assetCategory"
      ? groupPositionsByAssetCategory(sortedAllRows.map((r) => r.original))
      : [];
  const blockchainGroups =
    groupBy === "blockchain"
      ? groupPositionsByBlockchain(sortedAllRows.map((r) => r.original))
      : [];
  const activeGroups =
    groupBy === "blockchain" ? blockchainGroups : categoryGroups;
  const rowByAssetId = useMemo(() => {
    const m = new Map<string, Row<Holding>>();
    for (const r of sortedAllRows) m.set(r.original.assetId, r);
    return m;
     
  }, [sortedAllRows]);

  const allEnvelopesCount = Object.keys(ACCOUNT_TYPES).length;
  const positionsTitle =
    envelopeFilters.length === 0
      ? "Positions — aucune enveloppe"
      : envelopeFilters.length === allEnvelopesCount
        ? "Positions (toutes les enveloppes)"
        : envelopeFilters.length === 1
          ? `Positions — ${ACCOUNT_TYPES[envelopeFilters[0]!]}`
          : `Positions — ${envelopeFilters.length} enveloppes`;

  /** Clé stable des colonnes visibles (identité stable entre renders). */
  const visibleLeafKey = table
    .getVisibleLeafColumns()
    .map((c) => c.id)
    .join("|");
  /** +1 expand (plus de colonne ⋯ — actions dans l’historique) */
  const visibleLeafIds = useMemo(
    () => (visibleLeafKey ? visibleLeafKey.split("|") : []),
    [visibleLeafKey]
  );
  const visibleColCount = visibleLeafIds.length + 1;
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
      expandPx: EXPAND_COL_PX,
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
    visibleLeafIds,
    visibleLeafKey,
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
    <section className="space-y-3 sm:space-y-4" data-testid="holdings-section">
      {tab === "cto" && <EnvelopeCashPanel envelope="CTO" />}
      {tab === "pea" && <EnvelopeCashPanel envelope="PEA" lockCurrencyToEur />}
      {tab === "av" && (
        <>
          <EnvelopeCashPanel envelope="AV" />
          <div className="mb-1 sm:mb-2">
            <LifeInsuranceTab />
          </div>
        </>
      )}
      <div className="card-flat min-w-0 overflow-hidden">
        <HoldingsToolbar
          title={positionsTitle}
          subtitle={
            envelopeFilters.length === allEnvelopesCount
              ? "Positions calculées depuis le journal · CUMP multi-compte"
              : envelopeFilters.length === 0
                ? "Sélectionnez au moins une enveloppe pour afficher les positions"
                : `${envelopeFilters.map((e) => ACCOUNT_TYPES[e]).join(" · ")} · journal`
          }
          sourceCount={holdings.length}
          filteredCount={filteredHoldings.length}
          loading={loading}
          envelopeFilters={envelopeFilters}
          onEnvelopeFiltersChange={onEnvelopeFiltersChange}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          groupMode={groupMode}
          categoryGroupCount={activeGroups.length}
          onExpandAllGroups={expandAllGroups}
          onCollapseAllGroups={() =>
            collapseAllGroups(
              groupBy === "blockchain"
                ? blockchainGroups.map((g) => g.blockchainKey)
                : categoryGroups.map((g) => g.category)
            )
          }
          search={searchInput}
          onSearchChange={setSearchInput}
          accountFilter={accountFilter}
          onAccountFilterChange={setAccountFilter}
          platformFilterLabel={platformFilterLabel}
          onClearPlatformFilter={
            platformFilterId ? clearPlatformFilter : undefined
          }
          pageSize={pagination.pageSize}
          onPageSizeChange={(n) =>
            setPagination({ pageIndex: 0, pageSize: n })
          }
          savedViews={savedViews}
          onSaveView={(name) => {
            const view: SavedHoldingsView = {
              id: `v-${Date.now()}`,
              name,
              envelope: envelopeFilters.join(",") || "",
              accountType: accountFilter || "",
              search: searchInput,
              visibility: columnVisibility as Record<string, boolean>,
              pageSize: pagination.pageSize,
              createdAt: new Date().toISOString(),
            };
            const next = [...savedViews, view];
            setSavedViews(next);
            saveSavedViews(next);
          }}
          onApplyView={(view) => {
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
            if (onEnvelopeFiltersChange && view.envelope) {
              const parts = view.envelope
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean) as AccountType[];
              if (parts.length > 0) onEnvelopeFiltersChange(parts);
            }
          }}
          columns={{
            visibility: columnVisibility as Record<string, boolean>,
            order: columnOrder,
            onVisibilityChange: (id, visible) => {
              const meta = HOLDINGS_COLUMN_META.find((c) => c.id === id);
              if (meta?.group === "mandatory" || meta?.locked) {
                setColumnVisibility((prev) => ({ ...prev, [id]: true }));
                return;
              }
              setColumnVisibility((prev) => ({ ...prev, [id]: visible }));
            },
            onOrderChange: (next) => setColumnOrder(next),
            onReset: () => {
              const reset = resetHoldingsColumns();
              setColumnVisibility(reset.visibility);
              setColumnOrder(reset.order);
              setLockedSizing(reset.sizing);
              setColumnSizing({});
            },
          }}
        />
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
                    const fullLabel =
                      HOLDINGS_COLUMN_META.find((c) => c.id === colId)?.label ??
                      String(h.column.columnDef.header ?? colId);
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
                        title={`${fullLabel}\nClic = trier · ⋮⋮ = déplacer · bord = largeur`}
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
                          <span
                            className="min-w-0 truncate"
                            data-column-label
                            title={fullLabel}
                          >
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
                </tr>
              ))}
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={Math.max(visibleColCount, 1)}
                    className="p-0"
                  >
                    <div className="px-2 py-2" data-testid="holdings-loading-skeleton">
                      {Array.from({ length: 8 }).map((_, r) => (
                        <div
                          key={r}
                          className="flex items-center gap-3 border-t border-[var(--border)] px-2 py-2.5 first:border-t-0"
                        >
                          <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[var(--muted)]" />
                          <div className="h-3 w-28 animate-pulse rounded bg-[var(--muted)]" />
                          <div className="h-3 w-16 animate-pulse rounded bg-[var(--muted)]" />
                          <div className="ml-auto h-3 w-20 animate-pulse rounded bg-[var(--muted)]" />
                          <div className="h-3 w-16 animate-pulse rounded bg-[var(--muted)]" />
                          <div className="h-3 w-14 animate-pulse rounded bg-[var(--muted)]" />
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              {!loading && filteredHoldings.length === 0 && (
                <tr>
                  <td
                    colSpan={Math.max(visibleColCount, 1)}
                    className="px-4 py-10 text-center"
                  >
                    <HoldingsEmptyState
                      kind={
                        holdings.length === 0 && !debouncedSearch && !accountFilter
                          ? envelopeFilters.length === 0 ||
                            envelopeFilters.length < allEnvelopesCount
                            ? "envelope"
                            : "source"
                          : debouncedSearch || accountFilter
                            ? "filter"
                            : envelopeFilters.length < allEnvelopesCount
                              ? "envelope"
                              : "source"
                      }
                      envelopeLabel={
                        envelopeFilters.length === 1
                          ? ACCOUNT_TYPES[envelopeFilters[0]!]
                          : envelopeFilters.length === 0
                            ? "aucune"
                            : undefined
                      }
                      searchQuery={debouncedSearch.trim() || undefined}
                      onClearSearch={
                        debouncedSearch
                          ? () => {
                              setSearchInput("");
                              setAccountFilter("");
                            }
                          : undefined
                      }
                      onAddTransaction={onAddTransaction}
                      onImport={onImport}
                    />
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
                activeGroups.map((group) => {
                  const groupKey =
                    "blockchainKey" in group
                      ? group.blockchainKey
                      : group.category;
                  const expanded = !isGroupCollapsed(groupKey);
                  return (
                    <Fragment key={groupKey}>
                      <PositionCategoryGroupHeader
                        label={group.label}
                        count={group.count}
                        totalMarketValue={group.totalMarketValue}
                        totalUnrealizedPnl={group.totalUnrealizedPnl}
                        weightPct={group.weightPct}
                        baseCurrency={baseCurrency}
                        expanded={expanded}
                        onToggle={() => toggleGroupCollapsed(groupKey)}
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
          const showNav = shouldShowPaginationNav(total);

          if (groupMode) {
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400"
                data-testid="holdings-pagination"
              >
                <span className="tabular-nums" data-testid="holdings-group-summary">
                  {total === 0
                    ? "Aucune position à afficher"
                    : `${total} position${total !== 1 ? "s" : ""} · ${activeGroups.length} groupe${activeGroups.length !== 1 ? "s" : ""}`}
                </span>
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  Toutes les lignes · pagination inactive
                </span>
              </div>
            );
          }

          // Empty / loading: human footer, no « Page 0 / 0 », no duplicate page-size
          if (!showNav) {
            return (
              <div
                className="border-t border-[var(--border)] px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400"
                data-testid="holdings-pagination"
                data-empty="true"
              >
                <span className="tabular-nums" data-testid="holdings-page-label">
                  {loading
                    ? "Chargement…"
                    : holdings.length === 0
                      ? "Aucune position"
                      : "Aucun résultat pour les filtres actifs"}
                </span>
              </div>
            );
          }

          const pageCount = Math.max(1, table.getPageCount() || 1);
          const pageIndex = table.getState().pagination.pageIndex;
          const pageSize = table.getState().pagination.pageSize;
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400"
              data-testid="holdings-pagination"
              data-empty="false"
            >
              {/* Page size : uniquement dans la toolbar (pas de doublon footer) */}
              <span className="tabular-nums">
                {formatRangeLabel(pageIndex, pageSize, total)}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="tabular-nums font-medium"
                  data-testid="holdings-page-label"
                >
                  {formatPageLabel(pageIndex, pageCount, total)}
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
