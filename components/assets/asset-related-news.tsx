"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import type { NewsItem } from "@/app/lib/news/service";
import { cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const INITIAL = 3;
const EXPANDED = 6;

function formatNewsTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

/**
 * Encart compact d’actualités liées au ticker de la position.
 * Secondaire : entre graphe et historique, sans images ni cartes lourdes.
 */
export function AssetRelatedNews({
  ticker,
  enabled,
}: {
  ticker: string | null | undefined;
  enabled: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const t = (ticker || "").trim();

  const q = useQuery({
    queryKey: ["asset-news", t],
    enabled: enabled && t.length > 0,
    queryFn: () =>
      fetchJson<{ news: NewsItem[] }>(
        `/api/news?ticker=${encodeURIComponent(t)}&limit=${EXPANDED}`
      ),
    staleTime: 5 * 60_000,
  });

  if (!t) return null;

  if (q.isLoading) {
    return (
      <div
        className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-3"
        data-testid="asset-related-news"
        data-state="loading"
      >
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <div
        className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-2.5 text-[11px] text-[var(--muted-foreground)]"
        data-testid="asset-related-news"
        data-state="error"
      >
        Actualités indisponibles pour le moment.
      </div>
    );
  }

  const all = q.data?.news ?? [];
  if (all.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]"
        data-testid="asset-related-news"
        data-state="empty"
      >
        Aucune actualité liée à {t.toUpperCase()}.
      </div>
    );
  }

  const visible = showAll ? all.slice(0, EXPANDED) : all.slice(0, INITIAL);
  const hasMore = all.length > INITIAL;

  return (
    <section
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-3",
        "animate-in fade-in-0 slide-in-from-top-1 duration-200"
      )}
      data-testid="asset-related-news"
      data-state="ready"
      aria-label={`Actualités liées à ${t}`}
    >
      <div className="mb-2.5 flex items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
            Actualités liées
          </h3>
          <p className="text-meta">Contexte marché pour ce titre</p>
        </div>
        <span className="text-meta font-mono tabular-nums">{t.toUpperCase()}</span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {visible.map((n) => (
          <li key={n.id}>
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "group flex items-start gap-2 py-2 text-left transition",
                "hover:bg-[var(--muted)]/40 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                "rounded-[var(--radius-sm)] px-0.5"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-snug text-[var(--foreground)] group-hover:text-[var(--primary)]">
                  {n.title}
                </p>
                <p className="text-meta mt-0.5">
                  {n.source}
                  <span className="mx-1 opacity-40">·</span>
                  <time dateTime={n.publishedAt}>
                    {formatNewsTime(n.publishedAt)}
                  </time>
                </p>
              </div>
              <ExternalLink
                className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted-foreground)] opacity-50 group-hover:opacity-100"
                aria-hidden
              />
            </a>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
          data-testid="asset-news-see-more"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Voir moins" : "Voir plus"}
        </button>
      )}
    </section>
  );
}
