"use client";

import { cn } from "@/app/lib/utils";

/**
 * Ce qu'il reste du shell de module : la carte, son bandeau, sa bande
 * d'indicateurs et les deux classes de table.
 *
 * Employé par le journal des Transactions, la gestion de l'Épargne salariale
 * et `alternatives-shell`, qui le relaie aux cinq écrans Alternatifs. Ce n'est
 * plus un patron d'écran complet : l'en-tête de page et la tuile d'indicateur
 * qu'il portait ont disparu avec le dernier écran qui les employait, les
 * modules refondus écrivant leur en-tête en clair et passant par
 * `ui/kpi-tiles`.
 */

/** Carte module (journal, liste crédits, détail enveloppes…). */
export function ModuleCard({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn("card min-w-0 overflow-hidden", className)}
      data-testid={testId}
    >
      {children}
    </section>
  );
}

/** Bandeau titre + actions d’une ModuleCard. */
export function ModuleCardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5",
        className
      )}
    >
      <div className="min-w-0 max-w-2xl">
        <h3 className="text-title">{title}</h3>
        {subtitle != null && subtitle !== "" ? (
          <div className="text-meta mt-0.5 leading-relaxed">{subtitle}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** En-tête de table standard. */
export const moduleTableHeadClass =
  "table-head text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]";

/** Ligne hover standard. */
export const moduleTableRowClass =
  "border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35";

/** Zone KPI en bas d’en-tête de carte. */
export function ModuleKpiStrip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}
