"use client";

import { cn } from "@/app/lib/utils";

export function Kpi({
  icon,
  label,
  value,
  tone,
  testId,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: string;
  tone?: "up" | "down";
  testId?: string;
}) {
  return (
    <div
      className="card flex min-h-[5.5rem] min-w-0 flex-col justify-between p-3 sm:p-4"
      data-testid={testId}
    >
      <div className="mb-2 flex min-w-0 items-start gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-xs">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 leading-snug break-words">{label}</span>
      </div>
      <div
        className={cn(
          "kpi-value min-w-0 text-base font-semibold leading-tight break-words sm:text-lg xl:text-xl",
          tone === "up" && "text-emerald-600 dark:text-emerald-400",
          tone === "down" && "text-red-600 dark:text-red-400",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="kpi-value text-lg font-semibold">{value}</div>
    </div>
  );
}
