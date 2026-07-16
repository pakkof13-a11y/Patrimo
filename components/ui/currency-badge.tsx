"use client";

import { currencyLabel, getCurrency } from "@/app/lib/money/currencies";
import { cn } from "@/app/lib/utils";

export function CurrencyBadge({
  code,
  className,
  /** @deprecated always shows CODE (symbol) like selectors — kept for API compat */
  showName = false,
}: {
  code: string;
  className?: string;
  showName?: boolean;
}) {
  const c = getCurrency(code);
  // Same format as selectors: EUR (€), USD ($), CHF (Fr.), …
  const label = currencyLabel(code);
  void showName;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
        className
      )}
      title={c.name}
    >
      <span className="tabular-nums whitespace-nowrap">{label}</span>
    </span>
  );
}
