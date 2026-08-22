"use client";

/**
 * Ligne d'un plan d'épargne salariale.
 *
 * Les plans étaient des cartes de dix-huit centimètres de haut, deux par
 * rangée, et au-delà de six un bouton renvoyait vers la gestion. On ne pouvait
 * donc pas comparer quatre plans sans faire défiler — alors que la question
 * qu'on se pose ici est justement comparative : où est mon argent, et lequel
 * est disponible.
 *
 * La ligne porte les cinq colonnes qui répondent à cette question et rien de
 * plus. Le reste — supports, versements, échéances — se lit dans le panneau.
 */

import { PlatformLogo } from "@/components/ui/platform-logo";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { PlanView } from "@/app/lib/employee-savings/overview";

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
        maximumFractionDigits: digits,
      })} %`;

/**
 * Statut de disponibilité.
 *
 * Trois états, pas deux : un plan peut être partiellement disponible, et
 * l'écraser en « bloqué » ferait disparaître de l'argent auquel on a droit.
 */
function LiquidityDot({ plan }: { plan: PlanView }) {
  const label =
    plan.availableValue <= 0
      ? "Bloqué"
      : plan.blockedValue <= 0
        ? "Disponible"
        : "Partiel";
  const tone =
    plan.availableValue <= 0
      ? "var(--foreground-faint)"
      : plan.blockedValue <= 0
        ? "var(--success)"
        : "var(--primary)";

  return (
    <span className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: tone }}
        aria-hidden
      />
      {label}
      {plan.hasRetirementLock && plan.availableValue <= 0 ? (
        <span className="text-[var(--foreground-faint)]">· retraite</span>
      ) : null}
    </span>
  );
}

export function EsPlanRow({
  plan,
  selected,
  onSelect,
}: {
  plan: PlanView;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const availablePct =
    plan.value > 0 ? (plan.availableValue / plan.value) * 100 : null;

  return (
    <tr
      className={cn("es-plan-row", selected && "is-selected")}
      onClick={() => onSelect(plan.key)}
      aria-current={selected ? "true" : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(plan.key);
        }
      }}
      data-testid="es-plan-row"
    >
      <td>
        <span className="flex min-w-0 items-center gap-[var(--space-3)]">
          <PlatformLogo name={plan.manager} size={26} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-[var(--space-2)]">
              <span className="truncate font-medium text-[var(--foreground)]">
                {plan.title}
              </span>
              <span className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
                {plan.shortLabel}
              </span>
            </span>
            <span className="text-meta block truncate">{plan.manager}</span>
          </span>
        </span>
      </td>
      <td className="num text-right font-medium">
        {formatCurrency(String(plan.value), "EUR")}
      </td>
      <td className="num text-right">
        <span className="block">
          {formatCurrency(String(plan.availableValue), "EUR")}
        </span>
        <span className="text-meta block">
          {availablePct != null
            ? `${availablePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
            : ""}
        </span>
      </td>
      <td
        className={cn(
          "num text-right",
          plan.gainPct != null && plan.gainPct >= 0 && "val-positive",
          plan.gainPct != null && plan.gainPct < 0 && "val-negative"
        )}
      >
        {pctLabel(plan.gainPct)}
      </td>
      <td>
        <LiquidityDot plan={plan} />
      </td>
    </tr>
  );
}
