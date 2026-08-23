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
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/ui/sparkline";
import { buildClassPeriodSeries } from "@/app/lib/portfolio/class-period-series";
import { fetchJson } from "@/app/lib/api-client";
import { CurrencyBadge } from "@/components/ui/currency-badge";
import { AssetLogo, PlatformLogo } from "@/components/ui/platform-logo";
import { EnvelopeCashPanel } from "@/components/tabs/envelope-cash-panel";
import { LifeInsuranceTab } from "@/components/tabs/life-insurance-tab";
import { PositionCategoryGroupHeader } from "@/components/holdings/position-category-group-header";
import { PositionGroupHeader } from "@/components/holdings/position-group-header";
import { EditAssetCategoryModal } from "@/components/holdings/edit-asset-category-modal";
import {
  HoldingsToolbar,
  type HoldingsPageSize,
} from "@/components/holdings/holdings-toolbar";
import { HoldingsEmptyState } from "@/components/holdings/holdings-empty-state";
import { PortfolioKpiCards } from "@/components/holdings/portfolio-kpi-cards";
import { visibilityForMode } from "@/app/lib/portfolio/holdings-view-mode";
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
import { holdingsToCsv } from "@/app/lib/portfolio/holdings-csv";
import {
  matchesPnlFilter,
  parsePnlFilter,
  type PnlFilter,
} from "@/app/lib/portfolio/pnl-filter";
import { PageJump } from "@/components/ui/page-jump";
import {
  ACCOUNT_TYPES,
  ASSET_CLASS_COLORS,
  type AccountType,
  type AssetClass,
} from "@/app/lib/constants";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
  formatUnitPrice,
  getAssetClassLabel,
  getChangeColor,
  cn,
} from "@/app/lib/utils";
import {
  type HistoryPoint,
  type Holding,
  type MainTab,
} from "@/app/lib/types/ui";
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
  assetCategoryLabel,
  groupPositionsByAssetCategory,
  parseAssetCategory,
  parseHoldingsGroupBy,
  type HoldingsGroupBy,
} from "@/app/lib/assets/categories";
import { groupPositionsByBlockchain } from "@/app/lib/assets/blockchain";
import {
  groupPositionsByAssetClass,
  parseAssetClass,
} from "@/app/lib/assets/asset-class-groups";
import { useClassPnlQuery } from "@/app/hooks/use-portfolio-queries";

const DEFAULT_PAGE_SIZE: HoldingsPageSize = 20;
import {
  COLUMN_RESIZE_MAX,
  COLUMN_RESIZE_MIN,
  HOLDINGS_COLUMN_META,
  columnAlign,
  columnMeta,
  resetHoldingsColumns,
  defaultColumnOrder,
  defaultColumnSizing,
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
import { HorizontalScrollbar } from "@/components/ui/h-scrollbar";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import {
  formatPageLabel,
  formatRangeLabel,
  shouldShowPaginationNav,
} from "@/app/lib/ui/pagination";

const TABLE_KEY = "holdings";
const EXPAND_COL_PX = HOLDINGS_EXPAND_COL_PX;

/** Aligné sur le plafond de la route : au-delà, elle tronque la demande. */
const SPARKLINE_MAX_ASSETS = 120;
/**
 * Les clôtures d'hier ne changent plus : le cache peut être long. Il n'y a
 * aucune raison de retélécharger un mois d'historique parce qu'on est revenu
 * sur l'onglet.
 */
const SPARKLINE_STALE_MS = 5 * 60_000;

export function HoldingsSection({
  tab,
  holdings,
  history,
  loading,
  baseCurrency,
  envelopeFilters,
  onEnvelopeFiltersChange,
  onAccountTypeChange,
  onTriggerLevelChange,
  onRowDoubleClick,
  selectedAssetId,
  onCategoryChange,
  onAddTransaction,
  onImport,
}: {
  tab: MainTab;
  holdings: Holding[];
  /** Historique patrimonial global — alimente les sparklines des KPI. */
  history?: HistoryPoint[];
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
  /** Ligne actuellement affichée dans la colonne de détail. */
  selectedAssetId?: string | null;
  /** CTA empty state */
  onAddTransaction?: () => void;
  onImport?: () => void;
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
  /** Filtre rapide P&L latent : tout / gagnants / perdants */
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>("all");
  /**
   * Puces de filtre. Convention commune : liste vide = aucune restriction.
   * Elles ne sont pas persistées — un filtre est un geste de consultation,
   * pas un réglage ; le retrouver actif trois jours plus tard ferait croire
   * à un portefeuille amputé.
   */
  const [assetClassFilters, setAssetClassFilters] = useState<string[]>([]);
  const [currencyFilters, setCurrencyFilters] = useState<string[]>([]);
  /** Filtre plateforme (deep-link depuis Mes plateformes : ?platformId=) */
  const platformIdFromUrl = searchParams.get("platformId") || "";
  const platformFilterId = platformIdFromUrl.trim();
  const platformNameFromUrl = (searchParams.get("platformName") || "").trim();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // ── Regroupement par sous-catégorie ──────────────────────────────────────
  const [groupBy, setGroupByState] = useState<HoldingsGroupBy>("assetClass");
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
      // Le portefeuille s'ouvre regroupé par classe d'actifs : trente lignes
      // à plat ne disent pas de quoi le patrimoine est fait, six groupes si.
      setGroupByState(
        parseHoldingsGroupBy(loadUiPref(HOLDINGS_GROUP_BY_KEY, "assetClass"))
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

  /**
   * Même valeur qu'au chargement des préférences : sans cela le premier rendu
   * afficherait huit colonnes puis en ajouterait trois après hydratation, et
   * le tableau sauterait sous les yeux à chaque arrivée sur la page.
   */
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    visibilityForMode(
      "summary",
      HOLDINGS_COLUMN_META.map((c) => c.id)
    )
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
    /**
     * À défaut de préférence enregistrée, le portefeuille s'ouvre en « Synthèse »
     * — les colonnes du mockup. Le défaut historique (colonnes obligatoires
     * seules) ne correspondait à aucun des trois modes : les trois onglets
     * s'affichaient éteints à la première visite, ce qui se lit comme une panne.
     */
    const fallback = visibilityForMode(
      "summary",
      HOLDINGS_COLUMN_META.map((c) => c.id)
    );
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
  const paginationResetKey = `${tab}:${envelopeKey}:${holdings.length}:${debouncedSearch}:${accountFilter}:${platformFilterId}:${groupBy}:${pnlFilter}:${assetClassFilters.join(",")}:${currencyFilters.join(",")}`;
  const [prevPaginationResetKey, setPrevPaginationResetKey] = useState(
    paginationResetKey
  );
  if (paginationResetKey !== prevPaginationResetKey) {
    setPrevPaginationResetKey(paginationResetKey);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }

  /**
   * Le filtre plateforme passe par l'URL, pas par un état local : c'est le même
   * paramètre que le lien profond « voir les positions de cette plateforme »
   * depuis l'écran Plateformes. Deux mécanismes pour un seul filtre finiraient
   * par se contredire.
   */
  const setPlatformFilter = useCallback(
    (id: string | null, name?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set("platformId", id);
        if (name) params.set("platformName", name);
        else params.delete("platformName");
      } else {
        params.delete("platformId");
        params.delete("platformName");
      }
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );


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
      if (
        assetClassFilters.length > 0 &&
        !assetClassFilters.includes(h.assetClass)
      ) {
        return false;
      }
      if (currencyFilters.length > 0 && !currencyFilters.includes(h.currency)) {
        return false;
      }
      return matchesSearchQuery(debouncedSearch, [
        h.name,
        h.ticker,
        h.isin,
        h.platformName,
        h.assetClass,
        h.category,
      ]);
    });

    // Reslice métriques (qty / MV / P&L) sur la jambe filtrée uniquement —
    // le filtre P&L doit porter sur les valeurs affichées, donc après reslice.
    const resliced = platformFilterId
      ? recomputeAllocationsForFiltered(
          visible.map((h) => applyPlatformFilterToHolding(h, platformFilterId))
        )
      : visible;

    if (pnlFilter === "all") return resliced;
    return resliced.filter((h) =>
      matchesPnlFilter(h.unrealizedPnlBase || h.unrealizedPnlEur, pnlFilter)
    );
  }, [
    holdingsWithCategory,
    debouncedSearch,
    accountFilter,
    platformFilterId,
    pnlFilter,
    assetClassFilters,
    currencyFilters,
  ]);

  /**
   * Options des puces, tirées des positions **avant** filtrage : une liste qui
   * se vide au fur et à mesure qu'on filtre empêche de revenir en arrière.
   * Les compteurs, eux, sont ceux de la source — ils disent combien de lignes
   * la valeur représente, pas combien il en reste après les autres filtres.
   */
  const chipOptions = useMemo(() => {
    const classes = new Map<string, number>();
    const currencies = new Map<string, number>();
    const platforms = new Map<string, { label: string; count: number }>();
    for (const h of holdingsWithCategory) {
      classes.set(h.assetClass, (classes.get(h.assetClass) ?? 0) + 1);
      currencies.set(h.currency, (currencies.get(h.currency) ?? 0) + 1);
      const slices =
        h.platformSlices && h.platformSlices.length > 0
          ? h.platformSlices.map((s) => ({
              id: s.platformId,
              name: s.platformName,
            }))
          : [{ id: h.platformId, name: h.platformName }];
      for (const p of slices) {
        if (!p.id) continue;
        const prev = platforms.get(p.id);
        platforms.set(p.id, {
          label: prev?.label || p.name || "—",
          count: (prev?.count ?? 0) + 1,
        });
      }
    }
    const byLabel = (a: { label: string }, b: { label: string }) =>
      a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
    return {
      assetClasses: [...classes.entries()]
        .map(([value, count]) => ({
          value,
          label: getAssetClassLabel(value),
          count,
        }))
        .sort(byLabel),
      currencies: [...currencies.entries()]
        .map(([value, count]) => ({ value, label: value, count }))
        .sort(byLabel),
      platforms: [...platforms.entries()]
        .map(([value, { label, count }]) => ({ value, label, count }))
        .sort(byLabel),
    };
  }, [holdingsWithCategory]);

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

  const groupMode = groupBy !== "none";

  /**
   * Vignettes de tendance — une requête pour tout le tableau.
   *
   * La clé porte les actifs du portefeuille **avant** filtrage, et non les
   * lignes visibles : sinon chaque frappe dans la recherche relancerait une
   * requête pour redessiner des courbes déjà en cache. La liste est triée pour
   * que deux rendus du même portefeuille produisent la même clé.
   */
  const sparklineIds = useMemo(() => {
    const ids = [...new Set(holdings.map((h) => h.assetId).filter(Boolean))];
    ids.sort();
    return ids.slice(0, SPARKLINE_MAX_ASSETS);
  }, [holdings]);

  const trendColumnVisible = columnVisibility.trend !== false;

  const sparklinesQuery = useQuery({
    queryKey: ["portfolio-sparklines", sparklineIds],
    // Colonne masquée = aucune requête : on ne télécharge pas trente
    // historiques pour des courbes que personne ne regarde.
    enabled: sparklineIds.length > 0 && trendColumnVisible,
    queryFn: () =>
      fetchJson<{ series: Record<string, number[]> }>(
        `/api/portfolio/sparklines?ids=${encodeURIComponent(sparklineIds.join(","))}`
      ),
    /*
      Une réponse vide n'est pas mise en cache : elle veut souvent dire que la
      route n'a pas encore fini de peupler le cache de clôtures. La garder cinq
      minutes afficherait un tableau de tirets alors que les données sont
      arrivées entre-temps. Dès qu'une seule courbe revient, on tient la
      réponse pour bonne — un portefeuille où *rien* n'a d'historique est un
      cache froid, pas un état stable.
    */
    staleTime: (query) =>
      Object.keys(query.state.data?.series ?? {}).length > 0
        ? SPARKLINE_STALE_MS
        : 0,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const sparklines = sparklinesQuery.data?.series;

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
          // `min-w-0` sur le conteneur ET la colonne de texte : sans lui, un
          // enfant flex refuse de rétrécir sous sa largeur de contenu, donc le
          // nom débordait et se faisait couper net par la cellule — « Appartement
          // Loca », sans ellipse, ce qui se lit comme un bug plutôt que comme une
          // troncature. Le nom complet reste accessible au survol.
          <div className="flex min-w-0 items-center gap-2.5">
            <AssetLogo
              src={row.original.assetLogoUrl || row.original.logoUrl}
              name={row.original.name}
              ticker={row.original.ticker}
              isin={row.original.isin}
              assetClass={row.original.assetClass}
              size={28}
            />
            <div className="min-w-0">
              <div className="truncate font-medium" title={row.original.name}>
                {row.original.name}
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                {row.original.isin && (
                  <span className="truncate font-mono text-[10px] text-slate-500">
                    {row.original.isin}
                  </span>
                )}
                {/* Sous-catégorie : jusqu'ici visible seulement en mode
                    regroupement (en-tête de groupe), invisible ligne par
                    ligne en tri normal — modifiable via le badge Catégorie
                    du panneau déplié, mais sans rappel dans la cellule elle-même. */}
                {parseAssetCategory(row.original.category) !== "UNCLASSIFIED" && (
                  <span
                    className="shrink-0 truncate rounded-full bg-[var(--muted)] px-1.5 py-px text-[9px] font-medium text-[var(--muted-foreground)]"
                    title="Sous-catégorie (classification d'affichage)"
                    data-testid="holding-category-badge"
                  >
                    {assetCategoryLabel(row.original.category)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "ticker",
        id: "ticker",
        header: "Ticker",
        // Or et monospace : le ticker est un code, pas un nom. La couleur le
        // distingue du libellé de l'actif sans ajouter de séparateur.
        cell: ({ row }) => (
          <span className="font-mono text-[length:var(--text-xs)] tracking-[var(--tracking-label)] text-[var(--primary-text)]">
            {row.original.ticker || "—"}
          </span>
        ),
      },
      {
        accessorKey: "accountType",
        id: "accountType",
        header: "Enveloppe",
        /*
          Pastille compacte plutôt que menu déroulant pleine largeur.

          Le libellé long (« Compte-Titres », « Assurance-Vie ») imposait une
          colonne de 160 px pour une information qui tient en trois lettres, et
          la boîte de sélection tirait l'œil plus que les nombres voisins. On
          affiche donc le code, dans une pastille — mais le champ reste un
          `<select>` : l'enveloppe se corrige toujours d'un clic depuis le
          tableau, ce qu'un simple badge aurait retiré.
        */
        cell: ({ row }) => {
          const code = (row.original.accountType || "CTO") as AccountType;
          return (
            <span className="holdings-envelope-cell">
              {/*
                Le libellé visible est un `<span>`, le `<select>` est transparent
                par-dessus. Un `<select>` prend la largeur de sa plus longue
                option, quelle que soit celle qui est choisie : « AV » occupait
                donc la place d'« IMMOBILIER », et la colonne alignait six
                pastilles identiques dont aucune ne faisait la taille de son
                texte. Le `<span>`, lui, ne mesure que ce qu'il affiche — et le
                `<select>` conserve son menu natif, appréciable au doigt.
              */}
              <span className="holdings-envelope-pill" data-autosize-box>
                <span className="holdings-envelope-pill__label">{code}</span>
                <select
                  className="holdings-envelope-pill__input"
                  aria-label="Enveloppe"
                  title={ACCOUNT_TYPES[code]}
                  value={code}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    onAccountTypeChange(row.original.assetId, e.target.value);
                  }}
                >
                  {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </span>
            </span>
          );
        },
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
        header: "Qté",
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
        header: "Cours",
        cell: ({ row }) => (
          <div>
            <div className="tabular-nums">
              {formatUnitPrice(
                row.original.currentPriceNative,
                row.original.currency,
                { crypto: row.original.assetClass === "CRYPTO" }
              )}
            </div>
            {/*
              La provenance du cours ne s'affiche plus sous chaque ligne : elle
              répétait « Démo » trente fois pour une information qui n'intéresse
              que lorsqu'elle cloche. Seul le cas qui cloche reste visible — un
              cours périmé —, et la ligne entière le signale déjà par
              `data-stale`. Le détail complet vit dans le panneau de droite.
            */}
            {row.original.priceStatus === "STALE" && (
              <div className="text-[10px] tracking-wide text-amber-500">
                cours périmé
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "marketValueBase",
        id: "marketValueBase",
        // La devise est déjà portée par chaque cellule (« 312 000,00 € ») :
        // la répéter en en-tête ne faisait que le faire tronquer.
        header: "Valeur",
        cell: ({ row }) => (
          <div>
            <span className="font-medium tabular-nums">
              {formatCurrency(
                row.original.marketValueBase || row.original.marketValueEur,
                baseCurrency
              )}
            </span>
          </div>
        ),
      },
      {
        /*
          Tendance à trente jours.

          Une colonne sans donnée propre : elle ne trie pas, ne se redimensionne
          pas, ne dit rien qu'une autre colonne ne dise en chiffres. Elle donne
          la seule chose qu'un nombre ne donne pas — la forme du chemin parcouru
          pour y arriver.

          Vide quand l'actif n'a pas de clôtures en cache. Une diagonale entre
          deux points inventés aurait l'apparence d'une tendance sans en être
          une, ce qui serait pire que la case vide.
        */
        id: "trend",
        accessorKey: "assetId",
        // En-tête muet : le mockup n'en montre aucun au-dessus des vignettes,
        // et le libellé complet reste disponible — infobulle de l'en-tête et
        // sélecteur de colonnes le lisent depuis la méta.
        header: () => <span className="sr-only">Tendance 30 j</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const closes = sparklines?.[row.original.assetId];
          if (!closes || closes.length < 2) {
            return (
              <span className="text-[10px] text-slate-400 dark:text-slate-600">
                —
              </span>
            );
          }
          const up = closes[closes.length - 1]! >= closes[0]!;
          return (
            /*
              Taille fixe et centrée, jamais étirée sur la largeur de la
              colonne : une vignette qui s'allonge quand la colonne s'élargit
              écrase sa propre pente, et deux lignes voisines cessent d'être
              comparables entre elles.
            */
            <span
              className="flex h-5 w-full items-center justify-center"
              title={`Tendance sur ${closes.length} clôtures (30 derniers jours)`}
            >
              <Sparkline
                values={closes}
                stroke={up ? "var(--chart-positive)" : "var(--chart-negative)"}
                width={56}
                height={20}
                strokeWidth={1.1}
              />
            </span>
          );
        },
      },
      {
        /*
          Variation : le montant, puis la proportion sous lui.

          Les deux chiffres répondent à une seule question et ne se lisent
          jamais l'un sans l'autre — « +1 700 € » ne dit pas si la ligne a bien
          travaillé, « +20 % » ne dit pas ce que ça pèse. En deux colonnes,
          leurs en-têtes se tronquaient de la même façon (« P&L LAT… » deux
          fois) et l'œil devait faire l'aller-retour de l'une à l'autre.

          Le tri porte sur les euros ; la colonne « Variation (%) », décochée
          par défaut, reste disponible pour classer par performance.
        */
        accessorKey: "unrealizedPnlBase",
        id: "unrealizedPnlBase",
        header: "Variation",
        cell: ({ row }) => {
          const amount =
            row.original.unrealizedPnlBase || row.original.unrealizedPnlEur;
          return (
            <div>
              <div className={cn("num font-medium", getChangeColor(amount))}>
                {formatSignedCurrency(amount, baseCurrency)}
              </div>
              <div
                className={cn(
                  "num text-[length:var(--text-2xs)]",
                  getChangeColor(row.original.unrealizedPnlPct)
                )}
              >
                {formatSignedPercent(row.original.unrealizedPnlPct)}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "unrealizedPnlPct",
        id: "unrealizedPnlPct",
        header: "Variation %",
        cell: ({ row }) => (
          <span className={cn("num", getChangeColor(row.original.unrealizedPnlPct))}>
            {formatSignedPercent(row.original.unrealizedPnlPct)}
          </span>
        ),
      },
      {
        accessorKey: "allocationPctOfClass",
        id: "allocationPctOfClass",
        header: "Alloc. classe",
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
        // « Poids » plutôt qu'« Alloc. portefeuille » : tronqué, l'en-tête
        // affichait « ALLOC. PORTEFE… ». Le libellé complet reste dans le
        // sélecteur de colonnes et dans l'infobulle.
        header: "Poids",
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
                currentPrice={row.original.currentPriceNative}
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
              currentPrice={row.original.currentPriceNative}
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
              currentPrice={row.original.currentPriceNative}
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
              currentPrice={row.original.currentPriceNative}
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
              currentPrice={row.original.currentPriceNative}
              onCommit={onTriggerLevelChange}
            />
          ) : (
            <span className="tabular-nums text-xs text-zinc-500">
              {row.original.tp4 || "—"}
            </span>
          ),
      },
    ],
    [baseCurrency, onAccountTypeChange, onTriggerLevelChange, sparklines]
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
  const classGroups =
    groupBy === "assetClass"
      ? groupPositionsByAssetClass(sortedAllRows.map((r) => r.original))
      : [];
  const categoryGroups =
    groupBy === "assetCategory"
      ? groupPositionsByAssetCategory(sortedAllRows.map((r) => r.original))
      : [];
  const blockchainGroups =
    groupBy === "blockchain"
      ? groupPositionsByBlockchain(sortedAllRows.map((r) => r.original))
      : [];
  const activeGroups =
    groupBy === "assetClass"
      ? classGroups
      : groupBy === "blockchain"
        ? blockchainGroups
        : categoryGroups;
  const rowByAssetId = useMemo(() => {
    const m = new Map<string, Row<Holding>>();
    for (const r of sortedAllRows) m.set(r.original.assetId, r);
    return m;
     
  }, [sortedAllRows]);

  /**
   * Courbe et variation du jour de chaque classe.
   *
   * Chargées seulement quand le tableau est effectivement regroupé par classe :
   * ce calcul peut réveiller le cache de clôtures côté serveur, et le
   * portefeuille n'a pas à le payer quand personne ne regarde les groupes.
   */
  const classPnlQ = useClassPnlQuery("1m", groupBy === "assetClass");
  const classSeries = useMemo(() => {
    const points = classPnlQ.data?.points;
    if (!points?.length) return null;

    const incomplete = new Set<string>();
    for (const p of points) {
      for (const cls of p.incompleteClasses ?? []) {
        incomplete.add(parseAssetClass(cls));
      }
    }

    /*
      Performance de la période, et non valeur de marché : la courbe montait
      d'un cran le jour d'un achat, si bien qu'un versement s'y lisait comme un
      gain. Le P&L cumulé neutralise les flux — la ligne ne bouge que sous
      l'effet des cours, et son point d'arrivée est le chiffre affiché à côté.
    */
    const performance = buildClassPeriodSeries(points);

    const values = new Map<string, number[]>();
    const periodPnl = new Map<string, number>();
    const periodPct = new Map<string, number | null>();
    for (const [rawClass, perf] of performance) {
      const cls = parseAssetClass(rawClass);
      values.set(cls, perf.cumulative);
      periodPnl.set(cls, perf.pnl);
      periodPct.set(cls, perf.pct);
    }

    return { values, periodPnl, periodPct, incomplete };
  }, [classPnlQ.data]);

  const allEnvelopesCount = Object.keys(ACCOUNT_TYPES).length;
  /**
   * Titre invariable.
   *
   * Il portait auparavant l'état du filtre d'enveloppe (« Positions — PEA »,
   * « Positions — 3 enveloppes »). Le filtre étant désormais matérialisé par
   * une puce juste en dessous, le répéter dans le titre faisait bouger le
   * repère principal de la page à chaque clic — exactement ce qu'un titre ne
   * doit pas faire.
   */
  const positionsTitle = "Portefeuille";

  /**
   * Un filtre restreint-il l'affichage ? Sert à deux choses : afficher le
   * bouton de réinitialisation, et retirer les sparklines des cartes KPI
   * (l'historique porte sur tout le patrimoine, pas sur la sélection).
   */
  const hasActiveFilters =
    Boolean(debouncedSearch.trim()) ||
    Boolean(accountFilter) ||
    Boolean(platformFilterId) ||
    pnlFilter !== "all" ||
    assetClassFilters.length > 0 ||
    currencyFilters.length > 0 ||
    envelopeFilters.length < allEnvelopesCount;

  const resetFilters = useCallback(() => {
    setSearchInput("");
    setAccountFilter("");
    setPnlFilter("all");
    setAssetClassFilters([]);
    setCurrencyFilters([]);
    setPlatformFilter(null);
    // Réinitialiser = revenir à « toutes les enveloppes », pas à aucune :
    // le seul état où le tableau est vide n'est pas un point de départ.
    onEnvelopeFiltersChange?.(Object.keys(ACCOUNT_TYPES) as AccountType[]);
  }, [onEnvelopeFiltersChange, setPlatformFilter]);

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
  /** +2 : colonne sélection + colonne expand (plus de colonne ⋯ — actions dans l’historique) */
  const visibleColCount = visibleLeafIds.length + 2;

  /**
   * Colonnes visibles avec leur largeur — les en-têtes de groupe rendent une
   * cellule par colonne pour que leurs totaux tombent sous la colonne qu'ils
   * totalisent, quel que soit l'ordre choisi par l'utilisateur.
   */
  const groupHeaderColumns = useMemo(
    () =>
      table.getVisibleLeafColumns().map((c) => ({
        id: c.id,
        size: c.getSize(),
      })),
    // `columnSizing` n'est pas lu directement : c'est lui qui fait bouger
    // `getSize()`, d'où sa présence explicite dans les dépendances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, visibleLeafKey, columnSizing]
  );
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

  /**
   * Export CSV de ce qui est à l'écran.
   *
   * Il portait sur une sélection par cases à cocher, dont la colonne a
   * disparu. Exporter les lignes filtrées revient au même geste en un clic de
   * moins : ce que l'utilisateur voit est ce qu'il emporte. Les colonnes
   * exportées restent celles affichées, dans leur ordre.
   */
  function downloadSelectionCsv() {
    const selected = filteredHoldings;
    if (selected.length === 0) return;
    const csv = holdingsToCsv(selected, visibleLeafIds, baseCurrency);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `positions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-3 sm:space-y-4" data-testid="holdings-section">
      {/*
        Plus de branche `cto` / `pea` : leurs poches d'espèces sont éditées
        dans l'onglet « PEA & CTO », qui porte désormais ces enveloppes. `av`
        reste ici, son onglet étant bien une vue filtrée de ce tableau.
      */}
      {tab === "av" && (
        <>
          <EnvelopeCashPanel envelope="AV" />
          <div className="mb-1 sm:mb-2">
            <LifeInsuranceTab
              avHoldings={holdings.filter((h) => h.accountType === "AV")}
            />
          </div>
        </>
      )}
      <PortfolioKpiCards
        holdings={filteredHoldings}
        history={history}
        baseCurrency={baseCurrency}
        filtered={hasActiveFilters}
      />
      <div className="card-flat min-w-0 overflow-hidden">
        <HoldingsToolbar
          title={positionsTitle}
          onExportCsv={downloadSelectionCsv}
          subtitle={
            envelopeFilters.length === allEnvelopesCount
              ? "Positions calculées depuis le journal · CUMP multi-plateforme"
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
              groupBy === "assetClass"
                ? classGroups.map((g) => g.assetClass)
                : groupBy === "blockchain"
                  ? blockchainGroups.map((g) => g.blockchainKey)
                  : categoryGroups.map((g) => g.category)
            )
          }
          search={searchInput}
          onSearchChange={setSearchInput}
          accountFilter={accountFilter}
          onAccountFilterChange={setAccountFilter}
          pnlFilter={pnlFilter}
          onPnlFilterChange={setPnlFilter}
          assetClassOptions={chipOptions.assetClasses}
          assetClassFilters={assetClassFilters}
          onAssetClassFiltersChange={setAssetClassFilters}
          currencyOptions={chipOptions.currencies}
          currencyFilters={currencyFilters}
          onCurrencyFiltersChange={setCurrencyFilters}
          platformOptions={chipOptions.platforms}
          platformFilterId={platformFilterId}
          onPlatformFilterChange={(id) =>
            setPlatformFilter(
              id,
              chipOptions.platforms.find((p) => p.value === id)?.label
            )
          }
          platformFilterLabel={platformFilterLabel}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetFilters}
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
              groupBy,
              sorting: sorting.map((s) => ({ id: s.id, desc: s.desc })),
              pnlFilter,
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
            // Absent sur les vues créées avant l'ajout de ce champ : ne pas
            // écraser le regroupement/tri courant par un défaut arbitraire.
            if (view.groupBy !== undefined) {
              setGroupBy(parseHoldingsGroupBy(view.groupBy));
            }
            if (view.sorting) {
              setSorting(view.sorting);
            }
            if (view.pnlFilter !== undefined) {
              setPnlFilter(parsePnlFilter(view.pnlFilter));
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
              // Seul le verrou refuse le décochage — pas l'appartenance au
              // groupe obligatoire, qui dit seulement « affichée au départ ».
              // La case du sélecteur applique la même règle : les deux doivent
              // s'accorder, sinon elle se décoche à l'écran sans rien changer.
              const meta = columnMeta(id);
              if (meta?.locked) {
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
          id="holdings-table-scroll"
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
                  {hg.headers.map((h) => {
                    const colId = h.column.id;
                    const size = h.getSize();
                    const floor = columnMinWidth(colId);
                    const isResizing = h.column.getIsResizing();
                    const isLocked = lockedSizing[colId] != null;
                    const fullLabel =
                      columnMeta(colId)?.label ??
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
                          textAlign: columnAlign(colId),
                        }}
                        title={`${fullLabel}\nClic = trier · glisser = déplacer · bord = largeur`}
                        /*
                          L'en-tête entier porte le glisser-déposer, au lieu
                          d'une poignée dédiée. Celle-ci occupait seize pixels
                          dans chacune des dix colonnes — assez pour tronquer
                          « TICKER » en « TICK… » — et le mockup n'en montre
                          aucune. La cible est désormais plus grande, pas plus
                          petite.
                        */
                        draggable
                        onDragStart={(e) => {
                          dragColRef.current = colId;
                          setDraggingCol(colId);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", colId);
                        }}
                        onDragEnd={() => {
                          dragColRef.current = null;
                          setDraggingCol(null);
                          setDragOverCol(null);
                        }}
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
                            className="min-w-0 truncate"
                            data-column-label
                            title={fullLabel}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                          </span>
                          {/* Hors du span tronqué : sur les colonnes étroites (ticker,
                              devise, qté), le glyphe texte précédent se faisait couper
                              net par l'ellipse — une icône séparée, jamais tronquée. */}
                          {h.column.getIsSorted() === "asc" && (
                            <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                          )}
                          {h.column.getIsSorted() === "desc" && (
                            <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                          )}
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
                    onOpenAsset: onRowDoubleClick,
                    selectedAssetId,
                  })
                )}
              {!loading &&
                groupMode &&
                activeGroups.map((group) => {
                  const groupKey =
                    "assetClass" in group
                      ? group.assetClass
                      : "blockchainKey" in group
                        ? group.blockchainKey
                        : group.category;
                  const expanded = !isGroupCollapsed(groupKey);
                  return (
                    <Fragment key={groupKey}>
                      {"assetClass" in group ? (
                        <PositionGroupHeader
                          label={group.label}
                          assetClass={group.assetClass}
                          count={group.count}
                          totalMarketValue={group.totalMarketValue}
                          totalUnrealizedPnl={group.totalUnrealizedPnl}
                          unrealizedPnlPct={group.unrealizedPnlPct}
                          weightPct={group.weightPct}
                          spark={classSeries?.values.get(group.assetClass)}
                          periodPnl={
                            classSeries?.periodPnl.get(group.assetClass) ?? null
                          }
                          periodPct={
                            classSeries?.periodPct.get(group.assetClass) ?? null
                          }
                          estimated={classSeries?.incomplete.has(
                            group.assetClass
                          )}
                          totalCostBasis={group.totalCostBasis}
                          baseCurrency={baseCurrency}
                          expanded={expanded}
                          onToggle={() => toggleGroupCollapsed(groupKey)}
                          columns={groupHeaderColumns}
                        />
                      ) : (
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
                      )}
                      {expanded &&
                        group.positions.map((pos) => {
                          const row = rowByAssetId.get(pos.assetId);
                          if (!row) return null;
                          return renderHoldingRow(row, {
                    onOpenAsset: onRowDoubleClick,
                    selectedAssetId,
                  });
                        })}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/*
          Barre de défilement explicite, collée au bas du cadre.

          La barre native est superposée sur la plupart des systèmes : elle
          n'occupe aucune place et ne se montre qu'en cours de défilement, si
          bien qu'à la souris les colonnes de droite étaient inatteignables.
          Posée après le tableau, elle obligerait de surcroît à descendre
          trente lignes pour l'atteindre puis à remonter pour lire.
        */}
        <div className="sticky bottom-0 z-10 bg-[var(--card)] px-[var(--space-3)] pb-[var(--space-2)] pt-[var(--space-1)]">
          <HorizontalScrollbar
            targetRef={scrollWrapRef}
            controls="holdings-table-scroll"
            label="Défilement horizontal du portefeuille"
          />
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
