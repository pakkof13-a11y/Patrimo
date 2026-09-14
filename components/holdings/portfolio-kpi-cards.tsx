"use client";

import { useMemo } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { Holding } from "@/app/lib/types/ui";
import { formatDateTimeParis } from "@/app/lib/money/format";
import { formatRelativeUpdate } from "@/components/holdings/holding-table-row";

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
 * Une tuile.
 *
 * Portait autrefois un bandeau sparkline en pied de carte, alimenté par
 * `history` (prop `HistoryPoint[]`). Cette série venait de `portfolio.history`,
 * retirée de `GET /api/portfolio` en D20 (la route tombait en 504) : plus
 * aucun appelant ne fournissait `history` à `HoldingsSection` ni à ce
 * composant, si bien que le bandeau réservait 1,75 rem de hauteur pour un
 * graphique qui ne se remplissait jamais. Retiré ici avec toute la plomberie
 * morte (prop `history`, mémo `series`, props `spark`/`sparkStroke`).
 * La seule série vivante aujourd'hui est `GET /api/portfolio/daily-nav`, dont
 * les périmètres (`net`, `brut`, `financier`, `listed`…) ne savent pas
 * exprimer « le total des lignes actuellement affichées », qui dépend de
 * l'onglet et des filtres actifs — la brancher ici afficherait une grandeur
 * différente du chiffre au-dessus. Le bandeau ne doit revenir que si une
 * série existe pour la MÊME grandeur que la tuile (valeur totale filtrée,
 * P&L filtré).
 */
function KpiCard({
  label,
  value,
  unit,
  secondary,
  secondaryTone,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  secondary?: string;
  secondaryTone?: "positive" | "negative" | "muted";
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
    </article>
  );
}

/**
 * Bandeau d'indicateurs du portefeuille.
 *
 * Les cinq mesures du mockup, calculées sur les positions **effectivement
 * affichées** et non sur le portefeuille entier : quand un filtre est actif,
 * un total qui ignorerait ce filtre contredirait le tableau juste en dessous.
 */
export function PortfolioKpiCards({
  holdings,
  baseCurrency,
  filtered,
  className,
}: {
  /** Positions après filtres — la source des totaux. */
  holdings: Holding[];
  baseCurrency: string;
  /** true si un filtre restreint la sélection (ex. mention sur la tuile compteur). */
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
