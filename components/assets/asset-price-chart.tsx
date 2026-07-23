"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import { fetchJson } from "@/app/lib/api-client";
import {
  type ChartStyle,
  type PriceHistoryRange,
  type PriceHistoryResult,
  barIntervalLabel,
} from "@/app/lib/market/price-history-types";
import {
  buildTotalReturnSeries,
  computePositionPnlSummary,
  type LedgerTxLite,
} from "@/app/lib/portfolio/total-return";
import {
  buildAggregatedPerfSeries,
  clipSeriesFromFirstBuy,
  getFirstBuyAt,
  isPerfPeriodEnabled,
  type AggregatedPerfPoint,
  type AggregateInterval,
  type PerfMetricMode,
} from "@/app/lib/portfolio/perf-aggregate";
import {
  BENCHMARK_MODES,
  buildBenchmarkSeries,
  type BenchmarkMode,
} from "@/app/lib/portfolio/benchmark";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildChartTxMarkers,
  ensureSession,
  formatCompact,
  safeFinite,
} from "@/components/assets/chart/chart-markers";
import { HistorySourceBadge } from "@/components/assets/chart/history-source-badge";
import {
  SessionCandleChart,
  SessionLineChart,
} from "@/components/assets/chart/session-price-charts";
import {
  PerfAggTooltip,
  PerfColumnShape,
} from "@/components/assets/chart/perf-chart-parts";

// Re-export type for consumers that imported ChartTxMarker from this module
export type { ChartTxMarker } from "@/components/assets/chart/chart-markers";

type MainTab = "price" | "perf";
type PerfChartStyle = "line" | "columns";

/** Périodes vue Cours (sans 5Y) */
const PERIODS: { id: PriceHistoryRange; label: string }[] = [
  { id: "7d", label: "7J" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1A" },
  { id: "all", label: "Tout" },
];

/** Périodes vue Performance — défaut 7J */
const PERF_PERIODS: { id: PriceHistoryRange; label: string }[] = [
  { id: "7d", label: "7J" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1A" },
  { id: "5y", label: "5Y" },
  { id: "all", label: "Tout" },
];

const STYLES: { id: ChartStyle; label: string }[] = [
  { id: "line", label: "Courbe" },
  { id: "candle", label: "Chandeliers" },
];

const PERF_STYLES: { id: PerfChartStyle; label: string }[] = [
  { id: "line", label: "Courbe" },
  { id: "columns", label: "Colonnes" },
];

/** Δ = flux · Σ = total return · Div = cash dividendes nets cumulés */
const PERF_METRIC_MODES: { id: PerfMetricMode; label: string; title: string }[] =
  [
    {
      id: "period",
      label: "Δ Périodique",
      title: "Variation de chaque période (prix + réalisé + revenus nets du jour)",
    },
    {
      id: "cumul",
      label: "Σ Cumulée",
      title:
        "P&L économique cumulé (valeur + div. nets + réalisé − cash investi)",
    },
    {
      id: "dividends",
      label: "Dividendes",
      title:
        "Cash dividendes / revenus nets cumulés (après prélèvement à la source)",
    },
  ];

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "price", label: "Cours de l'actif" },
  { id: "perf", label: "Performance" },
];

const PERF_POS = "#10b981";
const PERF_NEG = "#f43f5e";

function ChartSkeleton() {
  return (
    <div className="space-y-3" data-testid="asset-chart-skeleton">
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <Skeleton key={p.id} className="h-7 w-11" />
        ))}
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}


export function AssetPriceChart({
  assetId,
  enabled = true,
  transactions = [],
  currentPriceEur,
  holdingQty,
  holdingAvgCostEur,
}: {
  assetId: string;
  enabled?: boolean;
  /** Position ledger txs — used for Total Return curve + markers */
  transactions?: LedgerTxLite[];
  /** Cours actuel EUR (quote) pour KPIs latents */
  currentPriceEur?: number | null;
  /** Quantité détenue (holding) — optionnel, recalculée depuis le ledger si absent */
  holdingQty?: number | null;
  holdingAvgCostEur?: number | null;
}) {
  const [mainTab, setMainTab] = useState<MainTab>("price");
  const [range, setRange] = useState<PriceHistoryRange>("1m");
  const [style, setStyle] = useState<ChartStyle>("line");
  /** Échelle Y : linéaire (défaut) ou logarithmique */
  const [yScale, setYScale] = useState<"linear" | "log">("linear");
  /** Perf : période par défaut 7J, style Courbe, métrique Σ cumulée */
  const [perfRange, setPerfRange] = useState<PriceHistoryRange>("7d");
  const [perfStyle, setPerfStyle] = useState<PerfChartStyle>("line");
  const [perfMetric, setPerfMetric] = useState<PerfMetricMode>("cumul");
  const [prevPerfMetric, setPrevPerfMetric] = useState(perfMetric);
  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>("none");

  const firstBuyAt = useMemo(
    () => getFirstBuyAt(transactions),
    [transactions]
  );

  /** Onglet Performance : nécessite au moins un achat dans le journal */
  const canShowPerf = Boolean(firstBuyAt) && transactions.length > 0;

  const perfPeriodEnabled = useMemo(() => {
    const map = {} as Record<PriceHistoryRange, boolean>;
    for (const p of PERF_PERIODS) {
      map[p.id] = isPerfPeriodEnabled(p.id, firstBuyAt);
    }
    return map;
  }, [firstBuyAt]);

  // Ajustements d’état pendant le render (remplace les effects de sync)
  if (perfMetric !== prevPerfMetric) {
    setPrevPerfMetric(perfMetric);
    setPerfStyle(perfMetric === "period" ? "columns" : "line");
  }
  if (!canShowPerf && mainTab === "perf") {
    setMainTab("price");
  }
  if (!isPerfPeriodEnabled(perfRange, firstBuyAt) && perfRange !== "7d") {
    setPerfRange("7d");
  }

  const activeRange: PriceHistoryRange =
    mainTab === "price" ? range : perfRange;

  // Perf + fenêtres longues : étendre l'historique jusqu'au 1er achat
  const historySince =
    mainTab === "perf" && firstBuyAt ? firstBuyAt : null;

  const q = useQuery({
    queryKey: ["asset-history", assetId, activeRange, historySince],
    enabled: Boolean(assetId) && enabled,
    queryFn: () => {
      const params = new URLSearchParams({ range: activeRange });
      if (historySince) params.set("since", historySince);
      return fetchJson<PriceHistoryResult>(
        `/api/assets/${assetId}/history?${params.toString()}`
      );
    },
    staleTime: 60_000,
  });

  const points = useMemo(
    () => (q.data?.points ?? []).map(ensureSession),
    [q.data?.points]
  );
  const barInterval = q.data?.barInterval;

  const { series, buyMarkers, sellMarkers, divMarkers, allMarkers, seriesSummary } =
    useMemo(() => {
      // barInterval pilote l'alignement txs↔barres (évite biais jour-1 midnight UTC)
      const { series: s, summary } = buildTotalReturnSeries(points, transactions, {
        barInterval: barInterval ?? undefined,
      });
      // OHLC strictement aligné sur les points de cours affichés (même ordre / indices)
      const ohlcBars = points.map((p) => {
        const n = ensureSession(p);
        return {
          date: n.date,
          label: n.label,
          close: n.close,
          open: n.open,
          high: n.high,
          low: n.low,
        };
      });
      const markers = buildChartTxMarkers(ohlcBars, transactions);
      return {
        series: s,
        seriesSummary: summary,
        allMarkers: markers,
        buyMarkers: markers.filter((m) => m.kind === "BUY"),
        sellMarkers: markers.filter((m) => m.kind === "SELL"),
        divMarkers: markers.filter((m) => m.kind === "DIVIDEND"),
      };
    }, [points, transactions, barInterval]);

  /**
   * KPIs performance :
   * - Latente = (cours actuel − CUMP) × qty
   * - Réalisée = Σ ventes qty × (prix vente − CUMP à la vente)
   * Priorité cours : prop quote → dernier close de la série.
   */
  const pnlKpis = useMemo(() => {
    const priceFromSeries = series[series.length - 1]?.close;
    const price = safeFinite(
      currentPriceEur != null && Number.isFinite(currentPriceEur) && currentPriceEur > 0
        ? currentPriceEur
        : priceFromSeries ?? 0
    );

    // Replay ledger pour réalisé + CUMP/qty (source de vérité)
    const fromLedger = computePositionPnlSummary(transactions, price);

    // KPI latente / réalisé : ledger rejoué = même vérité que la série (parité P&L).
    // Holding API uniquement si aucune tx (import partiel / edge).
    const useLedger = transactions.length > 0;
    const qty = safeFinite(
      useLedger
        ? fromLedger.qty
        : holdingQty != null && Number.isFinite(holdingQty)
          ? Math.max(0, holdingQty)
          : 0
    );
    const cump = safeFinite(
      useLedger
        ? fromLedger.cumpEur
        : holdingAvgCostEur != null &&
            Number.isFinite(holdingAvgCostEur) &&
            holdingAvgCostEur > 0 &&
            qty > 0
          ? holdingAvgCostEur
          : 0
    );

    const latentPnlEur = safeFinite(qty * (price - cump));
    const costBasis = qty * cump;
    const latentPnlPct = safeFinite(
      costBasis > 1e-9 ? (latentPnlEur / costBasis) * 100 : 0
    );

    return {
      latentPnlEur,
      latentPnlPct,
      realizedPnlEur: safeFinite(fromLedger.realizedPnlEur),
      hasSells: fromLedger.hasSells,
      cumpEur: cump,
      qty,
      price,
      seriesLatent: safeFinite(seriesSummary.latentPnlEur),
    };
  }, [
    transactions,
    currentPriceEur,
    holdingQty,
    holdingAvgCostEur,
    series,
    seriesSummary.latentPnlEur,
  ]);

  /** Série de perf : démarre au premier achat, jamais avant */
  const perfSeriesFromBuy = useMemo(
    () => clipSeriesFromFirstBuy(series, firstBuyAt),
    [series, firstBuyAt]
  );

  const { intervalType: perfInterval, points: perfChartDataRaw } = useMemo(() => {
    if (mainTab !== "perf") {
      return {
        intervalType: "day" as AggregateInterval,
        points: [] as AggregatedPerfPoint[],
      };
    }
    return buildAggregatedPerfSeries(perfSeriesFromBuy, perfRange, perfMetric);
  }, [mainTab, perfSeriesFromBuy, perfRange, perfMetric]);

  // Indice CAC40 (Yahoo) quand mode index
  const indexQ = useQuery({
    queryKey: [
      "benchmark-index",
      "cac40",
      perfSeriesFromBuy[0]?.date,
      perfSeriesFromBuy[perfSeriesFromBuy.length - 1]?.date,
    ],
    enabled:
      mainTab === "perf" &&
      benchmarkMode === "index" &&
      perfSeriesFromBuy.length >= 2,
    queryFn: () => {
      const from = perfSeriesFromBuy[0]!.date;
      const to = perfSeriesFromBuy[perfSeriesFromBuy.length - 1]!.date;
      const params = new URLSearchParams({
        symbol: "cac40",
        from,
        to,
      });
      return fetchJson<{
        points: Array<{ date: string; close: number }>;
        source?: string;
      }>(`/api/benchmark?${params.toString()}`);
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  /** Benchmark aligné sur la série clipée puis re-échantillonné sur l'agrégat */
  const perfChartData = useMemo(() => {
    if (benchmarkMode === "none" || perfChartDataRaw.length === 0) {
      return perfChartDataRaw.map((p) => ({ ...p, benchmarkEur: 0 }));
    }
    const bench = buildBenchmarkSeries(
      perfSeriesFromBuy,
      benchmarkMode,
      benchmarkMode === "index" ? indexQ.data?.points : undefined
    );
    const byDate = new Map(bench.map((b) => [b.date, b.benchmarkEur]));
    return perfChartDataRaw.map((p) => ({
      ...p,
      benchmarkEur:
        byDate.get(p.date) ??
        byDate.get(p.dateEnd) ??
        byDate.get(p.dateStart) ??
        0,
    }));
  }, [
    perfChartDataRaw,
    perfSeriesFromBuy,
    benchmarkMode,
    indexQ.data?.points,
  ]);

  const delta = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0]!.close;
    const last = points[points.length - 1]!.close;
    const abs = last - first;
    const pct = first > 0 ? (abs / first) * 100 : 0;
    return { abs, pct, up: abs >= 0 };
  }, [points]);

  /** Domaine Y symétrique → ligne 0 au milieu du graphique */
  const perfYDomain = useMemo((): [number, number] => {
    let maxAbs = 0;
    for (const p of perfChartData) {
      maxAbs = Math.max(
        maxAbs,
        Math.abs(p.chartValueEur ?? 0),
        Math.abs((p as { benchmarkEur?: number }).benchmarkEur ?? 0)
      );
    }
    const pad = Math.max(maxAbs * 1.12, 1);
    return [-pad, pad];
  }, [perfChartData]);

  const lastChartValue = useMemo(() => {
    if (perfChartData.length === 0) return null;
    const last = perfChartData[perfChartData.length - 1]!;
    const eur = last.chartValueEur;
    return { eur, up: eur >= 0, pct: last.chartValuePct };
  }, [perfChartData]);

  const chartH = "h-[280px]";

  if (q.isLoading && !q.data) {
    return (
      <div
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5"
        data-testid="asset-price-chart"
      >
        <div className="mb-2 flex gap-1">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-24" />
        </div>
        <ChartSkeleton />
      </div>
    );
  }

  const isPrice = mainTab === "price";
  const isPerf = mainTab === "perf";
  const historyError = q.isError && !q.data;

  const aggHint =
    perfInterval === "day"
      ? "1 j"
      : perfInterval === "week"
        ? "1 sem."
        : "1 mois";

  return (
    <div
      className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 transition-opacity duration-200"
      data-testid="asset-price-chart"
      data-main-tab={mainTab}
    >
      {/* Ligne 1 : mode (gauche) + style (droite) — hiérarchie claire */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-0.5"
          role="tablist"
          aria-label="Vue du graphique"
        >
          {MAIN_TABS.filter((t) => t.id === "price" || canShowPerf).map(
            (t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={mainTab === t.id}
                data-testid={`chart-main-tab-${t.id}`}
                onClick={() => setMainTab(t.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
                  mainTab === t.id
                    ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                {t.label}
              </button>
            )
          )}
        </div>
        {!canShowPerf && (
          <p className="text-meta w-full basis-full sm:ml-auto sm:w-auto sm:basis-auto">
            Performance après le premier achat
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {isPrice && delta && (
            <span
              className={cn(
                "text-[10px] font-medium tabular-nums",
                delta.up
                  ? "text-sky-600 dark:text-sky-400"
                  : "text-[var(--muted-foreground)]"
              )}
            >
              {delta.up ? "+" : ""}
              {formatCurrency(delta.abs, "EUR")} ({delta.up ? "+" : ""}
              {delta.pct.toFixed(1)} %)
            </span>
          )}
          {isPrice && (
            <div
              className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-0.5"
              role="tablist"
              aria-label="Style de graphique"
            >
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={style === s.id}
                  data-testid={`chart-style-${s.id}`}
                  onClick={() => setStyle(s.id)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-medium transition",
                    style === s.id
                      ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {isPrice && (
            <div
              className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-0.5"
              role="tablist"
              aria-label="Échelle de l'axe Y"
            >
              {(
                [
                  { id: "linear" as const, label: "Linéaire" },
                  { id: "log" as const, label: "Log" },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={yScale === s.id}
                  data-testid={`chart-yscale-${s.id}`}
                  onClick={() => setYScale(s.id)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-medium transition",
                    yScale === s.id
                      ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {isPerf && (
            <>
              <div
                className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-0.5"
                role="tablist"
                aria-label="Métrique de performance"
              >
                {PERF_METRIC_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    title={m.title}
                    aria-selected={perfMetric === m.id}
                    data-testid={`perf-metric-${m.id}`}
                    onClick={() => setPerfMetric(m.id)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-medium transition",
                      perfMetric === m.id
                        ? "bg-teal-700 text-white dark:bg-teal-600"
                        : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div
                className="inline-flex rounded-lg border border-[var(--border)] bg-slate-50 p-0.5 dark:bg-slate-900/60"
                role="tablist"
                aria-label="Style performance"
              >
                {PERF_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={perfStyle === s.id}
                    data-testid={`perf-style-${s.id}`}
                    onClick={() => setPerfStyle(s.id)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-medium transition",
                      perfStyle === s.id
                        ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                        : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <label
                className="inline-flex items-center gap-1 text-[10px] text-slate-500"
                title="Comparer la Σ personnelle à une référence"
              >
                <span className="hidden sm:inline">Vs</span>
                <select
                  className="input !w-auto !py-0.5 !text-[10px]"
                  value={benchmarkMode}
                  onChange={(e) =>
                    setBenchmarkMode(e.target.value as BenchmarkMode)
                  }
                  data-testid="perf-benchmark"
                >
                  {BENCHMARK_MODES.map((m) => (
                    <option key={m.id} value={m.id} title={m.title}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </div>

      {/* Ligne 2 : sélecteurs de période (sous les onglets) */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {isPrice && (
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Période">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={range === p.id}
                onClick={() => setRange(p.id)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-medium transition",
                  range === p.id
                    ? "bg-teal-700 text-white dark:bg-teal-600"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {isPerf && (
          <div
            className="flex flex-wrap items-center gap-1"
            role="tablist"
            aria-label="Période performance"
          >
            {PERF_PERIODS.map((p) => {
              const enabled = perfPeriodEnabled[p.id] !== false;
              const selected = perfRange === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-disabled={!enabled}
                  disabled={!enabled}
                  title={
                    enabled
                      ? undefined
                      : "Historique de position trop court pour cette période"
                  }
                  data-testid={`perf-range-${p.id}`}
                  data-enabled={enabled ? "true" : "false"}
                  onClick={() => {
                    if (!enabled) return;
                    setPerfRange(p.id);
                  }}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-medium transition",
                    !enabled &&
                      "cursor-not-allowed opacity-40 text-slate-500 dark:text-slate-500 bg-slate-100/70 dark:bg-slate-800/50",
                    enabled &&
                      selected &&
                      "bg-teal-700 text-white dark:bg-teal-600",
                    enabled &&
                      !selected &&
                      "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
        {!historyError && (
          <HistorySourceBadge
            source={q.data?.source}
            barIntervalLabel={
              isPrice && barInterval
                ? barIntervalLabel(barInterval)
                : isPerf
                  ? `pas ${aggHint}`
                  : null
            }
            extendedToFirstBuy={Boolean(q.data?.extendedToFirstBuy)}
            className="ml-1"
          />
        )}
      </div>

      {/* KPIs Performance : latente (position) vs réalisée (ventes) — distincts de Σ courbe */}
      {isPerf && (
        <div
          className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="perf-kpis"
        >
          <div className="rounded-lg border border-[var(--border)] bg-slate-50/80 px-3 py-2 dark:bg-slate-900/50">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Plus-value latente
            </div>
            <div
              className={cn(
                "mt-0.5 text-base font-bold tabular-nums leading-tight",
                pnlKpis.latentPnlEur > 0 &&
                  "text-emerald-600 dark:text-emerald-400",
                pnlKpis.latentPnlEur < 0 && "text-rose-600 dark:text-rose-400",
                pnlKpis.latentPnlEur === 0 && "text-slate-500 dark:text-slate-400"
              )}
              data-testid="kpi-latent-chart"
            >
              {pnlKpis.latentPnlEur >= 0 ? "+" : ""}
              {formatCurrency(pnlKpis.latentPnlEur, "EUR")}
              <span className="ml-1.5 text-sm font-semibold opacity-90">
                ({pnlKpis.latentPnlPct >= 0 ? "+" : ""}
                {pnlKpis.latentPnlPct.toFixed(1)} %)
              </span>
            </div>
            <p className="mt-1 text-[9px] leading-snug text-slate-400">
              Position ouverte : (cours − CUMP) × qté
              {pnlKpis.qty > 0 &&
                ` · CUMP ${formatCurrency(pnlKpis.cumpEur, "EUR")}`}
              . ≠ courbe Σ (qui inclut div. + réalisé).
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-slate-50/80 px-3 py-2 dark:bg-slate-900/50">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Plus-value réalisée
            </div>
            <div
              className={cn(
                "mt-0.5 text-base font-bold tabular-nums leading-tight",
                !pnlKpis.hasSells && "text-slate-500 dark:text-slate-400",
                pnlKpis.hasSells &&
                  pnlKpis.realizedPnlEur > 0 &&
                  "text-emerald-600 dark:text-emerald-400",
                pnlKpis.hasSells &&
                  pnlKpis.realizedPnlEur < 0 &&
                  "text-rose-600 dark:text-rose-400",
                pnlKpis.hasSells &&
                  pnlKpis.realizedPnlEur === 0 &&
                  "text-slate-500 dark:text-slate-400"
              )}
              data-testid="kpi-realized"
            >
              {!pnlKpis.hasSells ? (
                "—"
              ) : (
                <>
                  {pnlKpis.realizedPnlEur >= 0 ? "+" : ""}
                  {formatCurrency(pnlKpis.realizedPnlEur, "EUR")}
                </>
              )}
            </div>
            <p className="mt-1 text-[9px] leading-snug text-slate-400">
              {pnlKpis.hasSells
                ? "Σ ventes clôturées : qté × (prix vente − CUMP)"
                : "Aucune vente enregistrée"}
            </p>
          </div>

          <div className="rounded-lg border border-teal-200/60 bg-teal-50/40 px-3 py-2 dark:border-teal-900/40 dark:bg-teal-950/30 sm:col-span-2 lg:col-span-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-teal-800/80 dark:text-teal-200/80">
              P&amp;L total (Σ courbe)
            </div>
            <div
              className={cn(
                "mt-0.5 text-base font-bold tabular-nums leading-tight",
                (lastChartValue?.eur ?? seriesSummary.totalPnlEur) > 0 &&
                  "text-emerald-600 dark:text-emerald-400",
                (lastChartValue?.eur ?? seriesSummary.totalPnlEur) < 0 &&
                  "text-rose-600 dark:text-rose-400",
                (lastChartValue?.eur ?? seriesSummary.totalPnlEur) === 0 &&
                  "text-slate-500 dark:text-slate-400"
              )}
              data-testid="kpi-total-pnl"
            >
              {(() => {
                const v =
                  perfMetric === "cumul"
                    ? (lastChartValue?.eur ?? seriesSummary.totalPnlEur)
                    : seriesSummary.totalPnlEur;
                return (
                  <>
                    {v >= 0 ? "+" : ""}
                    {formatCurrency(v, "EUR")}
                  </>
                );
              })()}
            </div>
            <p className="mt-1 text-[9px] leading-snug text-slate-500 dark:text-slate-400">
              Valeur + div. nets + réalisé − cash investi (métrique de la courbe
              Σ cumulée).
            </p>
          </div>
        </div>
      )}

      {/* Zone graphique unique */}
      <div className={cn("relative w-full", chartH)}>
        {q.isFetching && q.data && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end p-1">
            <span className="rounded bg-slate-900/70 px-1.5 py-0.5 text-[9px] text-white">
              …
            </span>
          </div>
        )}

        {historyError && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
            <span>Impossible de charger l&apos;historique de cours.</span>
            <button
              type="button"
              className="rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-slate-200 dark:text-slate-900"
              onClick={() => void q.refetch()}
            >
              Réessayer
            </button>
          </div>
        )}

        {!historyError &&
          isPrice &&
          (points.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              Aucun point de cours
            </div>
          ) : style === "candle" ? (
            <SessionCandleChart
              points={points}
              barInterval={barInterval}
              markers={allMarkers}
              scale={yScale}
            />
          ) : (
            <SessionLineChart
              points={points}
              barInterval={barInterval}
              markers={allMarkers}
              scale={yScale}
            />
          ))}

        {!historyError &&
          isPerf &&
          (perfChartData.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-slate-500">
              <span>
                {firstBuyAt
                  ? "Pas encore de performance calculable sur cette période"
                  : "Aucune transaction d'achat : la performance démarre au premier achat"}
              </span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={perfChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                barCategoryGap="28%"
              >
                <defs>
                  <linearGradient id="perfPosFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PERF_POS} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={PERF_POS} stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="perfNegFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PERF_NEG} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={PERF_NEG} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                  height={24}
                />
                <YAxis
                  width={52}
                  tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v: number) => formatCompact(v)}
                  domain={perfYDomain}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                />
                <Tooltip
                  // Recharts 3 + React 19 : ne pas passer isAnimationActive (fuit vers le DOM)
                  // ni un élément pré-créé (cloneElement propage des props invalides).
                  content={(tipProps) => (
                    <PerfAggTooltip
                      active={Boolean(tipProps.active)}
                      payload={
                        tipProps.payload as unknown as Array<{
                          payload?: AggregatedPerfPoint;
                        }>
                      }
                      intervalType={perfInterval}
                      metricMode={perfMetric}
                    />
                  )}
                  cursor={
                    perfStyle === "columns"
                      ? { fill: "rgba(148,163,184,0.12)" }
                      : {
                          stroke: "var(--muted-foreground)",
                          strokeDasharray: "3 3",
                        }
                  }
                />

                {perfStyle === "line" && (
                  <>
                    <Area
                      type="monotone"
                      dataKey="pos"
                      name="Gain"
                      stroke="none"
                      fill="url(#perfPosFill)"
                      legendType="none"
                      animationDuration={0}
                    />
                    <Area
                      type="monotone"
                      dataKey="neg"
                      name="Perte"
                      stroke="none"
                      fill="url(#perfNegFill)"
                      legendType="none"
                      animationDuration={0}
                    />
                    <Line
                      type="monotone"
                      dataKey="chartValueEur"
                      name={
                        perfMetric === "period"
                          ? "Δ période"
                          : perfMetric === "dividends"
                            ? "Dividendes nets"
                            : "Σ cumulée"
                      }
                      stroke={
                        perfMetric === "dividends"
                          ? "#f59e0b"
                          : lastChartValue?.up !== false
                            ? "#059669"
                            : "#e11d48"
                      }
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                      animationDuration={0}
                    />
                    {benchmarkMode !== "none" && (
                      <Line
                        type="monotone"
                        dataKey="benchmarkEur"
                        name={
                          benchmarkMode === "price"
                            ? "Cours seul"
                            : benchmarkMode === "index"
                              ? "CAC 40"
                              : "Cash 0 %"
                        }
                        stroke={
                          benchmarkMode === "index" ? "#2563eb" : "#64748b"
                        }
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                        dot={false}
                        animationDuration={0}
                      />
                    )}
                  </>
                )}

                {perfStyle === "columns" && (
                  <Bar
                    dataKey="chartValueEur"
                    name={
                      perfMetric === "period" ? "Δ période" : "Σ cumulée"
                    }
                    maxBarSize={36}
                    animationDuration={0}
                    shape={(barProps) => (
                      <PerfColumnShape
                        x={typeof barProps.x === "number" ? barProps.x : 0}
                        y={typeof barProps.y === "number" ? barProps.y : 0}
                        width={
                          typeof barProps.width === "number" ? barProps.width : 0
                        }
                        height={
                          typeof barProps.height === "number"
                            ? barProps.height
                            : 0
                        }
                        payload={
                          (barProps as { payload?: AggregatedPerfPoint })
                            .payload
                        }
                      />
                    )}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          ))}
      </div>

      {/* Légende / note selon l'onglet */}
      {isPrice &&
        (buyMarkers.length > 0 ||
          sellMarkers.length > 0 ||
          divMarkers.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-3 text-[9px] text-slate-500">
            {buyMarkers.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-[8px] font-bold text-white">
                  +
                </span>
                Achat
              </span>
            )}
            {sellMarkers.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white">
                  −
                </span>
                Vente
              </span>
            )}
            {divMarkers.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[7px] font-bold text-white">
                  D
                </span>
                Dividende
              </span>
            )}
            <span className="text-slate-400">· survoler une icône pour le détail</span>
          </div>
        )}
      {isPerf && (
        <p className="mt-1.5 text-[9px] leading-snug text-slate-500 dark:text-slate-400">
          {perfMetric === "period" ? (
            <>
              <strong>Δ Périodique</strong> = variation de chaque période (qty
              d&apos;ouverture × Δ cours + réalisé + div. nets). Agrégation{" "}
              {aggHint}.
            </>
          ) : perfMetric === "dividends" ? (
            <>
              <strong>Dividendes</strong> = cash revenus nets cumulés (après
              prélèvement à la source + frais courtier). Le brut et le WHT sont
              dans le tooltip. Agrégation {aggHint}.
            </>
          ) : (
            <>
              <strong>Σ Cumulée</strong> = P&amp;L économique net (valeur + div.
              nets + réalisé − cash investi). Agrégation {aggHint}.
            </>
          )}{" "}
          Ligne 0 = point mort · vert = gain · rose = perte.
        </p>
      )}
    </div>
  );
}
