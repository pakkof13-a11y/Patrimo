"use client";

import { useEffect, useMemo, useState } from "react";
import { NewsMacroPanel } from "@/components/dashboard/news-macro-panel";
import type { PortfolioTickerProp } from "@/components/dashboard/market-calendar-panel";
import { PortfolioEvolutionPanel } from "@/components/dashboard/portfolio-evolution-panel";
import { AllocationClassPanel } from "@/components/dashboard/allocation-class-panel";
import { PortfolioSummaryPanel } from "@/components/dashboard/portfolio-summary-panel";
import { DashboardActivation } from "@/components/dashboard/dashboard-activation";
import {
  DashboardQuickActions,
  type DashboardNavTarget,
} from "@/components/dashboard/dashboard-quick-actions";
import { getAssetClassLabel, cn } from "@/app/lib/utils";
import { type HistoryPoint, type PortfolioAllocation } from "@/app/lib/types/ui";
import {
  dashboardBlocksFor,
  resolveDashboardMaturity,
  toOnboardingSignals,
  type DashboardMaturity,
  type DashboardMaturityInput,
} from "@/app/lib/dashboard/maturity";

type ClassSlice = { name: string; value: number };

/** Round to 2 decimals (display + pie labels) */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type DashboardTabProps = {
  baseCurrency: string;
  summary?: Record<string, string | number>;
  allocation?: PortfolioAllocation;
  history: HistoryPoint[];
  historyLoading?: boolean;
  /** Compteurs pour maturité (si absents → dérivés des props data) */
  maturityInput?: DashboardMaturityInput;
  /** Override test / story */
  maturityOverride?: DashboardMaturity;
  /** Titres cotés pour le calendrier des résultats (priorité portefeuille) */
  portfolioTickers?: PortfolioTickerProp[];
  onAddPlatform?: () => void;
  onImport?: () => void;
  onAddTransaction?: () => void;
  /** Navigation cockpit → vues métier */
  onNavigate?: (target: DashboardNavTarget) => void;
  showEveryStart?: boolean;
  onShowEveryStartChange?: (v: boolean) => void;
};

/**
 * Tableau de bord adaptatif :
 * - empty / setup → activation (faible densité)
 * - active → cockpit analytique complet
 */
export function DashboardTab({
  baseCurrency,
  summary,
  allocation,
  history,
  historyLoading,
  maturityInput,
  maturityOverride,
  portfolioTickers = [],
  onAddPlatform,
  onImport,
  onAddTransaction,
  onNavigate,
  showEveryStart,
  onShowEveryStartChange,
}: DashboardTabProps) {
  const resolvedInput: DashboardMaturityInput = maturityInput ?? {
    platformCount: 0,
    transactionCount: 0,
    holdingCount: (allocation?.byClass?.length ?? 0) > 0 ? 1 : 0,
    historyPointCount: history.length,
  };

  const maturity =
    maturityOverride ?? resolveDashboardMaturity(resolvedInput);
  const blocks = dashboardBlocksFor(maturity);
  const signals = toOnboardingSignals(resolvedInput);

  function handleNav(target: DashboardNavTarget) {
    if (onNavigate) {
      onNavigate(target);
      return;
    }
    if (target === "transaction") onAddTransaction?.();
    if (target === "import") onImport?.();
    if (target === "platforms") onAddPlatform?.();
  }

  // Keep last non-empty allocation visible while holdings/history refetch mid-refresh
  const [stableAllocation, setStableAllocation] = useState<
    PortfolioAllocation | undefined
  >(allocation);

  useEffect(() => {
    if (!allocation) return;
    const hasClass = (allocation.byClass?.length ?? 0) > 0;
    const hasPlat = (allocation.byPlatform?.length ?? 0) > 0;
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

  const [stableHistory, setStableHistory] = useState<HistoryPoint[]>(history);
  useEffect(() => {
    if (history.length > 0) setStableHistory(history);
  }, [history]);

  const showHistoryLoading =
    Boolean(historyLoading) &&
    stableHistory.length === 0 &&
    history.length === 0;

  const canActivate =
    Boolean(onAddPlatform) &&
    Boolean(onImport) &&
    Boolean(onAddTransaction);

  return (
    <div
      className="section-stack"
      data-testid="dashboard-tab"
      data-maturity={maturity}
    >
      {/* —— 1. Activation (empty / setup) —— */}
      {blocks.showOnboardingHero && canActivate && (
        <DashboardActivation
          maturity={maturity === "active" ? "setup" : maturity}
          signals={signals}
          onAddPlatform={onAddPlatform!}
          onImport={onImport!}
          onAddTransaction={onAddTransaction!}
          showEveryStart={showEveryStart}
          onShowEveryStartChange={onShowEveryStartChange}
        />
      )}

      {/* —— 1b. Actions rapides (mature) —— */}
      {blocks.showQuickActions && (
        <DashboardQuickActions onNavigate={handleNav} />
      )}

      {maturity === "setup" && !blocks.showOnboardingHero && (
        <p
          className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--muted)]/50 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]"
          data-testid="dashboard-setup-hint"
        >
          Continuez le journal d&apos;opérations pour enrichir l&apos;analyse
          patrimoniale (courbe, allocation, synthèse).
        </p>
      )}

      {/* —— 2. Analyse patrimoniale (grille modulaire) —— */}
      {(blocks.showEvolutionChart ||
        blocks.showAllocations ||
        blocks.showSecondaryStats) && (
        <section
          className="space-y-4"
          data-testid="dashboard-portfolio-section"
          aria-labelledby="dashboard-portfolio-heading"
        >
          <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
            <div>
              <h2
                id="dashboard-portfolio-heading"
                className="section-heading"
              >
                Votre patrimoine
              </h2>
              <p className="text-meta">
                Évolution, allocation et synthèse en un coup d&apos;œil
              </p>
            </div>
            {onNavigate && (
              <button
                type="button"
                className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--primary)] transition hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                data-testid="dashboard-link-positions"
                onClick={() => handleNav("positions")}
              >
                Voir les positions →
              </button>
            )}
          </div>

          {/*
            Desktop : 50/50 — évolution alignée en hauteur sur la colonne
            Allocation + Plateforme (même système de cartes).
          */}
          <div
            className={cn(
              "grid min-w-0 gap-4",
              blocks.showEvolutionChart && blocks.showAllocations
                ? "lg:grid-cols-2 lg:items-stretch"
                : blocks.showAllocations
                  ? "sm:grid-cols-2"
                  : ""
            )}
            data-testid="dashboard-analytics"
          >
            {blocks.showEvolutionChart && (
              <div
                className={cn(
                  "min-w-0",
                  blocks.showAllocations
                    ? "flex lg:h-full"
                    : "mx-auto w-full max-w-3xl xl:max-w-4xl"
                )}
              >
                <PortfolioEvolutionPanel
                  history={stableHistory}
                  baseCurrency={baseCurrency}
                  loading={showHistoryLoading}
                  className={blocks.showAllocations ? "w-full" : undefined}
                />
              </div>
            )}

            {blocks.showAllocations && (
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-4",
                  blocks.showEvolutionChart
                    ? "lg:h-full"
                    : "sm:col-span-2 sm:grid sm:grid-cols-2 sm:gap-4"
                )}
              >
                <AllocationClassPanel
                  data={classChart}
                  baseCurrency={baseCurrency}
                  compact
                />
                <PortfolioSummaryPanel
                  baseCurrency={baseCurrency}
                  summary={summary}
                  platforms={platformChart}
                  showGlobal={blocks.showSecondaryStats}
                  className="flex-1"
                />
              </div>
            )}

            {/* Synthèse seule si allocations masquées mais stats actives */}
            {blocks.showSecondaryStats && !blocks.showAllocations && (
              <PortfolioSummaryPanel
                baseCurrency={baseCurrency}
                summary={summary}
                platforms={platformChart}
                showGlobal
              />
            )}
          </div>
        </section>
      )}

      {/* —— 3. Contexte marché (zone distincte, sous le patrimoine) —— */}
      {blocks.showNewsMacro && (
        <section
          className="pt-0.5"
          data-testid="dashboard-market-section"
          aria-label="Contexte marché"
        >
          <NewsMacroPanel portfolioTickers={portfolioTickers} compact />
        </section>
      )}
    </div>
  );
}
