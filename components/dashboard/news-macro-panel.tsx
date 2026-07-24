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
import {
  compareActualToConsensus,
  earningsTimingLabel,
  newsSourceLogoUrl,
} from "@/app/lib/news/service";
import {
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

const INITIAL = 5;

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
        upcoming: MacroEvent[];
        published: MacroEvent[];
        date: string;
        source?: string;
      }>("/api/macro"),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const earnQ = useQuery({
    queryKey: ["earnings-calendar", tickersParam],
    queryFn: () => {
      const q = new URLSearchParams({ limit: "10" });
      if (tickersParam) q.set("tickers", tickersParam);
      return fetchJson<{
        upcoming: EarningsEvent[];
        published: EarningsEvent[];
        date: string;
        source?: string;
      }>(`/api/earnings?${q.toString()}`);
    },
    staleTime: 5 * 60_000,
  });

  const newsAll = newsQ.data?.news ?? [];
  const macroAll = useMemo(
    () =>
      macroFilter === "upcoming"
        ? macroQ.data?.upcoming ?? []
        : macroQ.data?.published ?? [],
    [macroQ.data, macroFilter]
  );
  const earnAll = useMemo(
    () =>
      earnFilter === "upcoming"
        ? earnQ.data?.upcoming ?? []
        : earnQ.data?.published ?? [],
    [earnQ.data, earnFilter]
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
              <p className="text-meta">
                {macroQ.data &&
                "source" in (macroQ.data as { source?: string }) &&
                (macroQ.data as { source?: string }).source === "forexfactory"
                  ? "Calendrier du jour (live)"
                  : "Indicateurs du jour"}
              </p>
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
                    <div className="flex min-w-0 items-start gap-2 mb-1.5">
                      <span className="w-10 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                        {clockTime(e.time)}
                      </span>
                    </div>
                    <div className="flex min-w-0 gap-3">
                      <div className="relative shrink-0">
                        <CompanyLogo
                          src={e.logoUrl}
                          name={e.companyName}
                          ticker={e.ticker}
                          sizeClassName="h-10 w-10"
                          radiusClassName="rounded-lg"
                        />
                        <div className="absolute -bottom-0 -right-0">
                          <CountryFlag
                            code={e.countryCode || "us"}
                            showCode={false}
                            imgClassName="h-3 w-4"
                            className="px-0.5 py-0.5 shadow-sm ring-1 ring-white dark:ring-slate-900 bg-white dark:bg-slate-900 text-[10px]"
                          />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2 mb-1">
                          <span className="block truncate font-medium leading-tight text-[var(--foreground)]">
                            {e.companyName}
                          </span>
                          {e.inPortfolio && (
                            <span className="shrink-0 rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--primary)]">
                              Portefeuille
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center text-[10px]">
                          <span className="font-mono text-[var(--muted-foreground)]">
                            {e.ticker}
                          </span>
                          <span className="text-[var(--muted-foreground)]">·</span>
                          <span className="text-[var(--muted-foreground)]">
                            {earningsTimingLabel(e.timing)}
                          </span>
                        </div>
                        <EarningsFigures
                          estimate={e.epsEstimate}
                          actual={e.epsActual}
                          mode={earnFilter}
                        />
                      </div>
                    </div>
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
  equal: "text-sky-700 dark:text-sky-300 font-semibold",
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
  const [failed, setFailed] = useState(false);
  const size = sizeClassName === "h-10 w-10" ? 40 : 24;
  if (!src || failed) {
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
      src={src}
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
      onError={() => setFailed(true)}
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
      <p className="mt-0.5 pl-12 text-[10px] text-[var(--muted-foreground)]">
        <span className="font-medium">Cons.</span> EPS {estimate}
      </p>
    );
  }
  if (!actual && !estimate) return null;
  const cmp = compareActualToConsensus(actual, estimate);
  return (
    <p className="mt-0.5 pl-12 text-[10px] tabular-nums text-[var(--muted-foreground)]">
      <span className="font-medium">Cons.</span> {estimate?.trim() || "—"}
      {" · "}
      <span className="font-medium">Rés.</span>{" "}
      <span className={RESULT_COLOR[cmp]}>{actual?.trim() || "—"}</span>
    </p>
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
