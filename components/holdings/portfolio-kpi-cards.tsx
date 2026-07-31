"use client";

import { useMemo } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { Holding, HistoryPoint } from "@/app/lib/types/ui";
import { Sparkline } from "@/components/ui/sparkline";
import { formatDateTimeParis } from "@/app/lib/money/format";
import { formatRelativeUpdate } from "@/components/holdings/holding-table-row";

/** Fenêtre des sparklines : un mois de relevés suffit à donner une pente. */
const SPARK_POINTS = 30;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

/**
 * « JJ/MM HH:MM » — l'horodatage complet (`formatDateTimeParis`, secondes
 * comprises) déborde de la tuile ; l'année et la seconde n'apportent rien à
 * une mesure de fraîcheur.
 */
function formatSyncClock(ms: number): string {
  const full = formatDateTimeParis(new Date(ms));
  const [date, time] = full.split(" ");
  if (!date || !time) return full;
  return `${date.slice(0, 5)} ${time.slice(0, 5)}`;
}

/**
 * Une tuile. La zone du graphique est réservée même sans série, sinon les
 * cinq cartes cessent d'avoir la même hauteur dès qu'une donnée manque.
 */
function KpiCard({
  label,
  value,
  unit,
  secondary,
  secondaryTone,
  spark,
  sparkStroke,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  secondary?: string;
  secondaryTone?: "positive" | "negative" | "muted";
  spark?: number[];
  sparkStroke?: string;
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

      <p className="flex items-baseline gap-[var(--space-2)] leading-none">
        <span className="num truncate text-[length:var(--text-xl)] font-semibold text-[var(--foreground)]">
          {value}
        </span>
        {unit && <span className="text-label shrink-0">{unit}</span>}
      </p>

      <p className="text-[length:var(--text-xs)] leading-none">
        {secondary ? (
          <span
            className={cn(
              "num",
              secondaryTone === "positive" && "val-positive",
              secondaryTone === "negative" && "val-negative",
              (!secondaryTone || secondaryTone === "muted") &&
                "text-[var(--foreground-faint)]"
            )}
          >
            {secondary}
          </span>
        ) : (
          <span className="text-[var(--foreground-faint)]">&nbsp;</span>
        )}
      </p>

      <div className="mt-auto h-[1.75rem] w-full pt-[var(--space-1)]">
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

/**
 * Bandeau d'indicateurs du portefeuille.
 *
 * Les cinq mesures du mockup, calculées sur les positions **effectivement
 * affichées** et non sur le portefeuille entier : quand un filtre est actif,
 * un total qui ignorerait ce filtre contredirait le tableau juste en dessous.
 *
 * Les sparklines viennent de l'historique patrimonial global, seule série
 * temporelle réellement disponible ici. Elles sont donc omises dès qu'un
 * filtre restreint la sélection — dessiner la courbe de tout le patrimoine
 * au-dessus d'un sous-ensemble filtré serait un contresens.
 */
export function PortfolioKpiCards({
  holdings,
  history,
  baseCurrency,
  filtered,
  className,
}: {
  /** Positions après filtres — la source des totaux. */
  holdings: Holding[];
  history?: HistoryPoint[];
  baseCurrency: string;
  /** true si un filtre restreint la sélection (masque les sparklines). */
  filtered: boolean;
  className?: string;
}) {
  const totals = useMemo(() => {
    let marketValue = 0;
    let costBasis = 0;
    /**
     * Fraîcheur = la position la plus ancienne, pas la plus récente.
     * Une seule ligne rafraîchie il y a deux jours suffit à rendre le total
     * faux ; annoncer « il y a 2 minutes » parce qu'une autre vient d'être
     * mise à jour donnerait une confiance que le chiffre ne mérite pas.
     */
    let oldestSync: number | null = null;
    for (const h of holdings) {
      marketValue += num(h.marketValueBase);
      costBasis += num(h.costBasisBase);
      const t = h.lastUpdatedAt ? Date.parse(h.lastUpdatedAt) : NaN;
      if (Number.isFinite(t) && (oldestSync == null || t < oldestSync)) {
        oldestSync = t;
      }
    }
    const pnl = marketValue - costBasis;
    return {
      marketValue,
      costBasis,
      pnl,
      pnlPct: costBasis > 0 ? (pnl / costBasis) * 100 : null,
      count: holdings.length,
      oldestSync,
    };
  }, [holdings]);

  const series = useMemo(() => {
    if (filtered || !history?.length) return null;
    const win = history.slice(-SPARK_POINTS);
    if (win.length < 2) return null;
    return {
      value: win.map((p) => num(p.totalValueBase)),
      pnl: win.map((p) => num(p.unrealizedPnlBase)),
    };
  }, [history, filtered]);

  const pnlUp = totals.pnl >= 0;

  return (
    <div
      className={cn(
        "grid min-w-0 gap-[var(--gap-card)]",
        "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
        className
      )}
      data-testid="portfolio-kpi-cards"
    >
      <KpiCard
        testId="pkpi-total"
        label="Valeur totale"
        value={formatCurrency(totals.marketValue, baseCurrency)}
        spark={series?.value}
        sparkStroke="var(--chart-gold)"
      />

      <KpiCard
        testId="pkpi-invested"
        label="Investi"
        value={formatCurrency(totals.costBasis, baseCurrency)}
        secondary="Prix de revient, frais inclus"
      />

      <KpiCard
        testId="pkpi-pnl"
        label="P&L global"
        value={`${pnlUp ? "+" : "−"}${formatCurrency(Math.abs(totals.pnl), baseCurrency)}`}
        secondary={totals.pnlPct != null ? formatPct(totals.pnlPct) : undefined}
        secondaryTone={pnlUp ? "positive" : "negative"}
        spark={series?.pnl}
        sparkStroke={
          pnlUp ? "var(--chart-positive)" : "var(--chart-negative)"
        }
      />

      <KpiCard
        testId="pkpi-count"
        label="Nombre d'actifs"
        value={String(totals.count)}
        secondary={filtered ? "Sur la sélection filtrée" : undefined}
      />

      {/* L'horodatage exact tient sur une ligne, pas la formule relative
          (« il y a environ 11 heures ») : celle-ci passe en légende, où elle
          peut respirer, et la valeur reste lisible d'un coup d'œil. */}
      <KpiCard
        testId="pkpi-sync"
        label="Dernière mise à jour"
        value={
          totals.oldestSync != null
            ? formatSyncClock(totals.oldestSync)
            : "—"
        }
        secondary={
          totals.oldestSync != null
            ? formatRelativeUpdate(new Date(totals.oldestSync).toISOString())
            : "Aucun cours daté"
        }
      />
    </div>
  );
}
