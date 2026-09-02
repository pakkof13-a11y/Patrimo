"use client";

import { Shield } from "lucide-react";
import { PendingControl } from "@/components/ui/pending-backend";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import type { OverviewTotals } from "@/app/lib/life-insurance/overview";
import {
  annualAllowanceEur,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  SOCIAL_CHARGES_RATE,
  type TaxHousehold,
} from "@/app/lib/life-insurance/fiscal";
import type { TxRow } from "@/app/lib/types/ui";

/**
 * Colonne contextuelle.
 *
 * Elle accompagne la lecture, elle ne la porte pas : pas de graphique, pas de
 * chiffre plus gros que ceux des cartes KPI, aucune information qui n'ait sa
 * place ailleurs. Ce qu'elle apporte est la mise en regard — l'encours face au
 * seuil fiscal, les dernières opérations face à la valeur du jour.
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

export function AvContextColumn({
  totals,
  taxHousehold,
  matureCount,
  operations,
  operationsLoading,
  className,
}: {
  totals: OverviewTotals;
  taxHousehold: TaxHousehold;
  /** Contrats ayant dépassé huit ans. */
  matureCount: number;
  operations: TxRow[];
  operationsLoading: boolean;
  className?: string;
}) {
  const premiums = totals.totalPremiumsEur;
  const thresholdUsedPct =
    premiums > 0 ? (premiums / PFU_OUTSTANDING_THRESHOLD_EUR) * 100 : 0;

  return (
    <aside
      className={cn("flex min-w-0 flex-col gap-[var(--gap-card)]", className)}
      data-testid="av-context-column"
      aria-label="Contexte de l'assurance-vie"
    >
      <Panel title="Synthèse" testId="av-context-summary">
        <Line
          label="Encours"
          value={formatCurrency(totals.totalValueEur, "EUR")}
        />
        <Line
          label="Contrats"
          value={`${totals.contractCount}`}
        />
        <Line label="Supports" value={`${totals.supportCount}`} />
        <Line
          label="Plus-value latente"
          value={`${totals.unrealizedGainEur >= 0 ? "+" : "−"}${formatCurrency(Math.abs(totals.unrealizedGainEur), "EUR")}`}
          tone={totals.unrealizedGainEur >= 0 ? "positive" : "negative"}
        />
        {totals.unattachedSupportCount > 0 && (
          <p
            className="text-meta mt-[var(--space-2)] border-t border-[var(--border-subtle)] pt-[var(--space-2)]"
            data-testid="av-unattached-note"
          >
            {totals.unattachedSupportCount} support
            {totals.unattachedSupportCount > 1 ? "s" : ""} (
            {formatCurrency(totals.unattachedValueEur, "EUR")}) ne{" "}
            {totals.unattachedSupportCount > 1 ? "sont" : "est"} rattaché
            {totals.unattachedSupportCount > 1 ? "s" : ""} à aucun contrat : ces
            lignes comptent dans l&apos;encours, mais pas dans la fiscalité
            d&apos;un contrat précis.
          </p>
        )}
      </Panel>

      <Panel title="Statut fiscal" testId="av-context-tax">
        <Line
          label="Foyer"
          value={taxHousehold === "COUPLE" ? "Couple" : "Personne seule"}
        />
        <Line
          label="Abattement annuel"
          value={formatCurrency(annualAllowanceEur(taxHousehold), "EUR")}
        />
        <Line
          label="Prélèvements sociaux"
          value={`${(SOCIAL_CHARGES_RATE * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
        />
        <Line
          label="Contrats de plus de 8 ans"
          value={`${matureCount} / ${totals.contractCount}`}
        />

        {premiums > 0 ? (
          <div className="mt-[var(--space-3)]">
            <div className="text-meta mb-[var(--space-1)] flex justify-between">
              <span>Versements / seuil des 150 000 €</span>
              <span className="num">
                {thresholdUsedPct.toLocaleString("fr-FR", {
                  maximumFractionDigits: 0,
                })}{" "}
                %
              </span>
            </div>
            <div
              className="h-[0.35rem] w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
              role="img"
              aria-label={`Versements ${formatCurrency(premiums, "EUR")} sur un seuil de ${formatCurrency(PFU_OUTSTANDING_THRESHOLD_EUR, "EUR")}`}
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.min(100, thresholdUsedPct)}%`,
                  background:
                    thresholdUsedPct >= 100
                      ? "var(--chart-negative)"
                      : "var(--chart-gold)",
                }}
              />
            </div>
            <p className="text-meta mt-[var(--space-2)]">
              Le seuil porte sur les versements de tous vos contrats, jamais sur
              l&apos;encours : la performance des marchés ne change pas votre
              taux d&apos;imposition.
            </p>
          </div>
        ) : (
          <p className="text-meta mt-[var(--space-2)]">
            Aucun versement déclaré : sans eux, ni le seuil des 150 000 € ni le
            gain imposable ne peuvent être établis. Ils se saisissent contrat par
            contrat, dans la gestion.
          </p>
        )}
      </Panel>

      <Panel title="Bénéficiaires" testId="av-context-beneficiaries">
        <p className="text-meta mb-[var(--space-3)] flex items-start gap-[var(--space-2)]">
          <Shield className="mt-[0.15rem] h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            La clause bénéficiaire décide de qui reçoit les capitaux, et de
            l&apos;abattement dont chacun profite. Elle n&apos;est pas encore
            gérée par l&apos;application — rien n&apos;est donc affiché ici
            plutôt qu&apos;une clause supposée.
          </span>
        </p>
        <PendingControl
          label="Renseigner la clause"
          hint="Bénéficiaires, quotes-parts, rang de dévolution"
        />
      </Panel>

      <Panel title="Opérations récentes" testId="av-context-operations">
        {operationsLoading ? (
          <p className="text-meta">Chargement…</p>
        ) : operations.length === 0 ? (
          <p className="text-meta">
            Aucune opération sur l&apos;enveloppe. Un versement se saisit comme
            une transaction, sur une plateforme d&apos;assurance-vie.
          </p>
        ) : (
          <ul className="min-w-0">
            {operations.slice(0, 5).map((t) => (
              <li
                key={t.id}
                className="flex items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border-subtle)] py-[var(--space-2)] last:border-0"
                data-testid="av-operation"
              >
                <div className="min-w-0">
                  <p className="truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                    {t.asset?.name ?? "—"}
                  </p>
                  <p className="text-meta num">
                    {t.type} · {formatDate(t.occurredAt)}
                  </p>
                </div>
                <span className="num shrink-0 text-[length:var(--text-xs)]">
                  {formatCurrency(Number(t.grossAmountEur ?? 0), "EUR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/*
        Le bloc « Actions rapides » a disparu d'ici.

        Ouvrir un contrat, verser, ajouter un support : ces trois entrées sont
        désormais dans le menu « Ajouter » de l'en-tête, avec les mêmes cibles.
        Les garder aussi dans la colonne les faisait exister à deux endroits,
        et c'est le genre de doublon dont on finit par ne plus savoir lequel
        fait foi.
      */}
    </aside>
  );
}
