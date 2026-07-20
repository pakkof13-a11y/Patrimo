"use client";

import { cn } from "@/app/lib/utils";

/**
 * Champ de formulaire transverse — label, aide, erreur, optionnel.
 * Utiliser `htmlFor` + `id` sur l’input pour une association a11y stricte
 * (surtout avec RHF `register`).
 */
export function Field({
  label,
  children,
  hint,
  error,
  optional,
  htmlFor,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Aide contextuelle sous le champ */
  hint?: React.ReactNode;
  /** Message d’erreur (role=alert + aria-live) */
  error?: React.ReactNode;
  /** Affiche « optionnel » à côté du label */
  optional?: boolean;
  /** id de l’input contrôlé */
  htmlFor?: string;
  className?: string;
}) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;

  return (
    <div className={cn("block min-w-0 text-xs", className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1 flex flex-wrap items-baseline gap-1.5 font-medium text-[var(--foreground)]/85"
      >
        <span>{label}</span>
        {optional ? (
          <span className="font-normal text-[var(--muted-foreground)]">
            optionnel
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p
          id={hintId}
          className="mt-1 text-[10px] font-normal leading-snug text-[var(--muted-foreground)]"
        >
          {hint}
        </p>
      ) : null}
      {/* aria-live : annonce les erreurs aux lecteurs d’écran sans voler le focus */}
      <div aria-live="polite" aria-atomic="true">
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="mt-1 text-[11px] font-medium leading-snug text-[var(--danger)]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Rangée de CTA de formulaire (Annuler + primaire à droite). */
export function FormActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Section de formulaire scannable (modales / panneaux). */
export function FormSection({
  title,
  hint,
  children,
  step,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  step?: number;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/12 p-3.5",
        className
      )}
    >
      <header className="flex flex-wrap items-start gap-2">
        {step != null && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600/15 text-[10px] font-bold text-teal-800 dark:text-teal-200">
            {step}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <h4 className="text-label">{title}</h4>
          {hint ? (
            <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
              {hint}
            </p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}
