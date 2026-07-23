"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, CalendarDays, Landmark } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import type {
  EarningsEvent,
  MacroEvent,
  MacroImpact,
} from "@/app/lib/news/service";
import {
  earningsTimingLabel,
  marketEventStatus,
} from "@/app/lib/news/service";
import { CountryFlag } from "@/components/ui/country-flag";
import { cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerNow } from "@/app/hooks/use-server-now";

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

const INITIAL_MACRO = 5;
const INITIAL_EARN = 5;
const INITIAL_MACRO_COMPACT = 3;
const INITIAL_EARN_COMPACT = 3;

/** Badge statut publié / à venir (bascule sur l'heure de Paris via horloge serveur). */
function StatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        published
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      )}
      data-status={published ? "published" : "upcoming"}
    >
      {published ? "Publié" : "À venir"}
    </span>
  );
}

export type PortfolioTickerProp = { ticker: string; name: string };

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

type CalTab = "macro" | "earnings";

/**
 * Calendrier de marché : macroéconomie + résultats d’entreprises.
 * Desktop = 2 cartes côte à côte · Mobile = onglets.
 */
export function MarketCalendarPanel({
  portfolioTickers = [],
  compact = false,
}: {
  /** Positions cotées du portefeuille (priorité résultats) */
  portfolioTickers?: PortfolioTickerProp[];
  compact?: boolean;
}) {
  const [tab, setTab] = useState<CalTab>("macro");
  const [macroExpanded, setMacroExpanded] = useState(false);
  const [earnExpanded, setEarnExpanded] = useState(false);
  const initialMacro = compact ? INITIAL_MACRO_COMPACT : INITIAL_MACRO;
  const initialEarn = compact ? INITIAL_EARN_COMPACT : INITIAL_EARN;

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

  const macroQ = useQuery({
    queryKey: ["macro-calendar"],
    queryFn: () =>
      fetchJson<{ events: MacroEvent[]; date: string; generatedAt?: string }>(
        "/api/macro"
      ),
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
        source?: "yahoo" | "finnhub" | "mixed" | "mock";
        generatedAt?: string;
      }>(`/api/earnings?${q.toString()}`);
    },
    staleTime: 5 * 60_000,
  });

  // Horloge synchronisée sur le serveur (NTP côté hébergeur) → bascule live
  // des statuts « Publié » quand l'horaire (Paris) est dépassé.
  const serverNow = useServerNow(
    macroQ.data?.generatedAt ?? earnQ.data?.generatedAt ?? null
  );

  const earnSourceLabel =
    earnQ.data?.source === "yahoo"
      ? "Source Yahoo Finance"
      : earnQ.data?.source === "finnhub"
        ? "Source Finnhub"
        : earnQ.data?.source === "mixed"
          ? "Sources Yahoo + Finnhub"
          : earnQ.data?.source === "mock"
            ? "Données illustratives"
            : null;

  const macroAll = macroQ.data?.events ?? [];
  const earnAll = earnQ.data?.events ?? [];
  const macroVisible = macroExpanded
    ? macroAll
    : macroAll.slice(0, initialMacro);
  const earnVisible = earnExpanded
    ? earnAll
    : earnAll.slice(0, initialEarn);

  return (
    <div data-testid="market-calendar-panel" className="min-w-0">
      <div className={cn("mb-1.5 px-0.5", compact && "mb-1")}>
        <h3
          className={cn(
            "font-semibold tracking-tight text-[var(--foreground)]",
            compact ? "text-[12px]" : "text-sm"
          )}
        >
          Calendrier de marché
        </h3>
        {!compact && (
          <p className="text-meta">Indicateurs et publications</p>
        )}
      </div>

      {/* Mobile : segmented control */}
      <div
        className="mb-2 flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/40 p-0.5 lg:hidden"
        role="tablist"
        aria-label="Type de calendrier"
      >
        {(
          [
            { id: "macro" as const, label: "Macroéconomie", icon: Landmark },
            {
              id: "earnings" as const,
              label: "Résultats",
              icon: Briefcase,
            },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`market-cal-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px] font-semibold transition",
                selected
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)]"
                  : "text-[var(--muted-foreground)]"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Desktop : 2 cartes · Mobile : panneau actif */}
      <div className="grid gap-3 lg:grid-cols-2">
        <CalendarCard
          className={cn(tab !== "macro" && "hidden lg:flex")}
          title="Macroéconomie"
          subtitle="Indicateurs & banques centrales"
          icon={Landmark}
          testId="market-cal-macro"
          loading={macroQ.isLoading}
          error={macroQ.isError}
          empty={!macroQ.isLoading && macroAll.length === 0}
          emptyLabel="Aucune annonce macro aujourd’hui"
          errorLabel="Calendrier macro indisponible"
        >
          <ul className="space-y-1.5">
            {macroVisible.map((e) => {
              const published = marketEventStatus(e.time, serverNow) === "published";
              const detail = published
                ? [
                    `Réel ${e.actual ?? "—"}`,
                    e.forecast ? `Cons. ${e.forecast}` : null,
                    e.previous ? `Préc. ${e.previous}` : null,
                  ]
                : [
                    e.forecast ? `Cons. ${e.forecast}` : null,
                    e.previous ? `Préc. ${e.previous}` : null,
                  ];
              const detailStr = detail.filter(Boolean).join(" · ");
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] px-1 py-1 text-xs sm:gap-2"
                  data-testid="macro-event"
                >
                  <span className="w-10 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                    {clockTime(e.time)}
                  </span>
                  <CountryFlag code={e.countryCode || e.country} showCode />
                  <span className="min-w-0 flex-1 leading-snug text-[var(--foreground)]">
                    {e.title}
                  </span>
                  <StatusBadge published={published} />
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                      IMPACT_CLASS[e.impact]
                    )}
                  >
                    {IMPACT_LABEL[e.impact]}
                  </span>
                  {detailStr && (
                    <span className="w-full text-[10px] text-[var(--muted-foreground)] sm:pl-12">
                      {detailStr}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {macroAll.length > initialMacro && (
            <button
              type="button"
              className="mt-2 text-[11px] font-medium text-[var(--primary)] hover:underline"
              data-testid="market-cal-macro-more"
              onClick={() => setMacroExpanded((v) => !v)}
            >
              {macroExpanded ? "Réduire" : "Voir tout"}
            </button>
          )}
        </CalendarCard>

        <CalendarCard
          className={cn(tab !== "earnings" && "hidden lg:flex")}
          title="Résultats des entreprises"
          subtitle={
            [
              portfolioTickers.length > 0
                ? "Priorité portefeuille"
                : "Ajoutez des positions pour filtrer",
              earnSourceLabel && !compact ? earnSourceLabel : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
          icon={Briefcase}
          testId="market-cal-earnings"
          loading={earnQ.isLoading}
          error={earnQ.isError}
          empty={!earnQ.isLoading && earnAll.length === 0}
          emptyLabel="Aucun résultat à l’affiche"
          errorLabel="Calendrier des résultats indisponible"
        >
          <ul className="space-y-1.5">
            {earnVisible.map((e) => {
              const published = marketEventStatus(e.time, serverNow) === "published";
              // Publié : résultat (EPS réel) + consensus. À venir : EPS attendu.
              const epsLine = published
                ? [
                    `EPS publié ${e.epsActual ?? "—"}`,
                    e.epsEstimate ? `cons. ${e.epsEstimate}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : e.epsEstimate
                  ? `EPS attendu ${e.epsEstimate}`
                  : "";
              return (
                <li
                  key={e.id}
                  className={cn(
                    "rounded-[var(--radius-md)] border border-transparent px-1.5 py-1.5 text-xs",
                    e.inPortfolio &&
                      "border-[var(--primary-soft)] bg-[var(--primary-soft)]/40"
                  )}
                  data-in-portfolio={e.inPortfolio ? "true" : "false"}
                  data-testid="earnings-event"
                >
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="w-10 shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                      {clockTime(e.time)}
                    </span>
                    <CountryFlag code={e.countryCode || "us"} showCode />
                    {e.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.logoUrl}
                        alt=""
                        width={20}
                        height={20}
                        loading="lazy"
                        className="h-5 w-5 shrink-0 rounded object-contain ring-1 ring-black/10 dark:ring-white/15"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-[var(--foreground)]">
                        {e.companyName}
                      </span>
                      <span className="ml-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">
                        {e.ticker}
                      </span>
                    </span>
                    <StatusBadge published={published} />
                    {e.inPortfolio && (
                      <span className="shrink-0 rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--primary)]">
                        Portefeuille
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">
                      {earningsTimingLabel(e.timing)}
                    </span>
                  </div>
                  {epsLine && (
                    <p className="mt-0.5 pl-12 text-[10px] text-[var(--muted-foreground)]">
                      {epsLine}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {earnAll.length > initialEarn && (
            <button
              type="button"
              className="mt-2 text-[11px] font-medium text-[var(--primary)] hover:underline"
              data-testid="market-cal-earnings-more"
              onClick={() => setEarnExpanded((v) => !v)}
            >
              {earnExpanded ? "Réduire" : "Voir tout"}
            </button>
          )}
        </CalendarCard>
      </div>
    </div>
  );
}

function CalendarCard({
  title,
  subtitle,
  icon: Icon,
  children,
  loading,
  error,
  empty,
  emptyLabel,
  errorLabel,
  testId,
  className,
}: {
  title: string;
  subtitle: string;
  icon: typeof CalendarDays;
  children: React.ReactNode;
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  emptyLabel: string;
  errorLabel: string;
  testId: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[8.5rem] flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--muted)]/15 p-2.5 sm:p-3",
        className
      )}
      data-testid={testId}
    >
      <div className="mb-2 flex items-start gap-2">
        <Icon
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[var(--foreground)]">
            {title}
          </p>
          <p className="text-meta">{subtitle}</p>
        </div>
      </div>
      {loading && (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex gap-2">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 flex-1" />
            </li>
          ))}
        </ul>
      )}
      {error && !loading && (
        <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">
          {errorLabel}
        </p>
      )}
      {empty && !loading && !error && (
        <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">
          {emptyLabel}
        </p>
      )}
      {!loading && !error && !empty && children}
    </div>
  );
}
