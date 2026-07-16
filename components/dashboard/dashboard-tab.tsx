"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { Stat } from "@/components/ui/kpi";
import { NewsMacroPanel } from "@/components/dashboard/news-macro-panel";
import { AllocationClassPanel } from "@/components/dashboard/allocation-class-panel";
import { formatCurrency, getAssetClassLabel } from "@/app/lib/utils";
import { type HistoryPoint, type PortfolioAllocation } from "@/app/lib/types/ui";
import { useDisplay } from "@/components/layout/display-provider";

type EvolutionRow = {
  label: string;
  date: string;
  valeur: number;
  cash: number;
  positions: number;
  isLive: boolean;
};

type ClassSlice = { name: string; value: number };

/** Round to 2 decimals (display + pie labels) */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatChartNumber(n: number): string {
  return round2(n).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function DashboardTab({
  baseCurrency,
  summary,
  allocation,
  history,
  historyLoading,
}: {
  baseCurrency: string;
  summary?: Record<string, string | number>;
  allocation?: PortfolioAllocation;
  history: HistoryPoint[];
  historyLoading?: boolean;
}) {
  const { layoutWidth } = useDisplay();

  // Keep last non-empty allocation visible while holdings/history refetch mid-refresh
  // so pie labels never flash empty / disappear until new data arrives.
  const [stableAllocation, setStableAllocation] = useState<PortfolioAllocation | undefined>(
    allocation
  );

  useEffect(() => {
    if (!allocation) return;
    const hasClass = (allocation.byClass?.length ?? 0) > 0;
    const hasPlat = (allocation.byPlatform?.length ?? 0) > 0;
    // Only swap when we have real data — never clear mid-refresh
    if (hasClass || hasPlat) {
      setStableAllocation(allocation);
    }
  }, [allocation]);

  const displayAllocation = stableAllocation ?? allocation;

  const classChart: ClassSlice[] = useMemo(
    () =>
      displayAllocation?.byClass.map((x) => ({
        name: getAssetClassLabel(x.name),
        value: round2(Number(x.value) || 0),
      })) ?? [],
    [displayAllocation?.byClass]
  );

  const platformChart = useMemo(
    () =>
      (displayAllocation?.byPlatform || []).map((x) => ({
        name: x.name,
        value: round2(Number(x.value) || 0),
      })),
    [displayAllocation?.byPlatform]
  );

  // Sticky history: don't blank the evolution chart while a refetch is in flight
  const [stableHistory, setStableHistory] = useState<HistoryPoint[]>(history);
  useEffect(() => {
    if (history.length > 0) setStableHistory(history);
  }, [history]);

  const evolutionChart: EvolutionRow[] = useMemo(
    () =>
      stableHistory.map((p) => ({
        label: p.label,
        date: p.date,
        valeur: round2(p.totalValueBase),
        cash: round2(p.cashTotalBase),
        positions: round2(p.totalValueBase - p.cashTotalBase),
        isLive: Boolean(p.isLive),
      })),
    [stableHistory]
  );

  const showHistoryLoading =
    Boolean(historyLoading) && stableHistory.length === 0 && history.length === 0;

  return (
    <div className="space-y-4">
    <section
      className={
        layoutWidth === "ultra"
          ? "grid min-w-0 gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3"
          : "grid min-w-0 gap-3 sm:gap-4 lg:grid-cols-2"
      }
    >
      <div
        className={
          layoutWidth === "ultra"
            ? "card p-4 xl:col-span-3"
            : "card p-4 lg:col-span-2"
        }
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Évolution de la valeur du portefeuille</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Actifs + cash · snapshots quotidiens (mis à jour à chaque actualisation des prix)
              {baseCurrency !== "EUR" ? " · conversion au taux du jour" : ""}
            </p>
          </div>
          {evolutionChart.length > 1 && (
            <div className="text-right text-xs text-slate-500 dark:text-slate-400">
              {(() => {
                const first = evolutionChart[0]?.valeur ?? 0;
                const last = evolutionChart[evolutionChart.length - 1]?.valeur ?? 0;
                const delta = last - first;
                const pct = first > 0 ? (delta / first) * 100 : 0;
                const up = delta >= 0;
                return (
                  <span
                    className={
                      up
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {up ? "+" : ""}
                    {formatCurrency(delta, baseCurrency)} ({up ? "+" : ""}
                    {pct.toFixed(1)} %) sur la période
                  </span>
                );
              })()}
            </div>
          )}
        </div>
        <div className="h-72">
          {showHistoryLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Chargement de l&apos;historique…
            </div>
          ) : evolutionChart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
              <p>Aucun historique pour le moment.</p>
              <p className="text-xs">
                Cliquez sur « Actualiser les prix » pour enregistrer un premier snapshot.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolutionChart} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v: number) =>
                    new Intl.NumberFormat("fr-FR", {
                      notation: "compact",
                      compactDisplay: "short",
                      maximumFractionDigits: 1,
                    }).format(v)
                  }
                  width={56}
                />
                <Tooltip
                  formatter={(v, name) => [
                    formatCurrency(Number(v ?? 0), baseCurrency),
                    name === "valeur"
                      ? "Valeur totale"
                      : name === "cash"
                        ? "Cash"
                        : name === "positions"
                          ? "Positions"
                          : String(name),
                  ]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { date?: string } | undefined;
                    return p?.date
                      ? new Intl.DateTimeFormat("fr-FR", {
                          timeZone: "Europe/Paris",
                          dateStyle: "medium",
                        }).format(new Date(p.date))
                      : "";
                  }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                  }}
                />
                <Legend
                  formatter={(value) =>
                    value === "valeur"
                      ? "Valeur totale (positions + cash)"
                      : value === "cash"
                        ? "Cash"
                        : value
                  }
                />
                <Line
                  type="monotone"
                  dataKey="valeur"
                  name="valeur"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#0f766e" }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="cash"
                  name="cash"
                  stroke="#0284c7"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <AllocationClassPanel data={classChart} baseCurrency={baseCurrency} />

      <div className="card p-4">
        <h3 className="mb-4 text-sm font-semibold">Allocation par plateforme</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={platformChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(v: number) => formatChartNumber(Number(v))}
              />
              <Tooltip
                formatter={(v) =>
                  formatCurrency(round2(Number(v ?? 0)), baseCurrency)
                }
              />
              <Bar
                dataKey="value"
                fill="#0f766e"
                radius={[6, 6, 0, 0]}
                animationDuration={0}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div
        className={
          layoutWidth === "ultra"
            ? "card grid gap-3 p-4 sm:grid-cols-2 xl:col-span-3 xl:grid-cols-4"
            : "card grid gap-3 p-4 sm:grid-cols-2 lg:col-span-2"
        }
      >
        <Stat
          label="Patrimoine net (Actifs − Passifs)"
          value={formatCurrency(String(summary?.netWorthBase ?? 0), baseCurrency)}
        />
        <Stat
          label="P&L réalisé"
          value={formatCurrency(
            String(summary?.realizedPnlBase ?? summary?.realizedPnlEur ?? 0),
            baseCurrency
          )}
        />
        <Stat
          label="Revenus cash"
          value={formatCurrency(
            String(summary?.cashIncomeBase ?? summary?.cashIncomeEur ?? 0),
            baseCurrency
          )}
        />
        <Stat
          label="Performance totale (estim.)"
          value={formatCurrency(
            String(summary?.totalReturnBase ?? summary?.totalReturnEur ?? 0),
            baseCurrency
          )}
        />
      </div>
    </section>

    <NewsMacroPanel />
    </div>
  );
}
