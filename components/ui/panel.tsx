"use client";

import { cn } from "@/app/lib/utils";

/**
 * En-tête de carte / section — titre + sous-titre + actions.
 * Alignement vertical bas sur desktop pour coller actions et titre.
 */
export function PanelHeader({
  title,
  subtitle,
  actions,
  as: Tag = "h3",
  className,
  titleId,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3" | "h4";
  className?: string;
  titleId?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
        className
      )}
    >
      <div className="min-w-0 max-w-2xl">
        <Tag
          id={titleId}
          className="text-title"
        >
          {title}
        </Tag>
        {subtitle != null && subtitle !== "" ? (
          <div className="text-meta mt-0.5">{subtitle}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * Contrôle segmenté (tabs compactes) — Global / Plateformes, Camembert / Mosaïque…
 */
export function SegmentedControl({
  "aria-label": ariaLabel,
  className,
  children,
  testId,
}: {
  "aria-label": string;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className={cn("segmented", className)}
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function SegmentedItem({
  selected,
  disabled,
  onClick,
  children,
  testId,
  className,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      onClick={onClick}
      className={cn("segmented-item", className)}
    >
      {children}
    </button>
  );
}

/**
 * Empty / erreur / placeholder centré dans une carte.
 */
export function EmptyPlaceholder({
  title,
  description,
  action,
  className,
  compact,
  testId,
  emptyKind,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
  testId?: string;
  /** Ex. filter | source | envelope — même nœud que data-testid pour e2e */
  emptyKind?: string;
}) {
  return (
    <div
      className={cn(
        "empty-placeholder",
        compact ? "py-6" : "py-10",
        className
      )}
      data-testid={testId}
      data-empty-kind={emptyKind}
    >
      <p className="empty-placeholder-title">{title}</p>
      {description ? (
        <p className="empty-placeholder-desc">{description}</p>
      ) : null}
      {action ? (
        <div className="empty-placeholder-actions">{action}</div>
      ) : null}
    </div>
  );
}
