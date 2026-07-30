"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
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
  /** Variante "terminal" (Dashboard) : flèche de tendance au lieu du liseré coloré */
  variant = "default",
  /**
   * `secondary` recule la tuile d'un cran : les classes d'exposition ne
   * doivent pas peser autant que le résultat, la trésorerie et la dette,
   * qui sont les seuls chiffres réellement pilotables.
   */
  emphasis = "default",
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: string;
  tone?: "up" | "down";
  testId?: string;
  variant?: "default" | "terminal";
  emphasis?: "default" | "secondary";
}) {
  const terminal = variant === "terminal";
  const secondary = emphasis === "secondary";
  return (
    <div
      className={cn(
        "kpi-tile flex min-h-[5.25rem] min-w-0 flex-col justify-between gap-2 p-3 sm:p-3.5",
        secondary && "bg-[var(--surface-muted)]/40",
        !terminal &&
          tone === "up" &&
          "border-l-[3px] border-l-[var(--positive)]/80 dark:border-l-[var(--positive)]/70",
        !terminal &&
          tone === "down" &&
          "border-l-[3px] border-l-[var(--negative)]/75 dark:border-l-[var(--negative)]/65"
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
      <div className="flex min-w-0 items-center gap-1">
        <div
          className={cn(
            "kpi-value min-w-0 leading-none break-words",
            secondary
              ? "text-[0.95rem] sm:text-base xl:text-[1.05rem]"
              : "text-[1.05rem] sm:text-lg xl:text-[1.2rem]",
            tone === "up" && "text-[var(--positive)]",
            tone === "down" && "text-[var(--negative)]",
            !tone && "text-[var(--foreground)]"
          )}
        >
          {value}
        </div>
        {/*
          La flèche double la couleur pour la direction — un liseré vert seul
          ne dit rien à qui ne distingue pas les teintes.
        */}
        {terminal && tone === "up" && (
          <ArrowUpRight
            className="h-3.5 w-3.5 shrink-0 text-[var(--positive)]"
            aria-hidden
          />
        )}
        {terminal && tone === "down" && (
          <ArrowDownRight
            className="h-3.5 w-3.5 shrink-0 text-[var(--negative)]"
            aria-hidden
          />
        )}
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
          tone === "up" && "text-[var(--positive)]",
          tone === "down" && "text-[var(--negative)]",
          (!tone || tone === "neutral") && "text-[var(--foreground)]"
        )}
      >
        {value}
      </div>
    </div>
  );
}
