"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Newspaper, CalendarDays } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import type { MacroEvent, MacroImpact, NewsItem } from "@/app/lib/news/service";
import { CountryFlag } from "@/components/ui/country-flag";
import { cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

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

function NewsSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="space-y-1.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </li>
      ))}
    </ul>
  );
}

function MacroSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export function NewsMacroPanel() {
  const newsQ = useQuery({
    queryKey: ["news"],
    queryFn: () => fetchJson<{ news: NewsItem[]; source: string }>("/api/news?limit=6"),
    staleTime: 5 * 60_000,
  });

  const macroQ = useQuery({
    queryKey: ["macro-calendar"],
    queryFn: () =>
      fetchJson<{ events: MacroEvent[]; date: string; source: string }>("/api/macro"),
    staleTime: 5 * 60_000,
  });

  return (
    <div
      className="grid gap-4 lg:grid-cols-2"
      data-testid="news-macro-panel"
    >
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-teal-700 dark:text-teal-400" />
          <div>
            <h3 className="text-sm font-semibold">Actualités éco</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Dernières infos · sources mock (API prête pour un flux réel)
            </p>
          </div>
        </div>
        {newsQ.isLoading ? (
          <NewsSkeleton />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(newsQ.data?.news ?? []).map((n) => (
              <li key={n.id} className="py-2.5 first:pt-0 last:pb-0">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-snug text-slate-800 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                      {n.title}
                    </span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 opacity-0 transition group-hover:opacity-100" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {n.source}
                    </span>
                    <span>·</span>
                    <time dateTime={n.publishedAt}>{relativeTime(n.publishedAt)}</time>
                  </div>
                </a>
              </li>
            ))}
            {(newsQ.data?.news?.length ?? 0) === 0 && (
              <li className="py-6 text-center text-sm text-slate-500">Aucune actualité</li>
            )}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-teal-700 dark:text-teal-400" />
          <div>
            <h3 className="text-sm font-semibold">Calendrier macro</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Annonces du jour · impact Faible / Moyen / Fort
            </p>
          </div>
        </div>
        {macroQ.isLoading ? (
          <MacroSkeleton />
        ) : (
          <ul className="space-y-2">
            {(macroQ.data?.events ?? []).map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-2.5 py-2 text-sm"
              >
                <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {clockTime(e.time)}
                </span>
                <CountryFlag code={e.countryCode || e.country} showCode />
                <span className="min-w-0 flex-1 text-xs sm:text-sm">{e.title}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    IMPACT_CLASS[e.impact]
                  )}
                >
                  {IMPACT_LABEL[e.impact]}
                </span>
                {(e.forecast || e.previous) && (
                  <span className="w-full text-[10px] text-slate-500 dark:text-slate-400 sm:w-auto">
                    {e.forecast ? `Prév. ${e.forecast}` : ""}
                    {e.forecast && e.previous ? " · " : ""}
                    {e.previous ? `Préc. ${e.previous}` : ""}
                  </span>
                )}
              </li>
            ))}
            {(macroQ.data?.events?.length ?? 0) === 0 && (
              <li className="py-6 text-center text-sm text-slate-500">
                Aucune annonce aujourd&apos;hui
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
