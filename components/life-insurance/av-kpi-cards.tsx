"use client";

import { Sparkline } from "@/components/ui/sparkline";
import { cn, formatCurrency } from "@/app/lib/utils";
import type { OverviewTotals } from "@/app/lib/life-insurance/overview";
import type { PerformancePoint } from "@/app/lib/life-insurance/performance";

/**
 * Les quatre mesures de l'enveloppe.
 *
 * Elles ne racontent pas la même chose et ne viennent pas de la même source :
 * la **valeur** et la **performance** sont de marché, les **versements** sont
 * déclarés, le **gain** est la différence des deux mondes. Chaque tuile dit
 * donc d'où vient son chiffre — sans quoi on additionnerait mentalement une
 * plus-value latente et un gain depuis l'origine, qui ne se recouvrent pas.
 */

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

function formatSignedCurrency(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), "EUR")}`;
}

function KpiCard({
  label,
  value,
  secondary,
  tone,
  spark,
  sparkStroke,
  reserveSpark,
  testId,
}: {
  label: string;
  value: string;
  secondary?: string;
  tone?: "positive" | "negative" | "muted";
  spark?: number[];
  sparkStroke?: string;
  /**
   * Réserve la bande de courbe même sans série, pour que les quatre tuiles
   * gardent la même hauteur. Inutile quand aucune n'a de série : quatre bandes
   * vides ne sont plus un alignement, seulement du vide.
   */
  reserveSpark: boolean;
  testId: string;
}) {
  return (
    <article
      className="panel flex flex-col gap-[var(--space-2)] p-[var(--pad-card)]"
      data-testid={testId}
    >
      <h3 className="text-label truncate" title={label}>
        {label}
      </h3>

      <p className="num truncate text-[length:var(--text-xl)] font-semibold leading-none text-[var(--foreground)]">
        {value}
      </p>

      {/* Hauteur réservée même sans seconde ligne : quatre tuiles de hauteurs
          différentes se lisent comme un défaut d'alignement, pas comme une
          donnée manquante. */}
      <p className="text-[length:var(--text-xs)] leading-none">
        {secondary ? (
          <span
            className={cn(
              "num",
              tone === "positive" && "val-positive",
              tone === "negative" && "val-negative",
              (!tone || tone === "muted") && "text-[var(--foreground-faint)]"
            )}
          >
            {secondary}
          </span>
        ) : (
          <span>&nbsp;</span>
        )}
      </p>

      <div
        className={cn(
          "mt-auto w-full",
          reserveSpark && "h-[1.75rem] pt-[var(--space-1)]"
        )}
      >
        {spark && spark.length >= 2 && (
          <Sparkline
            values={spark}
            stroke={sparkStroke ?? "var(--chart-gold)"}
            width={200}
            height={28}
            className="h-full w-full"
          />
        )}
      </div>
    </article>
  );
}

export function AvKpiCards({
  totals,
  series,
  ytdPct,
  className,
}: {
  totals: OverviewTotals;
  /** Série de performance de l'enveloppe — absente si aucun cours n'est connu. */
  series?: PerformancePoint[];
  ytdPct: number | null;
  className?: string;
}) {
  const spark = series && series.length >= 2 ? series.map((p) => p.index) : undefined;
  const reserveSpark = Boolean(spark);
  const perfUp = (ytdPct ?? 0) >= 0;
  const gain = totals.gainSincePremiumsEur;
  const gainUp = (gain ?? 0) >= 0;

  return (
    <div
      className={cn(
        "grid min-w-0 gap-[var(--gap-card)] grid-cols-2 xl:grid-cols-4",
        className
      )}
      data-testid="av-kpi-cards"
    >
      <KpiCard
        reserveSpark={reserveSpark}
        testId="avkpi-value"
        label="Valeur totale"
        value={formatCurrency(totals.totalValueEur, "EUR")}
        secondary={`${totals.supportCount} support${totals.supportCount > 1 ? "s" : ""} · ${totals.contractCount} contrat${totals.contractCount > 1 ? "s" : ""}`}
        spark={series && series.length >= 2 ? series.map((p) => p.valueEur) : undefined}
        sparkStroke="var(--chart-gold)"
      />

      <KpiCard
        reserveSpark={reserveSpark}
        testId="avkpi-performance"
        label="Performance (YTD)"
        value={ytdPct != null ? formatSignedPct(ytdPct) : "—"}
        secondary={
          ytdPct != null
            ? "Hors versements et rachats"
            : "Aucun historique de cours"
        }
        tone={ytdPct != null ? (perfUp ? "positive" : "negative") : "muted"}
        spark={spark}
        sparkStroke={
          perfUp ? "var(--chart-positive)" : "var(--chart-negative)"
        }
      />

      <KpiCard
        reserveSpark={reserveSpark}
        testId="avkpi-premiums"
        label="Versements"
        value={
          totals.totalPremiumsEur > 0
            ? formatCurrency(totals.totalPremiumsEur, "EUR")
            : "—"
        }
        secondary={
          totals.totalPremiumsEur > 0
            ? "Depuis l'origine"
            : "À déclarer sur les contrats"
        }
      />

      <KpiCard
        reserveSpark={reserveSpark}
        testId="avkpi-gain"
        label="Gains"
        value={gain != null ? formatSignedCurrency(gain) : "—"}
        secondary={
          gain != null
            ? totals.gainSincePremiumsPct != null
              ? `${formatSignedPct(totals.gainSincePremiumsPct)} depuis l'origine`
              : "Depuis l'origine"
            : "Sans versements déclarés, aucun gain calculable"
        }
        tone={gain != null ? (gainUp ? "positive" : "negative") : "muted"}
      />
    </div>
  );
}
