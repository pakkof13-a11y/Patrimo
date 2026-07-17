"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Stat } from "@/components/ui/kpi";
import {
  EmptyPlaceholder,
  PanelHeader,
  SegmentedControl,
  SegmentedItem,
} from "@/components/ui/panel";

type Mode = "global" | "platforms";

export type PlatformSlice = { name: string; value: number };

function n(v: string | number | undefined | null): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function signedTone(value: number): "up" | "down" | "neutral" {
  if (value > 0.005) return "up";
  if (value < -0.005) return "down";
  return "neutral";
}

function formatSignedCurrency(value: number, currency: string): string {
  if (value > 0.005) {
    return `+${formatCurrency(String(value), currency)}`;
  }
  if (value < -0.005) {
    return formatCurrency(String(value), currency);
  }
  return formatCurrency("0", currency);
}

function formatPct(value: number, signed = true): string {
  if (!Number.isFinite(value)) return "—";
  const s = value.toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (!signed) return `${s} %`;
  if (value > 0.05) return `+${s} %`;
  if (value < -0.05) return `${s} %`;
  return `${s} %`;
}

/**
 * Synthèse patrimoniale — deux modes exclusifs :
 * - Global : grille KPI 2×3 (résumé portefeuille)
 * - Plateformes : répartition réelle par source
 */
export function PortfolioSummaryPanel({
  baseCurrency,
  summary,
  platforms,
  showGlobal = true,
  className,
}: {
  baseCurrency: string;
  summary?: Record<string, string | number>;
  platforms: PlatformSlice[];
  /** false si maturité sans stats secondaires */
  showGlobal?: boolean;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>(showGlobal ? "global" : "platforms");

  const metrics = useMemo(() => {
    const netWorth = n(summary?.netWorthBase ?? summary?.netWorthEur);
    const unrealized = n(
      summary?.unrealizedPnlBase ?? summary?.unrealizedPnlEur
    );
    const realized = n(summary?.realizedPnlBase ?? summary?.realizedPnlEur);
    const income = n(summary?.cashIncomeBase ?? summary?.cashIncomeEur);
    const totalReturn = n(
      summary?.totalReturnBase ?? summary?.totalReturnEur
    );
    const cost = n(
      summary?.totalCostBasisBase ??
        summary?.totalCostBasisEur ??
        summary?.totalCostBase
    );
    // Coût de référence pour % : cost basis cotés, sinon actif brut
    const costRef =
      cost > 0
        ? cost
        : n(summary?.totalGrossAssetsBase ?? summary?.totalGrossAssetsEur);
    const returnPct = costRef > 0 ? (totalReturn / costRef) * 100 : 0;
    const latentPct = costRef > 0 ? (unrealized / costRef) * 100 : 0;

    return {
      netWorth,
      unrealized,
      realized,
      income,
      totalReturn,
      returnPct,
      latentPct,
    };
  }, [summary]);

  const platformRows = useMemo(() => {
    const total =
      platforms.reduce((s, p) => s + (Number.isFinite(p.value) ? p.value : 0), 0) ||
      1;
    return [...platforms]
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((p) => ({
        name: p.name,
        value: p.value,
        pct: (p.value / total) * 100,
      }));
  }, [platforms]);

  const maxPlatform = platformRows[0]?.value ?? 1;

  return (
    <div
      className={cn(
        "card flex min-w-0 flex-col p-3.5 sm:p-4",
        className
      )}
      data-testid="portfolio-summary-panel"
      data-mode={mode}
    >
      <PanelHeader
        title="Synthèse patrimoniale"
        subtitle={
          mode === "global"
            ? "Vue d’ensemble de vos indicateurs"
            : "Poids de chaque plateforme"
        }
        actions={
          <SegmentedControl
            aria-label="Mode de synthèse"
            testId="summary-mode-switch"
          >
            {(
              [
                { id: "global" as const, label: "Global", enabled: showGlobal },
                {
                  id: "platforms" as const,
                  label: "Plateformes",
                  enabled: true,
                },
              ] as const
            ).map((t) => (
              <SegmentedItem
                key={t.id}
                selected={mode === t.id}
                disabled={!t.enabled}
                testId={`summary-mode-${t.id}`}
                onClick={() => t.enabled && setMode(t.id)}
              >
                {t.label}
              </SegmentedItem>
            ))}
          </SegmentedControl>
        }
      />

      {mode === "global" && showGlobal ? (
        <div
          className="grid flex-1 grid-cols-2 gap-x-3 gap-y-3 content-start"
          data-testid="summary-global-kpis"
        >
          <Stat
            compact
            label="Patrimoine net"
            value={formatCurrency(String(metrics.netWorth), baseCurrency)}
          />
          <Stat
            compact
            label="P&L latent"
            value={formatSignedCurrency(metrics.unrealized, baseCurrency)}
            tone={signedTone(metrics.unrealized)}
          />
          <Stat
            compact
            label="P&L réalisé"
            value={formatSignedCurrency(metrics.realized, baseCurrency)}
            tone={signedTone(metrics.realized)}
          />
          <Stat
            compact
            label="Revenus cash"
            value={formatCurrency(String(metrics.income), baseCurrency)}
            tone={signedTone(metrics.income)}
          />
          <Stat
            compact
            label="Performance"
            value={formatPct(metrics.returnPct)}
            tone={signedTone(metrics.returnPct)}
          />
          <Stat
            compact
            label="P&L latent %"
            value={formatPct(metrics.latentPct)}
            tone={signedTone(metrics.latentPct)}
          />
        </div>
      ) : (
        <div
          className="flex min-h-[10rem] flex-1 flex-col"
          data-testid="summary-platforms-view"
        >
          {platformRows.length === 0 ? (
            <EmptyPlaceholder
              compact
              title="Aucune position par plateforme"
              description="Ajoutez un achat pour voir la répartition ici."
            />
          ) : (
            <ul className="space-y-2.5">
              {platformRows.map((row) => (
                <li key={row.name} className="min-w-0">
                  <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate font-medium text-[var(--foreground)]">
                      {row.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">
                      {row.pct.toFixed(1)}&nbsp;%
                      <span className="mx-1 opacity-40">·</span>
                      <span className="font-medium text-[var(--foreground)]">
                        {formatCurrency(String(row.value), baseCurrency)}
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div
                      className="h-full rounded-full bg-[var(--primary)]"
                      style={{
                        width: `${Math.max(4, (row.value / maxPlatform) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
