import { cn } from "@/app/lib/utils";

/**
 * Placeholder de chargement — pulse sobre, tokens surface.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "skeleton-block animate-pulse rounded-[var(--radius-md)]",
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
    <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-1/2" : "w-full")}
        />
      ))}
    </div>
  );
}
