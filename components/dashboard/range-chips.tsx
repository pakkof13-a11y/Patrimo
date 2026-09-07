"use client";

import { cn } from "@/app/lib/utils";
import { EVOLUTION_RANGE_CHIPS } from "@/app/lib/ui/evolution-ranges";
import type { EvolutionRange } from "@/app/lib/portfolio/evolution-aggregate";

/**
 * La rangée de périodes — un seul rendu, deux emplacements.
 *
 * La carte de tête et le panneau Évolution portaient chacun leur copie. Elles
 * étaient identiques au caractère près, sauf la taille : le hero en `10px` et
 * des marges resserrées, le panneau en `11px`. Rien ne tenait les deux
 * ensemble, et deux rangées qui pilotent la **même** période s'étaient mises à
 * ne plus se ressembler — la plus petite devenant difficile à viser.
 *
 * Le composant est donc unique. Ce qui reste propre à chaque emplacement — le
 * préfixe de `data-testid`, que des tests visent nommément — est passé en
 * paramètre ; l'apparence, elle, n'est plus un paramètre.
 */
export function RangeChips({
  range,
  onRangeChange,
  rangeEnabled,
  testIdPrefix,
  ariaLabel = "Période",
  className,
}: {
  range: EvolutionRange;
  onRangeChange: (r: EvolutionRange) => void;
  /** Périodes que la profondeur d'historique couvre. Absent = activée. */
  rangeEnabled?: Partial<Record<EvolutionRange, boolean>>;
  /** `hero-range` ou `evolution-range` — les deux sont asservis par des tests. */
  testIdPrefix: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-0.5 sm:gap-1",
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
      data-testid={`${testIdPrefix}-toggle`}
      data-range={range}
    >
      {EVOLUTION_RANGE_CHIPS.map((r) => {
        const enabled = rangeEnabled?.[r.id] !== false;
        const selected = range === r.id;
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-disabled={!enabled}
            disabled={!enabled}
            title={
              enabled ? undefined : "Historique trop court pour cette période"
            }
            data-testid={`${testIdPrefix}-${r.id}`}
            data-active={selected ? "true" : "false"}
            onClick={() => enabled && onRangeChange(r.id)}
            className={cn(
              "rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium transition",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              !enabled &&
                "cursor-not-allowed bg-[var(--muted)]/40 text-[var(--muted-foreground)] opacity-40",
              enabled &&
                selected &&
                "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)]",
              enabled &&
                !selected &&
                "bg-[var(--muted)]/70 text-[var(--foreground)] hover:bg-[var(--muted)]"
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
