"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";

/**
 * Shell métier transverse — Transactions, ES, Alternatifs, Passifs, Fiscalité.
 * Pattern : en-tête → KPI optionnels → barre d’outils / form → corps (table / empty).
 */

export function ModulePageHeader({
  title,
  subtitle,
  actions,
  className,
  testId,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <header
      className={cn(
        "module-page-header flex flex-wrap items-start justify-between gap-3",
        className
      )}
      data-testid={testId}
    >
      <div className="min-w-0 max-w-2xl">
        <h2 className="text-base font-semibold tracking-tight leading-snug text-[var(--foreground)]">
          {title}
        </h2>
        {subtitle != null && subtitle !== "" ? (
          <div className="module-intro text-meta">{subtitle}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

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

/** KPI synthèse (grille 2–4). */
export function ModuleKpi({
  label,
  value,
  hint,
  tip,
  valueClassName,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tip?: React.ReactNode;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("card p-3.5 sm:p-4", className)}>
      <div className="text-label flex items-center gap-1 normal-case tracking-wide">
        {label}
        {tip}
      </div>
      <div
        className={cn(
          "kpi-value mt-1 text-xl tracking-tight sm:text-2xl",
          valueClassName
        )}
      >
        {value}
      </div>
      {hint != null && hint !== "" ? (
        <div className="text-meta mt-1 leading-snug">{hint}</div>
      ) : null}
    </div>
  );
}

/** Encadré pédagogique (aide module / PFU / prélèvement). */
export function ModuleCallout({
  children,
  tone = "info",
  className,
  testId,
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "muted";
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-xl)] px-4 py-3 text-[11px] leading-relaxed",
        tone === "info" &&
          "border border-sky-500/20 bg-sky-500/[0.05] text-[var(--foreground)]/85",
        tone === "warn" &&
          "border border-amber-500/25 bg-amber-500/[0.06] text-amber-950/90 dark:text-amber-50/90",
        tone === "muted" &&
          "border border-[var(--border)] bg-[var(--muted)]/40 text-[var(--muted-foreground)]",
        className
      )}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/**
 * Empty guidé avec puces métier + CTA — pattern ES / Passifs / Alternatifs.
 */
export function ModuleGuidedEmpty({
  title,
  description,
  bullets,
  primaryLabel,
  onPrimary,
  primaryTestId,
  secondary,
  className,
  testId,
  compact,
}: {
  title: string;
  description: string;
  bullets?: string[];
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryTestId?: string;
  secondary?: React.ReactNode;
  className?: string;
  testId?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "empty-placeholder px-4",
        compact ? "py-6" : "py-10 sm:py-12",
        className
      )}
      data-testid={testId}
    >
      <p className="empty-placeholder-title">{title}</p>
      <p className="empty-placeholder-desc">{description}</p>
      {bullets && bullets.length > 0 ? (
        <ul className="mx-auto max-w-sm space-y-1.5 text-left text-[11px] text-[var(--muted-foreground)]">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--primary)]/70" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {(primaryLabel && onPrimary) || secondary ? (
        <div className="empty-placeholder-actions">
          {primaryLabel && onPrimary ? (
            <Button
              type="button"
              size="sm"
              onClick={onPrimary}
              data-testid={primaryTestId}
            >
              <Plus className="h-3.5 w-3.5" />
              {primaryLabel}
            </Button>
          ) : null}
          {secondary}
        </div>
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
