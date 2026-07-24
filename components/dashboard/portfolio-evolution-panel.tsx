"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { HistoryPoint } from "@/app/lib/types/ui";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import {
  buildEvolutionSeries,
  evolutionDeltaSummary,
  evolutionIntervalHint,
  evolutionIntervalLabel,
  isEvolutionRangeEnabled,
  withBenchmarkSeries,
  benchmarkLabel,
  benchmarkGapPct,
  type EvolutionChartStyle,
  type EvolutionMetric,
  type EvolutionRange,
  type EvolutionViewMode,
  type IndexClosePoint,
} from "@/app/lib/portfolio/evolution-aggregate";
import {
  DEFAULT_EVOLUTION_PREFS,
  loadEvolutionPrefs,
  saveEvolutionPrefs,
  type EvolutionBenchmark,
  type EvolutionBenchmarkChoice,
  type EvolutionPrefsV4,
} from "@/app/lib/portfolio/evolution-prefs";
import { loadDefaultBenchmark } from "@/app/lib/portfolio/benchmark-prefs";
import {
  MARKET_INDICES,
  marketIndexLabel,
  type MarketIndexKey,
} from "@/app/lib/portfolio/market-indices";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}
import {
  DecomposedCumulAreas,
  DecomposedCumulColumns,
  DecomposedPeriodChart,
  GlobalColumnsChart,
  GlobalLineChart,
  PeriodColumnsChart,
  PeriodLineChart,
} from "@/components/dashboard/portfolio-evolution-charts";

const RANGES: { id: EvolutionRange; label: string }[] = [
  { id: "7d", label: "7J" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1A" },
  { id: "5y", label: "5A" },
  { id: "all", label: "Tout" },
];

const METRICS: { id: EvolutionMetric; label: string; title: string }[] = [
  {
    id: "cumul",
    label: "Cumulée",
    title: "Niveau de patrimoine à chaque période",
  },
  {
    id: "period",
    label: "Périodique",
    title: "Variation entre deux périodes",
  },
];

const STYLES: { id: EvolutionChartStyle; label: string }[] = [
  { id: "line", label: "Courbe" },
  { id: "columns", label: "Colonnes" },
];

const VIEWS: { id: EvolutionViewMode; label: string; title: string }[] = [
  { id: "global", label: "Globale", title: "Patrimoine total uniquement" },
  {
    id: "decomposed",
    label: "Décomposée",
    title: "Positions, cash, revenus (div. / coupons / loyers), P&L",
  },
];

const BENCHMARK_CHOICES: {
  id: EvolutionBenchmarkChoice;
  label: string;
  title: string;
}[] = [
  {
    id: "default",
    label: "Défaut",
    title: "Benchmark défini dans Préférences",
  },
  { id: "none", label: "Aucun", title: "Pas de comparaison" },
  {
    id: "inflation",
    label: "Inflation",
    title: "Pouvoir d'achat — indice des prix INSEE (IPC France)",
  },
  {
    id: "index",
    label: "Indice",
    title: "Comparaison à un indice de marché réel (au choix)",
  },
];

function Segmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  testIdPrefix,
  size = "md",
  muted = false,
}: {
  items: { id: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  testIdPrefix?: string;
  size?: "md" | "sm";
  /** Contrôles secondaires : moins saillants */
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap rounded-[var(--radius-md)] border p-0.5",
        muted
          ? "border-[var(--border)]/70 bg-transparent"
          : "border-[var(--border)] bg-[var(--muted)]/45"
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            title={item.title}
            aria-selected={selected}
            data-testid={
              testIdPrefix ? `${testIdPrefix}-${item.id}` : undefined
            }
            onClick={() => onChange(item.id)}
            className={cn(
              "rounded-[var(--radius-sm)] font-medium transition",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              size === "sm"
                ? "px-1.5 py-0.5 text-[10px]"
                : "px-2.5 py-1 text-[11px]",
              selected &&
                !muted &&
                "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)]",
              selected &&
                muted &&
                "bg-[var(--muted)] font-semibold text-[var(--foreground)]",
              !selected &&
                "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Module Évolution du portefeuille — V3
 * Hiérarchie : période → lecture/style → options avancées (vue / Vs)
 * Prefs persistées (localStorage versionné).
 * Conçu pour s'insérer dans une colonne de grille (pas de bandeau full-width).
 */
export function PortfolioEvolutionPanel({
  history,
  baseCurrency,
  loading,
  className,
}: {
  history: HistoryPoint[];
  baseCurrency: string;
  loading?: boolean;
  className?: string;
}) {
  const isClient = useIsClient();
  const [prefs, setPrefs] = useState<EvolutionPrefsV4>(DEFAULT_EVOLUTION_PREFS);
  const [userDefaultBm, setUserDefaultBm] = useState<EvolutionBenchmark>("none");
  const [hydrated, setHydrated] = useState(false);
  const styleTouched = useRef(false);

  // Seed prefs/benchmark depuis localStorage au passage client (adjust state while rendering)
  if (isClient && !hydrated) {
    setHydrated(true);
    setPrefs(loadEvolutionPrefs());
    setUserDefaultBm(loadDefaultBenchmark());
  }

  useEffect(() => {
    if (!hydrated) return;
    saveEvolutionPrefs(prefs);
  }, [prefs, hydrated]);

  // Recharger le défaut si l'utilisateur change les Préférences (autre onglet / focus)
  useEffect(() => {
    function onFocus() {
      setUserDefaultBm(loadDefaultBenchmark());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const { range, metric, style, view, benchmark, indexKey, advancedOpen } =
    prefs;

  /** Benchmark effectif (héritage préférences ou override dashboard) */
  const activeBenchmark: EvolutionBenchmark =
    benchmark === "default" ? userDefaultBm : benchmark;

  const update = (patch: Partial<EvolutionPrefsV4>) => {
    setPrefs((p) => ({ ...p, ...patch, v: 4 }));
  };

  const setMetric = (m: EvolutionMetric) => {
    // Soft default style only if user n'a pas forcé le style
    if (!styleTouched.current) {
      update({ metric: m, style: m === "period" ? "columns" : "line" });
    } else {
      update({ metric: m });
    }
  };

  const setStyle = (s: EvolutionChartStyle) => {
    styleTouched.current = true;
    update({ style: s });
  };

  const firstDate = history[0]?.date ?? null;

  const rangeEnabled = useMemo(() => {
    const map = {} as Record<EvolutionRange, boolean>;
    for (const r of RANGES) {
      map[r.id] = isEvolutionRangeEnabled(r.id, firstDate);
    }
    return map;
  }, [firstDate]);

  // Repli 7j si la période courante devient indisponible (adjust state while rendering)
  if (hydrated && !rangeEnabled[range] && range !== "7d") {
    setPrefs((p) => ({ ...p, range: "7d", v: 4 as const }));
  }

  const { points: rawPoints, interval } = useMemo(
    () => buildEvolutionSeries(history, range, metric),
    [history, range, metric]
  );

  // Mode "index" : récupère les clôtures réelles de l'indice choisi sur la
  // fenêtre affichée (marge amont pour disposer d'une clôture de base).
  const wantIndex = view === "global" && activeBenchmark === "index";
  const idxFromKey = rawPoints[0]?.date.slice(0, 10) ?? "";
  const idxToKey = rawPoints[rawPoints.length - 1]?.date.slice(0, 10) ?? "";
  const indexQ = useQuery({
    queryKey: ["evolution-index", indexKey, idxFromKey, idxToKey],
    enabled: wantIndex && rawPoints.length > 1,
    staleTime: 30 * 60_000,
    queryFn: () => {
      const fromMs = Date.parse(rawPoints[0]!.date) - 7 * 24 * 60 * 60 * 1000;
      const from = new Date(fromMs).toISOString();
      const to = rawPoints[rawPoints.length - 1]!.date;
      const params = new URLSearchParams({ symbol: indexKey, from, to });
      return fetchJson<{ points: IndexClosePoint[] }>(
        `/api/benchmark?${params.toString()}`
      );
    },
  });
  const indexData = indexQ.data;
  const indexCloses = useMemo<IndexClosePoint[]>(
    () => indexData?.points ?? [],
    [indexData]
  );

  const points = useMemo(
    () =>
      view === "global" && activeBenchmark !== "none"
        ? withBenchmarkSeries(rawPoints, activeBenchmark, { indexCloses })
        : withBenchmarkSeries(rawPoints, "none"),
    [rawPoints, view, activeBenchmark, indexCloses]
  );

  const gap = useMemo(
    () =>
      view === "global" && activeBenchmark !== "none"
        ? benchmarkGapPct(points)
        : null,
    [points, view, activeBenchmark]
  );

  const benchmarkDisplayName =
    activeBenchmark === "index"
      ? marketIndexLabel(indexKey)
      : benchmarkLabel(activeBenchmark);

  const summary = useMemo(() => evolutionDeltaSummary(points), [points]);

  const empty = !loading && history.length === 0;
  const noPoints = !loading && !empty && points.length === 0;

  const showBenchmark =
    view === "global" && activeBenchmark !== "none";

  return (
    <div
      className={cn(
        "card flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3.5 sm:p-4",
        className
      )}
      data-testid="portfolio-evolution-panel"
    >
      <PanelHeader
        title="Évolution du portefeuille"
        subtitle={
          <>
            Positions et liquidités
            <span className="mx-1 opacity-40">·</span>
            {evolutionIntervalLabel(interval)}
            <span className="sr-only">
              {" "}
              ({evolutionIntervalHint(interval)})
            </span>
            {baseCurrency !== "EUR" ? (
              <>
                <span className="mx-1 opacity-40">·</span>
                {baseCurrency}
              </>
            ) : null}
          </>
        }
        actions={
          summary && points.length > 0 ? (
            <div
              className={cn(
                "shrink-0 text-right text-xs font-semibold tabular-nums",
                summary.delta >= 0
                  ? "text-[var(--success)]"
                  : "text-[var(--danger)]"
              )}
              data-testid="evolution-delta"
              title="Variation de la valeur totale sur la période affichée"
            >
              {summary.delta >= 0 ? "+" : ""}
              {formatCurrency(summary.delta, baseCurrency)}
              <span className="ml-1 font-medium opacity-90">
                ({summary.delta >= 0 ? "+" : ""}
                {summary.pct.toFixed(1)}&nbsp;%)
              </span>
            </div>
          ) : null
        }
      />

      {/* Primaire : période + cumul/périodique · Avancé repliable */}
      <div className="mb-2.5 space-y-2" data-testid="evolution-controls">
        <div
          className="flex min-w-0 flex-wrap items-center gap-0.5 sm:gap-1"
          role="tablist"
          aria-label="Période"
        >
          {RANGES.map((r) => {
            const enabled = rangeEnabled[r.id] !== false;
            const selected = range === r.id;
            return (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-disabled={!enabled}
                disabled={!enabled}
                title={
                  enabled
                    ? undefined
                    : "Historique trop court pour cette période"
                }
                data-testid={`evolution-range-${r.id}`}
                onClick={() => enabled && update({ range: r.id })}
                className={cn(
                  "rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium transition",
                  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                  !enabled &&
                    "cursor-not-allowed bg-[var(--muted)]/40 text-[var(--muted-foreground)] opacity-40",
                  enabled &&
                    selected &&
                    "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)]",
                  enabled &&
                    !selected &&
                    "bg-[var(--muted)]/70 text-[var(--foreground)] hover:bg-[var(--muted)]"
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Segmented
            items={METRICS}
            value={metric}
            onChange={setMetric}
            ariaLabel="Mode de lecture"
            testIdPrefix="evolution-metric"
          />
          <button
            type="button"
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1 text-[11px] font-medium transition",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              advancedOpen
                ? "border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
            aria-expanded={advancedOpen}
            data-testid="evolution-advanced-toggle"
            onClick={() => update({ advancedOpen: !advancedOpen })}
          >
            <SlidersHorizontal className="h-3 w-3" aria-hidden />
            Affichage
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                advancedOpen && "rotate-180"
              )}
              aria-hidden
            />
          </button>
        </div>

        {advancedOpen && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/15 px-2.5 py-2"
            data-testid="evolution-advanced"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Style
              </span>
              <Segmented
                items={STYLES}
                value={style}
                onChange={setStyle}
                ariaLabel="Style de graphique"
                testIdPrefix="evolution-style"
                size="sm"
                muted
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Vue
              </span>
              <Segmented
                items={VIEWS}
                value={view}
                onChange={(v) => update({ view: v })}
                ariaLabel="Mode de vue"
                testIdPrefix="evolution-view"
                size="sm"
                muted
              />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Vs
              </span>
              <Segmented
                items={BENCHMARK_CHOICES}
                value={benchmark}
                onChange={(b) => update({ benchmark: b })}
                ariaLabel="Comparaison"
                testIdPrefix="evolution-benchmark"
                size="sm"
                muted
              />
            </div>
            {activeBenchmark === "index" && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Indice
                </span>
                <select
                  className="input !h-7 !w-auto !min-w-0 !py-0 !pl-2 !pr-6 text-[11px]"
                  value={indexKey}
                  onChange={(e) =>
                    update({ indexKey: e.target.value as MarketIndexKey })
                  }
                  data-testid="evolution-index-select"
                  aria-label="Choix de l'indice de comparaison"
                  title="Indice de marché comparé au portefeuille"
                >
                  {MARKET_INDICES.map((idx) => (
                    <option key={idx.key} value={idx.key} title={idx.hint}>
                      {idx.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {view === "decomposed" && activeBenchmark !== "none" && (
              <p className="text-meta w-full basis-full">
                Comparaison disponible en vue globale
              </p>
            )}
          </div>
        )}
      </div>

      {/* —— Graphique (flex pour s'aligner sur la colonne droite) —— */}
      <div
        className="relative min-h-[12.5rem] w-full flex-1 sm:min-h-[13.5rem]"
        data-testid="evolution-chart"
      >
        <div className="absolute inset-0">
        {loading ? (
          <div
            className="flex h-full flex-col gap-3 px-2 py-2"
            data-testid="evolution-loading-skeleton"
            aria-busy="true"
          >
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="min-h-[10rem] w-full flex-1 rounded-[var(--radius-lg)]" />
            <div className="flex gap-2">
              <Skeleton className="h-2 w-14" />
              <Skeleton className="h-2 w-16" />
              <Skeleton className="h-2 w-12" />
            </div>
          </div>
        ) : empty ? (
          <EmptyPlaceholder
            compact
            title="Historique encore vide"
            description="Actualisez les cours pour enregistrer un premier point de courbe."
          />
        ) : noPoints ? (
          <EmptyPlaceholder
            compact
            title="Période trop courte"
            description="Choisissez une plage plus large ou attendez davantage d'historique."
          />
        ) : view === "decomposed" && metric === "cumul" ? (
          style === "columns" ? (
            <DecomposedCumulColumns data={points} baseCurrency={baseCurrency} />
          ) : (
            <DecomposedCumulAreas data={points} baseCurrency={baseCurrency} />
          )
        ) : view === "decomposed" && metric === "period" ? (
          <DecomposedPeriodChart
            data={points}
            baseCurrency={baseCurrency}
            style={style}
          />
        ) : metric === "period" ? (
          style === "line" ? (
            <PeriodLineChart
              data={points}
              baseCurrency={baseCurrency}
              showBenchmark={showBenchmark}
              benchmarkName={benchmarkDisplayName}
            />
          ) : (
            <PeriodColumnsChart data={points} baseCurrency={baseCurrency} />
          )
        ) : style === "columns" ? (
          <GlobalColumnsChart data={points} baseCurrency={baseCurrency} />
        ) : (
          <GlobalLineChart
            data={points}
            baseCurrency={baseCurrency}
            showBenchmark={showBenchmark}
            benchmarkName={benchmarkDisplayName}
          />
        )}
        </div>
      </div>

      {view === "decomposed" && !empty && points.length > 0 && (
        <p className="text-meta mt-2 shrink-0">
          Revenus du journal · dividendes, coupons, loyers
        </p>
      )}
      {showBenchmark && (
        <p className="text-meta mt-1.5 shrink-0" data-testid="evolution-vs-note">
          Vs {benchmarkDisplayName}
          {gap ? (
            <>
              {" · écart "}
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  gap.gapPct >= 0
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                )}
                title="Écart de performance portefeuille − indice sur la période"
                data-testid="evolution-vs-gap"
              >
                {gap.gapPct >= 0 ? "+" : ""}
                {gap.gapPct.toFixed(1)} pts
              </span>
            </>
          ) : wantIndex && indexQ.isLoading ? (
            " · chargement de l'indice…"
          ) : wantIndex && indexQ.isError ? (
            " · indice indisponible"
          ) : (
            ""
          )}
          {activeBenchmark === "inflation" ? " · IPC France" : ""}
          {benchmark === "default" ? " · défaut préférences" : ""}
        </p>
      )}
    </div>
  );
}
