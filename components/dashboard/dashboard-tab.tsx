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
  type EvolutionRange,
} from "@/app/lib/portfolio/evolution-aggregate";
import {
  DEFAULT_EVOLUTION_PREFS,
  loadEvolutionPrefs,
  saveEvolutionRange,
} from "@/app/lib/portfolio/evolution-prefs";
import { seriesChangeAbs, seriesChangePct } from "@/app/lib/portfolio/kpi-series";
import { useDailyNavQuery } from "@/app/hooks/use-portfolio-queries";
import { parisDayKey, endOfParisDay } from "@/app/lib/dates/paris";
import { historyFloorDay } from "@/app/lib/portfolio/historical/history-window";
import {
  dailyNavQueryWindow,
  dailyNavToHistoryPoints,
  servedDailyNavFrom,
  windowDailyNav,
  type HeroNavScope,
} from "@/app/lib/portfolio/daily-nav-view";
import type { DailyNavPoint } from "@/app/lib/portfolio/historical/get-daily-nav";
import { heroPeriodLabel } from "@/app/lib/portfolio/hero-range";
import { quoteStaleBadgeLabel } from "@/app/lib/ui/quote-staleness";
import { evolutionRangePeriodLabel } from "@/app/lib/ui/evolution-ranges";

/**
 * Série dense sur une fenêtre `getDailyNav`, ou rien.
 *
 * Même règle que `kpiSeries` (UNKNOWN ≠ ZERO), adaptée à `DailyNavPoint` —
 * `titresValueAt` et le croisement classe × enveloppe rendent `null` plutôt
 * qu'une valeur inventée, et un seul point manquant invalide toute la série
 * plutôt que de la combler.
 */
function denseNavSeries(
  points: DailyNavPoint[],
  pick: (p: DailyNavPoint) => number | null | undefined
): number[] | undefined {
  if (points.length < 2) return undefined;
  const out: number[] = [];
  for (const p of points) {
    const v = pick(p);
    if (v == null || !Number.isFinite(v)) return undefined;
    out.push(v);
  }
  return out;
}

/** États basculables de la tuile P&L — cf. AGENTS.md D19 P&L. */
type PnlTileMode = "latent" | "realized";

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
  /**
   * État de la tuile P&L — Latent par défaut. Ni l'un ni l'autre n'est
   * persisté : c'est une lecture ponctuelle du même écran, pas une
   * préférence durable comme la période ou le scope Net/Brut.
   */
  const [pnlMode, setPnlMode] = useState<PnlTileMode>("latent");

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
  /*
    Les bornes viennent du cap, plus d'une série que la page n'attend plus.

    `GET /api/portfolio` ne calcule plus d'historique : il tombait en 504 avant
    de le rendre, et les chips restaient grisés non parce que la profondeur
    manquait, mais parce que la réponse n'arrivait jamais. Lire `history[0]`
    pour décider ce qui est cliquable revenait à faire dépendre l'écran d'un
    appel dont il n'a plus besoin.

    La profondeur lisible est une constante — `MAX_HISTORY_YEARS`, six ans,
    la même qui borne le moteur. Un chip est donc activé parce que la période
    tient sous le cap, jamais parce qu'un tableau est arrivé rempli.

    Le jour de référence est aujourd'hui. Il ne peut pas être le dernier point
    servi : c'est lui qui compose la fenêtre demandée à `daily-nav`, dont la
    réponse fournirait ce point — la boucle se refermerait sur elle-même. Et
    c'est la fin de la fenêtre, pas son début : elle ne dépend d'aucune
    profondeur d'historique.
  */
  const floorDay = useMemo(() => historyFloorDay(), []);
  const firstHistoryDate = useMemo(
    () => endOfParisDay(floorDay).toISOString(),
    [floorDay]
  );
  if (
    rangeHydrated &&
    range !== "7d" &&
    !isEvolutionRangeEnabled(range, firstHistoryDate)
  ) {
    setRange("7d");
  }

  const referenceDay = parisDayKey(new Date());
  const earliestDay = floorDay;
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
    Fenêtre du bandeau d'indicateurs — même mécanique que la courbe
    (`windowDailyNav`, ancre conservée en tête pour le Δ), appliquée à la
    série brute `getDailyNav` plutôt qu'à sa recomposition `HistoryPoint` :
    c'est elle qui porte le croisement classe × enveloppe (Titres) et
    `byAssetClass` (Crypto), que `dailyNavToHistoryPoints` ne transporte pas.
  */
  const navWindowed = useMemo(
    () =>
      dailyNavPoints && dailyNavPoints.length
        ? windowDailyNav(dailyNavPoints, range, referenceDay)
        : [],
    [dailyNavPoints, range, referenceDay]
  );

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
    const sparkDates = navWindowed.map((p) => endOfParisDay(p.day).toISOString());

    /*
      Titres : croisement classe × enveloppe (PEA + CTO), jamais
      `byAssetClass` — même lecture que la répartition du patrimoine
      (`patrimonySlices` ci-dessus), pas une seconde formule.
    */
    const titres = denseNavSeries(navWindowed, (p) => titresValueAt(p));
    const crypto = denseNavSeries(navWindowed, (p) => p.byAssetClass?.CRYPTO);
    const av = denseNavSeries(navWindowed, (p) => p.av);
    /*
      Immobilier net : valeur des biens moins la dette qui les porte — même
      recomposition que `patrimonySlices.immobilier` (les seuls passifs
      actuels sont des crédits immobiliers), pas une seconde formule de
      valorisation.
    */
    const realEstateNet = denseNavSeries(navWindowed, (p) => p.immobilier - p.passifs);
    const alternatives = denseNavSeries(navWindowed, (p) => p.alternatifs);
    const employeeSavings = denseNavSeries(navWindowed, (p) => p.employeeSavings);
    const cash = denseNavSeries(navWindowed, (p) => p.cash);
    const liabilities = denseNavSeries(navWindowed, (p) => p.passifs);
    const latent = denseNavSeries(navWindowed, (p) => p.unrealizedPnl);
    // Réalisé pur (cessions), sans les revenus encaissés — cf. AGENTS.md D19 :
    // le repère de contrôle 3M (+117,08 €) est la seule vente de la période.
    const realized = denseNavSeries(navWindowed, (p) => p.realizedPnl);

    /*
      Ni `unrealizedPnl` ni `realizedPnl` ne sont périodiques : ce sont des
      cumuls à date. La tuile P&L affiche donc toujours un Δ de fenêtre —
      dernier point moins l'ancre que `windowDailyNav` conserve en tête —
      jamais le cumul brut, qui ne bougerait pas d'un chip de période à
      l'autre.
    */
    const latentPeriod = seriesChangeAbs(latent);
    const realizedPeriod = seriesChangeAbs(realized);
    const pnlPeriod = pnlMode === "latent" ? latentPeriod : realizedPeriod;
    const pnlSpark = pnlMode === "latent" ? latent : realized;
    /*
      « Tout » n'est plus « depuis l'origine » depuis le cap de six ans : son
      ancre est le plancher servi (`servedNavFrom`), daté explicitement — sinon
      le chip affirmerait une origine que l'application ne sert plus.
    */
    const periodPhrase =
      range === "all"
        ? heroPeriodLabel(range, servedNavFrom)
        : evolutionRangePeriodLabel(range);
    const pnlLabel =
      pnlMode === "latent"
        ? `P&L latent ${periodPhrase}`
        : `P&L réalisé ${periodPhrase}`;

    const cryptoNow = num(
      displayAllocation?.byClass?.find((s) => s.name === "CRYPTO")?.value ?? 0
    );
    const listedNow = num(
      summary?.totalListedBase ??
        summary?.totalListedEur ??
        summary?.totalMarketValueBase ??
        summary?.totalMarketValueEur
    );
    /*
      Même repli que `patrimonySlices` : croisement classe × enveloppe en
      priorité, `listed − crypto` seulement s'il n'est pas encore chargé.
      Pas une seconde formule — la même lecture, appliquée au dernier point
      de la fenêtre `getDailyNav` plutôt qu'à celui de la répartition.
    */
    const lastNavPoint = navWindowed[navWindowed.length - 1];
    const titresCroisementNow = lastNavPoint
      ? titresValueAt(lastNavPoint)
      : null;
    const realEstateNetNow =
      num(summary?.totalRealEstateBase ?? summary?.totalRealEstateEur) -
      num(summary?.totalLiabilitiesBase ?? summary?.totalLiabilitiesEur);

    return [
      {
        key: "pnl",
        label: pnlLabel,
        // UNKNOWN ≠ ZERO : une fenêtre trop courte ne doit pas se lire comme
        // un P&L nul sur la période.
        value: pnlPeriod,
        spark: pnlSpark,
        sparkDates,
        changeAbs: undefined,
        changePct: undefined,
        tone: pnlPeriod == null ? "neutral" : pnlPeriod >= 0 ? "positive" : "negative",
        /*
          Bascule Latent / Réalisé, à l'intérieur de la tuile — la seule à en
          porter une : les deux grandeurs partagent la même définition (Δ de
          fenêtre sur un cumul à date), et n'ont donc pas besoin de deux
          tuiles séparées.
        */
        toggle: {
          active: pnlMode,
          options: [
            { id: "latent", label: "Latent" },
            { id: "realized", label: "Réalisé" },
          ],
          onChange: (id) => setPnlMode(id as PnlTileMode),
        },
      },
      {
        key: "titres",
        label: "Titres",
        help: "PEA + CTO (actions, obligations). Hors crypto et hors CFD.",
        value: num(
          titresCroisementNow ??
            Math.max(0, listedNow - cryptoNow)
        ),
        spark: titres,
        sparkDates,
        changeAbs: seriesChangeAbs(titres),
        changePct: seriesChangePct(titres),
        tone: "gold",
      },
      {
        key: "crypto",
        label: "Crypto",
        value: cryptoNow,
        spark: crypto,
        sparkDates,
        changeAbs: seriesChangeAbs(crypto),
        changePct: seriesChangePct(crypto),
        tone: "gold",
      },
      {
        key: "life-insurance",
        label: "Assurance-vie",
        value: num(summary?.totalLifeInsuranceBase ?? summary?.totalLifeInsuranceEur),
        spark: av,
        sparkDates,
        changeAbs: seriesChangeAbs(av),
        changePct: seriesChangePct(av),
        tone: "neutral",
      },
      {
        key: "real-estate",
        label: "Immobilier net",
        help: "Valeur des biens moins la dette qui les porte.",
        value: realEstateNetNow,
        spark: realEstateNet,
        sparkDates,
        changeAbs: seriesChangeAbs(realEstateNet),
        changePct: seriesChangePct(realEstateNet),
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
    ];
  }, [summary, navWindowed, range, pnlMode, servedNavFrom, displayAllocation?.byClass]);

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
