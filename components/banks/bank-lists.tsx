"use client";

/**
 * Listes de l'onglet Banques : synthèse par établissement, et table dense des
 * produits.
 *
 * Les deux ne font que **montrer**. Aucun champ de saisie ne s'y trouve : la
 * modification appartient au panneau de détail. C'est le renversement au cœur
 * de la refonte — la page sert à comprendre son exposition bancaire, pas à
 * éditer des soldes en permanence.
 */

import { ChevronRight } from "lucide-react";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { BankInstitution, BankProduct } from "@/app/lib/cash/bank-groups";
import type { BankSelection } from "@/components/banks/bank-types";

const KIND_LABELS: Record<BankProduct["kind"], string> = {
  CHECKING: "Courant",
  SAVINGS: "Épargne",
  TERM_DEPOSIT: "Terme",
};

const isSelected = (sel: BankSelection | null, kind: string, id: string) =>
  sel != null && sel.kind === kind && sel.id === id;

/**
 * Statut patrimonial d'un produit.
 *
 * Trois états seulement, et le vert est réservé au seul cas positif : un
 * compte qui compte. Un solde nul n'est pas une alerte — c'est une ligne au
 * repos, elle reste grise.
 */
function StatusDot({ product }: { product: BankProduct }) {
  if (product.isPro) {
    return (
      <span className="text-meta" title="Compte professionnel — hors patrimoine personnel">
        Pro
      </span>
    );
  }
  if (!product.countsInNetWorth) {
    return (
      <span className="text-meta" title="Solde à 0 : ignoré du patrimoine net">
        Hors patrimoine
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]"
      title="Ce produit entre dans le patrimoine net"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]"
        aria-hidden
      />
      Patrimoine
    </span>
  );
}

/* ── Vue d'ensemble : établissements ─────────────────────────────────── */

export function InstitutionList({
  institutions,
  baseCurrency,
  selection,
  onSelect,
}: {
  institutions: BankInstitution[];
  baseCurrency: string;
  selection: BankSelection | null;
  onSelect: (sel: BankSelection) => void;
}) {
  if (institutions.length === 0) {
    return (
      <p className="text-meta px-[var(--space-4)] py-[var(--space-6)] text-center">
        Aucun compte enregistré. Utilisez « Ajouter » pour créer un compte
        courant, un livret ou un dépôt à terme.
      </p>
    );
  }

  return (
    <ul data-testid="bank-institution-list">
      {institutions.map((inst) => (
        <li key={inst.key} className="bank-institution">
          <button
            type="button"
            className={cn(
              "bank-institution-head",
              isSelected(selection, "INSTITUTION", inst.key) && "is-selected"
            )}
            onClick={() => onSelect({ kind: "INSTITUTION", id: inst.key })}
            data-testid="bank-institution-row"
            aria-current={
              isSelected(selection, "INSTITUTION", inst.key) ? "true" : undefined
            }
          >
            <PlatformLogo name={inst.name} size={26} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
                {inst.name}
              </span>
              <span className="text-meta">
                {inst.accountCount}{" "}
                {inst.accountCount > 1 ? "produits" : "produit"}
              </span>
            </span>
            <span className="num shrink-0 text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
              {formatCurrency(String(inst.totalBase), baseCurrency)}
            </span>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-[var(--foreground-faint)]"
              aria-hidden
            />
          </button>

          <ul>
            {inst.products.map((p) => (
              <li key={`${p.kind}:${p.id}`}>
                <button
                  type="button"
                  className={cn(
                    "bank-product-row",
                    isSelected(selection, p.kind, p.id) && "is-selected"
                  )}
                  onClick={() => onSelect({ kind: p.kind, id: p.id } as BankSelection)}
                  data-testid="bank-product-row"
                  aria-current={
                    isSelected(selection, p.kind, p.id) ? "true" : undefined
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-left text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                    {p.name}
                    {p.ratePercent ? (
                      <span className="num ml-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--primary-text)]">
                        {Number(p.ratePercent).toLocaleString("fr-FR", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        %
                      </span>
                    ) : null}
                  </span>
                  <span className="num shrink-0 text-[length:var(--text-xs)] text-[var(--foreground)]">
                    {formatCurrency(p.balance, p.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/* ── Sous-onglets : table dense ──────────────────────────────────────── */

/**
 * Table des produits d'une catégorie.
 *
 * Six colonnes, pas quinze. Tout ce qui n'aide pas à comparer deux lignes —
 * périodicité, pénalité, part détenue — est allé dans le panneau de détail :
 * une table qu'il faut faire défiler horizontalement ne se compare plus.
 */
export function ProductTable({
  products,
  selection,
  onSelect,
  emptyLabel,
}: {
  products: BankProduct[];
  selection: BankSelection | null;
  onSelect: (sel: BankSelection) => void;
  emptyLabel: string;
}) {
  if (products.length === 0) {
    return (
      <p className="text-meta px-[var(--space-4)] py-[var(--space-6)] text-center">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="term-table" data-testid="bank-product-table">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Type</th>
            <th>Établissement</th>
            <th className="text-right">Solde</th>
            <th className="text-right">Rendement</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr
              key={`${p.kind}:${p.id}`}
              className={cn(
                "bank-table-row",
                isSelected(selection, p.kind, p.id) && "is-selected"
              )}
              onClick={() => onSelect({ kind: p.kind, id: p.id } as BankSelection)}
              data-testid="bank-table-row"
              aria-current={
                isSelected(selection, p.kind, p.id) ? "true" : undefined
              }
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect({ kind: p.kind, id: p.id } as BankSelection);
                }
              }}
            >
              <td className="font-medium text-[var(--foreground)]">{p.name}</td>
              <td className="text-[var(--foreground-secondary)]">
                {KIND_LABELS[p.kind]}
              </td>
              <td className="text-[var(--foreground-secondary)]">
                {p.bankName?.trim() || "—"}
              </td>
              <td className="num text-right font-medium">
                {formatCurrency(p.balance, p.currency)}
              </td>
              <td className="num text-right">
                {p.ratePercent
                  ? `${Number(p.ratePercent).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                  : "—"}
              </td>
              <td>
                <StatusDot product={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
