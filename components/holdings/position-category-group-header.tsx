"use client";

import { ChevronDown } from "lucide-react";
import { formatCurrency, getChangeColor, cn } from "@/app/lib/utils";

/**
 * En-tête de groupe Positions (sous-catégorie).
 * Totaux fournis par le parent — pas de recalcul métier ici.
 */
export function PositionCategoryGroupHeader({
  label,
  count,
  totalMarketValue,
  totalUnrealizedPnl,
  weightPct,
  baseCurrency,
  expanded,
  onToggle,
  colSpan,
}: {
  label: string;
  count: number;
  totalMarketValue: number;
  totalUnrealizedPnl: number;
  weightPct: number | null;
  baseCurrency: string;
  expanded: boolean;
  onToggle: () => void;
  colSpan: number;
}) {
  const pnlColor = getChangeColor(totalUnrealizedPnl);
  const pnlSign =
    totalUnrealizedPnl > 0 ? "+" : totalUnrealizedPnl < 0 ? "−" : "";
  const pnlAbs = Math.abs(totalUnrealizedPnl);
  const weightText =
    weightPct != null && Number.isFinite(weightPct)
      ? `${weightPct.toLocaleString("fr-FR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} %`
      : "—";

  const countLabel =
    count === 1 ? "1 position" : `${count} positions`;

  return (
    <tr
      className="border-t border-[var(--border)] bg-slate-50/90 dark:bg-slate-900/60"
      data-testid={`category-group-header-${label}`}
    >
      <td colSpan={colSpan} className="px-2 py-2 sm:px-3">
        <button
          type="button"
          className={cn(
            "flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left transition",
            "hover:bg-teal-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 dark:hover:bg-teal-950/30"
          )}
          aria-expanded={expanded}
          onClick={onToggle}
          data-testid="category-group-toggle"
        >
          {/* Desktop */}
          <div className="hidden w-full items-center gap-3 sm:flex">
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-slate-500 transition-transform",
                !expanded && "-rotate-90"
              )}
              aria-hidden
            />
            <span className="min-w-[8rem] flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {label}
            </span>
            <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {countLabel}
            </span>
            <span className="min-w-[6.5rem] text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {formatCurrency(totalMarketValue, baseCurrency)}
            </span>
            <span
              className={cn(
                "min-w-[6.5rem] text-right text-sm font-medium tabular-nums",
                pnlColor
              )}
              aria-label={`P&L latent ${pnlSign}${formatCurrency(pnlAbs, baseCurrency)}`}
            >
              {pnlSign}
              {formatCurrency(pnlAbs, baseCurrency)}
            </span>
            <span className="min-w-[3.5rem] text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {weightText}
            </span>
          </div>
          {/* Mobile */}
          <div className="flex w-full items-start gap-2 sm:hidden">
            <ChevronDown
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform",
                !expanded && "-rotate-90"
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {label}
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  · {countLabel}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                <span className="font-semibold">
                  {formatCurrency(totalMarketValue, baseCurrency)}
                </span>
                <span className={pnlColor}>
                  {pnlSign}
                  {formatCurrency(pnlAbs, baseCurrency)}
                </span>
                <span className="text-slate-500">{weightText}</span>
              </div>
            </div>
          </div>
        </button>
      </td>
    </tr>
  );
}
