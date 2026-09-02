"use client";

/**
 * Liste des crédits.
 *
 * Elle ne fait que **montrer**. Remboursement anticipé, changement de
 * mensualité, révision de taux et suppression vivent dans le panneau de
 * détail : la liste portait auparavant un menu d'actions par ligne et un
 * dépliant de détail, ce qui en faisait une console de gestion plutôt qu'une
 * lecture de la dette.
 *
 * Six colonnes, celles qui répondent aux quatre questions du module : combien
 * reste-t-il, combien cela coûte par mois, à quel taux, et jusqu'à quand.
 */

import { Building2, Car, CreditCard, Landmark, User, type LucideIcon } from "lucide-react";
import { formatCurrency } from "@/app/lib/utils";
import { DataRow } from "@/components/ui/data-row";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { LIABILITY_CATEGORY_LABELS } from "@/app/lib/constants";
import type { LiabilityView } from "@/app/lib/liabilities/overview";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  IMMOBILIER: Building2,
  AUTO: Car,
  CONSOMMATION: CreditCard,
  DETTE_PRIVEE: User,
  PROFESSIONNEL: Landmark,
};

const categoryLabel = (c: string) =>
  LIABILITY_CATEGORY_LABELS[c as keyof typeof LIABILITY_CATEGORY_LABELS] ?? c;

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;

/**
 * Fin du crédit — mois et année suffisent.
 *
 * Un jour précis sur une échéance projetée dans quinze ans donnerait une
 * fausse impression d'exactitude ; le suffixe « env. » signale ce qui vient
 * d'une estimation de durée plutôt que d'une date saisie.
 */
function EndDate({ view }: { view: LiabilityView }) {
  if (!view.endDate) return <span className="text-[var(--foreground-faint)]">—</span>;
  const label = new Date(view.endDate).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
  });
  return (
    <span>
      {view.endDateIsEstimated ? (
        <span className="text-[var(--foreground-faint)]">env. </span>
      ) : null}
      {label}
    </span>
  );
}

function StatusDot({ view }: { view: LiabilityView }) {
  const settled = view.status === "SETTLED";
  return (
    <span className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: settled ? "var(--success)" : "var(--primary)",
        }}
        aria-hidden
      />
      {settled ? "Soldé" : "En cours"}
    </span>
  );
}

export function LiabilityList({
  views,
  selectedId,
  onSelect,
}: {
  views: LiabilityView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="term-table" data-testid="liability-table">
        <thead>
          <tr>
            <th>Crédit</th>
            <th>Type</th>
            <th className="text-right">Capital restant dû</th>
            <th className="text-right">Mensualité</th>
            <th className="text-right">Taux</th>
            <th className="text-right">Fin prévue</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => {
            const Icon = CATEGORY_ICON[v.category] ?? Landmark;
            return (
              <DataRow
                key={v.id}
                selected={selectedId === v.id}
                onSelect={() => onSelect(v.id)}
                data-testid="liability-row"
              >
                <td>
                  <span className="flex min-w-0 items-center gap-[var(--space-3)]">
                    {/*
                      Le logo du prêteur quand il est identifié, l'icône de
                      catégorie sinon.

                      `PlatformLogo` est le composant déjà utilisé pour les
                      assureurs et les courtiers : il porte le câblage
                      logo.dev, la cascade de sources et le repli sur monogramme.
                      Le refaire ici aurait donné deux résolutions de domaine à
                      faire diverger.

                      `bankName` est du texte libre : c'est la même entrée que
                      pour un assureur d'assurance-vie, et la recherche par nom
                      est précisément ce que le composant sait faire.
                    */}
                    {v.lender ? (
                      <PlatformLogo
                        name={v.lender}
                        size={28}
                        className="shrink-0"
                      />
                    ) : (
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--foreground-secondary)]"
                        aria-hidden
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--foreground)]">
                        {v.name}
                      </span>
                      <span className="text-meta block truncate">
                        {v.lender ?? categoryLabel(v.category)}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="text-[var(--foreground-secondary)]">
                  {categoryLabel(v.category)}
                </td>
                <td className="num text-right font-medium">
                  {formatCurrency(String(v.remainingEur), "EUR")}
                </td>
                <td className="num text-right">
                  {v.totalMonthlyEur != null
                    ? formatCurrency(String(v.totalMonthlyEur), "EUR")
                    : "—"}
                </td>
                <td className="num text-right">{pctLabel(v.ratePct)}</td>
                <td className="num text-right">
                  <EndDate view={v} />
                </td>
                <td>
                  <StatusDot view={v} />
                </td>
              </DataRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
