import { cn } from "@/app/lib/utils";

/**
 * Placeholder de chargement — shimmer discret, tokens surface.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "skeleton-block rounded-[var(--radius-md)]",
        "bg-[var(--muted)] dark:bg-[var(--elevated)]",
        className
      )}
      aria-hidden
    />
  );
}

/** Bloc de chargement pour une carte dashboard (3 lignes). */
export function SkeletonLines({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("space-y-2", className)}
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-1/2" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Bandeau KPI (4–8 cartes). */
export function SkeletonKpiStrip({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid w-full min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]",
        className
      )}
      aria-busy="true"
      data-testid="skeleton-kpi-strip"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
        >
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-2 h-6 w-24" />
          <Skeleton className="mt-1.5 h-2 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Tableau Positions / Transactions. */
export function SkeletonTable({
  rows = 8,
  cols = 6,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]",
        className
      )}
      aria-busy="true"
      data-testid="skeleton-table"
    >
      <div className="flex gap-3 border-b border-[var(--border)] bg-[var(--table-head)] px-3 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-3", i === 0 ? "w-28" : "w-16 flex-1 max-w-[6rem]")}
          />
        ))}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="flex items-center gap-3 px-3 py-3"
          >
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 w-28" />
            {Array.from({ length: Math.max(0, cols - 2) }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn(
                  "h-3 flex-1",
                  c % 2 === 0 ? "max-w-[4.5rem]" : "max-w-[5.5rem]"
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Zone graphique (évolution / allocation). */
export function SkeletonChart({
  className,
  height = "h-64",
}: {
  className?: string;
  height?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-4",
        className
      )}
      aria-busy="true"
      data-testid="skeleton-chart"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <div className={cn("relative w-full overflow-hidden rounded-[var(--radius-md)]", height)}>
        <Skeleton className="absolute inset-0 opacity-60" />
        {/* Silhouette de courbe */}
        <div className="absolute inset-x-4 bottom-4 top-8 flex items-end gap-1.5 opacity-40">
          {[40, 55, 45, 70, 60, 80, 65, 90, 75, 85].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-[var(--muted-foreground)]/25"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Carte liste (news / calendrier). */
export function SkeletonListCard({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-3",
        className
      )}
      aria-busy="true"
      data-testid="skeleton-list-card"
    >
      <Skeleton className="mb-3 h-3.5 w-28" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <Skeleton className="h-4 w-10 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Fiche détail actif (header + graph + historique). */
export function SkeletonAssetDetail({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex flex-col gap-3", className)}
      aria-busy="true"
      data-testid="skeleton-asset-detail"
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-2.5 py-2">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-48" />
          </div>
        </div>
        <div className="space-y-1.5 text-right">
          <Skeleton className="ml-auto h-2.5 w-16" />
          <Skeleton className="ml-auto h-5 w-24" />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between gap-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
