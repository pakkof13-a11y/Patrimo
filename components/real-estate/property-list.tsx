"use client";

/**
 * Liste des biens immobiliers.
 *
 * Elle ne fait que **montrer**. Valorisation, régime fiscal et caractéristiques
 * physiques — soixante champs à eux trois — vivent dans le panneau de détail :
 * une liste qui porte ses formulaires n'est plus une liste, c'est un
 * formulaire répété autant de fois qu'il y a de biens.
 *
 * Six colonnes seulement, celles qui permettent de comparer deux biens :
 * valeur, dette, equity, rendement, cash-flow. Le reste se lit à droite.
 */

import { PlatformLogo } from "@/components/ui/platform-logo";
import { formatCurrency, cn } from "@/app/lib/utils";
import {
  propertyTypeLabel,
  propertyUsageLabel,
} from "@/app/lib/real-estate/constants";
import type {
  PropertyStatus,
  PropertyView,
} from "@/app/lib/real-estate/property-views";

const STATUS_LABEL: Record<PropertyStatus, string> = {
  RENTED: "Loué",
  PRIMARY: "Rés. principale",
  SECONDARY: "Secondaire",
  VACANT: "Vacant",
};

/**
 * Pastille de statut.
 *
 * Le vert est réservé au bien qui produit un revenu ; l'ambre signale un bien
 * locatif qui n'en produit pas — c'est la seule anomalie que cette liste ait à
 * signaler. Une résidence principale n'est ni l'un ni l'autre : elle reste
 * neutre, parce qu'elle n'a pas vocation à rapporter.
 */
function StatusDot({ status }: { status: PropertyStatus }) {
  const tone =
    status === "RENTED"
      ? "var(--success)"
      : status === "VACANT"
        ? "var(--warning, var(--danger))"
        : "var(--foreground-faint)";
  return (
    <span className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: tone }}
        aria-hidden
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;

const signedMonthly = (v: number | null) =>
  v == null
    ? "—"
    : `${v >= 0 ? "+" : "−"}${formatCurrency(String(Math.abs(v)), "EUR")}`;

export function PropertyList({
  views,
  selectedId,
  onSelect,
}: {
  views: PropertyView[];
  selectedId: string | null;
  onSelect: (assetId: string) => void;
}) {
  if (views.length === 0) {
    return (
      <p className="text-meta px-[var(--space-4)] py-[var(--space-6)] text-center">
        Aucun bien déclaré. Utilisez « Ajouter » pour enregistrer un bien
        immobilier.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="term-table" data-testid="property-table">
        <thead>
          <tr>
            <th>Bien</th>
            <th className="text-right">Valeur</th>
            <th className="text-right">Dette</th>
            <th className="text-right">Equity</th>
            <th className="text-right">Rendement</th>
            <th className="text-right">Cash-flow</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr
              key={v.assetId}
              className={cn(
                "property-row",
                selectedId === v.assetId && "is-selected"
              )}
              onClick={() => onSelect(v.assetId)}
              aria-current={selectedId === v.assetId ? "true" : undefined}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(v.assetId);
                }
              }}
              data-testid="property-row"
            >
              <td>
                <span className="flex min-w-0 items-center gap-[var(--space-3)]">
                  <PlatformLogo name={v.name} size={26} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[var(--foreground)]">
                      {v.name}
                    </span>
                    <span className="text-meta block truncate">
                      {propertyTypeLabel(v.propertyType)} ·{" "}
                      {propertyUsageLabel(v.usage)}
                      {v.city ? ` · ${v.city}` : ""}
                    </span>
                  </span>
                </span>
              </td>
              <td className="num text-right font-medium">
                {formatCurrency(String(v.shareValueEur), "EUR")}
              </td>
              <td className="num text-right">
                {v.debtEur > 0
                  ? formatCurrency(String(v.debtEur), "EUR")
                  : "—"}
              </td>
              <td className="num text-right">
                <span className="block font-medium">
                  {formatCurrency(String(v.equityEur), "EUR")}
                </span>
                <span className="text-meta block">
                  {v.equitySharePct != null
                    ? `${v.equitySharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                    : ""}
                </span>
              </td>
              <td className="num text-right">{pctLabel(v.grossYieldPct)}</td>
              <td
                className={cn(
                  "num text-right",
                  v.monthlyCashFlowEur != null &&
                    v.monthlyCashFlowEur >= 0 &&
                    "val-positive",
                  v.monthlyCashFlowEur != null &&
                    v.monthlyCashFlowEur < 0 &&
                    "val-negative"
                )}
              >
                {signedMonthly(v.monthlyCashFlowEur)}
              </td>
              <td>
                <StatusDot status={v.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
