import { cn } from "@/app/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-700/60",
        className
      )}
      aria-hidden
    />
  );
}
