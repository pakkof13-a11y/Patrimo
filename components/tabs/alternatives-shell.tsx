"use client";

import {
  ModuleCard,
  ModuleCardHeader,
  ModuleGuidedEmpty,
  ModuleKpiStrip,
} from "@/components/ui/module-shell";
import { cn, getChangeColor } from "@/app/lib/utils";

/**
 * Shell UX partagé pour la section Actifs alternatifs.
 * S’appuie sur les primitives Module* pour rester aligné Transactions / ES / Passifs.
 */

export function AltModuleShell({
  testId,
  title,
  subtitle,
  action,
  kpis,
  formOpen,
  form,
  children,
}: {
  testId: string;
  title: string;
  subtitle: React.ReactNode;
  action?: React.ReactNode;
  kpis?: React.ReactNode;
  formOpen?: boolean;
  form?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ModuleCard testId={testId}>
      <ModuleCardHeader title={title} subtitle={subtitle} actions={action} />
      {kpis ? <ModuleKpiStrip>{kpis}</ModuleKpiStrip> : null}
      {formOpen && form ? form : null}
      {children}
    </ModuleCard>
  );
}

export function AltFormPanel({
  title,
  hint,
  children,
  actions,
  testId,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  actions: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="space-y-3 border-b border-[var(--primary)]/20 bg-[var(--primary-soft)] px-4 py-4 sm:px-5"
      data-testid={testId}
    >
      <header className="space-y-0.5">
        <h3 className="text-title text-sm">{title}</h3>
        {hint ? <p className="text-meta">{hint}</p> : null}
      </header>
      <div className="space-y-3">{children}</div>
      <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div>
    </div>
  );
}

export function AltFormSection({
  title,
  hint,
  children,
  cols = 3,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  cols?: 2 | 3;
}) {
  return (
    <section className="space-y-2.5 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)]/50 p-3">
      <header className="space-y-0.5">
        <h4 className="text-label">{title}</h4>
        {hint ? (
          <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
            {hint}
          </p>
        ) : null}
      </header>
      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2",
          cols === 3 && "lg:grid-cols-3"
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function AltField({
  label,
  hint,
  tip,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  tip?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0 text-xs", className)}>
      <span className="mb-1 flex items-center gap-1 font-medium text-[var(--foreground)]/85">
        {label}
        {tip}
      </span>
      {children}
      {hint ? (
        <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-foreground)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function AltEmptyState({
  title,
  description,
  bullets,
  primaryLabel,
  onPrimary,
  primaryTestId,
  secondary,
}: {
  title: string;
  description: string;
  bullets?: string[];
  primaryLabel: string;
  onPrimary: () => void;
  primaryTestId?: string;
  secondary?: React.ReactNode;
}) {
  return (
    <ModuleGuidedEmpty
      title={title}
      description={description}
      bullets={bullets}
      primaryLabel={primaryLabel}
      onPrimary={onPrimary}
      primaryTestId={primaryTestId}
      secondary={secondary}
    />
  );
}

export function AltMiniKpi({
  label,
  value,
  hint,
  tone,
  tip,
}: {
  label: React.ReactNode;
  value: string;
  hint?: string;
  tone?: number;
  tip?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-label flex items-center gap-1 normal-case tracking-wide">
        {label}
        {tip}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums tracking-tight",
          tone != null && tone !== 0 && getChangeColor(String(tone))
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function AltDashKpi({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "card p-4 text-left transition",
        onClick &&
          "cursor-pointer hover:border-[var(--primary)]/25 hover:bg-[var(--primary-soft)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
        active && "ring-1 ring-[var(--primary)]/35 bg-[var(--primary-soft)]"
      )}
    >
      <div className="text-label">{label}</div>
      <div
        className={cn(
          "kpi-value mt-1 text-xl tracking-tight",
          tone != null && tone !== 0 && getChangeColor(String(tone))
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="text-meta mt-1">{hint}</div>
      ) : null}
    </Comp>
  );
}
