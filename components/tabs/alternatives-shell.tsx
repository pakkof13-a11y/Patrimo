"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyPlaceholder } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ModuleCard,
  ModuleCardHeader,
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
    <EmptyPlaceholder
      /*
        `sm:py-12` reprend la respiration que portait l'ancien enrobage :
        `EmptyPlaceholder` s'arrête à `py-10`, et ces états vides guidés
        occupent une carte entière plutôt qu'un coin de tableau.
      */
      className="sm:py-12"
      title={title}
      description={description}
      action={
        <>
          <Button type="button" size="sm" onClick={onPrimary} data-testid={primaryTestId}>
            <Plus className="h-3.5 w-3.5" />
            {primaryLabel}
          </Button>
          {secondary}
        </>
      }
    >
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
    </EmptyPlaceholder>
  );
}

/**
 * Tuile d'une bande d'indicateurs de famille.
 *
 * ## L'état de chargement
 *
 * Les appelants lisent leur donnée en `summary?.X ?? "0"` puis la formatent :
 * l'absence devient un montant nul *avant* d'atteindre cette tuile, qui n'a
 * donc aucun moyen de faire la différence. Elle a besoin qu'on le lui dise —
 * d'où `loading`, alimenté par la requête elle-même et non déduit de la
 * valeur reçue.
 *
 * Pendant le chargement, seuls le libellé et son infobulle restent : le
 * squelette prend la place de la valeur, la tonalité s'efface — affirmer une
 * tendance sur une donnée inconnue est faux — et la précision aussi, car
 * elle est calculée sur cette même donnée absente et dirait « Sur 0,00 €
 * investis » sous un squelette.
 *
 * Un zéro réel, lui, s'affiche comme un montant : c'en est un.
 */
export function AltMiniKpi({
  label,
  value,
  hint,
  tone,
  tip,
  loading = false,
}: {
  label: React.ReactNode;
  value: string;
  hint?: string;
  tone?: number;
  tip?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div
      className="min-w-0"
      data-loading={loading ? "true" : undefined}
      aria-busy={loading || undefined}
    >
      <div className="text-label flex items-center gap-1 normal-case tracking-wide">
        {label}
        {tip}
      </div>
      {loading ? (
        <Skeleton
          /*
            Au gabarit exact de la valeur — `text-sm` à l'échelle Aurea, soit
            17 px de hauteur de ligne. Un squelette plus haut de trois pixels
            suffit à faire descendre tout ce qui suit à l'arrivée des données.
          */
          className="mt-0.5 h-[1.0625rem] w-24"
        />
      ) : (
        <div
          className={cn(
            "mt-0.5 text-sm font-semibold tabular-nums tracking-tight",
            tone != null && tone !== 0 && getChangeColor(String(tone))
          )}
        >
          {value}
        </div>
      )}
      {hint ? (
        /*
          La précision est masquée pendant le chargement, mais garde sa place.

          `visibility: hidden` plutôt qu'un squelette : ces précisions tiennent
          sur une ou deux lignes selon leur longueur, et un squelette de
          hauteur fixe réserverait la mauvaise — les tuiles de Métaux
          gagnaient quinze pixels à l'arrivée des données. Le texte occupe
          exactement la place qu'il prendra, sans être lu ni annoncé.
        */
        <div
          className={cn(
            "mt-0.5 text-[10px] text-[var(--muted-foreground)]",
            loading && "invisible"
          )}
        >
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
