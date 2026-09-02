"use client";

/**
 * Colonne de détail du produit bancaire sélectionné.
 *
 * Reprend exactement le principe du panneau d'actif de la page Portefeuille
 * (`components/holdings/asset-panel.tsx`) et sa classe `.asset-panel` : ancré
 * dans la grille en grand écran, superposé en tablette, plein écran en mobile.
 * Rien de tout cela n'est réécrit ici — un second système de panneaux latéraux
 * dans la même application n'aurait servi qu'à les faire diverger.
 *
 * C'est ce panneau qui porte l'édition. La liste, elle, ne fait plus que
 * montrer : les champs de saisie qui s'y alignaient auparavant transformaient
 * un écran de lecture du patrimoine en formulaire permanent.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  History,
  Landmark,
  PiggyBank,
  Timer,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Button } from "@/components/ui/button";
import { formatCurrency, cn } from "@/app/lib/utils";
import {
  REGULATED_PRODUCT_LABELS,
  type RegulatedProductType,
} from "@/app/lib/cash/regulated-products";
import {
  AccountHistoryModal,
  CeilingProgressBar,
  CurrencySelect,
  decimalEquals,
  EditableField,
  EVENT_LABELS,
  DOW_LABELS,
  MONTH_LABELS,
  type AccountEvent,
} from "@/components/banks/atoms";
import type {
  BankAccountRow,
  SavingsRow,
  TermDepositRow,
} from "@/components/banks/bank-types";
import type { BankInstitution } from "@/app/lib/cash/bank-groups";

/* ── Atomes de présentation ──────────────────────────────────────────── */

/**
 * Une ligne du bloc d'informations : intitulé discret à gauche, valeur alignée
 * à droite. Même forme que `Fact` dans le panneau d'actif, pour que les deux
 * fiches se lisent de la même façon.
 */
function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "positive" | "negative" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]">
      <dt className="text-label">{label}</dt>
      <dd
        className={cn(
          "num shrink-0 text-right text-[length:var(--text-xs)] font-medium",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          tone === "muted" && "text-[var(--foreground-faint)]",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-label mb-[var(--space-1)] mt-[var(--space-4)] first:mt-0">
      {children}
    </h3>
  );
}

/** Enveloppe d'un bloc du panneau — filet de séparation, jamais de carte. */
function Block({ children }: { children: React.ReactNode }) {
  return (
    <dl className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {children}
    </dl>
  );
}

function EditRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="py-[var(--space-2)]">
      <span className="text-label mb-[var(--space-1)] block">{label}</span>
      {children}
      {hint ? (
        <p className="mt-[var(--space-1)] text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const KIND_ICON: Record<string, LucideIcon> = {
  CHECKING: Wallet,
  SAVINGS: PiggyBank,
  TERM_DEPOSIT: Timer,
  INSTITUTION: Building2,
};

const pct = (v: string | null | undefined, digits = 2) =>
  v == null || v === ""
    ? "—"
    : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;

const dateFr = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/* ── Historique récent (4 derniers mouvements) ───────────────────────── */

/**
 * Aperçu de l'historique dans le panneau.
 *
 * Les événements sont produits côté serveur à chaque changement de solde
 * (`account-events.ts`) : ce que l'on montre ici est cohérent avec le solde
 * affiché au-dessus, ce qu'un journal éditable ne garantirait pas. Le panneau
 * n'en affiche que les derniers ; la fenêtre complète reste accessible.
 */
function RecentHistory({
  kind,
  accountId,
  currency,
  onOpenFull,
}: {
  kind: "banks" | "savings";
  accountId: string;
  currency: string;
  onOpenFull: () => void;
}) {
  const q = useQuery({
    queryKey: [kind, accountId, "events"],
    queryFn: () =>
      fetchJson<{ events: AccountEvent[] }>(`/api/${kind}/${accountId}/events`),
    staleTime: 30_000,
  });

  const events = (q.data?.events ?? []).slice(0, 4);

  return (
    <>
      <SectionTitle>Historique récent</SectionTitle>
      {q.isPending ? (
        <p className="text-meta py-[var(--space-2)]">Chargement…</p>
      ) : events.length === 0 ? (
        <p className="text-meta py-[var(--space-2)]">
          Aucun mouvement enregistré.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {events.map((e) => {
            const amount = Number(e.amount);
            return (
              <li
                key={e.id}
                className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                data-testid="bank-panel-history-row"
              >
                <div className="min-w-0">
                  <p className="truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                    {EVENT_LABELS[e.type] ?? e.type}
                  </p>
                  <p className="text-meta">
                    {new Date(e.occurredAt).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span
                  className={cn(
                    "num shrink-0 text-[length:var(--text-xs)] font-medium",
                    amount > 0 && "val-positive",
                    amount < 0 && "val-negative"
                  )}
                >
                  {amount > 0 ? "+" : ""}
                  {formatCurrency(e.amount, currency)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="mt-[var(--space-2)] inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)] transition-[color] hover:text-[var(--foreground)]"
        onClick={onOpenFull}
        data-testid="bank-panel-history-full"
      >
        <History className="h-3 w-3" aria-hidden />
        Voir l&apos;historique complet
      </button>
    </>
  );
}

/* ── Panneau ─────────────────────────────────────────────────────────── */

export type BankPanelTarget =
  | { kind: "CHECKING"; row: BankAccountRow }
  | { kind: "SAVINGS"; row: SavingsRow }
  | { kind: "TERM_DEPOSIT"; row: TermDepositRow }
  | { kind: "INSTITUTION"; institution: BankInstitution };

export function BankDetailPanel({
  target,
  baseCurrency,
  onClose,
  onPatchBank,
  onPatchSavings,
  onDelete,
  onSelectProduct,
  className,
}: {
  target: BankPanelTarget | null;
  baseCurrency: string;
  onClose: () => void;
  onPatchBank: (body: Record<string, string | boolean>) => void;
  onPatchSavings: (body: Record<string, string | boolean>) => void;
  onDelete: (target: BankPanelTarget) => void;
  /** Depuis la fiche d'un établissement, ouvrir l'un de ses produits. */
  onSelectProduct: (kind: string, id: string) => void;
  className?: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  /*
    Changer de produit referme l'historique.

    Le laisser ouvert afficherait les mouvements du compte précédent au-dessus
    de la fiche du suivant. Recalage pendant le rendu plutôt que dans un effet,
    comme le fait le panneau d'actif : React repart avec le bon état avant de
    peindre.
  */
  const targetId =
    target == null
      ? null
      : target.kind === "INSTITUTION"
        ? target.institution.key
        : target.row.id;
  const [seenId, setSeenId] = useState(targetId);
  if (targetId !== seenId) {
    setSeenId(targetId);
    setHistoryOpen(false);
  }

  if (!target) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="bank-detail-panel"
        data-open="false"
        aria-label="Détail du produit bancaire"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucun produit sélectionné
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez un établissement ou un compte pour afficher son détail ici.
            La liste reste en place.
          </p>
        </div>
      </aside>
    );
  }

  const Icon = KIND_ICON[target.kind] ?? Landmark;

  const head =
    target.kind === "INSTITUTION"
      ? {
          bankName: target.institution.name,
          title: target.institution.name,
          subtitle: `${target.institution.accountCount} ${
            target.institution.accountCount > 1 ? "produits" : "produit"
          }`,
          amount: formatCurrency(
            String(target.institution.totalBase),
            baseCurrency
          ),
        }
      : target.kind === "CHECKING"
        ? {
            bankName: target.row.bankName,
            title: target.row.bankName,
            subtitle: "Compte courant",
            amount: formatCurrency(target.row.balance, target.row.currency),
          }
        : target.kind === "SAVINGS"
          ? {
              bankName: target.row.bankName ?? target.row.name,
              title: target.row.name,
              subtitle: target.row.bankName ?? "Livret d'épargne",
              amount: formatCurrency(
                target.row.displayBalance,
                target.row.currency
              ),
            }
          : {
              bankName: target.row.bankName ?? "Dépôt à terme",
              title: target.row.bankName ?? "Dépôt à terme",
              subtitle: "Dépôt à terme",
              amount: formatCurrency(target.row.principal, target.row.currency),
            };

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="bank-detail-panel"
      data-open="true"
      aria-label="Détail du produit bancaire"
    >
      <div className="asset-panel-bar">
        <div className="flex min-w-0 items-center gap-[var(--space-2)]">
          <PlatformLogo name={head.bankName} size={22} />
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
              {head.title}
            </p>
            <p className="text-meta flex items-center gap-[var(--space-1)]">
              <Icon className="h-3 w-3" aria-hidden />
              {head.subtitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="bank-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="asset-panel-body">
        <p
          className="num text-[length:var(--text-2xl)] font-semibold tracking-tight text-[var(--foreground)]"
          data-testid="bank-panel-amount"
        >
          {head.amount}
        </p>

        {/* ── Établissement ────────────────────────────────────────── */}
        {target.kind === "INSTITUTION" && (
          <>
            <SectionTitle>Produits</SectionTitle>
            <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {target.institution.products.map((p) => (
                <li key={`${p.kind}:${p.id}`}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)] text-left transition-[color] hover:text-[var(--primary-text)]"
                    onClick={() => onSelectProduct(p.kind, p.id)}
                    data-testid="bank-panel-product-link"
                  >
                    <span className="min-w-0 truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                      {p.name}
                    </span>
                    <span className="num shrink-0 text-[length:var(--text-xs)] font-medium">
                      {formatCurrency(p.balance, p.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <SectionTitle>Informations</SectionTitle>
            <Block>
              <Fact label="Produits" value={target.institution.accountCount} />
              <Fact
                label="Encours total"
                value={formatCurrency(
                  String(target.institution.totalBase),
                  baseCurrency
                )}
              />
            </Block>
          </>
        )}

        {/* ── Compte courant ───────────────────────────────────────── */}
        {target.kind === "CHECKING" && (
          <CheckingBody
            row={target.row}
            onPatch={onPatchBank}
            onOpenHistory={() => setHistoryOpen(true)}
          />
        )}

        {/* ── Livret ───────────────────────────────────────────────── */}
        {target.kind === "SAVINGS" && (
          <SavingsBody
            row={target.row}
            onPatch={onPatchSavings}
            onOpenHistory={() => setHistoryOpen(true)}
          />
        )}

        {/* ── Dépôt à terme ────────────────────────────────────────── */}
        {target.kind === "TERM_DEPOSIT" && (
          <TermDepositBody row={target.row} baseCurrency={baseCurrency} />
        )}

        {target.kind !== "INSTITUTION" && (
          <>
            <SectionTitle>Actions</SectionTitle>
            <Button
              variant="danger"
              className="w-full"
              onClick={() => onDelete(target)}
              data-testid="bank-panel-delete"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Supprimer
            </Button>
          </>
        )}
      </div>

      {historyOpen && target.kind !== "INSTITUTION" && target.kind !== "TERM_DEPOSIT" && (
        <AccountHistoryModal
          kind={target.kind === "CHECKING" ? "banks" : "savings"}
          accountId={target.row.id}
          accountLabel={
            target.kind === "CHECKING" ? target.row.bankName : target.row.name
          }
          currency={target.row.currency}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );
}

/* ── Corps : compte courant ──────────────────────────────────────────── */

function CheckingBody({
  row,
  onPatch,
  onOpenHistory,
}: {
  row: BankAccountRow;
  onPatch: (body: Record<string, string | boolean>) => void;
  onOpenHistory: () => void;
}) {
  return (
    <>
      <SectionTitle>Informations</SectionTitle>
      <Block>
        <Fact label="Banque" value={row.bankName} />
        <Fact label="Type" value="Compte courant" />
        <Fact label="Devise" value={row.currency} />
        <Fact
          label="Part détenue"
          value={row.ownershipPct ? `${row.ownershipPct} %` : "100 %"}
        />
        <Fact
          label="Détention"
          value={row.ownershipPct ? "Compte joint" : "Individuel"}
        />
        <Fact
          label="Usage"
          value={row.isPro ? "Professionnel" : "Personnel"}
          tone={row.isPro ? "muted" : undefined}
        />
        <Fact
          label="Inclus patrim. net"
          value={row.countsInNetWorth ? "Oui" : "Non"}
          tone={row.countsInNetWorth ? "positive" : "muted"}
        />
      </Block>

      <RecentHistory
        kind="banks"
        accountId={row.id}
        currency={row.currency}
        onOpenFull={onOpenHistory}
      />

      <SectionTitle>Modifier</SectionTitle>
      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        <EditRow label="Solde">
          <EditableField
            key={`bal-${row.id}`}
            initialValue={row.balance}
            isEqual={decimalEquals}
            className="input w-full py-1.5 text-right"
            testId="bank-panel-balance"
            onCommit={(v) => onPatch({ id: row.id, balance: v || "0" })}
          />
        </EditRow>
        <EditRow label="Devise">
          <CurrencySelect
            value={row.currency}
            onChange={(c) => onPatch({ id: row.id, currency: c })}
            className="w-full"
          />
        </EditRow>
        <EditRow
          label="Part détenue (%)"
          hint="Vide = compte individuel, 100 % implicite."
        >
          <EditableField
            key={`own-${row.id}`}
            initialValue={row.ownershipPct ?? ""}
            className="input w-full py-1.5 text-right"
            type="number"
            min={0}
            max={100}
            onCommit={(v) => onPatch({ id: row.id, ownershipPct: v })}
          />
        </EditRow>
        <EditRow
          label="Compte professionnel"
          hint="Un compte pro n'entre pas dans le patrimoine personnel."
        >
          <label className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={row.isPro}
              onChange={(e) => onPatch({ id: row.id, isPro: e.target.checked })}
              data-testid="bank-panel-ispro"
            />
            Exclure du patrimoine personnel
          </label>
        </EditRow>
      </div>
    </>
  );
}

/* ── Corps : livret ──────────────────────────────────────────────────── */

function SavingsBody({
  row,
  onPatch,
  onOpenHistory,
}: {
  row: SavingsRow;
  onPatch: (body: Record<string, string | boolean>) => void;
  onOpenHistory: () => void;
}) {
  const accrued = Number(row.displayBalance) - Number(row.balance);
  const projectedAnnual =
    (Number(row.balance) * Number(row.apyPercent || "0")) / 100;

  return (
    <>
      <SectionTitle>Rendement</SectionTitle>
      <Block>
        <Fact
          label="Taux"
          value={`${pct(row.apyPercent)} ${row.rateType}`}
          tone="positive"
        />
        <Fact label="Périodicité" value={row.payoutRuleLabel} />
        {row.payoutFrequency === "WEEKLY" && row.payoutDayOfWeek != null && (
          <Fact label="Jour" value={DOW_LABELS[row.payoutDayOfWeek] ?? "—"} />
        )}
        {(row.payoutFrequency === "MONTHLY" ||
          row.payoutFrequency === "YEARLY") &&
          row.payoutDayOfMonth != null && (
            <Fact label="Jour du mois" value={row.payoutDayOfMonth} />
          )}
        {row.payoutFrequency === "YEARLY" && row.payoutMonth != null && (
          <Fact label="Mois" value={MONTH_LABELS[row.payoutMonth] ?? "—"} />
        )}
      </Block>

      <SectionTitle>Intérêts</SectionTitle>
      <Block>
        <Fact
          label="Courus"
          value={formatCurrency(String(accrued), row.currency)}
          tone={accrued > 0 ? "positive" : undefined}
        />
        <Fact
          label="Sur la période"
          value={formatCurrency(row.periodInterest, row.currency)}
        />
        <Fact
          label="Par jour"
          value={formatCurrency(row.dailyInterest, row.currency)}
        />
        <Fact
          label="Projection annuelle"
          value={formatCurrency(String(projectedAnnual), row.currency)}
        />
        <Fact label="Jours écoulés" value={row.daysElapsed} />
        <Fact
          label="Dernière capitalisation"
          value={dateFr(row.lastPayoutAt)}
        />
      </Block>

      {row.ceilingAmount ? (
        <>
          <SectionTitle>Plafond</SectionTitle>
          <CeilingProgressBar
            balance={row.balance}
            ceilingAmount={row.ceilingAmount}
            currency={row.currency}
          />
        </>
      ) : null}

      <SectionTitle>Informations</SectionTitle>
      <Block>
        <Fact
          label="Produit"
          value={
            REGULATED_PRODUCT_LABELS[row.productType as RegulatedProductType] ??
            row.productType
          }
        />
        <Fact label="Banque" value={row.bankName ?? "—"} />
        <Fact label="Devise" value={row.currency} />
        <Fact
          label="Part détenue"
          value={row.ownershipPct ? `${row.ownershipPct} %` : "100 %"}
        />
        <Fact label="Usage" value={row.isPro ? "Professionnel" : "Personnel"} />
        <Fact
          label="Inclus patrim. net"
          value={row.countsInNetWorth ? "Oui" : "Non"}
          tone={row.countsInNetWorth ? "positive" : "muted"}
        />
      </Block>

      <RecentHistory
        kind="savings"
        accountId={row.id}
        currency={row.currency}
        onOpenFull={onOpenHistory}
      />

      {/*
        Réglages avancés.

        Ils vivaient dans la liste, dépliés sous chaque ligne : quatre livrets
        ouverts et l'écran devenait un formulaire. Ils sont conservés à
        l'identique — aucune capacité n'est retirée — mais ils appartiennent à
        la fiche du produit, pas à la vue d'ensemble.
      */}
      <SectionTitle>Réglages</SectionTitle>
      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        <EditRow label="Solde">
          <EditableField
            key={`sbal-${row.id}`}
            initialValue={row.balance}
            isEqual={decimalEquals}
            className="input w-full py-1.5 text-right"
            testId="savings-panel-balance"
            onCommit={(v) => onPatch({ id: row.id, balance: v || "0" })}
          />
        </EditRow>
        <EditRow label="Taux (%)">
          <EditableField
            key={`rate-${row.id}`}
            initialValue={row.apyPercent}
            isEqual={decimalEquals}
            className="input w-full py-1.5 text-right"
            testId="savings-panel-rate"
            onCommit={(v) => onPatch({ id: row.id, apyPercent: v || "0" })}
          />
        </EditRow>
        <EditRow
          label="Nature du taux"
          hint="APR : linéaire. APY : composé, rétro-calculé."
        >
          <select
            className="input w-full py-1.5"
            value={row.rateType}
            onChange={(e) => onPatch({ id: row.id, rateType: e.target.value })}
            data-testid="savings-panel-ratetype"
          >
            <option value="APY">APY</option>
            <option value="APR">APR</option>
          </select>
        </EditRow>
        <EditRow label="Périodicité de versement">
          <select
            className="input w-full py-1.5"
            value={row.payoutFrequency}
            onChange={(e) =>
              onPatch({ id: row.id, payoutFrequency: e.target.value })
            }
            data-testid="savings-panel-frequency"
          >
            <option value="DAILY">Quotidienne</option>
            <option value="WEEKLY">Hebdomadaire</option>
            <option value="MONTHLY">Mensuelle</option>
            <option value="YEARLY">Annuelle</option>
          </select>
        </EditRow>
        {row.payoutFrequency === "WEEKLY" && (
          <EditRow label="Jour de la semaine">
            <select
              className="input w-full py-1.5"
              value={row.payoutDayOfWeek ?? 1}
              onChange={(e) =>
                onPatch({ id: row.id, payoutDayOfWeek: e.target.value })
              }
            >
              {DOW_LABELS.slice(1).map((l, i) => (
                <option key={l} value={i + 1}>
                  {l}
                </option>
              ))}
            </select>
          </EditRow>
        )}
        {(row.payoutFrequency === "MONTHLY" ||
          row.payoutFrequency === "YEARLY") && (
          <EditRow label="Jour du mois">
            <EditableField
              key={`dom-${row.id}`}
              initialValue={String(row.payoutDayOfMonth ?? 1)}
              className="input w-full py-1.5 text-right"
              type="number"
              min={1}
              max={31}
              onCommit={(v) => onPatch({ id: row.id, payoutDayOfMonth: v })}
            />
          </EditRow>
        )}
        {row.payoutFrequency === "YEARLY" && (
          <EditRow label="Mois">
            <select
              className="input w-full py-1.5"
              value={row.payoutMonth ?? 12}
              onChange={(e) =>
                onPatch({ id: row.id, payoutMonth: e.target.value })
              }
            >
              {MONTH_LABELS.slice(1).map((l, i) => (
                <option key={l} value={i + 1}>
                  {l}
                </option>
              ))}
            </select>
          </EditRow>
        )}
        <EditRow
          label="Plafond de versement"
          hint="Hors intérêts capitalisés. Vide = pas de plafond."
        >
          <EditableField
            key={`ceil-${row.id}`}
            initialValue={row.ceilingAmount ?? ""}
            className="input w-full py-1.5 text-right"
            testId="savings-panel-ceiling"
            onCommit={(v) => onPatch({ id: row.id, ceilingAmount: v })}
          />
        </EditRow>
        <EditRow label="Devise">
          <CurrencySelect
            value={row.currency}
            onChange={(c) => onPatch({ id: row.id, currency: c })}
            className="w-full"
          />
        </EditRow>
        <EditRow label="Part détenue (%)">
          <EditableField
            key={`sown-${row.id}`}
            initialValue={row.ownershipPct ?? ""}
            className="input w-full py-1.5 text-right"
            type="number"
            min={0}
            max={100}
            onCommit={(v) => onPatch({ id: row.id, ownershipPct: v })}
          />
        </EditRow>
        <EditRow label="Livret professionnel">
          <label className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={row.isPro}
              onChange={(e) => onPatch({ id: row.id, isPro: e.target.checked })}
            />
            Exclure du patrimoine personnel
          </label>
        </EditRow>
      </div>
    </>
  );
}

/* ── Corps : dépôt à terme ───────────────────────────────────────────── */

/**
 * Frise d'échéance.
 *
 * Un dépôt à terme se lit d'abord par le temps qu'il lui reste : c'est ce qui
 * détermine si le capital est mobilisable. La proportion écoulée est bornée à
 * l'intervalle [0, 1] — un dépôt échu depuis six mois remplit la barre, il ne
 * la dépasse pas.
 */
function MaturityTimeline({ row }: { row: TermDepositRow }) {
  /*
    La proportion écoulée se déduit de `daysUntilMaturity`, que la route
    calcule déjà, plutôt que de l'horloge du navigateur : lire l'heure pendant
    le rendu rendrait le composant impur, et le serveur et le client
    pourraient dessiner deux barres différentes.
  */
  const opened = Date.parse(row.openedAt);
  const matures = Date.parse(row.maturityDate);
  const spanDays = (matures - opened) / 86_400_000;
  const elapsedDays = spanDays - row.daysUntilMaturity;
  const ratio =
    Number.isFinite(spanDays) && spanDays > 0
      ? Math.min(1, Math.max(0, elapsedDays / spanDays))
      : row.status === "MATURED"
        ? 1
        : 0;
  const matured = row.status === "MATURED" || row.daysUntilMaturity <= 0;

  return (
    <div className="py-[var(--space-2)]">
      <div className="mb-[var(--space-2)] flex items-baseline justify-between gap-[var(--space-2)]">
        <span
          className={cn(
            "text-[length:var(--text-xs)] font-medium",
            matured ? "val-negative" : "text-[var(--foreground)]"
          )}
          data-testid="term-deposit-countdown"
        >
          {matured
            ? "Arrivé à échéance"
            : `Échéance dans ${row.daysUntilMaturity} jour${row.daysUntilMaturity > 1 ? "s" : ""}`}
        </span>
        <span className="text-meta num">{dateFr(row.maturityDate)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="h-full rounded-full bg-[var(--primary)] transition-[width]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="mt-[var(--space-1)] flex justify-between">
        <span className="text-meta num">{dateFr(row.openedAt)}</span>
        <span className="text-meta">
          {matured ? "échu" : `${Math.round(ratio * 100)} % écoulé`}
        </span>
      </div>
    </div>
  );
}

function TermDepositBody({
  row,
  baseCurrency,
}: {
  row: TermDepositRow;
  baseCurrency: string;
}) {
  return (
    <>
      <SectionTitle>Échéance</SectionTitle>
      <div className="border-y border-[var(--border)]">
        <MaturityTimeline row={row} />
      </div>

      <SectionTitle>Informations</SectionTitle>
      <Block>
        <Fact label="Banque" value={row.bankName ?? "—"} />
        <Fact
          label="Principal"
          value={formatCurrency(row.principal, row.currency)}
        />
        {row.currency !== baseCurrency && (
          <Fact
            label={`Contre-valeur (${baseCurrency})`}
            value={formatCurrency(row.principalBase, baseCurrency)}
          />
        )}
        <Fact label="Taux" value={pct(row.ratePercent)} tone="positive" />
        <Fact label="Devise" value={row.currency} />
        <Fact label="Ouverture" value={dateFr(row.openedAt)} />
        <Fact label="Échéance" value={dateFr(row.maturityDate)} />
        <Fact
          label="Pénalité retrait anticipé"
          value={pct(row.earlyWithdrawalPenaltyPct)}
          tone={row.earlyWithdrawalPenaltyPct ? "negative" : "muted"}
        />
        <Fact
          label="Statut"
          value={row.status === "ACTIVE" ? "Actif" : "Échu"}
          tone={row.status === "ACTIVE" ? "positive" : "muted"}
        />
        <Fact
          label="Part détenue"
          value={row.ownershipPct ? `${row.ownershipPct} %` : "100 %"}
        />
        <Fact label="Usage" value={row.isPro ? "Professionnel" : "Personnel"} />
      </Block>

      {row.notes ? (
        <>
          <SectionTitle>Notes</SectionTitle>
          <p className="border-y border-[var(--border)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
            {row.notes}
          </p>
        </>
      ) : null}
    </>
  );
}
