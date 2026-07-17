"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FileUp,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import {
  onboardingStepCompletion,
  type DashboardMaturity,
  type OnboardingSignals,
} from "@/app/lib/dashboard/maturity";

type Props = {
  maturity: Extract<DashboardMaturity, "empty" | "setup">;
  signals: OnboardingSignals;
  onAddPlatform: () => void;
  onImport: () => void;
  onAddTransaction: () => void;
  showEveryStart?: boolean;
  onShowEveryStartChange?: (v: boolean) => void;
  className?: string;
};

/**
 * Zone d’activation du dashboard (comptes empty / setup).
 * Hiérarchie : promesse → progression → 3 étapes → CTA primaire unique.
 */
export function DashboardActivation({
  maturity,
  signals,
  onAddPlatform,
  onImport,
  onAddTransaction,
  showEveryStart = true,
  onShowEveryStartChange,
  className,
}: Props) {
  const progress = onboardingStepCompletion(signals);
  const isEmpty = maturity === "empty";

  const next: {
    label: string;
    hint: string;
    onClick: () => void;
    icon: ReactNode;
  } = !signals.hasPlatforms
    ? {
        label: "Créer ma première plateforme",
        hint: "Courtier, banque ou wallet — le conteneur de vos opérations.",
        onClick: onAddPlatform,
        icon: <Building2 className="h-4 w-4" />,
      }
    : !signals.hasTransactions
      ? {
          label: "Importer un CSV ou saisir un achat",
          hint: "Le journal de transactions alimente positions, CUMP et P&L.",
          onClick: onImport,
          icon: <FileUp className="h-4 w-4" />,
        }
      : {
          label: "Enregistrer une transaction",
          hint: "Affinez le journal : achats, ventes, dividendes, transferts…",
          onClick: onAddTransaction,
          icon: <Plus className="h-4 w-4" />,
        };

  const steps = [
    {
      id: "platform",
      done: progress.platform,
      title: "Plateforme",
      body: "Où se trouvent vos actifs ?",
      cta: signals.hasPlatforms ? "Gérer" : "Ajouter",
      onClick: onAddPlatform,
    },
    {
      id: "data",
      done: progress.data,
      title: "Journal",
      body: "Import CSV ou saisie manuelle.",
      cta: "Import / saisie",
      onClick: onImport,
    },
    {
      id: "portfolio",
      done: progress.portfolio,
      title: "Positions",
      body: "Calculées depuis les transactions.",
      cta: "Nouvel achat",
      onClick: onAddTransaction,
    },
  ] as const;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]",
        "ring-1 ring-[var(--primary-soft)]",
        className
      )}
      data-testid="dashboard-activation"
      data-maturity={maturity}
      aria-label={
        isEmpty ? "Bienvenue — démarrer Patrimo" : "Configuration en cours"
      }
    >
      <div className="border-b border-[var(--border)] px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-xl space-y-2">
            <p className="text-label inline-flex items-center gap-1.5 text-[var(--primary)]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {isEmpty ? "Votre cockpit patrimonial" : "Configuration en cours"}
            </p>
            <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-[1.35rem]">
              {isEmpty
                ? "Prenez le contrôle de votre patrimoine"
                : "Encore quelques pas pour activer le tableau de bord"}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
              {isEmpty
                ? "Patrimo construit positions, P&L et allocations à partir de votre journal. Commencez par une plateforme, puis importez ou saisissez vos opérations."
                : "Les modules d’analyse (courbes, allocations, actualité) s’afficheront dès que le journal et les positions seront en place — sans bruit inutile d’ici là."}
            </p>
            <p className="text-meta font-medium text-[var(--primary)]">
              Les transactions sont la source de vérité · quantités, CUMP et
              indicateurs en découlent.
            </p>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-2 sm:max-w-xs lg:items-end">
            <Button
              size="md"
              className="w-full justify-center gap-2 sm:w-auto"
              onClick={next.onClick}
              data-testid="dashboard-activation-primary-cta"
            >
              {next.icon}
              {next.label}
              <ArrowRight className="h-4 w-4 opacity-80" aria-hidden />
            </Button>
            <p className="text-center text-[11px] leading-snug text-slate-500 dark:text-slate-400 lg:text-right">
              {next.hint}
            </p>
            {onShowEveryStartChange && (
              <label
                className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"
                data-testid="onboarding-show-every-start"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                  checked={showEveryStart}
                  onChange={(e) => onShowEveryStartChange(e.target.checked)}
                />
                Rappeler l&apos;aide au démarrage
              </label>
            )}
          </div>
        </div>

        {/* Progression */}
        <div className="mt-5" data-testid="dashboard-activation-progress">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300">
            <span>
              Progression · {progress.doneCount}/{progress.total} étapes
            </span>
            <span className="tabular-nums text-teal-800 dark:text-teal-200">
              {progress.percent}&nbsp;%
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-950"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progression de configuration"
          >
            <div
              className="h-full rounded-full bg-teal-600 transition-[width] duration-300 ease-out dark:bg-teal-400"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      </div>

      <ol className="grid gap-0 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={cn(
              "flex flex-col gap-3 border-t border-teal-100/80 p-4 sm:border-t-0 sm:p-5",
              "dark:border-teal-900/30",
              i > 0 && "sm:border-l sm:border-teal-100/80 dark:sm:border-teal-900/30"
            )}
            data-testid={`onboarding-step-${step.id === "data" ? "import" : step.id === "portfolio" ? "transaction" : step.id}`}
            data-done={step.done ? "true" : "false"}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  step.done
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {step.title}
                </h3>
                <p className="mt-0.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
                  {step.body}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={step.done ? "outline" : i === progress.doneCount ? "default" : "outline"}
              className="mt-auto w-full justify-center text-xs"
              onClick={step.onClick}
              disabled={
                step.id !== "platform" &&
                !signals.hasPlatforms &&
                step.id !== "data"
              }
            >
              {step.cta}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
