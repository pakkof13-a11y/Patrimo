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
  evolutionPnlSummary,
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
  type EvolutionAccount,
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
import { RangeChips } from "@/components/dashboard/range-chips";
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
  dailyNavScopeForAccount,
  pocketChartLineType,
  pocketEmptyState,
  pocketFlowsUnreliable,
  pocketSeriesTooShort,
  titresUnknownEnvelopeEur,
  accountsGapEur,
  toPocketEvolutionPoints,
  windowPocketDailyNav,
} from "@/app/lib/portfolio/pocket-series";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

/**
 * Comptes proposés au sélecteur.
 *
 * « Compte » — où l'argent est déposé — et non « Catégorie » : Titres
 * additionne PEA et CTO (deux comptes réels), jamais une classe d'actif qui
 * mélangerait l'assurance-vie avec elle. Chaque entrée correspond à un scope
 * `getDailyNav` distinct (Titres excepté, qui lit le croisement classe ×
 * enveloppe) — voir `dailyNavScopeForAccount`.
 *
 * Pas de Tangibles ni de Trading : les tangibles sont fusionnés avec métaux,
 * private equity et crowdlending dans la seule manche Alternatifs du moteur,
 * et les positions de trading (CFD) vivent dans `TradingPosition`, que le
 * moteur historique ne charge jamais.
 */
const ACCOUNT_CHOICES: {
  id: EvolutionAccount | "all";
  label: string;
  title: string;
}[] = [
  { id: "all", label: "Tout", title: "Patrimoine entier, tous comptes confondus" },
  {
    id: "TITRES",
    label: "Titres",
    title: "Comptes-titres — PEA et CTO, actions et obligations",
  },
  {
    id: "ASSURANCE_VIE",
    label: "Assurance-vie",
    title: "Unités de compte et fonds euro, tous contrats confondus",
  },
  { id: "CRYPTO", label: "Crypto", title: "Toutes les positions crypto détenues à chaque date" },
  { id: "IMMOBILIER", label: "Immobilier", title: "Biens directs et véhicules indirects" },
  {
    id: "ALTERNATIFS",
    label: "Alternatifs",
    title: "Métaux, private equity, crowdlending et tangibles",
  },
  {
    id: "EPARGNE_SALARIALE",
    label: "Épargne salariale",
    title: "PEE, PER et PERCO — le moteur ne distingue pas les plans entre eux",
  },
  {
    id: "CASH",
    label: "Banques / liquidités",
    title: "Trésorerie — comptes, livrets, dépôts à terme",
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
  { id: "all", label: "Tout", title: "Les deux comptes-titres, PEA et CTO, additionnés" },
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
  const account = prefs.account ?? null;
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
    Boolean(account) &&
    versus === "none" &&
    classMetric === "value" &&
    !showIntraday &&
    Boolean(navQueryFrom && navQueryTo);
  const pocketScope = account
    ? dailyNavScopeForAccount(account)
    : "listed";
  const pocketNavQ = useDailyNavQuery(navQueryFrom ?? "", navQueryTo ?? "", {
    enabled: wantPocketDailyNav,
    scope: pocketScope,
    range,
  });
  const pocketServedFrom = servedDailyNavFrom(pocketNavQ.data, {
    isPlaceholderData: pocketNavQ.isPlaceholderData,
  });
  const pocketWindowed = useMemo(() => {
    const points = pocketNavQ.data?.points;
    if (!points?.length || !account) return [];
    const ref =
      points[points.length - 1]?.day ??
      dailyNav?.[dailyNav.length - 1]?.day ??
      "";
    if (!ref) return [];
    return windowPocketDailyNav(points, range, ref, pocketServedFrom);
  }, [pocketNavQ.data?.points, account, range, pocketServedFrom, dailyNav]);
  const pocketPoints = useMemo(
    () =>
      account
        ? toPocketEvolutionPoints(pocketWindowed, account, envelope)
        : [],
    [pocketWindowed, account, envelope]
  );
  const pocketLineType = pocketChartLineType(account);
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
    !account &&
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
        envelope: normalizeEnvelopeFor(fusion.account, fusion.envelope),
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
  /*
    « Tout » seulement — jamais un compte. `scopeHistory` connaît les six
    `assetClass` du moteur (ACTIONS, OBLIGATIONS…), pas les comptes de D18 :
    Titres additionne deux classes par enveloppe, et Assurance-vie/Alternatifs/
    Épargne salariale n'ont pas de clé dans `byAssetClassBase`. Chaque compte
    est donc tracé exclusivement via `pocketPoints` (`getDailyNav`), jamais
    via cette projection — voir `pocketPoints`, `vsIndexSeries` plus bas.
  */
  const scopedHistory = useMemo(
    () => scopeHistory(history, { scope, assetClass: null, envelope: null, classMetric }),
    [history, scope, classMetric]
  );

  /**
   * Part des titres qui n'est ni PEA ni CTO, sur le dernier point de la
   * fenêtre affichée — CFD non historisé, ou enveloppe pas encore démontrée.
   *
   * Lue sur `pocketWindowed` (même requête `getDailyNav` que la courbe), pas
   * sur `history` : c'est la source qui porte le croisement classe ×
   * enveloppe pour Titres, jamais `byAssetClass`.
   */
  const titresGapEur = useMemo(() => {
    if (account !== "TITRES") return null;
    const last = pocketWindowed[pocketWindowed.length - 1];
    return last ? titresUnknownEnvelopeEur(last) : null;
  }, [account, pocketWindowed]);

  /**
   * Ce que « Tout » porte et qu'aucune option du sélecteur ne couvre.
   *
   * Le sélecteur partitionne le patrimoine par lieu de dépôt, et la partition
   * n'est pas complète : les lignes en CFD n'ont pas de compte. Sans cette
   * ligne, « Tout » afficherait un montant que la somme des options ne
   * retrouve pas, sans que rien ne le dise.
   *
   * Lue sur `dailyNav`, la série que « Tout » trace déjà — pas sur une requête
   * supplémentaire, et pas sur `rawPoints`, qui a perdu la ventilation par
   * poche en devenant des points de graphique.
   */
  const accountsGap = useMemo(() => {
    if (account != null) return null;
    const last = dailyNav?.[dailyNav.length - 1];
    return last ? accountsGapEur(last) : null;
  }, [account, dailyNav]);

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
   * exactement ce que l'œil voit. Titres seul est concerné — ACTIONS et
   * OBLIGATIONS sont désormais additionnées dans ce compte.
   */
  const unknownEnvelopeEur = useMemo(() => {
    if (account !== "TITRES" || !envelope) return 0;
    const from = startOfRange(range, heroWindowReference(history));
    const fromT = from ? from.getTime() : -Infinity;
    let max = 0;
    for (const p of history) {
      if (Date.parse(p.date) < fromT) continue;
      const uActions = Number(p.byAssetClassAndEnvelopeBase?.ACTIONS?.UNKNOWN ?? 0);
      const uObligations = Number(
        p.byAssetClassAndEnvelopeBase?.OBLIGATIONS?.UNKNOWN ?? 0
      );
      const u = uActions + uObligations;
      if (Number.isFinite(u) && u > max) max = u;
    }
    return max;
  }, [history, account, envelope, range]);

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
    série du hero (Brut/Net/Financier), quel que soit le compte actif ici. Un
    compte filtré compare donc `pocketPoints` (juste au-dessus) plutôt que
    cette fenêtre-là : l'indice doit suivre la série réellement tracée à
    l'écran, pas *Tout*.
  */
  const isPocketFiltered = Boolean(account);
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

    Filtré : l'ancre est le premier jour de `pocketPoints` — la fenêtre que
    `getDailyNav` sert réellement pour ce compte/enveloppe, pas celle du hero.
  */
  const idxFromKey = isPocketFiltered
    ? (pocketPoints[0] ? parisDayKey(pocketPoints[0].date) : "")
    : servedNavFrom ??
      vsNavWindowed[0]?.day ??
      dailyNav?.[0]?.day ??
      "";
  const idxToKey = isPocketFiltered
    ? (pocketPoints[pocketPoints.length - 1]
        ? parisDayKey(pocketPoints[pocketPoints.length - 1]!.date)
        : "")
    : vsNavWindowed[vsNavWindowed.length - 1]?.day ??
      dailyNav?.[dailyNav.length - 1]?.day ??
      navQueryTo ??
      "";
  const indexQ = useQuery({
    queryKey: ["evolution-index", indexKey, range, idxFromKey, idxToKey],
    enabled:
      wantIndex &&
      Boolean(idxFromKey && idxToKey) &&
      (isPocketFiltered
        ? pocketPoints.length > 1
        : vsNavWindowed.length > 1 || rawPoints.length > 1),
    staleTime: 30 * 60_000,
    retry: false,
    /*
      Même règle que la série de valeur : changer de période annule la
      requête d'indice en vol. Sans cela, une réponse lente pour « 1A »
      pouvait s'installer sous un chip « Tout » déjà actif, et l'overlay
      comparait deux fenêtres différentes.
    */
    queryFn: ({ signal }) => {
      const fromMs = Date.parse(idxFromKey) - 7 * 24 * 60 * 60 * 1000;
      const from = new Date(fromMs).toISOString();
      const to = idxToKey;
      const params = new URLSearchParams({ symbol: indexKey, from, to });
      return fetchJson<{ points: IndexClosePoint[] }>(
        `/api/benchmark?${params.toString()}`,
        { signal }
      );
    },
  });
  const indexCloses = useMemo<IndexClosePoint[]>(
    () => (indexQ.isError ? [] : indexQ.data?.points ?? []),
    [indexQ.data, indexQ.isError]
  );

  const points = isPocketFiltered ? pocketPoints : rawPoints;

  /*
    Deux niveaux (NAV hero ou série filtrée, clôture Yahoo), base 100 à
    l'ancre servie. Overlay absent si 429 / vide / aucune close ≤ ancre —
    la série portefeuille reste intacte. Pas `toPercentSeries` : sans
    `growth`, le portefeuille restait à +0 %.

    Filtrée (compte/enveloppe actif) : `pocketPoints` — la série réellement
    tracée pour ce compte — sert de base 100, jamais la NAV hero non filtrée
    ni `rawPoints`, qui reste celle du patrimoine entier.
  */
  const vsIndexSeries = useMemo(() => {
    if (versus !== "index") return [];
    const indexLevels = indexCloses.map((c) => ({
      day: c.date,
      value: c.close,
    }));
    const scopedLevels = (isPocketFiltered ? pocketPoints : rawPoints).map(
      (p) => ({
        day: parisDayKey(p.date),
        value: p.total,
      })
    );
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
    pocketPoints,
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
  const pnlSummary = useMemo(() => evolutionPnlSummary(points), [points]);
  const pocketSummary = useMemo(
    () => (usePocketCurve ? evolutionDeltaSummary(pocketPoints) : null),
    [usePocketCurve, pocketPoints]
  );
  /*
    Le flux par enveloppe n'est pas reconstructible : `flowsByAssetClass` est
    forcé à 0 dès qu'on filtre PEA/CTO (`pocket-series.ts`), et il n'existe
    aucune ventilation flux × classe × enveloppe dans le dépôt. Assurance-vie,
    alternatifs et épargne salariale n'ont pas non plus de clé de flux dédiée.
    `pnl = delta` recopierait donc la ligne du dessus — la ligne 2 dit `n/d`
    plutôt que de prétendre neutraliser un versement qu'on n'a pas su isoler.
  */
  const pnlUnreliable = pocketFlowsUnreliable(account, envelope);
  const pocketPnlSummary = useMemo(
    () =>
      usePocketCurve
        ? evolutionPnlSummary(pocketPoints, {
            flowsUnreliable: pnlUnreliable,
          })
        : null,
    [usePocketCurve, pocketPoints, pnlUnreliable]
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
      data-pocket-account={account ?? "all"}
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
            {account && envelope
              ? `Compte : ${ACCOUNT_CHOICES.find((c) => c.id === account)?.label ?? account} · ${envelope}`
              : account
              ? `Compte : ${ACCOUNT_CHOICES.find((c) => c.id === account)?.label ?? account}`
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
                data-testid="evolution-headline-delta"
              >
                {pocketSummary.delta >= 0 ? "+" : ""}
                {formatCurrency(pocketSummary.delta, baseCurrency)}
              </div>
              <div
                className="text-xs font-medium text-[var(--muted-foreground)]"
                data-testid="evolution-headline-pnl"
                title={
                  pnlUnreliable
                    ? "Flux non disponibles pour ce compte : le P&L de période ne peut pas être isolé des versements."
                    : "Ce montant inclut vos versements ; ce P&L ne les compte pas."
                }
              >
                {pocketPnlSummary == null || pocketPnlSummary.pct == null
                  ? "P&L n/d"
                  : `P&L ${pocketPnlSummary.pnl >= 0 ? "+" : ""}${formatCurrency(pocketPnlSummary.pnl, baseCurrency)} · ${pocketPnlSummary.pct >= 0 ? "+" : ""}${pocketPnlSummary.pct.toFixed(1)} %`}
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
                data-testid="evolution-headline-delta"
              >
                {summary.delta >= 0 ? "+" : ""}
                {formatCurrency(summary.delta, baseCurrency)}
              </div>
              <div
                className="text-xs font-medium text-[var(--muted-foreground)]"
                data-testid={versus === "none" ? "evolution-headline-pnl" : undefined}
                title={
                  versus === "none"
                    ? "Ce montant inclut vos versements ; ce P&L ne les compte pas."
                    : undefined
                }
              >
                {versus === "none"
                  ? /*
                       Deux chiffres, deux significations.

                       Le montant au-dessus est la variation du patrimoine,
                       versements compris. La ligne du dessous est le P&L de la
                       période — ce même montant moins les versements — et son
                       pourcentage rapporte ce P&L à un capital moyen pondéré
                       par le temps. Le dire explicitement évite de lire l'un
                       comme le ratio de l'autre.
                    */
                    pnlSummary == null || pnlSummary.pct == null
                    ? "P&L n/d"
                    : `P&L ${pnlSummary.pnl >= 0 ? "+" : ""}${formatCurrency(pnlSummary.pnl, baseCurrency)} · ${pnlSummary.pct >= 0 ? "+" : ""}${pnlSummary.pct.toFixed(1)} %`
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
        <RangeChips
          range={range}
          onRangeChange={onRangeChange}
          rangeEnabled={rangeEnabled}
          testIdPrefix="evolution-range"
        />

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          {/*
            Le compte commande, l'enveloppe précise.

            « Compte » — où l'argent est déposé — remplace la classe d'actif :
            Actions additionnait PEA + CTO + unités de compte d'assurance-vie,
            et ni PEA ni CTO ne sont cette somme. Un unique sélecteur — pas une
            rangée de chips — car les huit comptes ne sont pas des variations
            d'une même question mais des poches disjointes du patrimoine.

            Changer de compte remet l'enveloppe à « Tout » : garder « PEA » en
            passant sur la crypto laisserait un filtre actif qu'aucun contrôle
            n'affiche plus.
          */}
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
            <span className="text-[10px] font-medium uppercase tracking-wide">
              Compte
            </span>
            <select
              className="input !h-7 w-auto !min-w-0 py-0 pl-2 pr-6 text-[11px]"
              value={account ?? "all"}
              onChange={(e) =>
                update({
                  account:
                    e.target.value === "all"
                      ? null
                      : (e.target.value as EvolutionAccount),
                  envelope: null,
                })
              }
              data-testid="evolution-account-select"
              aria-label="Compte"
            >
              {ACCOUNT_CHOICES.map((c) => (
                <option key={c.id} value={c.id} title={c.title}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {/*
            La sous-rangée d'enveloppe n'existe que là où la question se pose.

            Sur Titres seulement : c'est le seul compte que le journal sait
            recouper avec PEA ou CTO. Assurance-vie, crypto, immobilier,
            alternatifs, épargne salariale et banques n'ont aucun rapport avec
            un compte-titres.
          */}
          {account === "TITRES" && (
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
              lineType={pocketChartLineType(account)}
            />
          ) : (
            <PortfolioPercentChart
              data={percentPoints}
              benchmarkName={benchmarkDisplayName}
            />
          )}
        </div>
      </div>

      {account === "TITRES" && envelope && !empty && (
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

      {/*
        `null` ne s'affiche pas, et zéro non plus — mais pas pour la même
        raison : l'un dit qu'on ne sait pas, l'autre que tout est rattaché.
        Aucun des deux ne mérite une ligne, et les confondre ferait afficher
        « 0 € hors comptes-titres » là où l'enveloppe est simplement inconnue.
      */}
      {account === "TITRES" &&
        !empty &&
        titresGapEur != null &&
        Math.abs(titresGapEur) >= 0.01 && (
        <p
          className="text-meta mt-1.5 shrink-0"
          data-testid="evolution-titres-cfd-gap"
        >
          {/*
            La valeur de ligne, pas la marge : un CFD non historisé pèse ici
            pour l'exposition qu'il porte, pas pour le résultat qu'il dégage —
            ce sont deux grandeurs distinctes, et la confusion inventerait un
            écart qui ne correspond à rien de mesuré.
          */}
          {formatCurrency(titresGapEur, baseCurrency)} hors comptes-titres —
          CFD non historisé (valeur de ligne, pas la marge).
        </p>
      )}

      {/*
        Même distinction que sous Titres : `null` ne s'affiche pas, et zéro non
        plus — l'un dit qu'on ne sait pas, l'autre que la partition est
        complète. Le libellé nomme les deux natures présentes, CFD et devise,
        plutôt que de les ranger sous un mot qui n'en couvrirait qu'une.
      */}
      {account == null &&
        !empty &&
        accountsGap != null &&
        Math.abs(accountsGap) >= 0.01 && (
        <p
          className="text-meta mt-1.5 shrink-0"
          data-testid="evolution-accounts-gap"
        >
          Hors comptes : {formatCurrency(accountsGap, baseCurrency)} (CFD /
          devises non historisés).
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
