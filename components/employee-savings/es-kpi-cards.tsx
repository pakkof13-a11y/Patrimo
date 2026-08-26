"use client";

import { Sparkline } from "@/components/ui/sparkline";
import { cn, formatCurrency } from "@/app/lib/utils";
import type {
  ContributionPoint,
  OverviewTotals,
} from "@/app/lib/employee-savings/overview";

/**
 * Les quatre mesures de l'épargne salariale.
 *
 * L'ordre de lecture est délibéré : ce que ça vaut, comment ça se comporte, ce
 * qui a été mis, ce que ça a rapporté. Les deux dernières dépendent d'un
 * montant versé que le modèle n'a pas toujours ; sans lui, la tuile le dit au
 * lieu d'afficher un zéro qui se lirait « rien versé ».
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
  sparkTitle,
  reserveSpark,
  testId,
}: {
  label: string;
  value: string;
  secondary?: string;
  tone?: "positive" | "negative" | "muted";
  spark?: number[];
  sparkStroke?: string;
  /** Ce que la courbe représente — jamais déductible de la seule tuile. */
  sparkTitle?: string;
  /**
   * Réserve la bande de courbe même sans série : quatre tuiles de hauteurs
   * différentes se lisent comme un défaut d'alignement. Inutile quand aucune
   * n'a de série — quatre bandes vides ne sont plus qu'un vide.
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
        title={spark && spark.length >= 2 ? sparkTitle : undefined}
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

export function EsKpiCards({
  totals,
  series,
  className,
}: {
  totals: OverviewTotals;
  /** Versements cumulés — seule série datée dont dispose ce module. */
  series: ContributionPoint[];
  className?: string;
}) {
  const spark =
    series.length >= 2 ? series.map((p) => p.cumulative) : undefined;
  const reserveSpark = Boolean(spark);
  const gainUp = (totals.gain ?? 0) >= 0;
  const incomplete = totals.linesMissingContribution > 0;

  return (
    <div
      className={cn(
        "grid min-w-0 gap-[var(--gap-card)] grid-cols-2 xl:grid-cols-4",
        className
      )}
      data-testid="es-kpi-cards"
    >
      <KpiCard
        testId="eskpi-value"
        label="Valeur totale"
        value={formatCurrency(totals.totalValue, "EUR")}
        secondary={`${totals.lineCount} support${totals.lineCount > 1 ? "s" : ""} · ${totals.planCount} plan${totals.planCount > 1 ? "s" : ""}`}
        reserveSpark={reserveSpark}
      />

      <KpiCard
        testId="eskpi-performance"
        label="Performance"
        value={totals.gainPct != null ? formatSignedPct(totals.gainPct) : "—"}
        secondary={
          totals.gainPct != null
            ? "Depuis l'origine, rapportée aux versements"
            : "Sans montants versés, aucune performance calculable"
        }
        tone={
          totals.gainPct != null ? (gainUp ? "positive" : "negative") : "muted"
        }
        reserveSpark={reserveSpark}
      />

      <KpiCard
        testId="eskpi-contributed"
        label="Versements"
        value={
          totals.contributed != null
            ? formatCurrency(totals.contributed, "EUR")
            : "—"
        }
        secondary={
          totals.contributed == null
            ? "À renseigner support par support"
            : incomplete
              ? `${totals.linesMissingContribution} support${totals.linesMissingContribution > 1 ? "s" : ""} sans montant`
              : "Cumul depuis l'origine"
        }
        spark={spark}
        sparkStroke="var(--chart-gold)"
        sparkTitle="Versements cumulés — une somme d'apports, pas une valorisation"
        reserveSpark={reserveSpark}
      />

      <KpiCard
        testId="eskpi-gain"
        label="Gains"
        value={totals.gain != null ? formatSignedCurrency(totals.gain) : "—"}
        secondary={
          totals.gain == null
            ? "Valeur moins versements — versements inconnus"
            : incomplete
              ? "Partiel : certains versements manquent"
              : "Valeur d'aujourd'hui moins versements"
        }
        tone={totals.gain != null ? (gainUp ? "positive" : "negative") : "muted"}
        reserveSpark={reserveSpark}
      />
    </div>
  );
}
