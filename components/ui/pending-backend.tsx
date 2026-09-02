"use client";

import { Construction } from "lucide-react";
import { cn } from "@/app/lib/utils";

/**
 * Écran d'une fonctionnalité dont l'interface est prête et le back-end non.
 *
 * Il existe pour une raison précise : préparer le terrain sans mentir. Une
 * section « en attente » qui afficherait des documents fictifs ou un impôt
 * estimé au hasard serait pire que pas de section du tout — on finirait par
 * prendre une décision patrimoniale sur un chiffre inventé.
 *
 * Ce bloc annonce donc trois choses, et rien d'autre : ce que la section fera,
 * ce qui manque côté serveur, et — quand il y en a — ce que l'application sait
 * *déjà* et affiche pour de vrai juste à côté.
 */
export function PendingBackend({
  title,
  what,
  missing,
  className,
  testId,
  children,
}: {
  title: string;
  /** Ce que la section apportera une fois branchée. */
  what: string;
  /** Ce qui manque côté serveur, en une phrase compréhensible. */
  missing: string;
  className?: string;
  testId?: string;
  /** Maquette non interactive de l'écran cible, si elle éclaire le propos. */
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn("panel p-[var(--pad-card)]", className)}
      data-testid={testId ?? "pending-backend"}
      data-pending-backend="true"
    >
      <div className="flex items-start gap-[var(--space-3)]">
        <Construction
          className="mt-[var(--space-px)] h-4 w-4 shrink-0 text-[var(--primary-text)]"
          aria-hidden
        />
        <div className="min-w-0">
          <h3 className="text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
            {title}
          </h3>
          <p className="text-meta mt-[var(--space-1)]">{what}</p>
          <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] leading-normal text-[var(--foreground-faint)]">
            <span className="text-label">En attente&nbsp;·&nbsp;</span>
            {missing}
          </p>
        </div>
      </div>

      {children && (
        <div
          className="mt-[var(--space-4)] border-t border-[var(--border)] pt-[var(--space-4)]"
          data-testid="pending-backend-preview"
        >
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Contrôle d'un écran à venir : visible, à sa place définitive, et désactivé.
 *
 * Le laisser cliquable donnerait un formulaire qui ne sauvegarde rien ; le
 * retirer ferait perdre la maquette. `aria-disabled` plutôt que `disabled` :
 * le lecteur d'écran annonce alors le champ **et** son indisponibilité.
 */
export function PendingControl({
  label,
  hint,
  className,
}: {
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-label">{label}</div>
      <div
        aria-disabled
        className={cn(
          "mt-[var(--space-1)] flex h-9 items-center rounded-[var(--radius-md)]",
          "border border-dashed border-[var(--border-strong)] bg-[var(--surface-sunken)]",
          "px-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--foreground-faint)]"
        )}
      >
        {hint ?? "—"}
      </div>
    </div>
  );
}
