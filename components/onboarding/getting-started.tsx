"use client";

import type { ReactNode } from "react";
import { Building2, FileUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";

export type OnboardingStepId = "platform" | "import" | "transaction";

/**
 * Onboarding « Bienvenue » :
 * - grand panneau tant que non masqué explicitement
 * - « Afficher à chaque démarrage » (coché par défaut) :
 *   Masquer = cache pour la visite ; F5 / prochain chargement → réaffiche
 * - case décochée + Masquer = ne réapparaît plus (localStorage)
 */
export function GettingStartedPanel({
  hasPlatforms,
  hasHoldings,
  hasTransactions,
  onAddPlatform,
  onImport,
  onAddTransaction,
  onDismiss,
  compact,
  className,
  showEveryStart = true,
  onShowEveryStartChange,
}: {
  hasPlatforms: boolean;
  hasHoldings: boolean;
  hasTransactions: boolean;
  onAddPlatform: () => void;
  onImport: () => void;
  onAddTransaction: () => void;
  onDismiss?: () => void;
  /** Mode bannière (utilisateur déjà activé) */
  compact?: boolean;
  className?: string;
  /** Afficher l'aide à chaque démarrage (coché par défaut) */
  showEveryStart?: boolean;
  onShowEveryStartChange?: (value: boolean) => void;
}) {
  const steps: Array<{
    id: OnboardingStepId;
    done: boolean;
    title: string;
    hint: string;
    icon: ReactNode;
    actionLabel: string;
    onAction: () => void;
    primary?: boolean;
  }> = [
    {
      id: "platform",
      done: hasPlatforms,
      title: "Ajouter une plateforme",
      hint: "Courtier, banque, wallet… d’où partent vos opérations.",
      icon: <Building2 className="h-4 w-4" />,
      actionLabel: hasPlatforms ? "Gérer" : "Créer une plateforme",
      onAction: onAddPlatform,
      primary: !hasPlatforms,
    },
    {
      id: "import",
      done: hasTransactions,
      title: "Importer un CSV ou saisir",
      hint: "Import courtier, ou une première transaction manuelle.",
      icon: <FileUp className="h-4 w-4" />,
      actionLabel: "Import CSV",
      onAction: onImport,
      primary: hasPlatforms && !hasTransactions,
    },
    {
      id: "transaction",
      done: hasTransactions || hasHoldings,
      title: "Enregistrer un achat",
      hint: "Les positions et le CUMP se calculent à partir du journal.",
      icon: <Plus className="h-4 w-4" />,
      actionLabel: "Nouvelle transaction",
      onAction: onAddTransaction,
    },
  ];

  const everyStartCheckbox = onShowEveryStartChange && (
    <label
      className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-teal-900/80 dark:text-teal-100/80"
      data-testid="onboarding-show-every-start"
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-teal-400 text-teal-700 focus:ring-teal-500"
        checked={showEveryStart}
        onChange={(e) => onShowEveryStartChange(e.target.checked)}
      />
      Afficher à chaque démarrage
    </label>
  );

  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200/60 bg-teal-50/50 px-3 py-2 text-xs dark:border-teal-900/40 dark:bg-teal-950/30",
          className
        )}
        data-testid="getting-started-compact"
      >
        <p className="text-teal-900/90 dark:text-teal-100/90">
          <strong>Découvrir Patrimo</strong> — plateforme, import CSV, premier
          achat. Les transactions sont la source de vérité.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {everyStartCheckbox}
          <Button size="sm" variant="outline" onClick={onAddTransaction}>
            Achat
          </Button>
          <Button size="sm" variant="outline" onClick={onImport}>
            Import
          </Button>
          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              data-testid="onboarding-dismiss"
              aria-label="Masquer l'aide"
            >
              <X className="h-3.5 w-3.5" />
              Masquer l&apos;aide
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "rounded-xl border border-teal-200/80 bg-gradient-to-br from-teal-50/90 to-white p-4 shadow-sm dark:border-teal-900/50 dark:from-teal-950/40 dark:to-slate-950",
        className
      )}
      data-testid="getting-started"
      aria-label="Premiers pas"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-teal-900 dark:text-teal-100">
            Bienvenue sur Patrimo
          </h2>
          <p className="mt-0.5 text-xs text-teal-800/80 dark:text-teal-200/70">
            Trois étapes pour suivre votre patrimoine. Les transactions sont la
            source de vérité (quantités, CUMP, P&amp;L dérivés).
          </p>
          {everyStartCheckbox && (
            <p className="mt-1.5 text-[11px] text-teal-800/70 dark:text-teal-200/60">
              {showEveryStart
                ? "Case cochée : l’aide réapparaît à chaque rechargement (F5)."
                : "Case décochée : après masquage, l’aide ne réapparaîtra plus au démarrage."}
            </p>
          )}
        </div>
        {everyStartCheckbox && (
          <div className="flex flex-col items-end gap-1.5">
            {everyStartCheckbox}
          </div>
        )}
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={cn(
              "flex flex-col rounded-lg border bg-white/80 p-3 dark:bg-slate-900/60",
              step.done
                ? "border-emerald-200 dark:border-emerald-900/50"
                : "border-[var(--border)]"
            )}
            data-testid={`onboarding-step-${step.id}`}
            data-done={step.done ? "true" : "false"}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                  step.done
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                {step.title}
              </span>
            </div>
            <p className="mb-3 flex-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              {step.hint}
            </p>
            <Button
              size="sm"
              variant={step.primary ? "default" : "outline"}
              className="w-full justify-center gap-1.5 text-xs"
              onClick={step.onAction}
              disabled={
                step.id !== "platform" && !hasPlatforms && step.id !== "import"
              }
            >
              {step.icon}
              {step.actionLabel}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Activé = a une plateforme ou au moins une transaction/position. */
export function isUserActivated(opts: {
  hasPlatforms: boolean;
  hasHoldings: boolean;
  hasTransactions: boolean;
}): boolean {
  return opts.hasPlatforms || opts.hasHoldings || opts.hasTransactions;
}

/**
 * Afficher le panneau d'aide.
 * - forceShow → toujours
 * - dismissed (uniquement après clic « Masquer l'aide ») → non
 * - sinon → oui (le parent affiche le grand panneau, pas de bascule auto)
 */
export function shouldShowOnboarding(opts: {
  hasPlatforms: boolean;
  hasHoldings: boolean;
  hasTransactions: boolean;
  dismissed?: boolean;
  forceShow?: boolean;
}): boolean {
  if (opts.forceShow) return true;
  if (opts.dismissed) return false;
  return true;
}
