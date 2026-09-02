"use client";

import { ArrowRight, CalendarClock, Lock } from "lucide-react";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import type { PlanView } from "@/app/lib/employee-savings/overview";
import type { FundCategory } from "@/app/lib/employee-savings/fund-category";

/**
 * Un plan d'épargne salariale, en carte.
 *
 * Un plan se comprend en trois secondes ou il ne se comprend pas : ce qu'il
 * vaut, comment il est réparti, quand il se débloque. Tout le reste — le détail
 * des lots, les codes ISIN, les modes de déblocage — vit dans la gestion.
 */

const TONE: Record<FundCategory, string> = {
  EQUITY: "var(--chart-gold)",
  DIVERSIFIED: "var(--chart-cyan)",
  BOND: "var(--chart-neutral)",
  MONETARY: "var(--chart-positive)",
  OTHER: "var(--foreground-faint)",
};

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

/**
 * Barre de répartition : un seul rail partagé, jamais plusieurs jauges.
 * C'est un partage à 100 % ; trois barres indépendantes laisseraient croire à
 * trois mesures indépendantes.
 */
function AllocationBar({ plan }: { plan: PlanView }) {
  const slices = plan.allocation.filter((a) => (a.sharePct ?? 0) > 0);
  if (slices.length === 0) {
    return (
      <div
        className="h-[0.4rem] w-full rounded-full bg-[var(--surface-sunken)]"
        aria-hidden
      />
    );
  }
  return (
    <div
      className="flex h-[0.4rem] w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      role="img"
      aria-label={slices
        .map(
          (s) =>
            `${s.label} ${(s.sharePct ?? 0).toLocaleString("fr-FR", {
              maximumFractionDigits: 0,
            })} %`
        )
        .join(", ")}
    >
      {slices.map((s) => (
        <span
          key={s.category}
          style={{ width: `${s.sharePct}%`, background: TONE[s.category] }}
        />
      ))}
    </div>
  );
}

function Line({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)]">
      <span className="text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
        {label}
      </span>
      <span
        className="num shrink-0 text-[length:var(--text-xs)] font-medium text-[var(--foreground)]"
        title={hint}
      >
        {value}
      </span>
    </div>
  );
}

export function EsPlanCard({
  plan,
  onOpen,
}: {
  plan: PlanView;
  onOpen: (planKey: string) => void;
}) {
  const gainUp = (plan.gain ?? 0) >= 0;

  return (
    /*
      La carte n'est pas un bouton : elle contient une barre de répartition et
      des listes, que le modèle de contenu interdit dans un élément interactif.
      C'est le titre qui porte le bouton, étendu à toute la carte par un
      pseudo-élément — un vrai contrôle au clavier, toute la surface à la souris.
    */
    <article
      className="panel panel--interactive relative flex min-w-0 flex-col p-[var(--pad-card)] focus-within:border-[var(--border-strong)]"
      data-testid="es-plan-card"
      data-plan-key={plan.key}
    >
      {/* ── Identité ───────────────────────────────────────────── */}
      <div className="flex min-w-0 items-start gap-[var(--space-3)]">
        <PlatformLogo name={plan.manager} size={32} />
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 flex-wrap items-baseline gap-[var(--space-2)] text-[length:var(--text-base)] font-medium text-[var(--foreground)]">
            <button
              type="button"
              onClick={() => onOpen(plan.key)}
              className={cn(
                "truncate text-left",
                "after:absolute after:inset-0 after:rounded-[var(--radius-lg)]",
                "focus-visible:outline focus-visible:outline-2",
                "focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              )}
              title={plan.title}
              aria-label={`Voir le détail du plan ${plan.title} — ${plan.manager}`}
              data-testid="es-plan-open"
            >
              {plan.title}
            </button>
            <span
              className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-2xs)] font-medium tracking-[var(--tracking-label)] text-[var(--foreground-secondary)]"
              data-testid="es-plan-type"
            >
              {plan.shortLabel}
            </span>
          </h3>
          <p className="text-meta truncate">{plan.manager}</p>
        </div>

        <span
          className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]"
          data-testid="es-plan-status"
        >
          Ouvert
        </span>
      </div>

      {/* ── Valeur ─────────────────────────────────────────────── */}
      <div className="mt-[var(--space-4)]">
        <p className="num text-[length:var(--text-2xl)] font-semibold leading-none text-[var(--foreground)]">
          {formatCurrency(plan.value, "EUR")}
        </p>
        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)]">
          {plan.gain != null ? (
            <span className={cn("num", gainUp ? "val-positive" : "val-negative")}>
              {formatSignedPct(plan.gainPct ?? 0)} ({gainUp ? "+" : "−"}
              {formatCurrency(Math.abs(plan.gain), "EUR")})
            </span>
          ) : (
            <span className="text-[var(--foreground-faint)]">
              Performance inconnue — versements non renseignés
            </span>
          )}
        </p>
      </div>

      {/* ── Répartition ────────────────────────────────────────── */}
      <div className="mt-[var(--space-4)]">
        <p className="text-label mb-[var(--space-2)]">Répartition</p>
        <AllocationBar plan={plan} />
        <div className="text-meta mt-[var(--space-2)] flex flex-wrap gap-x-[var(--space-3)] gap-y-[var(--space-1)]">
          {plan.allocation
            .filter((a) => (a.sharePct ?? 0) > 0)
            .map((a) => (
              <span key={a.category} className="whitespace-nowrap">
                {a.label}{" "}
                <span className="num text-[var(--foreground-secondary)]">
                  {(a.sharePct ?? 0).toLocaleString("fr-FR", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  %
                </span>
              </span>
            ))}
        </div>
      </div>

      {/* ── Repères ────────────────────────────────────────────── */}
      <div className="mt-[var(--space-4)] border-t border-[var(--border-subtle)] pt-[var(--space-2)]">
        <Line
          label="Versements cette année"
          value={
            plan.contributedThisYear != null
              ? formatCurrency(plan.contributedThisYear, "EUR")
              : "—"
          }
          hint={
            plan.contributedThisYear == null
              ? "Aucun montant versé renseigné sur ce plan"
              : undefined
          }
        />
        <Line
          label="Disponible"
          value={formatCurrency(plan.availableValue, "EUR")}
          hint="Part dont la date de déblocage est passée"
        />
        <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)]">
          <span className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
            {plan.nextUnlockDate ? (
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
            )}
            Prochain déblocage
          </span>
          <span className="num shrink-0 text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
            {plan.nextUnlockDate
              ? formatDate(plan.nextUnlockDate)
              : plan.hasRetirementLock
                ? "À la retraite"
                : "—"}
          </span>
        </div>
      </div>

      {/* ── Pied ───────────────────────────────────────────────── */}
      <p className="text-meta mt-[var(--space-3)] flex items-center justify-center gap-[var(--space-2)] border-t border-[var(--border-subtle)] pt-[var(--space-3)]">
        Voir le détail du plan
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </p>
    </article>
  );
}
