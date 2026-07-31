"use client";

import { FileText, PiggyBank, Settings2, TrendingUp } from "lucide-react";
import { PendingControl } from "@/components/ui/pending-backend";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import type {
  NextUnlock,
  OverviewTotals,
  RecentContribution,
} from "@/app/lib/employee-savings/overview";

/**
 * Colonne contextuelle.
 *
 * Elle accompagne la lecture sans la porter : aucun chiffre n'y est plus gros
 * que ceux des cartes KPI, et rien n'y apparaît qui ne soit déjà lisible
 * ailleurs. Ce qu'elle apporte est la mise en regard — l'encours face à ce qui
 * est bloqué, la prochaine échéance face à la date du jour.
 */

function Panel({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="panel" data-testid={testId}>
      <div className="panel-head">
        <h3 className="text-title">{title}</h3>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)]">
      <span className="text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
        {label}
      </span>
      <span
        className={cn(
          "num shrink-0 text-[length:var(--text-xs)] font-medium",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  icon: typeof PiggyBank;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] px-[var(--space-2)] py-[var(--space-2)] text-left text-[length:var(--text-xs)] text-[var(--foreground-secondary)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
      data-testid={testId}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

export function EsContextColumn({
  totals,
  unlock,
  operations,
  onAddLine,
  onManage,
  className,
}: {
  totals: OverviewTotals;
  unlock: NextUnlock | null;
  operations: RecentContribution[];
  onAddLine: () => void;
  onManage: () => void;
  className?: string;
}) {
  const availablePct = totals.availablePct ?? 0;

  return (
    <aside
      className={cn("flex min-w-0 flex-col gap-[var(--gap-card)]", className)}
      data-testid="es-context-column"
      aria-label="Contexte de l'épargne salariale"
    >
      <Panel title="Aperçu global" testId="es-context-overview">
        <Line
          label="Valeur totale"
          value={formatCurrency(totals.totalValue, "EUR")}
        />
        <Line
          label="Versements"
          value={
            totals.contributed != null
              ? formatCurrency(totals.contributed, "EUR")
              : "—"
          }
        />
        <Line
          label="Gains"
          value={
            totals.gain != null
              ? `${totals.gain >= 0 ? "+" : "−"}${formatCurrency(Math.abs(totals.gain), "EUR")}`
              : "—"
          }
          tone={
            totals.gain == null
              ? undefined
              : totals.gain >= 0
                ? "positive"
                : "negative"
          }
        />
        <Line label="Plans" value={String(totals.planCount)} />
      </Panel>

      <Panel title="Disponibilités" testId="es-context-liquidity">
        <Line
          label="Disponible"
          value={formatCurrency(totals.availableValue, "EUR")}
          tone="positive"
        />
        <Line
          label="Indisponible"
          value={formatCurrency(totals.blockedValue, "EUR")}
        />
        <div
          className="mt-[var(--space-3)] flex h-[0.4rem] w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
          role="img"
          aria-label={`Disponible ${formatCurrency(totals.availableValue, "EUR")} sur ${formatCurrency(totals.totalValue, "EUR")}`}
        >
          <span
            className="block h-full"
            style={{
              width: `${Math.min(100, Math.max(0, availablePct))}%`,
              background: "var(--chart-gold)",
            }}
          />
        </div>
        <p className="text-meta mt-[var(--space-2)]">
          L&apos;épargne salariale est bloquée par défaut — cinq ans sur un PEE,
          jusqu&apos;à la retraite sur un PER. Les cas de déblocage anticipé
          (mariage, logement, rupture) ne sont pas suivis ici.
        </p>
      </Panel>

      <Panel title="Fiscalité" testId="es-context-tax">
        {unlock ? (
          <>
            <Line
              label="Échéance prochaine"
              value={formatDate(unlock.dateIso)}
            />
            <Line
              label="Jours restants"
              value={`${unlock.daysAway.toLocaleString("fr-FR")} jours`}
            />
            <Line
              label="Montant concerné"
              value={formatCurrency(unlock.amount, "EUR")}
            />
          </>
        ) : (
          <p className="text-meta">
            Aucune échéance datée à venir : soit tout est déjà disponible, soit
            les sommes restent bloquées jusqu&apos;à la retraite.
          </p>
        )}
        <p className="text-meta mt-[var(--space-3)]">
          Les plus-values d&apos;un PEE échappent à l&apos;impôt sur le revenu à
          la sortie, mais pas aux prélèvements sociaux de 17,2 %.
        </p>
      </Panel>

      <Panel title="Dernières opérations" testId="es-context-operations">
        {operations.length === 0 ? (
          <p className="text-meta">
            Aucun versement daté. La date figure sur le relevé de votre
            gestionnaire ; elle commande aussi le calcul des cinq ans.
          </p>
        ) : (
          <ul className="min-w-0">
            {operations.map((op) => (
              <li
                key={op.id}
                className="flex items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border-subtle)] py-[var(--space-2)] last:border-0"
                data-testid="es-operation"
              >
                <div className="min-w-0">
                  <p className="truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                    {op.sourceLabel}
                  </p>
                  <p className="text-meta num truncate">
                    {formatDate(op.dateIso)} · {op.planLabel}
                  </p>
                </div>
                <span
                  className={cn(
                    "num shrink-0 text-[length:var(--text-xs)]",
                    op.amount != null
                      ? "val-positive"
                      : "text-[var(--foreground-faint)]"
                  )}
                >
                  {op.amount != null
                    ? `+${formatCurrency(op.amount, "EUR")}`
                    : "montant inconnu"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Actions rapides" testId="es-context-actions">
        <div className="flex flex-col gap-[var(--space-2)]">
          <QuickAction
            icon={PiggyBank}
            label="Effectuer un versement"
            onClick={onAddLine}
            testId="es-action-add"
          />
          <QuickAction
            icon={Settings2}
            label="Modifier l'épargne"
            onClick={onManage}
            testId="es-action-manage"
          />
          <PendingControl
            label="Consulter mes bulletins"
            hint="Aucun document n'est stocké par l'application"
          />
          <PendingControl
            label="Simuler ma retraite"
            hint="Demande un moteur de projection — âge, rente, fiscalité de sortie"
          />
          <p className="text-meta mt-[var(--space-1)] flex items-start gap-[var(--space-2)]">
            <TrendingUp className="mt-[0.15rem] h-3 w-3 shrink-0" aria-hidden />
            <span>
              Une projection de retraite suppose des hypothèses de rendement et
              d&apos;inflation : mieux vaut aucune estimation qu&apos;un chiffre
              posé au hasard sur trente ans.
            </span>
          </p>
          <p className="text-meta flex items-start gap-[var(--space-2)]">
            <FileText className="mt-[0.15rem] h-3 w-3 shrink-0" aria-hidden />
            <span>
              Les relevés de votre gestionnaire restent la référence en cas
              d&apos;écart.
            </span>
          </p>
        </div>
      </Panel>
    </aside>
  );
}
