"use client";

/**
 * Colonne de détail du crédit sélectionné.
 *
 * Même géométrie que le panneau d'actif du Portefeuille, des Banques, de
 * l'Assurance-vie, de l'Immobilier, de l'Épargne salariale et des Alternatifs
 * (`.asset-panel`) : ancrée en grand écran, superposée en tablette, plein écran
 * en mobile.
 *
 * Le bloc **Bien financé** est la raison d'être de ce panneau pour un
 * particulier. « Ce prêt finance ce bien, le bien vaut X, il reste Y, donc j'ai
 * Z » se lit d'un coup d'œil, là où un écran de crédit bancaire classique
 * laisse le rapprochement à faire de tête.
 */

import { useState } from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/app/lib/utils";
import { LIABILITY_CATEGORY_LABELS } from "@/app/lib/constants";
import {
  linkedAssetEquity,
  type LiabilityView,
} from "@/app/lib/liabilities/overview";
import { buildAmortizationSchedule } from "@/app/lib/liabilities/amortization";
import { downloadAmortizationCsv } from "@/app/lib/liabilities/schedule-csv";

export type LiabilityEvent = {
  id: string;
  type: string;
  amount: string | null;
  remainingAfter: string | null;
  eventDate: string;
  notes: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  MONTHLY_DEBIT: "Échéance prélevée",
  EARLY_REPAYMENT_PARTIAL: "Remboursement anticipé",
  EARLY_REPAYMENT_TOTAL: "Solde du crédit",
  PAYMENT_CHANGE: "Mensualité modifiée",
  RATE_CHANGE: "Taux modifié",
};

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;

const categoryLabel = (c: string) =>
  LIABILITY_CATEGORY_LABELS[c as keyof typeof LIABILITY_CATEGORY_LABELS] ?? c;

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

function Block({ children }: { children: React.ReactNode }) {
  return (
    <dl className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {children}
    </dl>
  );
}

/**
 * Progression du remboursement.
 *
 * Absente quand le capital initial est inconnu : afficher une barre vide
 * laisserait croire que rien n'a été remboursé, ce qui est une affirmation, et
 * pas une absence d'information.
 */
function RepaymentProgress({ view }: { view: LiabilityView }) {
  if (view.progressPct == null) {
    return (
      <p className="text-meta py-[var(--space-2)]">
        Capital initial non renseigné — la part déjà remboursée ne peut pas être
        calculée.
      </p>
    );
  }

  return (
    <div data-testid="liability-progress">
      <div className="flex items-center gap-[var(--space-3)]">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${Math.min(100, view.progressPct)}%` }}
          />
        </div>
        <span className="num shrink-0 text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
          {view.progressPct.toLocaleString("fr-FR", {
            maximumFractionDigits: 1,
          })}{" "}
          %
        </span>
      </div>
      <p className="text-meta mt-[var(--space-1)] text-right">remboursé</p>

      <dl className="mt-[var(--space-3)] grid grid-cols-3 gap-[var(--space-3)]">
        <div>
          <dt className="text-label">Capital initial</dt>
          <dd className="num text-[length:var(--text-xs)] font-medium">
            {formatCurrency(String(view.initialEur), "EUR")}
          </dd>
        </div>
        <div>
          <dt className="text-label">Déjà remboursé</dt>
          <dd className="num text-[length:var(--text-xs)] font-medium val-positive">
            {formatCurrency(String(view.repaidEur), "EUR")}
          </dd>
        </div>
        <div>
          <dt className="text-label">Restant dû</dt>
          <dd className="num text-[length:var(--text-xs)] font-medium">
            {formatCurrency(String(view.remainingEur), "EUR")}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Sections proposées — seules celles qui ont de quoi s'afficher. */
function sectionsFor(view: LiabilityView, events: LiabilityEvent[]) {
  const out = [{ id: "summary", label: "Résumé" }];
  out.push({ id: "financing", label: "Financement" });
  // L'amortissement demande une mensualité et un taux : sans eux, aucune
  // échéance ne peut être projetée.
  if (view.monthlyPaymentEur != null && view.ratePct != null) {
    out.push({ id: "schedule", label: "Amortissement" });
  }
  out.push({ id: "cost", label: "Coût" });
  if (events.length > 0) out.push({ id: "history", label: "Historique" });
  return out;
}

export function LiabilityPanel({
  view,
  events,
  onClose,
  onEdit,
  onRepay,
  onDelete,
  onOpenLinkedAsset,
  className,
}: {
  view: LiabilityView | null;
  events: LiabilityEvent[];
  onClose: () => void;
  /** Modifier la mensualité ou le taux — flux existants. */
  onEdit: (target: "payment" | "rate") => void;
  /** Remboursement anticipé, partiel ou total. */
  onRepay: () => void;
  onDelete: () => void;
  /** Ouvre le bien immobilier financé, quand il en existe un. */
  onOpenLinkedAsset?: (assetId: string) => void;
  className?: string;
}) {
  const [section, setSection] = useState("summary");

  // Changer de crédit ramène au résumé : la section ouverte peut ne pas
  // exister sur le suivant (un prêt sans taux n'a pas d'amortissement).
  const id = view?.id ?? null;
  const [seenId, setSeenId] = useState(id);
  if (id !== seenId) {
    setSeenId(id);
    setSection("summary");
  }

  if (!view) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="liability-panel"
        data-open="false"
        aria-label="Détail du crédit"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucun crédit sélectionné
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez un crédit pour afficher son détail ici. La liste reste en
            place.
          </p>
        </div>
      </aside>
    );
  }

  const sections = sectionsFor(view, events);
  const equity = linkedAssetEquity(view);

  /*
    Échéancier projeté — jamais stocké, toujours recalculé depuis les
    caractéristiques du prêt. C'est une projection à taux constant : le panneau
    l'annonce comme telle plutôt que de la présenter comme un relevé.
  */
  const fullSchedule =
    view.monthlyPaymentEur != null && view.ratePct != null
      ? buildAmortizationSchedule({
          principal: view.remainingEur,
          annualPercent: view.ratePct,
          monthlyPayment: view.monthlyPaymentEur,
          insuranceMonthly: view.insuranceMonthlyEur ?? 0,
          startDate: new Date(),
        })
      : [];

  /*
    L'écran n'en montre que douze : des centaines de lignes dans une colonne de
    quatre cents pixels ne se lisent pas. L'export CSV, lui, porte l'échéancier
    entier — c'est la forme dans laquelle on l'exploite réellement.
  */
  const schedule = fullSchedule.slice(0, 12);

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="liability-panel"
      data-open="true"
      aria-label={`Crédit — ${view.name}`}
    >
      <div className="asset-panel-bar">
        <div className="min-w-0">
          <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
            {view.name}
          </p>
          <p className="text-meta truncate">
            {categoryLabel(view.category)}
            {view.lender ? ` · ${view.lender}` : ""}
            {view.status === "SETTLED" ? " · soldé" : ""}
          </p>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="liability-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <nav className="workspace-tabs" role="tablist" aria-label="Sections du crédit">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className="workspace-tab"
            data-active={section === s.id ? "true" : "false"}
            data-testid={`liability-tab-${s.id}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="asset-panel-body">
        <p
          className="num text-[length:var(--text-2xl)] font-semibold tracking-tight text-[var(--foreground)]"
          data-testid="liability-panel-remaining"
        >
          {formatCurrency(String(view.remainingEur), "EUR")}
        </p>
        <p className="text-meta">
          Capital restant dû
          {view.totalMonthlyEur != null ? (
            <>
              <span className="mx-1 opacity-40">·</span>
              <span className="num">
                {formatCurrency(String(view.totalMonthlyEur), "EUR")}
              </span>{" "}
              / mois
            </>
          ) : null}
          {view.ratePct != null ? (
            <>
              <span className="mx-1 opacity-40">·</span>
              <span className="num">{pctLabel(view.ratePct)}</span>
            </>
          ) : null}
        </p>

        {section === "summary" && (
          <>
            <SectionTitle>Progression du remboursement</SectionTitle>
            <RepaymentProgress view={view} />

            <SectionTitle>Informations clés</SectionTitle>
            <Block>
              <Fact
                label="Date de début"
                value={view.startDate ? formatDate(view.startDate) : "—"}
              />
              <Fact
                label={
                  view.endDateIsEstimated ? "Fin estimée" : "Date de fin prévue"
                }
                value={view.endDate ? formatDate(view.endDate) : "—"}
                tone={view.endDateIsEstimated ? "muted" : undefined}
              />
              <Fact
                label="Durée restante"
                value={
                  view.monthsRemaining != null
                    ? `${Math.floor(view.monthsRemaining / 12)} ans et ${view.monthsRemaining % 12} mois`
                    : "—"
                }
              />
              <Fact label="Taux nominal" value={pctLabel(view.ratePct)} />
              <Fact
                label="Assurance"
                value={
                  view.insuranceMonthlyEur != null
                    ? `${formatCurrency(String(view.insuranceMonthlyEur), "EUR")} / mois`
                    : "—"
                }
                tone={view.insuranceMonthlyEur == null ? "muted" : undefined}
              />
              <Fact
                label="Échéance totale"
                value={
                  view.totalMonthlyEur != null
                    ? `${formatCurrency(String(view.totalMonthlyEur), "EUR")} / mois`
                    : "—"
                }
              />
            </Block>

            {/* ── Bien financé ───────────────────────────────────── */}
            {view.linkedAsset ? (
              <>
                <SectionTitle>Bien financé</SectionTitle>
                <div
                  className="border-y border-[var(--border)] py-[var(--space-3)]"
                  data-testid="liability-linked-asset"
                >
                  <div className="flex items-baseline justify-between gap-[var(--space-3)]">
                    <span className="min-w-0 truncate text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                      {view.linkedAsset.name}
                    </span>
                    {onOpenLinkedAsset ? (
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-[var(--space-1)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)] transition-[color] hover:text-[var(--foreground)]"
                        onClick={() => onOpenLinkedAsset(view.linkedAsset!.id)}
                        data-testid="liability-open-asset"
                      >
                        Voir le bien
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    ) : null}
                  </div>

                  {equity ? (
                    <dl className="mt-[var(--space-2)] divide-y divide-[var(--border)]">
                      <Fact
                        label="Valeur actuelle"
                        value={formatCurrency(String(equity.valueEur), "EUR")}
                      />
                      <Fact
                        label="Dette liée"
                        value={formatCurrency(String(equity.debtEur), "EUR")}
                      />
                      <Fact
                        label="Equity estimé"
                        value={formatCurrency(String(equity.equityEur), "EUR")}
                        tone={equity.equityEur >= 0 ? "positive" : "negative"}
                      />
                    </dl>
                  ) : (
                    <p className="text-meta mt-[var(--space-2)]">
                      Valeur du bien non renseignée — l&apos;equity ne peut pas
                      être calculée.
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </>
        )}

        {section === "financing" && (
          <>
            <SectionTitle>Financement</SectionTitle>
            <Block>
              <Fact label="Prêteur" value={view.lender ?? "—"} />
              <Fact label="Type" value={categoryLabel(view.category)} />
              <Fact
                label="Capital initial"
                value={
                  view.initialEur > 0
                    ? formatCurrency(String(view.initialEur), "EUR")
                    : "—"
                }
              />
              <Fact
                label="Capital restant dû"
                value={formatCurrency(String(view.remainingEur), "EUR")}
              />
              <Fact
                label="Mensualité (hors assurance)"
                value={
                  view.monthlyPaymentEur != null
                    ? formatCurrency(String(view.monthlyPaymentEur), "EUR")
                    : "—"
                }
              />
              <Fact
                label="Assurance emprunteur"
                value={
                  view.insuranceMonthlyEur != null
                    ? formatCurrency(String(view.insuranceMonthlyEur), "EUR")
                    : "—"
                }
                tone={view.insuranceMonthlyEur == null ? "muted" : undefined}
              />
              <Fact label="Taux nominal" value={pctLabel(view.ratePct)} />
            </Block>

            <SectionTitle>Modifier</SectionTitle>
            <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
              <button
                type="button"
                className="btn btn-ghost text-[11px]"
                onClick={() => onEdit("payment")}
                data-testid="liability-edit-payment"
              >
                Changer la mensualité
              </button>
              <button
                type="button"
                className="btn btn-ghost text-[11px]"
                onClick={() => onEdit("rate")}
                data-testid="liability-edit-rate"
              >
                Réviser le taux
              </button>
            </div>
          </>
        )}

        {section === "schedule" && (
          <>
            <SectionTitle>Douze prochaines échéances</SectionTitle>
            <ul
              className="divide-y divide-[var(--border)] border-y border-[var(--border)]"
              data-testid="liability-schedule"
            >
              {schedule.map((r) => (
                <li
                  key={r.index}
                  className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                >
                  <span className="min-w-0">
                    <span className="block text-[length:var(--text-xs)] text-[var(--foreground)]">
                      {r.dueDate ? formatDate(r.dueDate) : `Échéance ${r.index}`}
                    </span>
                    <span className="text-meta block">
                      capital{" "}
                      <span className="num">
                        {formatCurrency(r.principalPaid, "EUR")}
                      </span>{" "}
                      · intérêts{" "}
                      <span className="num">
                        {formatCurrency(r.interest, "EUR")}
                      </span>
                    </span>
                  </span>
                  <span className="num shrink-0 text-[length:var(--text-xs)] font-medium">
                    {formatCurrency(r.payment, "EUR")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
              <p className="text-meta min-w-0">
                Projection à taux et mensualité constants — ce n&apos;est pas le
                relevé de la banque.
              </p>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)] transition-[color] hover:text-[var(--foreground)]"
                onClick={() => downloadAmortizationCsv(fullSchedule, view.name)}
                data-testid="liability-schedule-export"
              >
                <Download className="h-3 w-3" aria-hidden />
                Exporter l&apos;échéancier complet ({fullSchedule.length}{" "}
                échéances)
              </button>
            </div>
          </>
        )}

        {section === "cost" && (
          <>
            <SectionTitle>Coût du crédit</SectionTitle>
            <Block>
              <Fact
                label="Intérêts restants (est.)"
                value={formatCurrency(
                  String(view.estimatedInterestRemainingEur),
                  "EUR"
                )}
                tone="negative"
              />
              <Fact
                label="Assurance restante (est.)"
                value={
                  view.insuranceMonthlyEur != null && view.monthsRemaining != null
                    ? formatCurrency(
                        String(view.insuranceMonthlyEur * view.monthsRemaining),
                        "EUR"
                      )
                    : "—"
                }
                tone={
                  view.insuranceMonthlyEur == null || view.monthsRemaining == null
                    ? "muted"
                    : "negative"
                }
              />
              <Fact
                label="Coût futur total (est.)"
                value={formatCurrency(
                  String(
                    view.estimatedInterestRemainingEur +
                      (view.insuranceMonthlyEur != null &&
                      view.monthsRemaining != null
                        ? view.insuranceMonthlyEur * view.monthsRemaining
                        : 0)
                  ),
                  "EUR"
                )}
                tone="negative"
              />
            </Block>
            <p className="text-meta mt-[var(--space-2)]">
              Estimations calculées sur la durée résiduelle, à taux constant.
              Un remboursement anticipé les réduit.
            </p>
          </>
        )}

        {section === "history" && (
          <>
            <SectionTitle>Historique</SectionTitle>
            <ul
              className="divide-y divide-[var(--border)] border-y border-[var(--border)]"
              data-testid="liability-history"
            >
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                      {EVENT_LABELS[e.type] ?? e.type}
                    </span>
                    <span className="text-meta block">
                      {formatDate(e.eventDate)}
                      {e.notes ? ` · ${e.notes}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {e.amount ? (
                      <span className="num block text-[length:var(--text-xs)] font-medium">
                        {formatCurrency(e.amount, "EUR")}
                      </span>
                    ) : null}
                    {e.remainingAfter ? (
                      <span className="text-meta num block">
                        reste {formatCurrency(e.remainingAfter, "EUR")}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <SectionTitle>Actions</SectionTitle>
        <div className="grid gap-[var(--space-2)]">
          {view.status === "ACTIVE" ? (
            <Button
              variant="outline"
              onClick={onRepay}
              data-testid="liability-panel-repay"
            >
              Remboursement anticipé
            </Button>
          ) : null}
          <Button
            variant="danger"
            onClick={onDelete}
            data-testid="liability-panel-delete"
          >
            Supprimer ce crédit
          </Button>
        </div>
      </div>
    </aside>
  );
}
