"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { HistoryPoint } from "@/app/lib/types/ui";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import {
  buildEvolutionSeries,
  benchmarkGapPct,
  benchmarkLabel,
  evolutionDeltaSummary,
  evolutionIntervalHint,
  evolutionIntervalLabel,
  isEvolutionRangeEnabled,
  toPercentSeries,
  withBenchmarkSeries,
  type EvolutionRange,
  type IndexClosePoint,
} from "@/app/lib/portfolio/evolution-aggregate";
import {
  DEFAULT_EVOLUTION_PREFS,
  loadEvolutionPrefs,
  saveEvolutionPrefs,
  type EvolutionBenchmark,
  type EvolutionPrefsV5,
  type EvolutionAssetClass,
  type EvolutionScope,
} from "@/app/lib/portfolio/evolution-prefs";
import {
  MARKET_INDICES,
  marketIndexLabel,
  type MarketIndexKey,
} from "@/app/lib/portfolio/market-indices";
import {
  PortfolioPercentChart,
  PortfolioValueChart,
} from "@/components/dashboard/portfolio-evolution-charts";
import { IntradaySection } from "@/components/dashboard/intraday-section";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

const RANGES: { id: EvolutionRange; label: string }[] = [
  { id: "7d", label: "7J" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1A" },
  { id: "5y", label: "5A" },
  { id: "all", label: "Tout" },
];

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
const METRIC_CHOICES: {
  id: "value" | "performance";
  label: string;
  title: string;
}[] = [
  { id: "value", label: "Valeur", title: "Encours de la classe, apports compris" },
  {
    id: "performance",
    label: "Performance",
    title:
      "Résultat cumulé de la classe, mouvements de capitaux retirés — hors revenus encaissés",
  },
];

const SCOPE_CHOICES: {
  id: EvolutionScope;
  label: string;
  title: string;
}[] = [
  {
    id: "gross",
    label: "Portefeuille",
    title: "Valeur brute des actifs — titres, cash, alternatifs, épargne salariale",
  },
  {
    id: "net",
    label: "Patrimoine net",
    title: "Valeur brute des actifs moins le capital restant dû",
  },
];

/**
 * Échelle de lecture — quotidienne ou horaire.
 *
 * Proposée sur la seule fenêtre de sept jours : c'est là que l'heure a un sens,
 * et la collecte horaire ne remonte de toute façon pas plus loin. Le choix est
 * volontairement local et non mémorisé — c'est une façon de regarder, pas un
 * réglage de compte, et le mémoriser ferait rouvrir l'écran sur une courbe que
 * l'utilisateur n'a pas demandée.
 *
 * La courbe quotidienne reste le défaut : l'intraday s'ajoute au parcours, il
 * ne le remplace pas.
 */
type EvolutionScale = "daily" | "intraday";

const SCALE_CHOICES: { id: EvolutionScale; label: string; title: string }[] = [
  { id: "daily", label: "Jour", title: "Un point par jour — historique complet" },
  {
    id: "intraday",
    label: "Heure",
    title: "Un point par heure, sur les observations réellement collectées",
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
 * (« Versus »). Toute la logique d'affichage (numéraire vs pourcentage,
 * rebasage du benchmark) est centralisée ici et dans `evolution-aggregate.ts`
 * — aucun calcul de performance dupliqué ailleurs dans l'app.
 */
export function PortfolioEvolutionPanel({
  history,
  baseCurrency,
  loading,
  className,
}: {
  history: HistoryPoint[];
  baseCurrency: string;
  loading?: boolean;
  className?: string;
}) {
  const isClient = useIsClient();
  const [prefs, setPrefs] = useState<EvolutionPrefsV5>(DEFAULT_EVOLUTION_PREFS);
  const [hydrated, setHydrated] = useState(false);

  // Seed prefs depuis localStorage au passage client (adjust state while rendering)
  if (isClient && !hydrated) {
    setHydrated(true);
    setPrefs(loadEvolutionPrefs());
  }

  const { range, versus, indexKey, scope } = prefs;
  const assetClass = prefs.assetClass ?? null;
  const classMetric = prefs.classMetric ?? "value";

  /*
    L'échelle n'est pas mémorisée avec les autres préférences : c'est une façon
    de regarder sur l'instant, pas un réglage de compte. Elle retombe donc sur
    « Jour » — la courbe de référence — à chaque ouverture.
  */
  const [scale, setScale] = useState<EvolutionScale>("daily");
  // L'heure n'a de sens que sur la fenêtre courte, la seule que la collecte
  // horaire couvre. Ailleurs, le choix disparaît et la lecture reste quotidienne.
  const scaleAvailable = range === "7d";
  const showIntraday = scaleAvailable && scale === "intraday";

  const update = (patch: Partial<EvolutionPrefsV5>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch, v: 5 as const };
      if (hydrated) saveEvolutionPrefs(next);
      return next;
    });
  };

  const firstDate = history[0]?.date ?? null;

  const rangeEnabled = useMemo(() => {
    const map = {} as Record<EvolutionRange, boolean>;
    for (const r of RANGES) {
      map[r.id] = isEvolutionRangeEnabled(r.id, firstDate);
    }
    return map;
  }, [firstDate]);

  // Repli 7j si la période courante devient indisponible (adjust state while rendering)
  if (hydrated && !rangeEnabled[range] && range !== "7d") {
    setPrefs((p) => ({ ...p, range: "7d", v: 5 as const }));
  }

  /*
    Le périmètre est choisi **avant** l'agrégation, pas après.

    Actifs bruts et patrimoine net diffèrent de l'encours des dettes : les
    mélanger dans une même série ferait passer un remboursement d'emprunt pour
    un mouvement de marché. Réécrire le total en amont garantit qu'une seule
    des deux métriques circule dans toute la chaîne d'affichage.
  */
  const scopedHistory = useMemo(() => {
    /*
      Une classe isolée passe par le même chemin que « patrimoine net » : le
      total est réécrit **en amont**, et toute la chaîne d'affichage — deltas,
      rebasage du comparatif, infobulles — travaille ensuite sur une seule
      grandeur. Filtrer en aval aurait laissé les variations calculées sur le
      patrimoine entier sous une étiquette de classe.

      Les points dont la ventilation est absente sont **retirés**, jamais
      ramenés à zéro : une ventilation inconnue n'est pas une classe vide, et
      la courbe doit s'interrompre là où la donnée s'arrête.
    */
    if (assetClass) {
      const out = [];
      /*
        Deux lectures possibles de la même classe.

        « Valeur » trace l'encours, apports compris. « Performance » trace ce
        que le marché a produit, une fois les mouvements de capitaux retirés —
        c'est un **cumul** de résultats quotidiens, pas un encours, d'où
        l'accumulation ci-dessous. Les présenter sous le même nom ferait passer
        un versement pour un gain.

        La performance n'existe pas au premier point d'une série : sans veille,
        rien n'est comparable. Ces points sont écartés plutôt que ramenés à
        zéro.
      */
      let cumul = 0;
      for (const p of history) {
        if (classMetric === "performance") {
          const perf = p.performanceByAssetClassBase?.[assetClass];
          if (perf == null) continue;
          cumul += perf;
          out.push({
            ...p,
            totalValueBase: cumul,
            totalValueEur: cumul,
            netWorthBase: cumul,
          });
          continue;
        }
        const v = p.byAssetClassBase?.[assetClass];
        if (v == null) continue;
        out.push({ ...p, totalValueBase: v, totalValueEur: v, netWorthBase: v });
      }
      return out;
    }
    if (scope !== "net") return history;
    return history.map((p) =>
      p.netWorthBase == null
        ? p
        : { ...p, totalValueBase: p.netWorthBase, totalValueEur: p.netWorthBase }
    );
  }, [history, scope, assetClass, classMetric]);

  const { points: rawPoints, interval } = useMemo(
    () => buildEvolutionSeries(scopedHistory, range, "cumul"),
    [scopedHistory, range]
  );

  // Mode "index" : récupère les clôtures réelles de l'indice choisi sur la
  // fenêtre affichée (marge amont pour disposer d'une clôture de base).
  const wantIndex = versus === "index";
  const idxFromKey = rawPoints[0]?.date.slice(0, 10) ?? "";
  const idxToKey = rawPoints[rawPoints.length - 1]?.date.slice(0, 10) ?? "";
  const indexQ = useQuery({
    queryKey: ["evolution-index", indexKey, idxFromKey, idxToKey],
    enabled: wantIndex && rawPoints.length > 1,
    staleTime: 30 * 60_000,
    queryFn: () => {
      const fromMs = Date.parse(rawPoints[0]!.date) - 7 * 24 * 60 * 60 * 1000;
      const from = new Date(fromMs).toISOString();
      const to = rawPoints[rawPoints.length - 1]!.date;
      const params = new URLSearchParams({ symbol: indexKey, from, to });
      return fetchJson<{ points: IndexClosePoint[] }>(
        `/api/benchmark?${params.toString()}`
      );
    },
  });
  const indexCloses = useMemo<IndexClosePoint[]>(
    () => indexQ.data?.points ?? [],
    [indexQ.data]
  );

  const points = useMemo(
    () => withBenchmarkSeries(rawPoints, versus, { indexCloses }),
    [rawPoints, versus, indexCloses]
  );

  /*
    Trois situations distinctes, et elles ne se disent pas pareil :
    la période est trop courte, la donnée manque, ou tout va bien.
  */

  const percentPoints = useMemo(
    () => (versus === "none" ? [] : toPercentSeries(points)),
    [points, versus]
  );

  const gap = useMemo(
    () => (versus === "none" ? null : benchmarkGapPct(points)),
    [points, versus]
  );

  const benchmarkDisplayName =
    versus === "index" ? marketIndexLabel(indexKey) : benchmarkLabel(versus);

  const summary = useMemo(() => evolutionDeltaSummary(points), [points]);
  const headlinePct =
    percentPoints.length > 0
      ? percentPoints[percentPoints.length - 1]!.portfolioPct
      : 0;

  const empty = !loading && history.length === 0;
  const noPoints = !loading && !empty && rawPoints.length === 0;

  return (
    <div
      className={cn(
        "card flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3.5 sm:p-4",
        className
      )}
      data-testid="portfolio-evolution-panel"
    >
      <PanelHeader
        title="Évolution du portefeuille"
        subtitle={
          <>
            {assetClass
              ? `${CLASS_CHOICES.find((c) => c.id === assetClass)?.label ?? assetClass} — ${classMetric === "performance" ? "performance" : "valeur"}`
              : scope === "net"
                ? "Patrimoine net"
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
          summary && points.length > 0 ? (
            <div className="shrink-0 text-right" data-testid="evolution-headline">
              <div
                className={cn(
                  "text-lg font-bold tabular-nums sm:text-xl",
                  (versus === "none" ? summary.delta : headlinePct) >= 0
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                )}
              >
                {versus === "none" ? (
                  <>
                    {summary.delta >= 0 ? "+" : ""}
                    {formatCurrency(summary.delta, baseCurrency)}
                  </>
                ) : (
                  <>
                    {headlinePct >= 0 ? "+" : ""}
                    {headlinePct.toFixed(1)}&nbsp;%
                  </>
                )}
              </div>
              <div className="text-[11px] font-medium text-[var(--muted-foreground)]">
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
                  : `Vs ${benchmarkDisplayName}`}
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
                onClick={() => enabled && update({ range: r.id })}
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
          {scaleAvailable && (
            <Segmented
              items={SCALE_CHOICES}
              value={scale}
              onChange={setScale}
              ariaLabel="Échelle de lecture"
              testIdPrefix="evolution-scale"
            />
          )}
          <Segmented
            items={CLASS_CHOICES}
            value={assetClass ?? "all"}
            onChange={(v) =>
              update({ assetClass: v === "all" ? null : (v as EvolutionAssetClass) })
            }
            ariaLabel="Classe d'actifs"
            testIdPrefix="evolution-class"
          />
          {/*
            Valeur ou performance : la distinction n'a de sens que sur une
            classe, la courbe globale ayant déjà sa propre lecture.
          */}
          {assetClass && (
            <Segmented
              items={METRIC_CHOICES}
              value={classMetric}
              onChange={(v) => update({ classMetric: v })}
              ariaLabel="Grandeur tracée"
              testIdPrefix="evolution-metric"
            />
          )}
          {/*
            Brut ou net ne se pose que sur le patrimoine entier : les dettes
            n'appartiennent à aucune classe, et proposer « Crypto nette »
            n'aurait pas de sens.
          */}
          {!assetClass && (
            <Segmented
              items={SCOPE_CHOICES}
              value={scope}
              onChange={(v) => update({ scope: v })}
              ariaLabel="Périmètre"
              testIdPrefix="evolution-scope"
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
          ) : loading ? (
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
          ) : noPoints ? (
            <EmptyPlaceholder
              compact
              title="Période trop courte"
              description="Choisissez une plage plus large ou attendez davantage d'historique."
            />
          ) : versus === "none" ? (
            <PortfolioValueChart data={points} baseCurrency={baseCurrency} />
          ) : (
            <PortfolioPercentChart
              data={percentPoints}
              benchmarkName={benchmarkDisplayName}
            />
          )}
        </div>
      </div>

      {versus !== "none" && !empty && !noPoints && points.length > 0 && (
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
          ) : wantIndex && indexQ.isError ? (
            " · indice indisponible"
          ) : (
            ""
          )}
        </p>
      )}
    </div>
  );
}
