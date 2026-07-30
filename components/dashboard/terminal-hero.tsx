"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { HistoryPoint } from "@/app/lib/types/ui";
import { Sparkline } from "@/components/ui/sparkline";
import {
  buildEvolutionSeries,
  type EvolutionRange,
} from "@/app/lib/portfolio/evolution-aggregate";

/** Périodes du hero — sous-ensemble volontairement court du mockup. */
const HERO_RANGES: { id: EvolutionRange; label: string; noun: string }[] = [
  { id: "1m", label: "1M", noun: "1 mois" },
  { id: "3m", label: "3M", noun: "3 mois" },
  { id: "1y", label: "1A", noun: "12 mois" },
  { id: "all", label: "Tout", noun: "depuis l'origine" },
];

/**
 * Montant sans symbole ni décimales — réservé au chiffre de tête.
 *
 * Le code devise est affiché à côté comme libellé (mockup), et les centimes
 * n'apportent rien à 60 px : sur un patrimoine à six chiffres, ils ajoutent du
 * bruit là où on cherche un ordre de grandeur.
 */
function formatHeadline(v: number): string {
  return Math.round(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

function formatPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

/**
 * Carte de tête — le patrimoine net.
 *
 * C'est le seul chiffre de l'écran qui a droit à `--text-5xl` : la hiérarchie
 * du tableau de bord tient entièrement à ce qu'aucun autre nombre ne vienne
 * lui disputer le premier regard.
 *
 * Le graphique de droite est délibérément sans axe ni graduation. Il ne sert
 * pas à lire une valeur — la carte « Évolution du patrimoine net », plus bas,
 * s'en charge — mais à donner la forme du trajet en moins d'une seconde.
 */
export function TerminalHero({
  netWorth,
  history,
  baseCurrency,
  loading,
}: {
  netWorth: number | null;
  history: HistoryPoint[];
  baseCurrency: string;
  loading?: boolean;
}) {
  const [range, setRange] = useState<EvolutionRange>("1y");

  const series = useMemo(
    () => buildEvolutionSeries(history, range, "cumul").points,
    [history, range]
  );

  const values = useMemo(() => series.map((p) => p.total), [series]);

  const delta = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0]!.total;
    const last = series[series.length - 1]!.total;
    if (!(first > 0)) return null;
    return { abs: last - first, pct: ((last - first) / first) * 100 };
  }, [series]);

  const up = (delta?.abs ?? 0) >= 0;
  const stroke = up ? "var(--chart-positive)" : "var(--chart-negative)";
  const rangeNoun =
    HERO_RANGES.find((r) => r.id === range)?.noun ?? "la période";

  return (
    <section
      className="panel px-[var(--pad-card-lg)] py-[var(--pad-card-lg)]"
      data-testid="terminal-hero"
      aria-labelledby="hero-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-5)]">
        {/* ── Chiffre de tête ── */}
        <div className="min-w-0">
          <h2 id="hero-heading" className="text-label">
            Patrimoine net
          </h2>

          <div className="mt-[var(--space-3)] flex flex-wrap items-baseline gap-[var(--space-3)]">
            {loading && netWorth === null ? (
              <span
                className="num block h-[var(--text-4xl)] w-[14rem] rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]"
                aria-hidden
              />
            ) : (
              <span
                className={cn(
                  "num text-[length:var(--text-4xl)] font-semibold leading-none",
                  "tracking-[var(--tracking-tighter)] text-[var(--foreground)]",
                  "sm:text-[length:var(--text-5xl)]"
                )}
                data-testid="hero-net-worth"
              >
                {netWorth === null ? "—" : formatHeadline(netWorth)}
              </span>
            )}
            <span className="text-label">{baseCurrency}</span>
          </div>

          {/* Variation sur la période sélectionnée */}
          <p
            className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--text-sm)]"
            data-testid="hero-delta"
          >
            {delta ? (
              <>
                <span
                  className={cn(
                    "num font-medium",
                    up ? "val-positive" : "val-negative"
                  )}
                >
                  {/* Flèche en plus du signe : la couleur seule ne suffit pas
                      à distinguer hausse et baisse pour un œil daltonien. */}
                  {up ? "▲" : "▼"} {formatPct(delta.pct)}
                </span>
                <span className="text-[var(--foreground-faint)]">·</span>
                <span
                  className={cn("num", up ? "val-positive" : "val-negative")}
                >
                  {delta.abs >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(delta.abs), baseCurrency)}
                </span>
                <span className="text-[var(--foreground-faint)]">·</span>
                <span className="text-[var(--foreground-secondary)]">
                  {rangeNoun}
                </span>
              </>
            ) : (
              <span className="text-[var(--foreground-faint)]">
                Historique insuffisant sur cette période
              </span>
            )}
          </p>
        </div>

        {/* ── Graphique + sélecteur ── */}
        <div className="flex min-w-0 flex-1 flex-col items-end gap-[var(--space-3)]">
          <div
            className="term-seg"
            role="tablist"
            aria-label="Période du patrimoine net"
          >
            {HERO_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={range === r.id}
                data-active={range === r.id}
                className="term-seg-item"
                data-testid={`hero-range-${r.id}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="h-[5.5rem] w-full min-w-0 sm:h-[6.5rem]">
            {values.length >= 2 ? (
              <Sparkline
                values={values}
                stroke={stroke}
                fill
                width={640}
                height={104}
                strokeWidth={2}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full items-center justify-end text-[length:var(--text-xs)] text-[var(--foreground-faint)]">
                Pas encore de courbe
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Un indicateur de la rangée KPI. */
export type TerminalKpi = {
  key: string;
  label: string;
  value: number;
  /** Série d'historique — omise quand aucune donnée réelle n'existe. */
  spark?: number[];
  /** Teinte du trait ; par défaut dérivée du signe de la variation. */
  tone?: "gold" | "positive" | "negative" | "cyan" | "neutral";
  /** Variation en % sur la fenêtre d'historique, si calculable. */
  changePct?: number | null;
};

const TONE_STROKE: Record<string, string> = {
  gold: "var(--chart-gold)",
  positive: "var(--chart-positive)",
  negative: "var(--chart-negative)",
  cyan: "var(--chart-cyan)",
  neutral: "var(--chart-neutral)",
};

/**
 * Rangée d'indicateurs.
 *
 * Toutes les tuiles partagent la même hauteur, y compris celles qui n'ont pas
 * de sparkline : la zone du graphique est réservée en toutes circonstances.
 * Sans cela, les trois indicateurs sans historique (alternatifs, épargne
 * salariale, passifs) créeraient un décrochement dans la grille.
 */
export function TerminalKpiRow({
  items,
  baseCurrency,
}: {
  items: TerminalKpi[];
  baseCurrency: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-[var(--gap-card)]",
        "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
      )}
      data-testid="terminal-kpi-row"
    >
      {items.map((item) => {
        const pct = item.changePct;
        const signed = typeof pct === "number" && Number.isFinite(pct);
        const up = signed && pct >= 0;
        const tone =
          item.tone ?? (signed ? (up ? "positive" : "negative") : "neutral");
        return (
          <article
            key={item.key}
            className="kpi-tile flex flex-col gap-[var(--space-2)] p-[var(--pad-card)]"
            data-testid={`kpi-${item.key}`}
          >
            <h3 className="text-label truncate" title={item.label}>
              {item.label}
            </h3>

            <p
              className={cn(
                "num text-[length:var(--text-xl)] font-semibold leading-none",
                item.tone === "gold"
                  ? "text-[var(--primary-text)]"
                  : "text-[var(--foreground)]"
              )}
            >
              {formatCurrency(item.value, baseCurrency)}
            </p>

            <p className="text-[length:var(--text-xs)] leading-none">
              {signed ? (
                <span className={cn("num", up ? "val-positive" : "val-negative")}>
                  {formatPct(pct)}
                </span>
              ) : (
                <span className="text-[var(--foreground-faint)]">—</span>
              )}
            </p>

            {/* Hauteur réservée même sans série : garde la grille d'aplomb. */}
            <div className="mt-auto h-[1.75rem] w-full pt-[var(--space-1)]">
              {item.spark && item.spark.length >= 2 && (
                <Sparkline
                  values={item.spark}
                  stroke={TONE_STROKE[tone] ?? TONE_STROKE.neutral!}
                  width={180}
                  height={28}
                  className="h-full w-full"
                />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
