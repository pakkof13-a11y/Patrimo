"use client";

/**
 * Table des lignes fiscales.
 *
 * Une ligne = une source d'imposition, quel que soit le moteur qui la calcule :
 * une enveloppe titres, l'IFI, un régime locatif, un dispositif de réduction.
 * Les rassembler dans une seule table est tout l'intérêt de cet écran — ils
 * vivaient jusqu'ici dans trois modules qui ne se parlaient pas.
 *
 * La colonne « Impôt estimé » reste vide quand le moteur ne le calcule pas.
 * Un tiret y est une information : il dit que personne ne connaît le chiffre,
 * là où un « 0 € » affirmerait qu'il n'y a rien à payer.
 */

import { formatCurrency, cn } from "@/app/lib/utils";
import { DataRow } from "@/components/ui/data-row";
import type { FiscalLine, FiscalValueStatus } from "@/app/lib/tax/overview";

const KIND_LABEL: Record<FiscalLine["kind"], string> = {
  ENVELOPE: "Valeurs mobilières",
  IFI: "Fortune immobilière",
  RENTAL: "Revenus fonciers",
  SCHEME: "Réduction d'impôt",
};

export function StatusTag({ status }: { status: FiscalValueStatus }) {
  if (status === "COMPUTED") return null;
  const label =
    status === "ESTIMATED"
      ? "Estimation"
      : status === "NOT_APPLICABLE"
        ? "Non simulé"
        : "Indisponible";
  return (
    <span
      className="ml-1.5 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-1)] py-[var(--space-px)] text-[length:var(--text-2xs)] text-[var(--foreground-faint)]"
      data-status={status}
    >
      {label}
    </span>
  );
}

/** Montant d'impôt, ou l'aveu qu'il n'est pas calculé. */
function TaxCell({ line }: { line: FiscalLine }) {
  if (line.taxEur == null) {
    return (
      <span
        className="text-[var(--foreground-faint)]"
        title="Ce régime n'est pas simulé par Aurea"
      >
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "num font-medium",
        line.taxEur < 0 ? "val-positive" : "text-[var(--foreground)]"
      )}
    >
      {formatCurrency(String(line.taxEur), "EUR")}
    </span>
  );
}

export function FiscalLineList({
  lines,
  selectedId,
  onSelect,
}: {
  lines: FiscalLine[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="term-table" data-testid="fiscal-lines-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Catégorie</th>
            <th>Régime</th>
            <th className="text-right">Assiette</th>
            <th className="text-right">Impôt estimé</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <DataRow
              key={l.id}
              selected={selectedId === l.id}
              onSelect={() => onSelect(l.id)}
              data-testid="fiscal-row"
              data-fiscal-row={l.id}
            >
              <td>
                <span className="font-medium text-[var(--foreground)]">
                  {l.label}
                </span>
                <span className="text-meta block">{l.detail}</span>
              </td>
              <td>
                <span className="text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
                  {KIND_LABEL[l.kind]}
                </span>
              </td>
              <td>
                <span className="inline-flex items-center text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
                  {l.regimeLabel}
                  <StatusTag status={l.status} />
                </span>
              </td>
              <td className="num text-right text-[var(--foreground-secondary)]">
                {l.baseEur == null
                  ? "—"
                  : formatCurrency(String(l.baseEur), "EUR")}
              </td>
              <td className="text-right">
                <TaxCell line={l} />
              </td>
            </DataRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
