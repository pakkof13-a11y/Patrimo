"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
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
  type DashboardMaturity,
  type DashboardMaturityInput,
} from "@/app/lib/dashboard/maturity";
import {
  isEvolutionRangeEnabled,
  windowForRange,
  type EvolutionRange,
} from "@/app/lib/portfolio/evolution-aggregate";
import {
  DEFAULT_EVOLUTION_PREFS,
  loadEvolutionPrefs,
  saveEvolutionRange,
} from "@/app/lib/portfolio/evolution-prefs";
import {
  kpiSeries,
  latentPnlAt,
  listedValueAt,
  realizedPlusIncomeAt,
  seriesChangeAbs,
  seriesChangePct,
} from "@/app/lib/portfolio/kpi-series";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
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
}: DashboardTabProps) {
  const resolvedInput: DashboardMaturityInput = maturityInput ?? {
    platformCount: 0,
    transactionCount: 0,
    holdingCount: (allocation?.byClass?.length ?? 0) > 0 ? 1 : 0,
    historyPointCount: history.length,
  };

  const maturity = maturityOverride ?? resolveDashboardMaturity(resolvedInput);
  const blocks = dashboardBlocksFor(maturity);

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
   * Période commune du tableau de bord.
   *
   * Un seul réglage pour la courbe d'évolution et pour le bandeau
   * d'indicateurs. Le sélecteur reste affiché dans le panneau « Évolution du
   * portefeuille » — c'est là qu'on le cherche —, mais l'état vit ici, au-dessus
   * des deux blocs qui en dépendent.
   *
   * Le bandeau utilisait auparavant une fenêtre fixe de trente points, sans
   * rapport avec ce que l'utilisateur venait de choisir : deux périodes sur un
   * même écran, dont une que rien n'affichait. Passer de 1M à 1A changeait la
   * courbe et laissait les tuiles inchangées.
   *
   * La préférence enregistrée reste celle du panneau (`evolutionPrefs.v5`) :
   * partager l'état ne devait pas créer une seconde période mémorisée.
   */
  const isClient = useIsClient();
  const [range, setRange] = useState<EvolutionRange>(
    DEFAULT_EVOLUTION_PREFS.range
  );
  const [rangeHydrated, setRangeHydrated] = useState(false);
  // Seed depuis localStorage au passage client (adjust state while rendering)
  if (isClient && !rangeHydrated) {
    setRangeHydrated(true);
    setRange(loadEvolutionPrefs().range);
  }

  function changeRange(next: EvolutionRange) {
    setRange(next);
    saveEvolutionRange(next);
  }

  /*
    Repli 7J quand l'historique ne couvre pas la période enregistrée.

    Déplacé du panneau vers ici avec l'état qu'il corrige : un composant ne
    peut pas écrire l'état de son parent pendant son propre rendu. Le repli
    n'est délibérément **pas** enregistré — c'est une adaptation à un
    historique encore court, pas un choix de l'utilisateur, et l'écraser lui
    ferait perdre sa période dès que la courbe s'allonge.
  */
  const firstHistoryDate = stableHistory[0]?.date ?? null;
  if (
    rangeHydrated &&
    range !== "7d" &&
    !isEvolutionRangeEnabled(range, firstHistoryDate)
  ) {
    setRange("7d");
  }

  /**
   * Indicateurs — l'ordre du mockup, qui est aussi l'ordre de pilotage :
   * d'abord l'exposition cotée et le résultat, puis les poches annexes.
   *
   * Les sept tuiles lisent désormais la même chaîne : période commune →
   * fenêtre → série → courbe, variation € et variation %. Aucune n'a de
   * fenêtre propre, et aucune ne fabrique de zéro pour faire tenir un tracé —
   * `kpiSeries` déclare la série inconnue plutôt que de la combler.
   *
   * Le P&L latent et le réalisé sont reconstruits par le moteur historique
   * avec la définition du patrimoine du jour, à partir de l'état comptable
   * qu'il rejoue déjà (cf. `latentPnlAt`, `realizedPlusIncomeAt`). Ils
   * affichaient auparavant une courbe plate à zéro, faute que ces champs
   * soient calculés.
   */
  const kpis = useMemo<TerminalKpi[]>(() => {
    /*
      La période choisie, et rien d'autre.

      `windowForRange` est la fonction qu'emploie la courbe d'évolution : même
      découpe, même point d'ancrage en tête pour la valeur de départ. La
      variation de chaque tuile porte donc exactement sur la tranche de temps
      que le graphique dessine juste en dessous.

      La fenêtre glissante de trente points qui régnait ici évitait la variation
      « depuis l'origine », illisible sur un portefeuille parti de zéro. Ce
      compromis n'a plus à être arbitré dans le code : l'utilisateur choisit sa
      période, « Tout » compris, et `seriesChangePct` prend de toute façon pour
      base la première valeur non nulle.
    */
    const h = windowForRange(stableHistory, range);

    /*
      Une grandeur absente ne devient pas zéro.

      `kpiSeries` rend `undefined` dès qu'un point ne porte pas le champ
      demandé, au lieu de le remplacer par zéro pour faire tenir la courbe.
      Une ligne parfaitement plate à zéro est indiscernable d'un patrimoine
      réellement stable : c'est précisément la confusion que la doctrine du
      projet interdit. Un zéro véritable, lui, passe — une poche vide vaut
      zéro, et la courbe doit le dire.
    */
    const listed = kpiSeries(h, listedValueAt);
    const cash = kpiSeries(h, (p) => p.cashTotalBase);
    const alternatives = kpiSeries(h, (p) => p.alternativesBase);
    const employeeSavings = kpiSeries(h, (p) => p.employeeSavingsBase);
    const liabilities = kpiSeries(h, (p) => p.liabilitiesBase);
    const latent = kpiSeries(h, latentPnlAt);
    const realized = kpiSeries(h, realizedPlusIncomeAt);

    return [
      {
        key: "listed",
        label: "Cotés",
        value: num(summary?.totalMarketValueBase ?? summary?.totalMarketValueEur),
        spark: listed,
        changeAbs: seriesChangeAbs(listed),
        changePct: seriesChangePct(listed),
        tone: "gold",
      },
      {
        key: "latent",
        label: "P&L latent",
        value: num(summary?.unrealizedPnlBase ?? summary?.unrealizedPnlEur),
        spark: latent,
        changeAbs: seriesChangeAbs(latent),
        changePct: seriesChangePct(latent),
      },
      {
        key: "cash",
        label: "Cash",
        value: num(summary?.totalCashBase ?? summary?.totalCashEur),
        spark: cash,
        changeAbs: seriesChangeAbs(cash),
        changePct: seriesChangePct(cash),
        tone: "cyan",
      },
      {
        key: "alternatives",
        label: "Alternatifs",
        value: num(summary?.totalAlternativesBase ?? summary?.totalAlternativesEur),
        spark: alternatives,
        changeAbs: seriesChangeAbs(alternatives),
        changePct: seriesChangePct(alternatives),
        tone: "neutral",
      },
      {
        key: "employee-savings",
        label: "Épargne salariale",
        value: num(
          summary?.totalEmployeeSavingsBase ?? summary?.totalEmployeeSavingsEur
        ),
        spark: employeeSavings,
        changeAbs: seriesChangeAbs(employeeSavings),
        changePct: seriesChangePct(employeeSavings),
        tone: "neutral",
      },
      {
        key: "liabilities",
        label: "Passifs",
        value: num(summary?.totalLiabilitiesBase ?? summary?.totalLiabilitiesEur),
        spark: liabilities,
        /*
          Le signe n'est pas retourné : une dette qui baisse affiche bien une
          variation négative. Inverser la convention ici ferait de cette tuile
          la seule dont le signe ne décrit pas le mouvement du montant.
        */
        changeAbs: seriesChangeAbs(liabilities),
        changePct: seriesChangePct(liabilities),
        tone: "negative",
      },
      {
        key: "realized",
        label: "Réalisé + revenus",
        value:
          num(summary?.realizedPnlBase ?? summary?.realizedPnlEur) +
          num(summary?.cashIncomeBase ?? summary?.cashIncomeEur),
        spark: realized,
        changeAbs: seriesChangeAbs(realized),
        changePct: seriesChangePct(realized),
      },
    ];
  }, [summary, stableHistory, range]);

  const netWorth = summary
    ? num(summary.netWorthBase ?? summary.netWorthEur)
    : null;
  /** Somme des actifs, sans déduction des passifs — même source que `netWorth`. */
  const grossAssets = summary
    ? num(summary.totalGrossAssetsBase ?? summary.totalGrossAssetsEur)
    : null;

  /*
    Le tableau de bord ne porte plus l'accueil.

    Un compte réellement vierge n'arrive plus ici : `portfolio-app` affiche le
    cockpit à sa place, sur la foi de l'état patrimonial réel. Ce qui reste —
    un compte qui possède des données mais pas encore de positions calculées —
    doit voir son tableau de bord, pas une checklist « 0 / 3 étapes » qui
    l'inviterait à recommencer ce qu'il a déjà fait.
  */
  const onboardingAlone = false;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-[var(--gap-section)]",
        onboardingAlone && "min-h-[62vh] justify-center"
      )}
      data-testid="dashboard-tab"
      data-maturity={maturity}
    >
      {/* —— 1. Patrimoine (net ou brut, sélecteur dans la carte) —— */}
      {blocks.showEvolutionChart && (
        <TerminalHero
          netWorth={netWorth}
          grossAssets={grossAssets}
          history={stableHistory}
          baseCurrency={baseCurrency}
          loading={showHistoryLoading}
        />
      )}

      {/* —— 2. Indicateurs —— */}
      {blocks.showKpiStrip && (
        <TerminalKpiRow
          items={kpis}
          baseCurrency={baseCurrency}
          range={range}
        />
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
              range={range}
              onRangeChange={changeRange}
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
