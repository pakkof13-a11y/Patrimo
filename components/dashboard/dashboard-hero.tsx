"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { HistoryPoint } from "@/app/lib/types/ui";
import {
  buildEvolutionSeries,
  evolutionDeltaSummary,
  isEvolutionRangeEnabled,
  type EvolutionRange,
} from "@/app/lib/portfolio/evolution-aggregate";

const HERO_RANGES: { id: EvolutionRange; label: string }[] = [
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "1y", label: "1A" },
  { id: "all", label: "Tout" },
];

const PERIOD_LABEL: Record<string, string> = {
  "1m": "1 mois",
  "3m": "3 mois",
  "1y": "12 mois",
  all: "historique",
};

/**
 * `null` quand la valeur n'est pas encore calculée — jamais 0 : afficher un
 * patrimoine net à « 0,00 € » pendant le chargement ferait lire une ruine là
 * où il n'y a qu'une donnée manquante.
 */
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Pourcentage à la française — virgule décimale, comme `formatCurrency`. */
function formatPctFr(v: number): string {
  return v.toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Chemin SVG d'une sparkline normalisée dans un viewBox width×height. */
function sparklinePath(values: number[], width: number, height: number, pad = 3): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Hero "Patrimoine net" — en tête du dashboard, avant le bandeau KPI.
 * Réutilise les mêmes agrégats que le module Évolution (buildEvolutionSeries /
 * evolutionDeltaSummary) : aucun nouveau calcul métier, juste une lecture
 * condensée du même historique.
 */
export function DashboardHero({
  baseCurrency,
  summary,
  history,
}: {
  baseCurrency: string;
  summary?: Record<string, string | number>;
  history: HistoryPoint[];
}) {
  const [range, setRange] = useState<EvolutionRange>("1y");

  const firstDate = history[0]?.date ?? null;
  const rangeEnabled = useMemo(() => {
    const map = {} as Record<EvolutionRange, boolean>;
    for (const r of HERO_RANGES) {
      map[r.id] = isEvolutionRangeEnabled(r.id, firstDate);
    }
    return map;
  }, [firstDate]);

  const effectiveRange: EvolutionRange = rangeEnabled[range] ? range : "all";

  const { points } = useMemo(
    () => buildEvolutionSeries(history, effectiveRange, "cumul"),
    [history, effectiveRange]
  );
  const delta = useMemo(() => evolutionDeltaSummary(points), [points]);

  const netWorth = numOrNull(summary?.netWorthBase ?? summary?.netWorthEur);
  const sparkValues = points.map((p) => p.total);
  const path = sparklinePath(sparkValues, 300, 72);

  /** Date de la dernière valorisation réellement présente dans l'historique. */
  const lastValuationAt = points.length > 0 ? points[points.length - 1]!.date : null;
  const lastValuationLabel = lastValuationAt
    ? new Date(lastValuationAt).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  return (
    <div
      className="dashboard-hero flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5"
      data-testid="dashboard-hero"
    >
      <div className="min-w-0">
        <div className="text-label">Patrimoine net</div>
        <div className="dashboard-hero-value mt-1 text-[2rem] font-semibold leading-none sm:text-[2.5rem]">
          {netWorth == null ? (
            <span
              className="text-[1.5rem] font-medium text-[var(--foreground-muted)] sm:text-[1.75rem]"
              data-testid="dashboard-hero-unknown"
            >
              Non calculé
            </span>
          ) : (
            formatCurrency(String(netWorth), baseCurrency)
          )}
        </div>
        {delta && points.length > 1 && (
          <div
            className={cn(
              "mt-2 inline-flex flex-wrap items-center gap-x-1 text-[13px] font-semibold tabular-nums",
              delta.delta >= 0
                ? "text-[var(--positive)]"
                : "text-[var(--negative)]"
            )}
            data-testid="dashboard-hero-delta"
          >
            {/* Le signe double la couleur : un daltonien lit la direction sans elle. */}
            <span aria-hidden>{delta.delta >= 0 ? "▲" : "▼"}</span>
            {delta.delta >= 0 ? "+" : "−"}
            {formatPctFr(Math.abs(delta.pct))}&nbsp;% · {delta.delta >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(delta.delta), baseCurrency)}
            <span className="font-normal text-[var(--foreground-muted)]">
              {" "}
              sur {PERIOD_LABEL[effectiveRange] ?? effectiveRange}
            </span>
          </div>
        )}
        {/*
          Cette variation est un écart de valeur totale : elle contient aussi
          les apports et retraits de la période. Le dire évite de la lire comme
          une performance — le module Évolution reste la vue d'analyse.
        */}
        {delta && points.length > 1 && (
          <p className="mt-1 text-xs leading-snug text-[var(--foreground-muted)]">
            Variation de valeur, apports et retraits inclus.
            {lastValuationLabel ? ` Valorisation au ${lastValuationLabel}.` : ""}
          </p>
        )}
        {!delta && lastValuationLabel && (
          <p className="mt-1 text-xs text-[var(--foreground-muted)]">
            Valorisation au {lastValuationLabel}.
          </p>
        )}
      </div>

      {sparkValues.length > 1 && (
        <svg
          viewBox="0 0 300 72"
          className="h-14 w-full shrink-0 sm:h-16 sm:w-[220px]"
          aria-hidden
        >
          <path
            d={path}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      <div
        className="inline-flex shrink-0 gap-0.5 self-start rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/45 p-0.5 sm:self-center"
        role="tablist"
        aria-label="Période patrimoine net"
        data-testid="dashboard-hero-range"
      >
        {HERO_RANGES.map((r) => {
          const enabled = rangeEnabled[r.id] !== false;
          const selected = effectiveRange === r.id;
          return (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={!enabled}
              onClick={() => enabled && setRange(r.id)}
              className={cn(
                "rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-semibold tabular-nums transition",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                !enabled && "cursor-not-allowed opacity-40",
                enabled &&
                  selected &&
                  "bg-[var(--primary)] text-[var(--primary-foreground)]",
                enabled &&
                  !selected &&
                  "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
