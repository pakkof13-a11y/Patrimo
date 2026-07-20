"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";

export type WizardStep = {
  id: string;
  label: string;
  /** Description courte sous le titre d’étape */
  description?: string;
};

type FormWizardProps = {
  steps: WizardStep[];
  /** 0-based */
  current: number;
  onStepChange: (index: number) => void;
  /** Contenu de l’étape courante */
  children: React.ReactNode;
  /** Validation async avant Suivant / saut d’étape */
  onValidateStep?: (index: number) => boolean | Promise<boolean>;
  onNext?: () => void;
  onPrev?: () => void;
  onSaveDraft?: () => void;
  onCancel?: () => void;
  /** Bouton final (étape récap) */
  submitLabel?: string;
  onSubmit?: () => void;
  submitDisabled?: boolean;
  submitPending?: boolean;
  draftLabel?: string;
  className?: string;
  testId?: string;
};

/**
 * Shell multi-étapes : barre de progression + Précédent/Suivant + brouillon.
 * Compatible RHF (validation via onValidateStep → form.trigger).
 */
export function FormWizard({
  steps,
  current,
  onStepChange,
  children,
  onValidateStep,
  onNext,
  onPrev,
  onSaveDraft,
  onCancel,
  submitLabel = "Confirmer",
  onSubmit,
  submitDisabled,
  submitPending,
  draftLabel = "Sauvegarder en brouillon",
  className,
  testId = "form-wizard",
}: FormWizardProps) {
  const isFirst = current <= 0;
  const isLast = current >= steps.length - 1;
  const step = steps[current];

  async function goNext() {
    if (onValidateStep) {
      const ok = await onValidateStep(current);
      if (!ok) return;
    }
    if (isLast) {
      onSubmit?.();
      return;
    }
    onNext?.();
    onStepChange(Math.min(current + 1, steps.length - 1));
  }

  function goPrev() {
    onPrev?.();
    onStepChange(Math.max(current - 1, 0));
  }

  async function jumpTo(index: number) {
    if (index === current) return;
    // Retour libre ; avant, valider les étapes intermédiaires seulement si on avance
    if (index > current && onValidateStep) {
      for (let i = current; i < index; i++) {
        const ok = await onValidateStep(i);
        if (!ok) {
          onStepChange(i);
          return;
        }
      }
    }
    onStepChange(index);
  }

  return (
    <div className={cn("space-y-4", className)} data-testid={testId}>
      {/* Progress */}
      <nav aria-label="Étapes du formulaire" data-testid={`${testId}-progress`}>
        <ol className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s.id} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && (
                  <span
                    className="hidden h-px w-3 shrink-0 bg-[var(--border)] sm:block sm:w-5"
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  onClick={() => void jumpTo(i)}
                  className={cn(
                    "inline-flex max-w-[11rem] items-center gap-1.5 rounded-full px-2 py-1 text-left text-[11px] font-medium transition sm:max-w-none sm:px-2.5",
                    "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                    done &&
                      "bg-teal-500/15 text-teal-800 ring-1 ring-inset ring-teal-500/30 dark:text-teal-200",
                    active &&
                      "bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-teal-950",
                    !done &&
                      !active &&
                      "bg-[var(--muted)]/60 text-[var(--muted-foreground)] ring-1 ring-inset ring-[var(--border)]"
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                      active && "bg-white/20",
                      done && "bg-teal-600/20 dark:bg-teal-400/20",
                      !done && !active && "bg-[var(--card)]"
                    )}
                  >
                    {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
                  </span>
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {step?.description ? (
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">
            Étape {current + 1}/{steps.length}
            {step.description ? ` — ${step.description}` : ""}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            Étape {current + 1} sur {steps.length}
            {step ? ` · ${step.label}` : ""}
          </p>
        )}
      </nav>

      {/* Body */}
      <div
        className="min-h-[12rem] rounded-xl border border-[var(--border)] bg-[var(--card)]/40 p-3.5 sm:p-4"
        data-testid={`${testId}-body`}
      >
        {children}
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Annuler
          </Button>
        )}
        {onSaveDraft && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSaveDraft}
            data-testid={`${testId}-draft`}
            className="text-[var(--muted-foreground)]"
          >
            {draftLabel}
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={isFirst}
            data-testid={`${testId}-prev`}
          >
            Précédent
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void goNext()}
            disabled={isLast ? submitDisabled || submitPending : false}
            data-testid={isLast ? `${testId}-submit` : `${testId}-next`}
          >
            {isLast
              ? submitPending
                ? "…"
                : submitLabel
              : "Suivant"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Charge un brouillon JSON localStorage. */
export function loadWizardDraft<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveWizardDraft(key: string, data: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...((data as object) || {}), _savedAt: new Date().toISOString() })
    );
  } catch {
    /* quota */
  }
}

export function clearWizardDraft(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
