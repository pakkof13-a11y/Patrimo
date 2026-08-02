"use client";

import { useMemo, useState } from "react";
import { NewsMacroPanel } from "@/components/dashboard/news-macro-panel";
import type { PortfolioTickerProp } from "@/components/dashboard/market-calendar-panel";
import { PortfolioEvolutionPanel } from "@/components/dashboard/portfolio-evolution-panel";
import {
  TerminalHero,
  TerminalKpiRow,
  type TerminalKpi,
} from "@/components/dashboard/terminal-hero";
import {
  AllocationCard,
  RecentActivityCard,
  WatchlistCard,
} from "@/components/dashboard/terminal-panels";
import { DashboardActivation } from "@/components/dashboard/dashboard-activation";
import type { DashboardNavTarget } from "@/components/dashboard/dashboard-quick-actions";
import { getAssetClassLabel, cn } from "@/app/lib/utils";
import type {
  Holding,
  HistoryPoint,
  PortfolioAllocation,
} from "@/app/lib/types/ui";
import {
  dashboardBlocksFor,
  resolveDashboardMaturity,
  toOnboardingSignals,
  type DashboardMaturity,
  type DashboardMaturityInput,
} from "@/app/lib/dashboard/maturity";

/**
 * Profondeur d'historique des tuiles KPI (sparkline + variation).
 * Trente points ≈ un mois de relevés quotidiens : assez pour dessiner une
 * tendance, assez court pour que le pourcentage reste interprétable.
 */
const KPI_WINDOW_POINTS = 30;

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Variation d'une série d'historique, en %.
 *
 * La base est la première valeur **non nulle**, pas la première valeur tout
 * court : un portefeuille commence à zéro, et prendre ce zéro comme référence
 * rendait la variation incalculable sur presque tous les indicateurs — tous
 * affichaient « — » alors que l'historique existait. Les zéros de tête sont
 * l'absence de position, pas une valeur mesurée.
 *
 * `null` quand la série est trop courte ou entièrement nulle : mieux vaut ne
 * rien afficher qu'un pourcentage inventé.
 */
function seriesChangePct(values: number[]): number | null {
  if (values.length < 2) return null;
  const baseIdx = values.findIndex((v) => Number.isFinite(v) && v !== 0);
  if (baseIdx < 0 || baseIdx === values.length - 1) return null;
  const first = values[baseIdx]!;
  const last = values[values.length - 1]!;
  if (!Number.isFinite(last)) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

export type DashboardTabProps = {
  baseCurrency: string;
  summary?: Record<string, string | number>;
  allocation?: PortfolioAllocation;
  history: HistoryPoint[];
  historyLoading?: boolean;
  /** Lignes détenues — alimentent la watchlist. */
  holdings?: Holding[];
  maturityInput?: DashboardMaturityInput;
  maturityOverride?: DashboardMaturity;
  portfolioTickers?: PortfolioTickerProp[];
  onAddPlatform?: () => void;
  onImport?: () => void;
  onAddTransaction?: () => void;
  /** Retire un actif de la watchlist depuis la carte du tableau de bord. */
  onUnwatch?: (assetId: string) => void;
  onNavigate?: (target: DashboardNavTarget) => void;
  showEveryStart?: boolean;
  onShowEveryStartChange?: (v: boolean) => void;
};

/**
 * Tableau de bord — terminal patrimonial.
 *
 * Hiérarchie de lecture, dans cet ordre et sans exception :
 *   patrimoine net → indicateurs → évolution → répartition → activité.
 *
 * Chaque bloc est plus dense et moins contrasté que le précédent ; c'est ce
 * dégradé, plus que les tailles de police prises isolément, qui fait que
 * l'œil descend la page sans hésiter.
 */
export function DashboardTab({
  baseCurrency,
  summary,
  allocation,
  history,
  historyLoading,
  holdings = [],
  maturityInput,
  maturityOverride,
  portfolioTickers = [],
  onAddPlatform,
  onImport,
  onAddTransaction,
  onUnwatch,
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

  const maturity = maturityOverride ?? resolveDashboardMaturity(resolvedInput);
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

  // Conserve la dernière allocation non vide pendant un rafraîchissement :
  // sans cela le camembert disparaît à chaque refetch.
  const [stableAllocation, setStableAllocation] = useState<
    PortfolioAllocation | undefined
  >(allocation);
  const [prevAllocation, setPrevAllocation] = useState(allocation);
  if (allocation !== prevAllocation) {
    setPrevAllocation(allocation);
    if (allocation) {
      const hasClass = (allocation.byClass?.length ?? 0) > 0;
      const hasPlat = (allocation.byPlatform?.length ?? 0) > 0;
      if (hasClass || hasPlat) setStableAllocation(allocation);
    }
  }
  const displayAllocation = stableAllocation ?? allocation;

  const classChart = useMemo(
    () =>
      displayAllocation?.byClass.map((x) => ({
        name: getAssetClassLabel(x.name),
        value: round2(num(x.value)),
      })) ?? [],
    [displayAllocation?.byClass]
  );

  const [stableHistory, setStableHistory] = useState<HistoryPoint[]>(history);
  const [prevHistory, setPrevHistory] = useState(history);
  if (history !== prevHistory) {
    setPrevHistory(history);
    if (history.length > 0) setStableHistory(history);
  }

  const showHistoryLoading =
    Boolean(historyLoading) && stableHistory.length === 0 && history.length === 0;

  /**
   * Indicateurs — l'ordre du mockup, qui est aussi l'ordre de pilotage :
   * d'abord l'exposition cotée et le résultat, puis les poches annexes.
   *
   * Une sparkline n'est fournie que là où l'historique porte réellement la
   * grandeur. Alternatifs, épargne salariale et passifs n'y figurent pas :
   * leur tracer une courbe reviendrait à inventer une trajectoire.
   */
  const kpis = useMemo<TerminalKpi[]>(() => {
    // Fenêtre glissante plutôt que l'historique entier : sur un portefeuille
    // parti de zéro, une variation « depuis l'origine » affiche +30 000 % et
    // n'apprend rien. Un indicateur de tête répond à « où en est-on
    // récemment ? », pas à « qu'a-t-on accumulé depuis toujours ? ».
    const h = stableHistory.slice(-KPI_WINDOW_POINTS);
    const seriesOf = (pick: (p: HistoryPoint) => number) =>
      h.length >= 2 ? h.map(pick) : undefined;

    const listed = seriesOf((p) => num(p.positionsBase));
    const latent = seriesOf((p) => num(p.unrealizedPnlBase));
    const cash = seriesOf((p) => num(p.cashTotalBase));
    const realized = seriesOf(
      (p) => num(p.realizedPnlBase) + num(p.cashIncomeBase)
    );

    return [
      {
        key: "listed",
        label: "Cotés",
        value: num(summary?.totalMarketValueBase ?? summary?.totalMarketValueEur),
        spark: listed,
        changePct: listed ? seriesChangePct(listed) : null,
        tone: "gold",
      },
      {
        key: "latent",
        label: "P&L latent",
        value: num(summary?.unrealizedPnlBase ?? summary?.unrealizedPnlEur),
        spark: latent,
        changePct: latent ? seriesChangePct(latent) : null,
      },
      {
        key: "cash",
        label: "Cash",
        value: num(summary?.totalCashBase ?? summary?.totalCashEur),
        spark: cash,
        changePct: cash ? seriesChangePct(cash) : null,
        tone: "cyan",
      },
      {
        key: "alternatives",
        label: "Alternatifs",
        value: num(summary?.totalAlternativesBase ?? summary?.totalAlternativesEur),
        changePct: null,
        tone: "neutral",
      },
      {
        key: "employee-savings",
        label: "Épargne salariale",
        value: num(
          summary?.totalEmployeeSavingsBase ?? summary?.totalEmployeeSavingsEur
        ),
        changePct: null,
        tone: "neutral",
      },
      {
        key: "liabilities",
        label: "Passifs",
        value: num(summary?.totalLiabilitiesBase ?? summary?.totalLiabilitiesEur),
        changePct: null,
        tone: "negative",
      },
      {
        key: "realized",
        label: "Réalisé + revenus",
        value:
          num(summary?.realizedPnlBase ?? summary?.realizedPnlEur) +
          num(summary?.cashIncomeBase ?? summary?.cashIncomeEur),
        spark: realized,
        changePct: realized ? seriesChangePct(realized) : null,
      },
    ];
  }, [summary, stableHistory]);

  const netWorth = summary
    ? num(summary.netWorthBase ?? summary.netWorthEur)
    : null;

  const canActivate =
    Boolean(onAddPlatform) && Boolean(onImport) && Boolean(onAddTransaction);
  const onboardingAlone = blocks.showOnboardingHero && canActivate;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-[var(--gap-section)]",
        onboardingAlone && "min-h-[62vh] justify-center"
      )}
      data-testid="dashboard-tab"
      data-maturity={maturity}
    >
      {/* —— Activation (compte vierge ou en cours de constitution) —— */}
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

      {/* —— 1. Patrimoine net —— */}
      {blocks.showEvolutionChart && (
        <TerminalHero
          netWorth={netWorth}
          history={stableHistory}
          baseCurrency={baseCurrency}
          loading={showHistoryLoading}
        />
      )}

      {/* —— 2. Indicateurs —— */}
      {blocks.showKpiStrip && (
        <TerminalKpiRow items={kpis} baseCurrency={baseCurrency} />
      )}

      {/* —— 3 & 4. Évolution · Répartition + Watchlist —— */}
      {(blocks.showEvolutionChart || blocks.showAllocations) && (
        <div
          className={cn(
            "grid min-w-0 gap-[var(--gap-card)]",
            blocks.showEvolutionChart && blocks.showAllocations
              ? "xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start"
              : ""
          )}
          data-testid="dashboard-analytics"
        >
          {blocks.showEvolutionChart && (
            <PortfolioEvolutionPanel
              history={stableHistory}
              baseCurrency={baseCurrency}
              loading={showHistoryLoading}
              className="min-h-[22rem]"
            />
          )}

          {blocks.showAllocations && (
            <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
              <AllocationCard data={classChart} baseCurrency={baseCurrency} />
              <WatchlistCard
                holdings={holdings}
                onUnwatch={onUnwatch}
                onOpenPositions={() => handleNav("positions")}
              />
            </div>
          )}
        </div>
      )}

      {/* —— 5. Activité récente —— */}
      {blocks.showEvolutionChart && (
        <RecentActivityCard
          baseCurrency={baseCurrency}
          onOpenJournal={() => handleNav("transactions")}
        />
      )}

      {/* —— Contexte marché — zone secondaire, sous le patrimoine —— */}
      {blocks.showNewsMacro && (
        <NewsMacroPanel portfolioTickers={portfolioTickers} compact />
      )}
    </div>
  );
}
