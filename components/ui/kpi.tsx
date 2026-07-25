"use client";

import { cn } from "@/app/lib/utils";

/**
 * Tuile KPI — hiérarchie : libellé discret → valeur forte.
 * Densité maîtrisée pour bandeaux 6–8 indicateurs.
 */
export function Kpi({
  icon,
  label,
  value,
  tone,
  testId,
  accent = false,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: string;
  tone?: "up" | "down";
  testId?: string;
  /**
   * Met la tuile en avant : fond teinté, liseré, valeur agrandie.
   * Réservé à l'indicateur de tête d'un bandeau — le patrimoine net avait
   * exactement le même poids visuel que sept autres tuiles, en dernière
   * position, alors que c'est le chiffre que l'on vient lire en premier.
   */
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "kpi-tile flex min-h-[5.25rem] min-w-0 flex-col justify-between gap-2 p-3 sm:p-3.5",
        accent &&
          "bg-[var(--primary-soft)] ring-1 ring-inset ring-[var(--primary)]/20",
        tone === "up" &&
          "border-l-[3px] border-l-[var(--success)]/80 dark:border-l-[var(--success)]/70",
        tone === "down" &&
          "border-l-[3px] border-l-[var(--danger)]/75 dark:border-l-[var(--danger)]/65"
      )}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="mt-0.5 shrink-0 text-[var(--muted-foreground)] opacity-75 [&_svg]:h-3.5 [&_svg]:w-3.5"
          aria-hidden
        >
          {icon}
        </span>
        <span className="text-label min-w-0 leading-snug break-words normal-case tracking-wide">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "kpi-value min-w-0 leading-none break-words",
          accent
            ? "text-[1.2rem] sm:text-xl xl:text-[1.4rem]"
            : "text-[1.05rem] sm:text-lg xl:text-[1.2rem]",
          tone === "up" && "text-[var(--success)]",
          tone === "down" && "text-[var(--danger)]",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  compact,
  tone,
}: {
  label: string;
  value: string;
  /** Densité réduite (cartes imbriquées) */
  compact?: boolean;
  /** Couleur de la valeur uniquement (P&L / %) */
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div className={cn("min-w-0", compact ? "space-y-0.5" : "space-y-1")}>
      <div
        className={cn(
          "text-label normal-case tracking-wide",
          compact && "text-[10px]"
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "kpi-value tabular-nums",
          compact ? "text-sm sm:text-base" : "text-lg",
          tone === "up" && "text-[var(--success)]",
          tone === "down" && "text-[var(--danger)]",
          (!tone || tone === "neutral") && "text-[var(--foreground)]"
        )}
      >
        {value}
      </div>
    </div>
  );
}
