/**
 * Maturité du compte pour le tableau de bord adaptatif.
 *
 * - empty  : aucun signal d’activité (accueil / activation)
 * - setup  : configuration en cours (plateforme et/ou premiers flux)
 * - active : journal + positions suffisants → cockpit analytique
 *
 * Principe métier : les transactions sont la source de vérité ;
 * les positions/KPI en découlent.
 */

export type DashboardMaturity = "empty" | "setup" | "active";

export type DashboardMaturityInput = {
  platformCount: number;
  transactionCount: number;
  holdingCount: number;
  /** Points d’historique portefeuille (snapshots) — optionnel */
  historyPointCount?: number;
};

export type OnboardingSignals = {
  hasPlatforms: boolean;
  hasHoldings: boolean;
  hasTransactions: boolean;
};

export function toOnboardingSignals(
  input: DashboardMaturityInput
): OnboardingSignals {
  return {
    hasPlatforms: input.platformCount > 0,
    hasHoldings: input.holdingCount > 0,
    hasTransactions: input.transactionCount > 0,
  };
}

/**
 * Résout l’état d’affichage du dashboard.
 *
 * empty  → 0 plateforme, 0 transaction, 0 position
 * active → au moins une transaction ET (positions OU ≥ 3 mouvements cash)
 * setup  → tout le reste (démarrage partiel)
 */
export function resolveDashboardMaturity(
  input: DashboardMaturityInput
): DashboardMaturity {
  const platforms = Math.max(0, input.platformCount | 0);
  const txs = Math.max(0, input.transactionCount | 0);
  const holdings = Math.max(0, input.holdingCount | 0);

  if (platforms === 0 && txs === 0 && holdings === 0) {
    return "empty";
  }

  // Portefeuille coté ou cash actif via le journal
  if (txs > 0 && (holdings > 0 || txs >= 3)) {
    return "active";
  }

  // Positions sans tx comptées = données importées / edge → cockpit si plateformes
  if (holdings > 0 && platforms > 0) {
    return "active";
  }

  return "setup";
}

/** 3 étapes d’activation (plateforme → données → positions dérivées). */
export function onboardingStepCompletion(signals: OnboardingSignals): {
  platform: boolean;
  data: boolean;
  portfolio: boolean;
  doneCount: number;
  total: number;
  percent: number;
} {
  const platform = signals.hasPlatforms;
  // Import CSV ou saisie manuelle = présence de transactions
  const data = signals.hasTransactions;
  const portfolio = signals.hasHoldings || signals.hasTransactions;
  const flags = [platform, data, portfolio];
  const doneCount = flags.filter(Boolean).length;
  const total = 3;
  return {
    platform,
    data,
    portfolio,
    doneCount,
    total,
    percent: Math.round((doneCount / total) * 100),
  };
}

export type DashboardBlockVisibility = {
  /** Bandeau KPI global (shell) */
  showKpiStrip: boolean;
  /** Masquer KPI secondaires à zéro (densité intelligente) */
  kpiSmartFilter: boolean;
  /** Checklist / hero onboarding */
  showOnboardingHero: boolean;
  /** Bandeau d’actions rapides (compte mature) */
  showQuickActions: boolean;
  /** Courbe d’évolution */
  showEvolutionChart: boolean;
  /** Allocations (classe / plateforme) */
  showAllocations: boolean;
  /** Stats secondaires (P&L réalisé, revenus…) */
  showSecondaryStats: boolean;
  /** News / macro (contexte marché) */
  showNewsMacro: boolean;
  /** Ancien toggle aide bienvenue — désactivé au profit des quick actions */
  showHelpToggle: boolean;
};

/** Que montrer selon la maturité (dashboard uniquement). */
export function dashboardBlocksFor(
  maturity: DashboardMaturity
): DashboardBlockVisibility {
  switch (maturity) {
    case "empty":
      return {
        showKpiStrip: false,
        kpiSmartFilter: false,
        showOnboardingHero: true,
        showQuickActions: false,
        showEvolutionChart: false,
        showAllocations: false,
        showSecondaryStats: false,
        showNewsMacro: false,
        showHelpToggle: false,
      };
    case "setup":
      return {
        showKpiStrip: false,
        kpiSmartFilter: false,
        showOnboardingHero: true,
        showQuickActions: false,
        showEvolutionChart: false,
        showAllocations: false,
        showSecondaryStats: false,
        showNewsMacro: false,
        showHelpToggle: false,
      };
    case "active":
    default:
      return {
        showKpiStrip: true,
        kpiSmartFilter: true,
        showOnboardingHero: false,
        showQuickActions: true,
        showEvolutionChart: true,
        showAllocations: true,
        showSecondaryStats: true,
        showNewsMacro: true,
        showHelpToggle: false,
      };
  }
}
