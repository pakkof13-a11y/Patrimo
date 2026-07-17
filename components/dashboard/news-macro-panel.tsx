"use client";

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
import { earningsTimingLabel } from "@/app/lib/news/service";
import {
  filterEarningsByRelease,
  filterMacroByRelease,
  MARKET_RELEASE_FILTERS,
  type MarketReleaseFilter,
} from "@/app/lib/news/release-filter";
import { CountryFlag } from "@/components/ui/country-flag";
import { cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import type { PortfolioTickerProp } from "@/components/dashboard/market-calendar-panel";

export type { MarketReleaseFilter };

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

const INITIAL = 4;

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: fr });
  } catch {
    return "—";
  }
}

function clockTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
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
  compact = false,
}: {
  portfolioTickers?: PortfolioTickerProp[];
  /** Conservé pour API — densifie le contenu des listes */
  compact?: boolean;
}) {
  const newsLimit = compact ? 3 : 4;
  const listLimit = compact ? 3 : INITIAL;

  const [newsMore, setNewsMore] = useState(false);
  const [macroMore, setMacroMore] = useState(false);
  const [earnMore, setEarnMore] = useState(false);
  const [macroFilter, setMacroFilter] =
    useState<MarketReleaseFilter>("upcoming");
  const [earnFilter, setEarnFilter] =
    useState<MarketReleaseFilter>("upcoming");

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
        `/api/news?limit=${newsLimit}`
      ),
    staleTime: 5 * 60_000,
  });

  const macroQ = useQuery({
    queryKey: ["macro-calendar"],
    queryFn: () =>
      fetchJson<{ events: MacroEvent[]; date: string }>("/api/macro"),
    staleTime: 5 * 60_000,
  });

  const earnQ = useQuery({
    queryKey: ["earnings-calendar", tickersParam],
    queryFn: () => {
      const q = new URLSearchParams({ limit: "10" });
      if (tickersParam) q.set("tickers", tickersParam);
      return fetchJson<{
        events: EarningsEvent[];
        date: string;
        source?: string;
      }>(`/api/earnings?${q.toString()}`);
    },
    staleTime: 5 * 60_000,
  });

  const newsAll = newsQ.data?.news ?? [];
  const macroAll = useMemo(
    () => filterMacroByRelease(macroQ.data?.events ?? [], macroFilter),
    [macroQ.data?.events, macroFilter]
  );
  const earnAll = useMemo(
    () => filterEarningsByRelease(earnQ.data?.events ?? [], earnFilter),
    [earnQ.data?.events, earnFilter]
  );

  const newsVisible = newsMore ? newsAll : newsAll.slice(0, listLimit);
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
          className="card flex min-h-0 min-w-0 flex-col p-3.5 sm:p-4"
          data-testid="market-tile-news"
        >
          <header className="mb-2.5 flex items-start gap-2">
            <Newspaper
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <div className="min-w-0">
              <h3 className="text-title">Actualités</h3>
              <p className="text-meta">Flux économique</p>
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
                  <li key={n.id} className="list-row-interactive py-1.5 first:pt-0 last:pb-0">
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-1.5 rounded-[var(--radius-sm)] px-0.5 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                    >
                      <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-[var(--foreground)] group-hover:text-[var(--primary)]">
                        {n.title}
                      </span>
                      <ExternalLink
                        className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted-foreground)] opacity-40 group-hover:opacity-100"
                        aria-hidden
                      />
                    </a>
                    <p className="text-meta mt-0.5">
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

          {newsAll.length > listLimit && (
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
          className="card flex min-h-0 min-w-0 flex-col p-3.5 sm:p-4"
          data-testid="market-cal-macro"
        >
          <header className="mb-2 flex items-start gap-2">
            <Landmark
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-title">Macroéconomie</h3>
              <p className="text-meta">Indicateurs clés</p>
            </div>
          </header>

          <ReleaseFilterBar
            value={macroFilter}
            onChange={(f) => {
              setMacroFilter(f);
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
                {macroFilter === "upcoming"
                  ? "Aucun indicateur à venir"
                  : "Aucune publication (24 h)"}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {macroVisible.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] px-0.5 py-1 text-xs sm:gap-2"
                  >
                    <span className="w-10 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                      {clockTime(e.time)}
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
                    {(e.actual || e.forecast) && (
                      <span className="w-full pl-12 text-[10px] text-[var(--muted-foreground)]">
                        {e.actual
                          ? `Réel ${e.actual}`
                          : e.forecast
                            ? `Cons. ${e.forecast}`
                            : ""}
                        {e.actual && e.forecast ? ` · cons. ${e.forecast}` : ""}
                      </span>
                    )}
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
          className="card flex min-h-0 min-w-0 flex-col p-3.5 sm:p-4 sm:col-span-2 lg:col-span-1"
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
              <p className="text-meta">
                {portfolioTickers.length > 0
                  ? "Priorité portefeuille"
                  : "Publications cotées"}
              </p>
            </div>
          </header>

          <ReleaseFilterBar
            value={earnFilter}
            onChange={(f) => {
              setEarnFilter(f);
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
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
                {earnFilter === "upcoming"
                  ? "Aucun résultat à venir"
                  : "Aucun résultat publié (24 h)"}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {earnVisible.map((e) => (
                  <li
                    key={e.id}
                    className={cn(
                      "rounded-[var(--radius-md)] border border-transparent px-1 py-1.5 text-xs",
                      e.inPortfolio &&
                        "border-[var(--primary-soft)] bg-[var(--primary-soft)]/40"
                    )}
                    data-in-portfolio={e.inPortfolio ? "true" : "false"}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-10 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                        {clockTime(e.time)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-[var(--foreground)]">
                          {e.companyName}
                        </span>
                        <span className="ml-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">
                          {e.ticker}
                        </span>
                      </span>
                      {e.inPortfolio && (
                        <span className="shrink-0 rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--primary)]">
                          Portefeuille
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">
                        {earningsTimingLabel(e.timing)}
                      </span>
                    </div>
                    {(e.epsEstimate || e.epsActual) && (
                      <p className="mt-0.5 pl-12 text-[10px] text-[var(--muted-foreground)]">
                        {e.epsActual
                          ? `EPS ${e.epsActual}`
                          : e.epsEstimate
                            ? `EPS att. ${e.epsEstimate}`
                            : ""}
                      </p>
                    )}
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
