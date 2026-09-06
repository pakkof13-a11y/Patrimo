"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { HistoryPoint } from "@/app/lib/types/ui";
import { scopeHistory } from "@/app/lib/portfolio/scope-history";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { useDailyNavQuery } from "@/app/hooks/use-portfolio-queries";
import {
  buildEvolutionSeries,
  benchmarkLabel,
  evolutionDeltaSummary,
  evolutionIntervalHint,
  evolutionIntervalLabel,
  isEvolutionRangeEnabled,
  startOfRange,
  type EvolutionRange,
  type IndexClosePoint,
} from "@/app/lib/portfolio/evolution-aggregate";
import { parisDayKey } from "@/app/lib/dates/paris";
import {
  dailyNavToVsIndexLevels,
  INDEX_UNAVAILABLE_TITLE,
  rebaseToCommonBase100,
  toVsIndexPercentPoints,
  vsIndexChartKind,
  vsIndexGapPct,
  vsIndexHasOverlay,
  windowVsIndexNav,
} from "@/app/lib/portfolio/vs-index-series";
import { EVOLUTION_RANGE_CHIPS as RANGES } from "@/app/lib/ui/evolution-ranges";
import {
  DEFAULT_EVOLUTION_PREFS,
  loadEvolutionPrefs,
  normalizeEnvelopeFor,
  saveEvolutionPrefs,
  type EvolutionBenchmark,
  type EvolutionPrefsV5,
  type EvolutionAssetClass,
} from "@/app/lib/portfolio/evolution-prefs";
import {
  MARKET_INDICES,
  marketIndexLabel,
  type MarketIndexKey,
} from "@/app/lib/portfolio/market-indices";
import { heroWindowReference } from "@/app/lib/portfolio/hero-range";
import {
  PortfolioPercentChart,
  PortfolioValueChart,
  DailyNavChart,
} from "@/components/dashboard/portfolio-evolution-charts";
import { IntradaySection } from "@/components/dashboard/intraday-section";
import type { DailyNavPoint } from "@/app/lib/portfolio/historical/get-daily-nav";
import {
  headerFlux,
  headerMarketDelta,
  HERO_NAV_SCOPE_LABEL,
  servedDailyNavFrom,
  toDailyNavChartPoints,
  windowDailyNav,
  type HeroNavScope,
} from "@/app/lib/portfolio/daily-nav-view";
import {
  dailyNavScopeForClass,
  pocketChartLineType,
  pocketEmptyState,
  pocketSeriesTooShort,
  toPocketEvolutionPoints,
  windowPocketDailyNav,
} from "@/app/lib/portfolio/pocket-series";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

/**
 * Classes proposées au sélecteur.
 *
 * Les six valeurs de `Asset.assetClass`, plus « Tout ». Cette taxonomie est la
 * seule reconstructible historiquement : `assetClass` n'a aucun chemin de mise
 * à jour, là où `category` et `accountType` sont mutables sans journal — les
 * utiliser ferait qu'un reclassement d'aujourd'hui réécrirait tout le passé.
 */
const CLASS_CHOICES: {
  id: EvolutionAssetClass | "all";
  label: string;
  title: string;
}[] = [
  { id: "all", label: "Tout", title: "Patrimoine entier, toutes classes confondues" },
  { id: "ACTIONS", label: "Actions", title: "Actions et ETF" },
  { id: "OBLIGATIONS", label: "Obligations", title: "Obligations et fonds obligataires" },
  { id: "CRYPTO", label: "Crypto", title: "Toutes les positions crypto détenues à chaque date" },
  { id: "IMMOBILIER", label: "Immobilier", title: "Biens directs et véhicules indirects" },
  { id: "CASH", label: "Cash", title: "Trésorerie — comptes, livrets, dépôts à terme" },
  {
    id: "AUTRE",
    label: "Autre",
    title:
      "Alternatifs, épargne salariale et actifs sans classe dédiée dans cette taxonomie",
  },
];

/**
 * Ce que la courbe trace pour une classe.
 *
 * Les deux libellés sont explicites, et jamais interchangés : une variation de
 * valeur inclut les apports, une performance ne les compte pas.
 */
/**
 * Enveloppes fiscales proposées au sélecteur.
 *
 * `PEA-PME` n'a pas sa propre entrée : il rejoint `PEA`, comme le fait déjà
 * `accountTypeForEnvelope` — les deux plans partagent la même famille fiscale.
 * En faire une quatrième courbe inventerait une taxonomie que le reste du
 * dépôt ignore.
 */
const ENVELOPE_CHOICES: {
  id: "all" | "PEA" | "CTO";
  label: string;
  title: string;
}[] = [
  { id: "all", label: "Tout", title: "Patrimoine entier, toutes enveloppes confondues" },
  {
    id: "PEA",
    label: "PEA",
    title: "Titres détenus en PEA ou PEA-PME, sur les périodes où le journal le démontre",
  },
  {
    id: "CTO",
    label: "CTO",
    title: "Titres détenus en compte-titres, sur les périodes où le journal le démontre",
  },
];


const VERSUS_CHOICES: {
  id: EvolutionBenchmark;
  label: string;
  title: string;
}[] = [
  { id: "none", label: "Aucun", title: "Valeur du portefeuille, en devise" },
  {
    id: "index",
    label: "Indice",
    title: "Comparaison à un indice de marché réel (au choix)",
  },
];

function Segmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  testIdPrefix,
}: {
  items: { id: T; label: string; title?: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  testIdPrefix?: string;
}) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/45 p-0.5"
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            title={item.title}
            aria-selected={selected}
            aria-disabled={item.disabled}
            disabled={item.disabled}
            data-testid={
              testIdPrefix ? `${testIdPrefix}-${item.id}` : undefined
            }
            onClick={() => !item.disabled && onChange(item.id)}
            className={cn(
              "rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-medium transition",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              // Même traitement que les périodes hors historique : le choix
              // reste visible, mais on voit qu'il n'est pas disponible.
              item.disabled && "cursor-not-allowed opacity-40",
              selected
                ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Module Évolution du portefeuille — refonte « premium » orientée
 * investissement, à deux réglages seulement : la période et la comparaison
 * (« Versus »). Le vs-indice (T-4.E) rebase NAV et clôtures à 100 à
 * l'ancre `servedFrom` (`vs-index-series.ts`) — jamais une NAV en euros
 * à côté d'un indice déjà en %.
 */
export function PortfolioEvolutionPanel({
  history,
  dailyNav,
  navScope,
  navQueryFrom,
  navQueryTo,
  servedNavFrom,
  baseCurrency,
  loading,
  className,
  range,
  onRangeChange,
}: {
  history: HistoryPoint[];
  /** Série dense T-05 — courbe par défaut (Financier / Brut / Net). */
  dailyNav?: DailyNavPoint[];
  navScope?: HeroNavScope;
  /**
   * Même `from`/`to` que le hero. Un filtre de poche les réutilise : le
   * clamp `earliestDayForScope` se fait ensuite côté `getDailyNav`.
   */
  navQueryFrom?: string;
  navQueryTo?: string;
  /**
   * Borne `from` **servie** par daily-nav — jamais la demandée si clamp.
   * C'est l'ancre Versus (NAV et indice à 100 le même jour).
   */
  servedNavFrom?: string;
  baseCurrency: string;
  loading?: boolean;
  className?: string;
  /**
   * Période affichée — détenue par le tableau de bord, pas par ce panneau.
   *
   * Le sélecteur reste ici, là où on le lit ; la valeur, elle, est remontée
   * d'un cran parce qu'un second bloc en dépend — le bandeau d'indicateurs.
   * Deux états séparés auraient donné deux périodes sur un même écran, dont
   * une que rien n'affichait.
   */
  range: EvolutionRange;
  onRangeChange: (range: EvolutionRange) => void;
}) {
  const isClient = useIsClient();
  const [prefs, setPrefs] = useState<EvolutionPrefsV5>(DEFAULT_EVOLUTION_PREFS);
  const [hydrated, setHydrated] = useState(false);

  // Seed prefs depuis localStorage au passage client (adjust state while rendering)
  if (isClient && !hydrated) {
    setHydrated(true);
    setPrefs(loadEvolutionPrefs());
  }

  /*
    `prefs.range` n'est plus lu : la période vient du prop. Le champ subsiste
    dans l'objet stocké — c'est la même préférence enregistrée qu'avant — mais
    la valeur qui fait foi à l'écran est celle du tableau de bord, et toute
    écriture la réinjecte (voir `update`).
  */
  const { versus, indexKey } = prefs;
  /*
    Brut seulement.

    Net/Brut vit sur la carte de tête : le reproposer ici faisait deux
    sélecteurs pour la même question, et le second n'avait rien à dire que
    le premier n'ait déjà tranché. La courbe d'évolution trace les actifs
    bruts — c'est ce que « portefeuille » désigne, et ce qui se compare à
    un indice.
  */
  const scope = "gross" as const;
  const assetClass = prefs.assetClass ?? null;
  /*
    Le toggle Valeur / Performance a été retiré (D15.E1) : la série tracée
    est toujours la valeur, apports compris. `classMetric` reste dans le
    schéma des préférences stockées (compat v5), mais plus rien à l'écran ne
    l'écrit ni ne le lit ailleurs qu'ici, en épinglant "value".
  */
  const classMetric = "value" as const;
  const envelope = prefs.envelope ?? null;

  /*
    Plus d'échelle horaire sur ce tableau de bord.

    Le sélecteur Jour/Heure basculait sur un second moteur : la vue horaire ne
    sait produire que les actifs bruts, si bien qu'un clic remplaçait une
    courbe Financier à −373 € par une courbe brute à +15 000 € — deux
    périmètres, deux moteurs, aucun avertissement. `getDailyNav` n'a pas de
    grain horaire, et lui en inventer un pour tenir la comparaison aurait
    fabriqué de la donnée.

    L'intraday n'est pas démonté pour autant : il garde son sens là où une
    seule ligne est cotée — sur la fiche d'un actif — et ce chemin-là n'est pas
    touché. C'est l'agrégat patrimonial qui ne se lit pas à l'heure.
  */
  const showIntraday = false;

  const activeNavScope: HeroNavScope = navScope ?? "financier";
  /*
    Filtre de poche en valeur : même fenêtre que le hero, scope clampé par
    `earliestDayForScope`. Le vs-indice (T-4.E) lit `servedFrom…to`,
    les deux séries en base 100 à cette ancre.
  */
  const wantPocketDailyNav =
    Boolean(assetClass) &&
    versus === "none" &&
    classMetric === "value" &&
    !showIntraday &&
    Boolean(navQueryFrom && navQueryTo);
  const pocketScope = assetClass
    ? dailyNavScopeForClass(assetClass)
    : "listed";
  const pocketNavQ = useDailyNavQuery(navQueryFrom ?? "", navQueryTo ?? "", {
    enabled: wantPocketDailyNav,
    scope: pocketScope,
  });
  const pocketServedFrom = servedDailyNavFrom(pocketNavQ.data, {
    isPlaceholderData: pocketNavQ.isPlaceholderData,
  });
  const pocketWindowed = useMemo(() => {
    const points = pocketNavQ.data?.points;
    if (!points?.length || !assetClass) return [];
    const ref =
      points[points.length - 1]?.day ??
      dailyNav?.[dailyNav.length - 1]?.day ??
      "";
    if (!ref) return [];
    return windowPocketDailyNav(points, range, ref, pocketServedFrom);
  }, [pocketNavQ.data?.points, assetClass, range, pocketServedFrom, dailyNav]);
  const pocketPoints = useMemo(
    () =>
      assetClass
        ? toPocketEvolutionPoints(pocketWindowed, assetClass, envelope)
        : [],
    [pocketWindowed, assetClass, envelope]
  );
  const pocketLineType = pocketChartLineType(assetClass);
  const pocketReady =
    wantPocketDailyNav &&
    !pocketNavQ.isPending &&
    !pocketNavQ.isPlaceholderData;
  const usePocketCurve =
    pocketReady && !pocketSeriesTooShort(pocketPoints);
  const pocketTooShort =
    pocketReady && pocketSeriesTooShort(pocketPoints);

  const canUseDailyNavSeries =
    Boolean(dailyNav && dailyNav.length > 1) &&
    !assetClass &&
    !showIntraday;

  const navWindowed = useMemo(() => {
    if (!dailyNav?.length) return [];
    return windowDailyNav(
      dailyNav,
      range,
      dailyNav[dailyNav.length - 1]!.day
    );
  }, [dailyNav, range]);

  const navChart = useMemo(
    () => toDailyNavChartPoints(navWindowed, activeNavScope),
    [navWindowed, activeNavScope]
  );

  const navMarket = useMemo(
    () => headerMarketDelta(navWindowed, activeNavScope),
    [navWindowed, activeNavScope]
  );

  const navFlux = useMemo(
    () => headerFlux(navWindowed, activeNavScope),
    [navWindowed, activeNavScope]
  );

  const update = (patch: Partial<EvolutionPrefsV5>) => {
    setPrefs((p) => {
      const fusion = { ...p, ...patch, v: 5 as const };
      /*
        L'état en session passe par le même normaliseur que le stockage.

        Sans lui, une combinaison invalide vivrait le temps d'une session sans
        jamais être écrite : la courbe serait filtrée sur une enveloppe
        qu'aucun contrôle n'affiche, et le rechargement « corrigerait » l'écran
        sans que rien n'ait changé.
      */
      const next = {
        ...fusion,
        envelope: normalizeEnvelopeFor(fusion.assetClass, fusion.envelope),
      };
      /*
        La période partagée est réinjectée à chaque écriture.

        Sans cela, changer la comparaison ou la classe réécrirait l'objet
        stocké avec la période que ce composant portait encore en mémoire —
        celle d'avant le partage —, et le rechargement suivant aurait ramené
        une période que l'utilisateur avait quittée.
      */
      if (hydrated) saveEvolutionPrefs({ ...next, range });
      return next;
    });
  };

  const firstDate = dailyNav?.[0]?.day ?? history[0]?.date ?? null;

  /*
    Périodes proposées, selon la profondeur de l'historique.

    Sert ici au seul rendu des boutons — la correction de la période elle-même,
    quand l'historique ne la couvre pas, appartient au tableau de bord qui en
    détient l'état. Écrire l'état d'un parent pendant le rendu d'un enfant
    n'est pas permis, et la règle est de toute façon commune aux deux blocs :
    c'est la même fonction qui la tranche des deux côtés.
  */
  const rangeEnabled = useMemo(() => {
    const map = {} as Record<EvolutionRange, boolean>;
    for (const r of RANGES) {
      map[r.id] = isEvolutionRangeEnabled(r.id, firstDate);
    }
    return map;
  }, [firstDate]);

  /*
    Le périmètre est choisi **avant** l'agrégation, pas après.

    Actifs bruts et patrimoine net diffèrent de l'encours des dettes : les
    mélanger dans une même série ferait passer un remboursement d'emprunt pour
    un mouvement de marché. Réécrire le total en amont garantit qu'une seule
    des deux métriques circule dans toute la chaîne d'affichage.
  */
  const scopedHistory = useMemo(
    () => scopeHistory(history, { scope, assetClass, envelope, classMetric }),
    [history, scope, assetClass, classMetric, envelope]
  );

  /**
   * Part des titres dont l'enveloppe n'est pas démontrée, sur toute la fenêtre.
   *
   * Le journal ne remonte qu'à sa mise en place : tout ce qui précède est
   * inconnu, et le taire laisserait croire que `PEA + CTO` couvre tous les
   * titres.
   *
   * Le chiffre était lu sur le dernier point, ce qui l'annulait dans le cas le
   * plus courant : une fois toutes les lignes observées, le présent est connu
   * et l'avertissement disparaissait — alors même que les cinq années
   * précédentes de la courbe, elles, restaient inconnues. On balaie donc la
   * fenêtre affichée, et l'on retient le montant le plus élevé qu'elle porte :
   * c'est la part que la courbe ne démontre pas.
   *
   * `startOfRange` est celle de la série, pour que l'avertissement couvre
   * exactement ce que l'œil voit.
   */
  const unknownEnvelopeEur = useMemo(() => {
    if (!assetClass || !envelope) return 0;
    const from = startOfRange(range, heroWindowReference(history));
    const fromT = from ? from.getTime() : -Infinity;
    let max = 0;
    for (const p of history) {
      if (Date.parse(p.date) < fromT) continue;
      const u = Number(
        p.byAssetClassAndEnvelopeBase?.[assetClass]?.UNKNOWN ?? 0
      );
      if (Number.isFinite(u) && u > max) max = u;
    }
    return max;
  }, [history, assetClass, envelope, range]);

  const { points: rawPoints, interval } = useMemo(
    () =>
      buildEvolutionSeries(
        scopedHistory,
        range,
        "cumul",
        heroWindowReference(history)
      ),
    [scopedHistory, range, history]
  );

  /*
    Vs indice : fenêtre servie (clamp getDailyNav), pas la borne demandée.
    Marge amont de 7 j pour une close ≤ ancre (LOCF vendredi).

    Cette fenêtre ne vaut que pour la NAV **non filtrée** — dailyNav est la
    série du hero (Brut/Net/Financier), quel que soit le filtre de classe
    actif ici. Un filtre de classe ou d'enveloppe compare donc `scopedHistory`
    (via `rawPoints`, juste sous ce bloc) plutôt que cette fenêtre-là :
    l'indice doit suivre la série réellement tracée à l'écran, pas *Tout*.
  */
  const isPocketFiltered = Boolean(assetClass);
  const vsNavWindowed = useMemo(() => {
    if (isPocketFiltered) return [];
    if (!dailyNav?.length) return [];
    return windowVsIndexNav(
      dailyNav,
      range,
      dailyNav[dailyNav.length - 1]!.day,
      servedNavFrom
    );
  }, [dailyNav, range, servedNavFrom, isPocketFiltered]);

  const wantIndex = versus === "index";
  /*
    `from` = ancre servie, jamais `navQueryFrom` (borne demandée, ex. 1998
    alors que getDailyNav a clampé à 2022). `to` = dernier jour de la
    fenêtre affichée, pas une date demandée plus large.

    Filtré : l'ancre est le premier jour de `rawPoints` — la fenêtre que
    `scopedHistory` sert réellement pour cette classe/enveloppe, pas celle
    du hero.
  */
  const idxFromKey = isPocketFiltered
    ? (rawPoints[0] ? parisDayKey(rawPoints[0].date) : "")
    : servedNavFrom ??
      vsNavWindowed[0]?.day ??
      dailyNav?.[0]?.day ??
      "";
  const idxToKey = isPocketFiltered
    ? (rawPoints[rawPoints.length - 1]
        ? parisDayKey(rawPoints[rawPoints.length - 1]!.date)
        : "")
    : vsNavWindowed[vsNavWindowed.length - 1]?.day ??
      dailyNav?.[dailyNav.length - 1]?.day ??
      navQueryTo ??
      "";
  const indexQ = useQuery({
    queryKey: ["evolution-index", indexKey, idxFromKey, idxToKey],
    enabled:
      wantIndex &&
      Boolean(idxFromKey && idxToKey) &&
      (vsNavWindowed.length > 1 || rawPoints.length > 1),
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: () => {
      const fromMs = Date.parse(idxFromKey) - 7 * 24 * 60 * 60 * 1000;
      const from = new Date(fromMs).toISOString();
      const to = idxToKey;
      const params = new URLSearchParams({ symbol: indexKey, from, to });
      return fetchJson<{ points: IndexClosePoint[] }>(
        `/api/benchmark?${params.toString()}`
      );
    },
  });
  const indexCloses = useMemo<IndexClosePoint[]>(
    () => (indexQ.isError ? [] : indexQ.data?.points ?? []),
    [indexQ.data, indexQ.isError]
  );

  const points = rawPoints;

  /*
    Deux niveaux (NAV hero ou série filtrée, clôture Yahoo), base 100 à
    l'ancre servie. Overlay absent si 429 / vide / aucune close ≤ ancre —
    la série portefeuille reste intacte. Pas `toPercentSeries` : sans
    `growth`, le portefeuille restait à +0 %.

    Filtrée (classe/enveloppe active) : `rawPoints` — la série réellement
    tracée — sert de base 100, jamais la NAV hero non filtrée.
  */
  const vsIndexSeries = useMemo(() => {
    if (versus !== "index") return [];
    const indexLevels = indexCloses.map((c) => ({
      day: c.date,
      value: c.close,
    }));
    const scopedLevels = rawPoints.map((p) => ({
      day: parisDayKey(p.date),
      value: p.total,
    }));
    const portfolioLevels = isPocketFiltered
      ? scopedLevels
      : vsNavWindowed.length > 1
        ? dailyNavToVsIndexLevels(vsNavWindowed, activeNavScope)
        : scopedLevels;
    return rebaseToCommonBase100(portfolioLevels, indexLevels);
  }, [
    versus,
    indexCloses,
    vsNavWindowed,
    activeNavScope,
    rawPoints,
    isPocketFiltered,
  ]);

  const percentPoints = useMemo(
    () => (versus === "none" ? [] : toVsIndexPercentPoints(vsIndexSeries)),
    [vsIndexSeries, versus]
  );
  const hasIndexOverlay = vsIndexHasOverlay(percentPoints);
  const chartKind = vsIndexChartKind({
    versus,
    indexError: Boolean(wantIndex && indexQ.isError),
    hasOverlay: hasIndexOverlay,
  });
  /*
    NAV quotidienne dès que Versus n'a pas d'overlay à tracer : éteint,
    indice en erreur, ou overlay absent. Interdit dès que le graphe %
    est légitime — sinon on superposerait deux lectures.
  */
  const useDailyNavCurve = canUseDailyNavSeries && chartKind !== "percent";

  const gap = useMemo(
    () => (versus === "none" ? null : vsIndexGapPct(vsIndexSeries)),
    [vsIndexSeries, versus]
  );

  const benchmarkDisplayName =
    versus === "index" ? marketIndexLabel(indexKey) : benchmarkLabel(versus);

  const summary = useMemo(() => evolutionDeltaSummary(points), [points]);
  const pocketSummary = useMemo(
    () => (usePocketCurve ? evolutionDeltaSummary(pocketPoints) : null),
    [usePocketCurve, pocketPoints]
  );
  const headlinePct =
    chartKind === "percent" && percentPoints.length > 0
      ? percentPoints[percentPoints.length - 1]!.portfolioPct
      : null;

  const showPanelLoading = Boolean(
    loading ||
      (wantPocketDailyNav && !pocketReady && !pocketNavQ.isError)
  );
  const empty = !showPanelLoading && history.length === 0;
  const pocketEmpty = pocketReady ? pocketEmptyState(pocketPoints.length) : null;
  /*
    « Période trop courte » seulement après clamp : moins de deux points
    sur la fenêtre servie. Un `from` trop ancien n'est plus une absence.
    0 point de poche → copie dédiée, pas le générique.
  */
  const noPoints =
    !showPanelLoading &&
    !empty &&
    (wantPocketDailyNav
      ? pocketTooShort
      : versus === "index"
        ? chartKind === "percent"
          ? percentPoints.length < 2
          : rawPoints.length === 0 && vsNavWindowed.length < 2 && navChart.length < 2
        : rawPoints.length === 0);

  return (
    <div
      className={cn(
        "card flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3.5 sm:p-4",
        className
      )}
      data-testid="portfolio-evolution-panel"
      data-nav-scope={activeNavScope}
      data-pocket-class={assetClass ?? "all"}
      data-chart-kind={chartKind}
      data-vs-base-day={versus === "index" ? vsIndexSeries[0]?.day : undefined}
      data-line-type={
        usePocketCurve ? pocketLineType : useDailyNavCurve ? "linear" : undefined
      }
    >
      <PanelHeader
        title="Évolution du portefeuille"
        subtitle={
          <>
            {assetClass && envelope
              ? `${CLASS_CHOICES.find((c) => c.id === assetClass)?.label ?? assetClass} en ${envelope} — valeur`
              : assetClass
              ? `${CLASS_CHOICES.find((c) => c.id === assetClass)?.label ?? assetClass}${assetClass === "OBLIGATIONS" ? " (CTO)" : ""} — valeur`
              : useDailyNavCurve
              ? `${HERO_NAV_SCOPE_LABEL[activeNavScope]} — NAV quotidienne`
              : "Actifs bruts"}
            <span className="mx-1 opacity-40">·</span>
            {evolutionIntervalLabel(interval)}
            <span className="sr-only"> ({evolutionIntervalHint(interval)})</span>
            {baseCurrency !== "EUR" ? (
              <>
                <span className="mx-1 opacity-40">·</span>
                {baseCurrency}
              </>
            ) : null}
          </>
        }
        actions={
          useDailyNavCurve && navMarket != null && navChart.length > 1 ? (
            <div className="shrink-0 text-right" data-testid="evolution-headline">
              <div
                className={cn(
                  "text-lg font-bold tabular-nums sm:text-xl",
                  navMarket >= 0
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                )}
                data-testid="evolution-headline-market"
              >
                {navMarket >= 0 ? "+" : ""}
                {formatCurrency(navMarket, baseCurrency)}
              </div>
              <div className="text-xs font-medium text-[var(--muted-foreground)]">
                Performance {HERO_NAV_SCOPE_LABEL[activeNavScope].toLowerCase()}
                {navFlux != null && navFlux !== 0 ? (
                  <span data-testid="evolution-headline-flux">
                    {" · Capital investi "}
                    {navFlux >= 0 ? "+" : ""}
                    {formatCurrency(navFlux, baseCurrency)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : usePocketCurve && pocketSummary && pocketPoints.length > 0 ? (
            <div className="shrink-0 text-right" data-testid="evolution-headline">
              <div
                className={cn(
                  "text-lg font-bold tabular-nums sm:text-xl",
                  pocketSummary.delta >= 0
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                )}
              >
                {pocketSummary.delta >= 0 ? "+" : ""}
                {formatCurrency(pocketSummary.delta, baseCurrency)}
              </div>
              <div className="text-xs font-medium text-[var(--muted-foreground)]">
                {`${pocketSummary.pct >= 0 ? "+" : ""}${pocketSummary.pct.toFixed(1)} % de rendement`}
              </div>
            </div>
          ) : summary && points.length > 0 && chartKind !== "percent" ? (
            <div className="shrink-0 text-right" data-testid="evolution-headline">
              <div
                className={cn(
                  "text-lg font-bold tabular-nums sm:text-xl",
                  summary.delta >= 0
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                )}
              >
                {summary.delta >= 0 ? "+" : ""}
                {formatCurrency(summary.delta, baseCurrency)}
              </div>
              <div className="text-xs font-medium text-[var(--muted-foreground)]">
                {versus === "none"
                  ? /*
                       Deux chiffres, deux significations.

                       Le montant au-dessus est la variation du patrimoine,
                       versements compris. Le pourcentage est le rendement des
                       investissements, versements neutralisés — c'est pourquoi
                       il ne vaut pas « montant / valeur de départ ». Le dire
                       explicitement évite de lire l'un comme le ratio de
                       l'autre.
                    */
                    `${summary.pct >= 0 ? "+" : ""}${summary.pct.toFixed(1)} % de rendement`
                  : chartKind === "index-unavailable"
                    ? INDEX_UNAVAILABLE_TITLE
                    : `Vs ${benchmarkDisplayName}`}
              </div>
            </div>
          ) : summary && points.length > 0 && headlinePct != null ? (
            <div className="shrink-0 text-right" data-testid="evolution-headline">
              <div
                className={cn(
                  "text-lg font-bold tabular-nums sm:text-xl",
                  headlinePct >= 0
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                )}
              >
                {headlinePct >= 0 ? "+" : ""}
                {headlinePct.toFixed(1)}&nbsp;%
              </div>
              <div className="text-xs font-medium text-[var(--muted-foreground)]">
                {`Vs ${benchmarkDisplayName}`}
              </div>
            </div>
          ) : null
        }
      />

      {/* Période + Versus — deux réglages, rien d'autre. */}
      <div className="mb-2.5 space-y-2" data-testid="evolution-controls">
        <div
          className="flex min-w-0 flex-wrap items-center gap-0.5 sm:gap-1"
          role="tablist"
          aria-label="Période"
        >
          {RANGES.map((r) => {
            const enabled = rangeEnabled[r.id] !== false;
            const selected = range === r.id;
            return (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-disabled={!enabled}
                disabled={!enabled}
                title={
                  enabled
                    ? undefined
                    : "Historique trop court pour cette période"
                }
                data-testid={`evolution-range-${r.id}`}
                onClick={() => enabled && onRangeChange(r.id)}
                className={cn(
                  "rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium transition",
                  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                  !enabled &&
                    "cursor-not-allowed bg-[var(--muted)]/40 text-[var(--muted-foreground)] opacity-40",
                  enabled &&
                    selected &&
                    "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)]",
                  enabled &&
                    !selected &&
                    "bg-[var(--muted)]/70 text-[var(--foreground)] hover:bg-[var(--muted)]"
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          {/*
            La classe commande, l'enveloppe précise.

            Les deux ne sont plus exclusives : « où sont mes actions » est une
            question qui a un sens, et y répondre demandait de composer les deux
            filtres. La hiérarchie est celle de la question — on choisit d'abord
            ce que l'on détient, puis, quand cela s'y prête, où.

            Changer de classe remet l'enveloppe à « Tout » : garder « PEA » en
            passant sur la crypto laisserait un filtre actif qu'aucun contrôle
            n'affiche plus.
          */}
          <Segmented
            items={CLASS_CHOICES}
            value={assetClass ?? "all"}
            onChange={(v) =>
              update({
                assetClass: v === "all" ? null : (v as EvolutionAssetClass),
                envelope: null,
              })
            }
            ariaLabel="Classe d'actifs"
            testIdPrefix="evolution-class"
          />
          {/*
            Le sélecteur d'enveloppe n'existe que là où la question se pose.

            Sur les actions seulement : ce sont les seules lignes dont le
            portefeuille de démonstration comme le modèle admettent les deux
            enveloppes. Les obligations reçoivent une indication plutôt qu'un
            choix — voir le sous-titre — et la crypto, l'immobilier, le cash et
            « Autre » n'ont aucun rapport avec un compte-titres.
          */}
          {assetClass === "ACTIONS" && (
            <Segmented
              items={ENVELOPE_CHOICES}
              value={envelope ?? "all"}
              onChange={(v) =>
                update({ envelope: v === "all" ? null : (v as "PEA" | "CTO") })
              }
              ariaLabel="Enveloppe fiscale"
              testIdPrefix="evolution-envelope"
            />
          )}
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Vs
          </span>
          <Segmented
            items={VERSUS_CHOICES}
            value={versus}
            onChange={(v) => update({ versus: v })}
            ariaLabel="Comparaison"
            testIdPrefix="evolution-versus"
          />
          {versus === "index" && (
            <select
              className="input !h-7 w-auto !min-w-0 py-0 pl-2 pr-6 text-[11px]"
              value={indexKey}
              onChange={(e) =>
                update({ indexKey: e.target.value as MarketIndexKey })
              }
              data-testid="evolution-index-select"
              aria-label="Choix de l'indice de comparaison"
              title="Indice de marché comparé au portefeuille"
            >
              {MARKET_INDICES.map((idx) => (
                <option key={idx.key} value={idx.key} title={idx.hint}>
                  {idx.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Graphique — flex pour s'aligner sur la colonne droite du dashboard */}
      <div
        className="relative min-h-[12.5rem] w-full flex-1 sm:min-h-[13.5rem]"
        data-testid="evolution-chart"
      >
        <div className="absolute inset-0">
          {/*
            L'intraday court-circuite les états de la courbe quotidienne : il a
            les siens, et « historique encore vide » ne décrirait pas la même
            chose qu'« aucune donnée intraday collectée ».
          */}
          {showIntraday ? (
            <IntradaySection baseCurrency={baseCurrency} />
          ) : showPanelLoading ? (
            <div
              className="flex h-full flex-col gap-3 px-2 py-2"
              data-testid="evolution-loading-skeleton"
              aria-busy="true"
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="min-h-[10rem] w-full flex-1 rounded-[var(--radius-lg)]" />
              <div className="flex gap-2">
                <Skeleton className="h-2 w-14" />
                <Skeleton className="h-2 w-16" />
                <Skeleton className="h-2 w-12" />
              </div>
            </div>
          ) : empty ? (
            <EmptyPlaceholder
              compact
              title="Historique encore vide"
              description="Actualisez les cours pour enregistrer un premier point de courbe."
            />
          ) : wantPocketDailyNav && pocketEmpty?.kind === "empty" ? (
            <EmptyPlaceholder
              compact
              testId="evolution-pocket-empty"
              emptyKind="pocket"
              title={pocketEmpty.title}
              description={pocketEmpty.description}
            />
          ) : noPoints ? (
            /*
              Deux raisons très différentes de n'avoir aucun point, et une seule
              phrase les couvrait. Quand l'enveloppe est inconnue sur toute la
              fenêtre, « période trop courte » envoie élargir la plage — ce qui
              ne révélera jamais rien, l'historique manquant étant justement
              plus ancien. On dit donc ce qui manque réellement.
            */
            envelope && unknownEnvelopeEur > 0 ? (
              <EmptyPlaceholder
                compact
                testId="evolution-envelope-all-unknown"
                title="Enveloppe inconnue sur cette période"
                description="Le journal des enveloppes ne remonte pas jusqu'ici : aucune valeur PEA ou CTO n'y est démontrable. Une plage plus récente en montrera la partie connue."
              />
            ) : (
              <EmptyPlaceholder
                compact
                testId="evolution-too-short"
                title="Période trop courte"
                description="Choisissez une plage plus large ou attendez davantage d'historique."
              />
            )
          ) : chartKind === "index-unavailable" &&
            navChart.length < 2 &&
            points.length < 2 ? (
            <EmptyPlaceholder
              compact
              testId="evolution-index-unavailable"
              emptyKind="index"
              title={INDEX_UNAVAILABLE_TITLE}
              description="Le fournisseur d’indice n’a pas répondu. La comparaison est masquée — aucun +0 % inventé."
            />
          ) : versus === "none" && usePocketCurve ? (
            <PortfolioValueChart
              data={pocketPoints}
              baseCurrency={baseCurrency}
              lineType={pocketLineType}
            />
          ) : chartKind !== "percent" && useDailyNavCurve ? (
            <DailyNavChart
              data={navChart}
              baseCurrency={baseCurrency}
            />
          ) : chartKind !== "percent" ? (
            <PortfolioValueChart
              data={points}
              baseCurrency={baseCurrency}
              lineType={pocketChartLineType(assetClass)}
            />
          ) : (
            <PortfolioPercentChart
              data={percentPoints}
              benchmarkName={benchmarkDisplayName}
            />
          )}
        </div>
      </div>

      {envelope && !empty && (
        <p
          className="text-meta mt-1.5 shrink-0"
          data-testid="evolution-envelope-reclass"
        >
          {/*
            Ce que la variation d'une enveloppe mesure vraiment.

            Mesuré sur trois mois du compte de démonstration : PEA passe de 0 à
            40 799,50 € et CTO de 0 à 42 863,90 €, pendant que la poche
            « inconnu » se vide de 82 397 €. Aucun de ces mouvements n'est du
            marché — c'est le journal qui commence à démontrer un rattachement,
            et la valeur change simplement de colonne.

            Lue comme une performance, cette courbe raconte donc n'importe
            quoi : une enveloppe peut plonger le jour où ses titres sont
            reconnus ailleurs. La série n'est pas fausse, c'est sa lecture
            spontanée qui l'est — d'où cette ligne plutôt qu'un correctif de
            calcul.
          */}
          Variation d&apos;enveloppe, hors marché — un titre entre dans cette
          courbe le jour où le journal démontre son rattachement.
        </p>
      )}

      {envelope && unknownEnvelopeEur > 0 && !empty && (
        <p
          className="text-meta mt-1.5 shrink-0"
          data-testid="evolution-envelope-unknown"
        >
          {/*
            Nommer l'écart plutôt que le laisser deviner. Sans cette ligne, un
            utilisateur lirait « PEA 40 800 € » en croyant y voir tous ses
            titres de PEA, alors que le journal ne couvre qu'une partie de la
            période.

            La ligne s'affiche aussi quand la courbe est vide : c'est même le
            cas où elle importe le plus, l'écran n'ayant alors rien d'autre à
            montrer que l'absence.
          */}
          Une partie de l&apos;historique PEA/CTO est inconnue avant le premier
          constat d&apos;enveloppe — jusqu&apos;à{" "}
          {formatCurrency(unknownEnvelopeEur, baseCurrency)} de titres non
          rattachés sur cette période.
        </p>
      )}

      {chartKind === "index-unavailable" &&
        !empty &&
        (navChart.length >= 2 || points.length >= 2) && (
        <p
          className="text-meta mt-1.5 shrink-0"
          data-testid="evolution-index-unavailable"
          data-empty-kind="index"
        >
          {INDEX_UNAVAILABLE_TITLE}
          {" — comparaison masquée, courbe NAV seule."}
        </p>
      )}

      {versus !== "none" &&
        chartKind === "percent" &&
        !empty &&
        !noPoints &&
        (percentPoints.length > 0 || points.length > 0) && (
        <p className="text-meta mt-1.5 shrink-0" data-testid="evolution-vs-note">
          Vs {benchmarkDisplayName}
          {gap ? (
            <>
              {" · écart "}
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  gap.gapPct >= 0
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                )}
                title="Écart de performance portefeuille − indice sur la période"
                data-testid="evolution-vs-gap"
              >
                {gap.gapPct >= 0 ? "+" : ""}
                {/* Convention française, comme les montants juste à côté :
                    « 13.9 pts » à côté de « 100 400,00 € » jure. */}
                {gap.gapPct.toLocaleString("fr-FR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{" "}
                pts
              </span>
            </>
          ) : wantIndex && indexQ.isLoading ? (
            " · chargement de l'indice…"
          ) : (
            ""
          )}
        </p>
      )}
    </div>
  );
}
