"use client";

import { parisEventClock, PARIS_CLOCK_NOTE } from "@/app/lib/ui/paris-clock";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  ExternalLink,
  Landmark,
  Newspaper,
} from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import type {
  EarningsEvent,
  MacroEvent,
  MacroImpact,
  NewsItem,
} from "@/app/lib/news/service";
import {
  compareActualToConsensus,
  earningsTimingLabel,
  marketEventStatus,
  newsSourceLogoUrl,
} from "@/app/lib/news/service";
import {
  MARKET_RELEASE_FILTERS,
  type MarketReleaseFilter,
} from "@/app/lib/news/release-filter";
import {
  buildReleaseDayWindow,
  coveredDayRange,
  isDayCovered,
  type MarketDay,
} from "@/app/lib/news/market-days";
import { CountryFlag } from "@/components/ui/country-flag";
import { cn } from "@/app/lib/utils";
import { assetLogoSources } from "@/app/lib/logos/logodev";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import type { PortfolioTickerProp } from "@/components/dashboard/market-calendar-panel";
import { parisDayOf } from "@/app/lib/ui/paris-clock";
import { useServerNow } from "@/app/hooks/use-server-now";

export type { MarketReleaseFilter };

/*
  Les trois cartes de contexte partagent un plancher de hauteur.

  La grille les étire déjà l'une sur l'autre — mais seulement au-delà de
  , où elles tiennent sur une même ligne. En deçà, « Résultats » occupe sa
  propre rangée et se réduisait à son contenu : deux annonces suffisaient à en
  faire une carte deux fois plus courte que ses voisines, ce qui la faisait
  passer pour une tuile secondaire alors qu'elle porte la même information.

  Un plancher commun, plutôt qu'une hauteur fixe : une carte bien remplie
  continue de grandir, aucune ne se recroqueville.
*/
const CARTE_CONTEXTE = "min-h-[20rem]";

const IMPACT_LABEL: Record<MacroImpact, string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Fort",
};

const IMPACT_CLASS: Record<MacroImpact, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

const INITIAL = 5;

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: fr });
  } catch {
    return "—";
  }
}


/**
 * Contexte marché — 3 tuiles analytiques (Actualités · Macro · Résultats).
 * Même langage carte que Allocation / Plateforme.
 */
export function NewsMacroPanel({
  portfolioTickers = [],
  compact: _compact = false,
}: {
  portfolioTickers?: PortfolioTickerProp[];
  /** Conservé pour API — macro/résultats affichent toujours 5 items/onglet */
  compact?: boolean;
}) {
  // Min. 5 actualités (demande produit) ; macro/résultats : 5 par onglet, quel que soit compact
  const newsLimit = 5;
  const listLimit = INITIAL;

  const [newsMore, setNewsMore] = useState(false);
  const [macroMore, setMacroMore] = useState(false);
  const [earnMore, setEarnMore] = useState(false);
  const [macroFilter, setMacroFilter] =
    useState<MarketReleaseFilter>("upcoming");
  const [earnFilter, setEarnFilter] =
    useState<MarketReleaseFilter>("upcoming");

  /*
    Deux modes mutuellement exclusifs, un seul jour affiché à la fois par
    carte : « À venir » couvre J…J+6, « Publiées » couvre J−6…J. L'ancre
    temporelle (`mountNow`) est figée une fois au montage — le calendrier ne
    doit pas sauter de jour sous les pieds de l'utilisateur pendant qu'il
    consulte le panneau — et sert à calculer `todayKey` ainsi que la barre de
    chaque carte, recalculée quand son onglet change.
  */
  const [mountNow] = useState<Date>(() => new Date());
  const todayKey = useMemo(
    () => parisDayOf(mountNow) ?? mountNow.toISOString().slice(0, 10),
    [mountNow]
  );
  const [macroDay, setMacroDay] = useState<string>(todayKey);
  const [earnDay, setEarnDay] = useState<string>(todayKey);
  const macroDayWindow = useMemo<MarketDay[]>(
    () => buildReleaseDayWindow(macroFilter, mountNow),
    [macroFilter, mountNow]
  );
  const earnDayWindow = useMemo<MarketDay[]>(
    () => buildReleaseDayWindow(earnFilter, mountNow),
    [earnFilter, mountNow]
  );

  const tickersParam = useMemo(() => {
    return portfolioTickers
      .filter((p) => p.ticker?.trim())
      .slice(0, 24)
      .map((p) =>
        p.name?.trim()
          ? `${p.ticker.trim()}:${p.name.trim()}`
          : p.ticker.trim()
      )
      .join(",");
  }, [portfolioTickers]);

  const newsQ = useQuery({
    queryKey: ["news", newsLimit],
    queryFn: () =>
      fetchJson<{ news: NewsItem[]; source: string }>(
        `/api/news?limit=${Math.max(newsLimit, 8)}`
      ),
    // Actualités : rafraîchir souvent (Finnhub change)
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const macroQ = useQuery({
    queryKey: ["macro-calendar"],
    queryFn: () =>
      fetchJson<{
        events: MacroEvent[];
        upcoming: MacroEvent[];
        published: MacroEvent[];
        date: string;
        source?: "forexfactory" | "mock";
        generatedAt?: string;
      }>("/api/macro"),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const earnQ = useQuery({
    queryKey: ["earnings-calendar", tickersParam],
    queryFn: () => {
      /*
        Le plafond suit celui de la route (60) : la barre de jours couvre
        quinze jours et l'univers Finnhub (P4) porte désormais sur la même
        fenêtre — une limite trop basse tronquerait l'univers avant qu'il
        n'atteigne les jours les plus éloignés, sans que rien ne le signale.
      */
      const q = new URLSearchParams({ limit: "60" });
      if (tickersParam) q.set("tickers", tickersParam);
      return fetchJson<{
        events: EarningsEvent[];
        upcoming: EarningsEvent[];
        published: EarningsEvent[];
        date: string;
        source?: string;
        generatedAt?: string;
        diagnostics?: {
          universeSource: "finnhub" | "no-key";
          universeRaw: number;
          universeKept: number;
          portfolioTargets: number;
        };
      }>(`/api/earnings?${q.toString()}`);
    },
    staleTime: 5 * 60_000,
  });

  // Horloge synchronisée sur le serveur : le badge Publié/À venir bascule en
  // direct plutôt que de rester figé sur l'horaire de la requête.
  const serverNowMs = useServerNow(
    macroQ.data?.generatedAt ?? earnQ.data?.generatedAt ?? null
  );

  const newsAll = newsQ.data?.news ?? [];

  const macroEvents = useMemo(() => macroQ.data?.events ?? [], [macroQ.data]);
  const macroCoverage = useMemo(
    () => coveredDayRange(macroEvents.map((e) => e.time)),
    [macroEvents]
  );
  const macroDayEvents = useMemo(
    () => macroEvents.filter((e) => parisDayOf(e.time) === macroDay),
    [macroEvents, macroDay]
  );
  const macroAll = useMemo(
    () =>
      macroDayEvents.filter(
        (e) => marketEventStatus(e.time, serverNowMs) === macroFilter
      ),
    [macroDayEvents, macroFilter, serverNowMs]
  );

  const earnEvents = useMemo(() => earnQ.data?.events ?? [], [earnQ.data]);
  const earnDiag = earnQ.data?.diagnostics;
  const earnDayEvents = useMemo(
    () => earnEvents.filter((e) => parisDayOf(e.time) === earnDay),
    [earnEvents, earnDay]
  );
  const earnAll = useMemo(
    () =>
      earnDayEvents.filter(
        (e) => marketEventStatus(e.time, serverNowMs) === earnFilter
      ),
    [earnDayEvents, earnFilter, serverNowMs]
  );

  // Toujours afficher au moins 5 actus si disponibles
  const newsCap = Math.max(5, listLimit);
  const newsVisible = newsMore ? newsAll : newsAll.slice(0, newsCap);
  const macroVisible = macroMore ? macroAll : macroAll.slice(0, listLimit);
  const earnVisible = earnMore ? earnAll : earnAll.slice(0, listLimit);

  return (
    <section className="space-y-3" data-testid="news-macro-panel">
      <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="section-heading">Contexte marché</h2>
          <p className="text-meta">
            Actualités, calendrier macro et résultats
          </p>
        </div>
      </div>

      <div
        className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-stretch"
        data-testid="market-context-tiles"
      >
        {/* —— Actualités —— */}
        <article
          className={cn(CARTE_CONTEXTE, "card flex min-w-0 flex-col p-3.5 sm:p-4")}
          data-testid="market-tile-news"
        >
          <header className="mb-2.5 flex items-start gap-2">
            <Newspaper
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <div className="min-w-0">
              <h3 className="text-title">Actualités</h3>
              <p className="text-meta">
                {newsQ.data?.source === "google-fr"
                  ? "Sources FR prioritaires"
                  : newsQ.data?.source === "mixed"
                    ? "Sources FR + marché"
                    : newsQ.data?.source === "finnhub"
                      ? "Flux marché (live)"
                      : "Flux économique"}
              </p>
            </div>
          </header>

          <div className="min-h-[10rem] flex-1">
            {newsQ.isLoading ? (
              <ul className="space-y-2.5" aria-busy="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i}>
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="mt-1.5 h-3 w-1/2" />
                  </li>
                ))}
              </ul>
            ) : newsQ.isError ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">
                Actualités momentanément indisponibles
              </p>
            ) : newsAll.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">
                Aucune actualité pour l&apos;instant
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {newsVisible.map((n) => (
                  <li
                    key={n.id}
                    className="list-row-interactive py-1.5 first:pt-0 last:pb-0"
                  >
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2 rounded-[var(--radius-sm)] px-0.5 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                    >
                      <NewsSourceLogo
                        source={n.source}
                        logoUrl={n.sourceLogoUrl}
                        articleUrl={n.url}
                      />
                      <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-[var(--foreground)] group-hover:text-[var(--primary)]">
                        {n.title}
                      </span>
                      <ExternalLink
                        className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted-foreground)] opacity-40 group-hover:opacity-100"
                        aria-hidden
                      />
                    </a>
                    <p className="text-meta mt-0.5 pl-8">
                      {n.source}
                      <span className="mx-1 opacity-40">·</span>
                      <time dateTime={n.publishedAt}>
                        {relativeTime(n.publishedAt)}
                      </time>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {newsAll.length > newsCap && (
            <button
              type="button"
              className="mt-2 self-start text-[11px] font-medium text-[var(--primary)] hover:underline"
              onClick={() => setNewsMore((v) => !v)}
            >
              {newsMore ? "Voir moins" : "Voir plus"}
            </button>
          )}
        </article>

        {/* —— Macroéconomie —— */}
        <article
          className={cn(CARTE_CONTEXTE, "card flex min-w-0 flex-col p-3.5 sm:p-4")}
          data-testid="market-cal-macro"
        >
          <header className="mb-2 flex items-start gap-2">
            <Landmark
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-title">Macroéconomie</h3>
              <p className="text-meta">
                {/*
                  Le fuseau est dit une fois, ici, plutôt que sur chaque ligne.

                  Sans lui, une heure seule laissait le lecteur la rapporter à
                  son propre fuseau — ou à celui du pays de l'indicateur, ce qui
                  est le piège d'un calendrier international. La conversion était
                  juste ; c'est l'écran qui ne disait pas dans quelle unité il
                  parlait.
                */}
                {macroQ.data?.source === "forexfactory"
                  ? `Calendrier de la semaine (live) · ${PARIS_CLOCK_NOTE}`
                  : `Indicateurs du jour (exemples) · ${PARIS_CLOCK_NOTE}`}
              </p>
            </div>
          </header>

          <DayBar
            days={macroDayWindow}
            coverage={macroCoverage}
            value={macroDay}
            onChange={(d) => {
              setMacroDay(d);
              setMacroMore(false);
            }}
            testId="macro-day"
          />

          <ReleaseFilterBar
            value={macroFilter}
            onChange={(f) => {
              setMacroFilter(f);
              // Changer d'onglet remet le jour sur J : la barre change de
              // sens (J…J+6 ↔ J−6…J) et l'ancien jour sélectionné peut ne
              // plus exister côté nouvel onglet.
              setMacroDay(todayKey);
              setMacroMore(false);
            }}
            testId="macro-time-filter"
          />

          <div className="min-h-[10rem] flex-1">
            {macroQ.isLoading ? (
              <ul className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="flex gap-2">
                    <Skeleton className="h-4 w-10" />
                    <Skeleton className="h-4 flex-1" />
                  </li>
                ))}
              </ul>
            ) : macroQ.isError ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
                Calendrier macro indisponible
              </p>
            ) : macroAll.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
                {describeEmptyDay({
                  day: macroDay,
                  coverage: macroCoverage,
                  dayHasEvents: macroDayEvents.length > 0,
                  emptyDayLabel:
                    macroFilter === "upcoming"
                      ? "Aucun indicateur à venir ce jour"
                      : "Aucune publication ce jour",
                  emptyFilterLabel:
                    macroFilter === "upcoming"
                      ? "Tout est déjà publié pour ce jour"
                      : "Rien n'est encore publié pour ce jour",
                })}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {macroVisible.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] px-0.5 py-1 text-xs sm:gap-2"
                  >
                    <span className="w-10 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                      {parisEventClock(e.time)}
                    </span>
                    <CountryFlag code={e.countryCode || e.country} showCode />
                    <span className="min-w-0 flex-1 leading-snug text-[var(--foreground)]">
                      {e.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                        IMPACT_CLASS[e.impact]
                      )}
                    >
                      {IMPACT_LABEL[e.impact]}
                    </span>
                    <MacroFigures
                      previous={e.previous}
                      forecast={e.forecast}
                      actual={e.actual}
                      mode={macroFilter}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {macroAll.length > listLimit && (
            <button
              type="button"
              className="mt-2 self-start text-[11px] font-medium text-[var(--primary)] hover:underline"
              data-testid="market-cal-macro-more"
              onClick={() => setMacroMore((v) => !v)}
            >
              {macroMore ? "Voir moins" : "Voir plus"}
            </button>
          )}
        </article>

        {/* —— Résultats —— */}
        <article
          className={cn(CARTE_CONTEXTE, "card flex min-w-0 flex-col p-3.5 sm:p-4 sm:col-span-2 lg:col-span-1")}
          data-testid="market-cal-earnings"
        >
          <header className="mb-2 flex items-start gap-2">
            <Briefcase
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-title">
                Résultats des entreprises
              </h3>
              {/*
                Le sous-titre décrivait « Vos titres uniquement » — un
                périmètre que la carte a quitté : elle porte désormais
                l'univers du jour sélectionné, le cadre jaune distinguant ce
                qui est détenu (`inPortfolio`). Le sous-titre dit maintenant
                d'où vient ce périmètre, `diagnostics` en main plutôt que
                supposé : sans clé Finnhub, l'univers élargi est réellement
                absent (mesuré : `FINNHUB_API_KEY` n'existe pas sur cette
                machine), pas seulement vide.
              */}
              <p className="text-meta">
                {earnDiag?.universeSource === "no-key"
                  ? "Univers élargi indisponible (clé Finnhub absente) · portefeuille"
                  : earnDiag?.universeSource === "finnhub"
                    ? "Univers du jour (Finnhub) + portefeuille"
                    : portfolioTickers.length > 0
                      ? "Portefeuille"
                      : "Aucun titre coté au portefeuille"}
              </p>
            </div>
          </header>

          <DayBar
            days={earnDayWindow}
            coverage={null}
            value={earnDay}
            onChange={(d) => {
              setEarnDay(d);
              setEarnMore(false);
            }}
            testId="earn-day"
          />

          <ReleaseFilterBar
            value={earnFilter}
            onChange={(f) => {
              setEarnFilter(f);
              // Même règle que Macro : l'onglet change le sens de la barre,
              // le jour sélectionné revient sur J.
              setEarnDay(todayKey);
              setEarnMore(false);
            }}
            testId="earn-time-filter"
          />

          <div className="min-h-[10rem] flex-1">
            {earnQ.isLoading ? (
              <ul className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="flex gap-2">
                    <Skeleton className="h-4 w-10" />
                    <Skeleton className="h-4 flex-1" />
                  </li>
                ))}
              </ul>
            ) : earnQ.isError ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
                Calendrier des résultats indisponible
              </p>
            ) : earnAll.length === 0 ? (
              /*
                Vide n'est pas une panne. Trois causes, pas une : aucun titre
                coté, aucune annonce ce jour-là (portefeuille comme univers),
                ou univers élargi absent faute de clé — `diagnostics` dit
                laquelle plutôt que de les fondre dans un même silence.
              */
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
                {portfolioTickers.length === 0 &&
                earnDiag?.universeSource === "no-key"
                  ? "Aucun titre coté, et l'univers élargi est indisponible (clé Finnhub absente)"
                  : describeEmptyDay({
                      day: earnDay,
                      coverage: null,
                      dayHasEvents: earnDayEvents.length > 0,
                      emptyDayLabel:
                        earnFilter === "upcoming"
                          ? "Aucun résultat à venir ce jour"
                          : "Aucun résultat publié ce jour",
                      emptyFilterLabel:
                        earnFilter === "upcoming"
                          ? "Tout est déjà publié pour ce jour"
                          : "Rien n'est encore publié pour ce jour",
                    })}
              </p>
            ) : (
              /*
                Même gabarit de ligne que la carte Macro juste à côté — mêmes
                classes de hauteur, de fond et d'interligne (`flex flex-wrap
                items-center gap-1.5 … px-0.5 py-1 text-xs`, figures sur une
                ligne pleine largeur en dessous). Le logo 40×40 sur deux
                lignes de texte séparées produisait des cartes bien plus
                hautes et plus creuses côté Résultats qu'en Macro ; ici le
                logo rejoint la taille du drapeau macro et le nom tient sur la
                même ligne que l'heure.
              */
              <ul className="space-y-1.5">
                {earnVisible.map((e) => (
                  <li
                    key={e.id}
                    className={cn(
                      "flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-transparent px-0.5 py-1 text-xs sm:gap-2",
                      e.inPortfolio &&
                        "border-[var(--primary-soft)] bg-[var(--primary-soft)]/40"
                    )}
                    data-in-portfolio={e.inPortfolio ? "true" : "false"}
                  >
                    <span className="w-10 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                      {parisEventClock(e.time)}
                    </span>
                    <div className="relative shrink-0">
                      <CompanyLogo
                        src={e.logoUrl}
                        name={e.companyName}
                        ticker={e.ticker}
                        sizeClassName="h-5 w-5"
                        radiusClassName="rounded-md"
                      />
                      <div className="absolute -bottom-0.5 -right-0.5">
                        <CountryFlag
                          code={e.countryCode || "us"}
                          showCode={false}
                          imgClassName="h-2 w-3"
                          className="px-0.5 py-0 shadow-sm ring-1 ring-white dark:ring-slate-900 bg-white dark:bg-slate-900 text-[8px]"
                        />
                      </div>
                    </div>
                    <span className="min-w-0 flex-1 truncate leading-snug text-[var(--foreground)]">
                      {e.companyName}
                      <span className="ml-1 font-mono text-[10px] text-[var(--muted-foreground)]">
                        {e.ticker}
                      </span>
                    </span>
                    {e.inPortfolio && (
                      <span className="shrink-0 rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--primary)]">
                        Portefeuille
                      </span>
                    )}
                    <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {earningsTimingLabel(e.timing)}
                    </span>
                    <EarningsFigures
                      estimate={e.epsEstimate}
                      actual={e.epsActual}
                      mode={earnFilter}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {earnAll.length > listLimit && (
            <button
              type="button"
              className="mt-2 self-start text-[11px] font-medium text-[var(--primary)] hover:underline"
              data-testid="market-cal-earnings-more"
              onClick={() => setEarnMore((v) => !v)}
            >
              {earnMore ? "Voir moins" : "Voir plus"}
            </button>
          )}
        </article>
      </div>
    </section>
  );
}

const RESULT_COLOR = {
  above: "text-emerald-700 dark:text-emerald-300 font-semibold",
  below: "text-red-700 dark:text-red-300 font-semibold",
  equal: "text-stone-700 dark:text-stone-300 font-semibold",
  na: "text-[var(--muted-foreground)]",
} as const;

/** Ligne Préc. / Cons. / Rés. pour macro (publiées = 3 champs + couleur sur Rés.) */
function MacroFigures({
  previous,
  forecast,
  actual,
  mode,
}: {
  previous?: string | null;
  forecast?: string | null;
  actual?: string | null;
  mode: MarketReleaseFilter;
}) {
  const hasAny = previous || forecast || actual;
  if (!hasAny) return null;

  if (mode === "upcoming") {
    // À venir : consensus + précédent si dispo (pas de résultat)
    if (!forecast && !previous) return null;
    return (
      <span className="w-full pl-12 text-[10px] text-[var(--muted-foreground)]">
        {previous ? (
          <>
            <span className="font-medium">Préc.</span> {previous}
          </>
        ) : null}
        {previous && forecast ? " · " : null}
        {forecast ? (
          <>
            <span className="font-medium">Cons.</span> {forecast}
          </>
        ) : null}
      </span>
    );
  }

  // Publiées : toujours Préc. · Cons. · Rés. (— si manquant)
  const cmp = compareActualToConsensus(actual, forecast);
  return (
    <span className="w-full pl-12 text-[10px] tabular-nums text-[var(--muted-foreground)]">
      <span className="font-medium">Préc.</span> {previous?.trim() || "—"}
      {" · "}
      <span className="font-medium">Cons.</span> {forecast?.trim() || "—"}
      {" · "}
      <span className="font-medium">Rés.</span>{" "}
      <span className={RESULT_COLOR[cmp]}>{actual?.trim() || "—"}</span>
    </span>
  );
}

function NewsSourceLogo({
  source,
  logoUrl,
  articleUrl,
}: {
  source: string;
  logoUrl?: string | null;
  articleUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl || newsSourceLogoUrl(source, articleUrl);
  if (failed) {
    return (
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--muted)] text-[8px] font-bold uppercase text-[var(--muted-foreground)]"
        aria-hidden
        title={source}
      >
        {(source || "?").slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      decoding="async"
      title={source}
      className="mt-0.5 h-5 w-5 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/15"
      onError={() => setFailed(true)}
    />
  );
}

function CompanyLogo({
  src,
  name,
  ticker,
  sizeClassName = "h-6 w-6",
  radiusClassName = "rounded-md",
}: {
  src?: string | null;
  name: string;
  ticker: string;
  sizeClassName?: string;
  radiusClassName?: string;
}) {
  const size = sizeClassName === "h-10 w-10" ? 40 : 24;
  // Le ticker sert de second identifiant : quand la source ne fournit pas de
  // logo — ou qu'il ne charge pas — logo.dev sait encore le résoudre, et les
  // initiales ne restent que si tout échoue.
  const sources = useMemo(() => {
    const fromTicker = ticker
      ? assetLogoSources({ ticker, name, size })
      : name
        ? assetLogoSources({ name, size })
        : [];
    return src ? [src, ...fromTicker] : fromTicker;
  }, [src, ticker, name, size]);
  const [index, setIndex] = useState(0);
  // Le composant est réutilisé d'une société à l'autre quand le fil se
  // rafraîchit : sans remise à zéro, l'échec de la précédente vaudrait échec
  // de la suivante.
  const [seenFirst, setSeenFirst] = useState(sources[0]);
  if (sources[0] !== seenFirst) {
    setSeenFirst(sources[0]);
    setIndex(0);
  }

  if (index >= sources.length) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--muted)] font-bold text-[var(--muted-foreground)]",
          sizeClassName,
          radiusClassName,
          sizeClassName === "h-10 w-10" ? "text-[12px]" : "text-[9px]"
        )}
        aria-hidden
        title={name || ticker}
      >
        {(ticker || name || "?").slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[index]}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      title={name || ticker}
      className={cn(
        "shrink-0 bg-white object-contain p-0.5 ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/15",
        sizeClassName,
        radiusClassName
      )}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

function EarningsFigures({
  estimate,
  actual,
  mode,
}: {
  estimate?: string | null;
  actual?: string | null;
  mode: MarketReleaseFilter;
}) {
  if (mode === "upcoming") {
    if (!estimate) return null;
    return (
      <p className="w-full pl-12 text-[10px] text-[var(--muted-foreground)]">
        <span className="font-medium">Cons.</span> EPS {estimate}
      </p>
    );
  }
  if (!actual && !estimate) return null;
  const cmp = compareActualToConsensus(actual, estimate);
  return (
    <p className="w-full pl-12 text-[10px] tabular-nums text-[var(--muted-foreground)]">
      <span className="font-medium">Cons.</span> {estimate?.trim() || "—"}
      {" · "}
      <span className="font-medium">Rés.</span>{" "}
      <span className={RESULT_COLOR[cmp]}>{actual?.trim() || "—"}</span>
    </p>
  );
}

/**
 * Barre de jours J−7…J+7 (civil Europe/Paris). Un jour sélectionné à la fois ;
 * les jours hors de l'étendue effectivement couverte par la source (`coverage`
 * — `null` si sans objet, comme pour les résultats dont la fenêtre serveur
 * couvre déjà toute la barre) restent cliquables mais sont visuellement
 * atténués et portent un titre expliquant pourquoi : un jour hors fenêtre
 * n'est pas un jour sans événement, et ne doit pas se lire comme tel.
 */
function DayBar({
  days,
  coverage,
  value,
  onChange,
  testId,
}: {
  days: MarketDay[];
  coverage: { min: string; max: string } | null;
  value: string;
  onChange: (day: string) => void;
  testId: string;
}) {
  return (
    <div
      className="mb-2 flex gap-1 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Jour"
      data-testid={testId}
    >
      {days.map((d) => {
        const selected = d.key === value;
        const covered = isDayCovered(d.key, coverage);
        return (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`${testId}-${d.key}`}
            title={
              covered === false
                ? "Hors de la fenêtre fournie par la source (semaine courante)"
                : undefined
            }
            onClick={() => onChange(d.key)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-1 text-[10px] font-semibold capitalize transition",
              selected
                ? "bg-[var(--primary)] text-white shadow-[var(--shadow-xs)]"
                : covered === false
                  ? "text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              d.isToday && !selected && "ring-1 ring-inset ring-[var(--primary)]/40"
            )}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Message d'un jour sans résultat visible, qui distingue trois causes plutôt
 * que de les fondre dans un même « rien à afficher » :
 * - le jour est hors de l'étendue couverte par la source (`coverage` connu et
 *   `day` en dehors) ;
 * - le jour est couvert mais réellement vide (`dayHasEvents` faux) ;
 * - le jour porte des événements, mais aucun ne correspond à l'onglet
 *   sélectionné (à venir / publiées).
 */
function describeEmptyDay({
  day,
  coverage,
  dayHasEvents,
  emptyDayLabel,
  emptyFilterLabel,
}: {
  day: string;
  coverage: { min: string; max: string } | null;
  dayHasEvents: boolean;
  emptyDayLabel: string;
  emptyFilterLabel: string;
}): string {
  const covered = isDayCovered(day, coverage);
  if (covered === false) {
    return `Hors de la fenêtre fournie par la source (semaine courante${
      coverage ? ` : ${coverage.min} → ${coverage.max}` : ""
    })`;
  }
  return dayHasEvents ? emptyFilterLabel : emptyDayLabel;
}

function ReleaseFilterBar({
  value,
  onChange,
  testId,
}: {
  value: MarketReleaseFilter;
  onChange: (v: MarketReleaseFilter) => void;
  testId: string;
}) {
  return (
    <div
      className="mb-2 flex gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/30 p-0.5"
      role="tablist"
      aria-label="Statut de publication"
      data-testid={testId}
    >
      {MARKET_RELEASE_FILTERS.map((f) => {
        const selected = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`${testId}-${f.id}`}
            onClick={() => onChange(f.id)}
            className={cn(
              "flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] font-semibold transition",
              selected
                ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
