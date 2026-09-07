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
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  allocationSliceLabel,
  allocationSlicesForScope,
} from "@/app/lib/portfolio/allocation-scope";
import { allocatePercents } from "@/app/lib/ui/allocate-percents";
import { titresValueAt } from "@/app/lib/portfolio/pocket-series";
import type {
  Holding,
  HistoryPoint,
  PortfolioAllocation,
} from "@/app/lib/types/ui";
import type { AllocationByVenueApi } from "@/app/lib/portfolio/allocation-by-venue-api";
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
import { useDailyNavQuery } from "@/app/hooks/use-portfolio-queries";
import { parisDayKey } from "@/app/lib/dates/paris";
import {
  dailyNavQueryWindow,
  dailyNavToHistoryPoints,
  servedDailyNavFrom,
  type HeroNavScope,
} from "@/app/lib/portfolio/daily-nav-view";
import { heroWindowReference } from "@/app/lib/portfolio/hero-range";
import { quoteStaleBadgeLabel } from "@/app/lib/ui/quote-staleness";
import { evolutionRangePeriodLabel } from "@/app/lib/ui/evolution-ranges";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type DashboardTabProps = {
  baseCurrency: string;
  summary?: Record<string, string | number>;
  allocation?: PortfolioAllocation;
  /** D14.2 — répartition par endroit de détention, dénominateur du pavé Répartition. */
  allocationByVenue?: AllocationByVenueApi;
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
  // `allocationByVenue` (D14.2) n'alimente plus ce pavé — remplacé par la
  // répartition par classe de détention (D19 P2bis). Le prop reste dans le
  // contrat pour ne pas casser l'appelant ; l'API `allocation-by-venue`
  // continue d'exister pour d'autres usages.
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

  const [navScope, setNavScope] = useState<HeroNavScope>("net");

  /*
    Les valeurs brutes, sans `round2`.

    Arrondir ici avant que Hamilton ne répartisse les pourcentages faisait
    somner 100,1 % : chaque part était déjà écornée, puis `formatPct` arrondissait
    une seconde fois. `AllocationCard` applique `allocatePercents` sur ces
    montants tels quels.

    Le camembert lit le même périmètre que la carte active : Financier
    n'inclut pas l'immobilier, Brut/Net le portent, Net le dit « hors passifs ».
  */
  const classChart = useMemo(
    () =>
      allocationSlicesForScope(navScope, {
        byClass: displayAllocation?.byClass ?? [],
        holdings,
        cashInvestissement: num(
          summary?.cashInvestissementBase ?? summary?.cashInvestissementEur
        ),
        fondsEuro: num(summary?.fondsEuroBase ?? summary?.fondsEuroEur),
        esLiquid: num(summary?.esLiquidBase ?? summary?.esLiquidEur),
      }).map((x) => ({
        name: allocationSliceLabel(x.name),
        value: x.value,
      })),
    [displayAllocation?.byClass, holdings, navScope, summary]
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
   *
   * Le hero porte lui aussi les huit chips (`RANGES`, définies dans
   * `portfolio-evolution-panel.tsx` et réutilisées ici pour éviter deux
   * listes divergentes) : un clic dans la carte de tête appelle le même
   * `changeRange` que le panneau du bas, donc écrit le même état et la même
   * préférence — deux endroits pour changer une seule période, jamais deux
   * périodes. Les fenêtres, elles, s'ouvrent toutes depuis
   * `heroWindowReference` — la dernière valorisation, pas l'horloge.
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

  const referenceDay = parisDayKey(heroWindowReference(stableHistory));
  const earliestDay = stableHistory[0]?.date
    ? parisDayKey(new Date(stableHistory[0]!.date))
    : null;
  /*
    Fenêtre API : 1A couvre 7J…1A (texture quotidienne identique, recoupe
    côté client). 5A / Tout élargissent la requête.
  */
  const fetchRange: EvolutionRange =
    range === "5y" || range === "all" ? range : "1y";
  const navWindow = dailyNavQueryWindow(
    fetchRange,
    referenceDay,
    earliestDay
  );
  const dailyNavQ = useDailyNavQuery(navWindow.from, navWindow.to);
  const dailyNavPoints = dailyNavQ.data?.points;

  /*
    Répartition du patrimoine (D19 P2bis) — sept parts par classe de
    détention, plus une notice de passifs sous le pavé. Remplace la vue « par
    endroit » (PEA / CTO / Tangibles) de ce panneau précis.

    Chaque montant reprend un total déjà publié et vérifié ailleurs sur
    l'écran (les mêmes chiffres que les tuiles KPI) : aucune formule de
    valorisation n'est recalculée ici, seulement une recomposition d'aire.
    « Titres » retire la part crypto de `totalListedBase` (ACTIONS +
    OBLIGATIONS + CRYPTO) via `byClass`, pour isoler PEA + CTO de la crypto —
    même source, pas un second calcul.

    Pas de part Trading : `TradingPosition` n'est pas chargé par le moteur
    historique, la série n'existe pas — UNKNOWN ≠ ZERO, donc omise plutôt
    qu'affichée à zéro.

    Couleurs en hex fixe (pas de jeton `var(--chart-…)`) : elles doivent
    rester identiques en clair et en sombre, comme les couleurs par endroit
    (D14.5) dont ce pavé reprend le mécanisme d'affichage.
  */
  const patrimonySlices = useMemo(() => {
    const byClass = displayAllocation?.byClass ?? [];
    const cryptoValue = byClass.find((s) => s.name === "CRYPTO")?.value ?? 0;
    const crypto = num(cryptoValue);
    const listed = num(
      summary?.totalListedBase ??
        summary?.totalListedEur ??
        summary?.totalMarketValueBase ??
        summary?.totalMarketValueEur
    );
    /*
      « Titres » est PEA + CTO, et se lit au croisement classe × enveloppe.

      `listed − crypto` paraissait équivalent et ne l'est pas : mesuré au
      2026-09-06, il vaut 1 471 154,16 € contre 1 416 506,17 € pour les deux
      comptes-titres. Les 54 648 € d'écart sont la ligne NASDAQ 100 en CFD —
      cotée, donc dans `listed`, mais dans aucun compte. La ranger dans
      « Titres » contredirait le sélecteur Compte d'E18, qui l'exclut
      explicitement, et ferait porter à une part un montant qu'aucun compte ne
      détient. Elle rejoint l'écart annoncé sous le pavé.

      Repli sur `listed − crypto` seulement si le croisement n'est pas encore
      chargé : une part absente vaut mieux qu'une part fausse, mais un écran
      vide au premier rendu ne rend service à personne.
    */
    const dernierPoint = dailyNavPoints?.[dailyNavPoints.length - 1];
    const titresCroisement = dernierPoint ? titresValueAt(dernierPoint) : null;
    const titres = titresCroisement ?? Math.max(0, listed - crypto);
    /*
      Immobilier **net** : la valeur des biens moins la dette qui les porte.

      Le passif du patrimoine est aujourd'hui constitué des seuls crédits
      immobiliers — le crédit auto est intégralement amorti, son capital
      restant dû vaut zéro. Retrancher le total des passifs est donc exact ici,
      et c'est ce qui fait que la somme des parts retombe sur le patrimoine
      net. Si une dette non immobilière réapparaissait, cette ligne devrait
      lire les passifs adossés aux biens plutôt que leur total.
    */
    const immobilierBrut = num(
      summary?.totalRealEstateBase ?? summary?.totalRealEstateEur
    );
    const passifs = num(
      summary?.totalLiabilitiesBase ?? summary?.totalLiabilitiesEur
    );
    const immobilier = Math.max(0, immobilierBrut - passifs);
    const av = num(
      summary?.totalLifeInsuranceBase ?? summary?.totalLifeInsuranceEur
    );
    const es = num(
      summary?.totalEmployeeSavingsBase ?? summary?.totalEmployeeSavingsEur
    );
    const alt = num(
      summary?.totalAlternativesBase ?? summary?.totalAlternativesEur
    );
    const cash = num(summary?.totalCashBase ?? summary?.totalCashEur);

    const parts = [
      { key: "titres", label: "Titres", value: titres, color: "#d9a64d" },
      {
        key: "immobilier",
        label: "Immobilier net",
        value: immobilier,
        color: "#1f9bb3",
      },
      { key: "av", label: "Assurance-vie", value: av, color: "#2e9e63" },
      { key: "es", label: "Épargne salariale", value: es, color: "#0d6f80" },
      { key: "crypto", label: "Crypto", value: crypto, color: "#b8860b" },
      { key: "alt", label: "Alternatifs", value: alt, color: "#7c5cbf" },
      { key: "liquidites", label: "Liquidités", value: cash, color: "#6b7280" },
    ].filter((p) => p.value > 0);

    const pcts = allocatePercents(
      parts.map((p) => p.value),
      1
    );
    return parts.map((p, i) => ({
      id: p.key,
      label: p.label,
      amountEur: p.value,
      pct: pcts[i] ?? 0,
      color: p.color,
    }));
  }, [displayAllocation?.byClass, summary, dailyNavPoints]);

  const liabilitiesTotal = num(
    summary?.totalLiabilitiesBase ?? summary?.totalLiabilitiesEur
  );
  /*
    Notice, pas une part : les passifs ne se dessinent ni dans le donut ni
    dans la mosaïque (cf. Passifs, KPI dédié). Montant négatif — c'est ce
    qu'ils retranchent du patrimoine net.
  */
  /*
    Ce que la somme des parts ne couvre pas.

    Les parts doivent retomber sur le patrimoine net affiché au hero. Elles n'y
    retombent pas exactement, et l'écart a une composition connue : les lignes
    en CFD — NASDAQ 100, EUR/USD, or — sont dans le patrimoine mais
    n'appartiennent à aucun compte, donc à aucune part. Plutôt que de les
    diluer dans une part qui ne les détient pas, ou de laisser le lecteur
    découvrir que le camembert ne fait pas le total, le pavé le dit.

    Calculé, jamais écrit en dur : si une part venait à couvrir ces lignes,
    l'écart tomberait à zéro et la mention disparaîtrait d'elle-même.
  */
  const patrimonyNet = num(summary?.netWorthBase ?? summary?.netWorthEur);
  const patrimonySum = patrimonySlices.reduce((a, s) => a + s.amountEur, 0);
  const patrimonyGap = patrimonyNet - patrimonySum;

  const patrimonyFootnote = [
    liabilitiesTotal > 0
      ? `dont passifs −${formatCurrency(liabilitiesTotal, baseCurrency)}`
      : null,
    Math.abs(patrimonyGap) >= 1
      ? `hors comptes ${formatCurrency(patrimonyGap, baseCurrency)} (CFD / devises non historisés)`
      : null,
  ]
    .filter(Boolean)
    .join(" · ") || undefined;

  /*
    Libellé de période : borne **servie**, jamais celle demandée, jamais
    le `from` d'une fenêtre 1A encore affichée par `keepPreviousData`.
  */
  const servedNavFrom = servedDailyNavFrom(dailyNavQ.data, {
    isPlaceholderData: dailyNavQ.isPlaceholderData,
  });
  const staleQuotesLabel = quoteStaleBadgeLabel(
    dailyNavQ.isPlaceholderData ? undefined : dailyNavQ.data?.fetchedAt
  );
  const navHistory = useMemo(
    () =>
      dailyNavPoints && dailyNavPoints.length >= 2
        ? dailyNavToHistoryPoints(dailyNavPoints)
        : [],
    [dailyNavPoints]
  );
  const curveHistory = navHistory.length >= 2 ? navHistory : stableHistory;
  const showNavLoading =
    showHistoryLoading ||
    (dailyNavQ.isPending && navHistory.length === 0);

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
    const source = curveHistory.length >= 2 ? curveHistory : stableHistory;
    const h = windowForRange(
      source,
      range,
      heroWindowReference(source)
    );
    const sparkDates = h.map((p) => p.date);

    const listed = kpiSeries(h, listedValueAt);
    const cash = kpiSeries(h, (p) => p.cashTotalBase);
    const alternatives = kpiSeries(h, (p) => p.alternativesBase);
    const employeeSavings = kpiSeries(h, (p) => p.employeeSavingsBase);
    const liabilities = kpiSeries(h, (p) => p.liabilitiesBase);
    const latent = kpiSeries(h, latentPnlAt);
    const realized = kpiSeries(h, realizedPlusIncomeAt);
    /*
      La série est cumulative depuis l'origine : sa variation sur la fenêtre
      *est* ce qui a été réalisé et encaissé pendant la fenêtre. Une seule
      lecture, réutilisée par le montant et par la teinte.
    */
    const realizedPeriod = seriesChangeAbs(realized);

    return [
      {
        key: "listed",
        label: "Titres & crypto",
        /*
          Poche T-01 `listed` : ACTIONS + OBLIGATIONS + CRYPTO, hors IMMO/AV.
          Même série / fenêtre que le hero (getDailyNav).
        */
        value: num(
          summary?.totalListedBase ??
            summary?.totalListedEur ??
            listed?.[listed.length - 1]
        ),
        spark: listed,
        sparkDates,
        changeAbs: seriesChangeAbs(listed),
        changePct: seriesChangePct(listed),
        tone: "gold",
      },
      {
        key: "latent",
        /*
          Le suffixe n'est pas décoratif. Toutes les autres tuiles présentent un
          encours du jour surmontant une variation sur la période choisie ; le
          P&L latent, lui, est déjà un cumul depuis l'origine. Posé sans horizon
          à côté d'une variation à sept jours, il se lisait comme s'il portait
          la même fenêtre — d'où « Titres −872 € » et « P&L latent +14 606 € »
          sur le même écran, deux grandeurs justes que rien ne distinguait.
        */
        label: "P&L latent depuis l'origine",
        value: num(summary?.unrealizedPnlBase ?? summary?.unrealizedPnlEur),
        spark: latent,
        sparkDates,
        changeAbs: seriesChangeAbs(latent),
        changePct: seriesChangePct(latent),
      },
      {
        key: "cash",
        /*
          « Cash » désignait la poche sans dire ce qu'elle contient, et laissait
          croire à la seule trésorerie bancaire. Elle porte aussi le disponible
          des enveloppes d'investissement — mesuré : 11 820,75 € de comptes
          courants, 53 450,00 € de livrets, et 8 540,50 € en PEA, CTO et AV.

          Les trois enveloppes sont nommées, sans points de suspension :
          `EnvelopeCash` n'a que ces trois valeurs, et en promettre d'autres
          annoncerait un périmètre qui n'existe pas.

          Les intérêts de livrets déjà versés restent dans le montant : ils sont
          capitalisés dans le solde, et les en retirer ferait mentir la tuile.
        */
        label: "Liquidités",
        help:
          "Comptes courants, livrets et épargne bancaire, plus le cash non " +
          "investi des comptes d’investissement (PEA, CTO, AV). Pas les titres.",
        value: num(summary?.totalCashBase ?? summary?.totalCashEur),
        spark: cash,
        sparkDates,
        changeAbs: seriesChangeAbs(cash),
        changePct: seriesChangePct(cash),
        tone: "cyan",
      },
      {
        key: "alternatives",
        label: "Alternatifs",
        value: num(summary?.totalAlternativesBase ?? summary?.totalAlternativesEur),
        spark: alternatives,
        sparkDates,
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
        sparkDates,
        changeAbs: seriesChangeAbs(employeeSavings),
        changePct: seriesChangePct(employeeSavings),
        tone: "neutral",
      },
      {
        key: "liabilities",
        label: "Passifs",
        value: num(summary?.totalLiabilitiesBase ?? summary?.totalLiabilitiesEur),
        spark: liabilities,
        sparkDates,
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
        /*
          Même défaut que le P&L latent, à l'envers : la série est cumulative
          depuis l'origine, mais la tuile doit porter la somme réalisée +
          encaissée sur la fenêtre affichée, pas le cumul. Cette somme vaut
          exactement `dernier − premier` de la série — ce que
          `seriesChangeAbs` calcule déjà — donc le montant de tête et
          `seriesChangeAbs(realized)` sont la même grandeur. Pas de seconde
          formule, et pas de ligne de variation en double en dessous : une
          fois le montant devenu la variation de la période, la répéter en
          dessous n'apprendrait rien.
        */
        label: `Réalisé + revenus ${evolutionRangePeriodLabel(range)}`,
        // UNKNOWN ≠ ZERO : une série absente ou à un seul point ne doit pas
        // se lire comme un réalisé nul sur la période.
        value: realizedPeriod,
        spark: realized,
        sparkDates,
        // Le dénominateur d'un « réalisé en % » serait le capital de la
        // fenêtre, non calculé ici : un pourcentage adossé à autre chose
        // serait faux, donc aucun n'est affiché sur cette tuile.
        changeAbs: undefined,
        changePct: undefined,
        /*
          La teinte se déduisait du signe de `changeAbs`. Celui-ci ayant
          disparu, la tuile serait retombée en gris neutre alors que son
          montant, lui, a bien un signe. On le déclare donc explicitement :
          la couleur décrit le chiffre affiché, comme partout ailleurs.
        */
        tone:
          realizedPeriod == null
            ? "neutral"
            : realizedPeriod >= 0
              ? "positive"
              : "negative",
      },
    ];
  }, [summary, stableHistory, curveHistory, range]);

  const netWorth = summary
    ? num(summary.netWorthBase ?? summary.netWorthEur)
    : null;
  /** Somme des actifs, sans déduction des passifs — même source que `netWorth`. */
  const grossAssets = summary
    ? num(summary.totalGrossAssetsBase ?? summary.totalGrossAssetsEur)
    : null;
  const financier = summary
    ? num(summary.totalFinancierBase ?? summary.totalFinancierEur)
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
          financier={financier}
          history={curveHistory}
          baseCurrency={baseCurrency}
          loading={showNavLoading}
          scope={navScope}
          onScopeChange={setNavScope}
          range={range}
          onRangeChange={changeRange}
          firstHistoryDate={firstHistoryDate}
          servedNavFrom={servedNavFrom}
        />
      )}

      {blocks.showEvolutionChart && staleQuotesLabel && (
          <p
            className="-mt-[var(--space-2)] px-[var(--space-1)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]"
            data-testid="hero-stale-quotes"
            role="status"
          >
            {staleQuotesLabel}
          </p>
        )}

      {/*
        Ce que la courbe raconte, dit une fois pour toutes.

        La ligne trace la NAV, capital investi compris : un achat la fait monter
        sans qu'aucune valeur ait progressé. La performance, elle, retire ce
        capital — elle peut donc être négative le mois où le patrimoine atteint
        son plus haut. Les deux affirmations sont vraies en même temps, et
        c'est précisément ce qui déroute sans cette phrase.
      */}
      {blocks.showEvolutionChart && (
        <p
          className="-mt-[var(--space-2)] px-[var(--space-1)] text-[length:var(--text-2xs)] text-[var(--foreground-faint)]"
          data-testid="hero-legend"
        >
          La courbe inclut le capital investi. La performance peut être négative
          même si le patrimoine monte.
        </p>
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
              history={curveHistory}
              dailyNav={dailyNavPoints ?? []}
              navScope={navScope}
              navQueryFrom={navWindow.from}
              navQueryTo={navWindow.to}
              servedNavFrom={servedNavFrom}
              baseCurrency={baseCurrency}
              loading={showNavLoading}
              className="min-h-[22rem]"
              range={range}
              onRangeChange={changeRange}
            />
          )}

          {blocks.showAllocations && (
            <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
              <AllocationCard
                data={classChart}
                classSlices={patrimonySlices}
                footnote={patrimonyFootnote}
                title="Répartition du patrimoine"
                periodRange={range}
                baseCurrency={baseCurrency}
                scope={navScope}
                emptyHint="Les classes de détention apparaîtront dès le premier compte alimenté."
              />
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
