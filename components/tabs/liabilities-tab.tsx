"use client";

import { fetchJson } from "@/app/lib/api-client";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormActions } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DateInput } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { LiabilityCreateForm } from "@/components/modals/liability-create-form";
import type { LiabilityForm } from "@/app/lib/schemas";
import { LIABILITY_LENDER_OPTIONS } from "@/app/lib/constants";
import { formatCurrency, formatDate, cn } from "@/app/lib/utils";
import {
  buildAmortizationSchedule,
  currentScheduleIndex,
  nextPaymentDueDate,
  repaymentProgressPct,
} from "@/app/lib/liabilities/amortization";
import {
  ModuleCallout,
  ModuleCard,
  ModuleCardHeader,
  ModuleGuidedEmpty,
  ModuleKpi,
  ModulePageHeader,
  moduleTableHeadClass,
  moduleTableRowClass,
} from "@/components/ui/module-shell";

type LiabilityRow = {
  id: string;
  name: string;
  initialAmount: string;
  remainingAmount: string;
  remainingEur: string;
  currency: string;
  interestRate: string | null;
  monthlyPayment: string | null;
  startDate: string | null;
  endDate: string | null;
  paymentDay: number | null;
  lastPaymentAppliedAt: string | null;
  bankName: string | null;
  notes: string | null;
  monthsRemaining: number | null;
  estimatedInterestRemaining: string;
  events: Array<{
    id: string;
    type: string;
    amount: string | null;
    remainingAfter: string | null;
    eventDate: string;
    notes: string | null;
  }>;
};

const EVENT_LABELS: Record<string, string> = {
  MONTHLY_DEBIT: "Prélèvement mensuel",
  EARLY_REPAYMENT_PARTIAL: "Remb. anticipé partiel",
  EARLY_REPAYMENT_TOTAL: "Remb. anticipé total",
  PAYMENT_CHANGE: "Avenant mensualité",
  RATE_CHANGE: "Avenant taux d'intérêt",
};

export function LiabilitiesTab({ baseCurrency }: { baseCurrency: string }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [earlyId, setEarlyId] = useState<string | null>(null);
  const [earlyKind, setEarlyKind] = useState<"PARTIAL" | "TOTAL">("PARTIAL");
  const [earlyAmount, setEarlyAmount] = useState("");
  const [earlyDate, setEarlyDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [amendId, setAmendId] = useState<string | null>(null);
  const [amendPayment, setAmendPayment] = useState("");
  const [amendDate, setAmendDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [showHelp, setShowHelp] = useState(false);

  const listQ = useQuery({
    queryKey: ["liabilities"],
    queryFn: () =>
      fetchJson<{ liabilities: LiabilityRow[]; totalRemainingEur: string }>(
        "/api/liabilities"
      ),
  });

  const rows = useMemo(
    () => listQ.data?.liabilities ?? [],
    [listQ.data?.liabilities]
  );
  const totalRemaining = listQ.data?.totalRemainingEur || "0";

  const monthlyOutflow = useMemo(() => {
    return rows.reduce((acc, l) => {
      if (!l.monthlyPayment) return acc;
      const n = Number(l.monthlyPayment);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [rows]);

  const activeCount = useMemo(
    () => rows.filter((l) => Number(l.remainingAmount) > 0).length,
    [rows]
  );

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["liabilities"] });
    await qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const createMut = useMutation({
    mutationFn: (body: LiabilityForm) =>
      fetchJson("/api/liabilities", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast.success("Crédit créé");
      setShowCreate(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMut = useMutation({
    mutationFn: (body: Record<string, string | number | null>) =>
      fetchJson("/api/liabilities", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast.success("Passif mis à jour");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/liabilities?id=${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Passif supprimé");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const earlyMut = useMutation({
    mutationFn: () =>
      fetchJson("/api/liabilities", {
        method: "POST",
        body: JSON.stringify({
          action: "early_repayment",
          liabilityId: earlyId,
          kind: earlyKind,
          amount: earlyAmount,
          eventDate: earlyDate,
        }),
      }),
    onSuccess: async () => {
      toast.success(
        earlyKind === "TOTAL"
          ? "Remboursement total enregistré"
          : "Remboursement partiel — capital recalculé"
      );
      setEarlyId(null);
      setEarlyAmount("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const amendMut = useMutation({
    mutationFn: () =>
      fetchJson("/api/liabilities", {
        method: "POST",
        body: JSON.stringify({
          action: "payment_change",
          liabilityId: amendId,
          monthlyPayment: amendPayment,
          eventDate: amendDate,
        }),
      }),
    onSuccess: async () => {
      toast.success("Avenant mensualité — durée et intérêts réestimés");
      setAmendId(null);
      setAmendPayment("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="section-stack" data-testid="liabilities-tab">
      <ModulePageHeader
        title="Passifs / Crédits"
        subtitle={
          <>
            Crédits immobiliers, auto, conso ou dettes privées — capital restant
            dû, mensualités et{" "}
            <span className="inline-flex items-center gap-0.5">
              prélèvement automatique
              <FinanceTip term="Mensualité" />
            </span>
            .
          </>
        }
        actions={
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            data-testid="liability-add"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouveau crédit
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ModuleKpi
          label="Capital restant dû"
          value={formatCurrency(totalRemaining, "EUR")}
          valueClassName="text-[var(--danger)]"
          hint={
            rows.length === 0
              ? "Somme des dettes une fois les crédits saisis"
              : baseCurrency !== "EUR"
                ? `Reporting aussi en ${baseCurrency}`
                : "Total consolidé en euros"
          }
        />
        <ModuleKpi
          label="Crédits actifs"
          value={
            <>
              {activeCount}
              {rows.length > 0 && activeCount !== rows.length ? (
                <span className="text-base font-normal text-[var(--muted-foreground)]">
                  {" "}
                  / {rows.length}
                </span>
              ) : null}
            </>
          }
          hint="Positions avec capital encore dû"
        />
        <ModuleKpi
          label="Charge mensuelle"
          tip={<FinanceTip term="Mensualité" />}
          value={formatCurrency(String(monthlyOutflow), "EUR")}
          hint="Somme des mensualités renseignées"
        />
        <div className="card p-3.5 sm:p-4">
          <div className="text-label">Suivi automatique</div>
          <p className="text-meta mt-2 leading-relaxed">
            À chaque passage du jour de prélèvement, le capital restant diminue
            de la mensualité (sans double comptage).
          </p>
          <button
            type="button"
            className="mt-2 text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
          >
            {showHelp ? "Masquer l’aide" : "Comprendre le module"}
          </button>
        </div>
      </section>

      {showHelp && (
        <ModuleCallout tone="info">
          <ul className="space-y-1.5">
            <li>
              <strong>Capital restant dû</strong> — solde encore à rembourser ;
              décrémenté automatiquement ou via remboursement anticipé.
            </li>
            <li>
              <strong>Jour de prélèvement</strong> — jour du mois (1–31) où la
              mensualité est appliquée. La date de début borne le premier
              prélèvement possible.
            </li>
            <li>
              <strong>Remboursement anticipé</strong> — partiel ou total, hors
              échéance mensuelle.
            </li>
            <li>
              <strong>Avenant</strong> — nouvelle mensualité ou taux : durée et
              intérêts restants sont réestimés.
            </li>
          </ul>
        </ModuleCallout>
      )}

      <ModuleCard>
        <ModuleCardHeader
          title="Crédits en cours"
          subtitle="Progression, prochaine échéance, amortissement prévisionnel et remboursements"
        />

        {listQ.isLoading ? (
          <div
            className="space-y-2 px-4 py-4"
            aria-busy="true"
            data-testid="liabilities-loading"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 skeleton-block rounded-lg border border-[var(--border)]"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <ModuleGuidedEmpty
            title="Aucun crédit pour l’instant"
            description="Enregistrez un crédit immobilier, auto, consommation ou une dette privée pour suivre le capital restant, la charge mensuelle et le calendrier."
            bullets={[
              "Montant initial et capital restant dû",
              "Mensualité + jour de prélèvement → décrément auto",
              "Tableau d’amortissement prévisionnel",
              "Remboursements anticipés en un clic",
            ]}
            primaryLabel="Créer mon premier crédit"
            onPrimary={() => setShowCreate(true)}
            primaryTestId="liability-empty-add"
          />
        ) : (
          <div className="table-container-responsive table-fluid-wrap">
            <table
              className="table-fluid text-sm"
              data-testid="liabilities-table"
            >
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th className="px-3 py-2.5 text-left">Crédit</th>
                  <th className="px-3 py-2.5 text-right">Capital</th>
                  <th className="px-3 py-2.5 text-right">Taux</th>
                  <th className="px-3 py-2.5 text-left">Prochaine échéance</th>
                  <th className="min-w-[8rem] px-3 py-2.5 text-left">
                    Progression
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const expanded = expandedId === l.id;
                  const pct = repaymentProgressPct(
                    l.initialAmount,
                    l.remainingAmount
                  );
                  const nextDue = nextPaymentDueDate({
                    paymentDay: l.paymentDay,
                    startDate: l.startDate ? new Date(l.startDate) : null,
                    endDate: l.endDate ? new Date(l.endDate) : null,
                    lastPaymentAppliedAt: l.lastPaymentAppliedAt
                      ? new Date(l.lastPaymentAppliedAt)
                      : null,
                  });
                  const nextAmount =
                    l.monthlyPayment && Number(l.remainingAmount) > 0
                      ? l.monthlyPayment
                      : null;
                  const isActive = Number(l.remainingAmount) > 0;

                  return (
                    <Fragment key={l.id}>
                      <tr
                        className={cn(
                          moduleTableRowClass,
                          !isActive && "opacity-60"
                        )}
                        data-testid={`liability-row-${l.id}`}
                      >
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            className="flex items-start gap-1.5 text-left"
                            onClick={() =>
                              setExpandedId((id) =>
                                id === l.id ? null : l.id
                              )
                            }
                            aria-expanded={expanded}
                            data-testid={`liability-expand-${l.id}`}
                          >
                            {expanded ? (
                              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                            )}
                            <span>
                              <span className="font-medium text-[var(--foreground)]">
                                {l.name}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">
                                {l.bankName || "Prêteur non renseigné"}
                                {l.monthsRemaining != null
                                  ? ` · ${l.monthsRemaining} mois restants`
                                  : ""}
                                {!isActive ? " · soldé" : ""}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="tabular-nums font-semibold text-[var(--danger)]">
                            {formatCurrency(l.remainingAmount, l.currency)}
                          </div>
                          <div className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                            initial{" "}
                            {formatCurrency(l.initialAmount, l.currency)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="tabular-nums text-[var(--foreground)]">
                            {l.interestRate != null && l.interestRate !== ""
                              ? `${Number(l.interestRate).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} %`
                              : "—"}
                          </div>
                          <div className="text-[10px] text-[var(--muted-foreground)]">
                            effectif / an
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {isActive && nextDue ? (
                            <div>
                              <div className="font-medium tabular-nums text-[var(--foreground)]">
                                {formatDate(nextDue.toISOString())}
                              </div>
                              <div className="text-[11px] tabular-nums text-teal-600 dark:text-teal-300">
                                {nextAmount
                                  ? formatCurrency(nextAmount, l.currency)
                                  : "—"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[var(--muted-foreground)]">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]"
                              role="progressbar"
                              aria-valuenow={Math.round(pct)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`Remboursé à ${Math.round(pct)} %`}
                            >
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400 transition-[width]"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">
                              {Math.round(pct)} %
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="!h-8 text-[11px]"
                              disabled={!isActive}
                              data-testid={`liability-repay-${l.id}`}
                              title="Enregistrer un remboursement (prérempli avec la prochaine mensualité)"
                              onClick={() => {
                                setEarlyId(l.id);
                                setEarlyKind("PARTIAL");
                                setEarlyAmount(
                                  l.monthlyPayment &&
                                    Number(l.monthlyPayment) > 0
                                    ? String(l.monthlyPayment)
                                    : ""
                                );
                                setEarlyDate(
                                  new Date().toISOString().slice(0, 10)
                                );
                              }}
                            >
                              <Banknote className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">
                                Remboursement
                              </span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="!h-8 text-[11px]"
                              data-testid={`liability-detail-${l.id}`}
                              onClick={() =>
                                setExpandedId((id) =>
                                  id === l.id ? null : l.id
                                )
                              }
                            >
                              {expanded ? "Masquer" : "Détail"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
                              title="Avenant mensualité"
                              aria-label="Avenant mensualité"
                              onClick={() => {
                                setAmendId(l.id);
                                setAmendPayment(l.monthlyPayment || "");
                                setAmendDate(
                                  new Date().toISOString().slice(0, 10)
                                );
                              }}
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600"
                              aria-label="Supprimer le crédit"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Supprimer le crédit « ${l.name} » ?`
                                  )
                                ) {
                                  deleteMut.mutate(l.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-[var(--border)] bg-[var(--muted)]/20">
                          <td colSpan={6} className="px-4 py-4">
                            <LiabilityDetailPanel
                              liability={l}
                              onEditRate={(v) => {
                                fetchJson("/api/liabilities", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    action: "rate_change",
                                    liabilityId: l.id,
                                    interestRate: v || "0",
                                  }),
                                })
                                  .then(() => {
                                    toast.success(
                                      "Taux mis à jour — projections recalculées"
                                    );
                                    return refresh();
                                  })
                                  .catch((err: Error) =>
                                    toast.error(err.message)
                                  );
                              }}
                              onEditRemaining={(v) => {
                                if (v !== l.remainingAmount)
                                  patchMut.mutate({
                                    id: l.id,
                                    remainingAmount: v,
                                  });
                              }}
                              onEditPaymentDay={(v) => {
                                const cur =
                                  l.paymentDay != null
                                    ? String(l.paymentDay)
                                    : "";
                                if (v !== cur)
                                  patchMut.mutate({
                                    id: l.id,
                                    paymentDay: v === "" ? null : v,
                                  });
                              }}
                              onEditBank={(v) => {
                                if (v !== (l.bankName || ""))
                                  patchMut.mutate({
                                    id: l.id,
                                    bankName: v || null,
                                  });
                              }}
                              onRepay={() => {
                                setEarlyId(l.id);
                                setEarlyKind("PARTIAL");
                                setEarlyAmount(
                                  l.monthlyPayment &&
                                    Number(l.monthlyPayment) > 0
                                    ? String(l.monthlyPayment)
                                    : ""
                                );
                                setEarlyDate(
                                  new Date().toISOString().slice(0, 10)
                                );
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ModuleCard>

      {showCreate && (
        <Modal
          title="Nouveau crédit / passif"
          onClose={() => setShowCreate(false)}
          wide
        >
          <LiabilityCreateForm
            pending={createMut.isPending}
            onCancel={() => setShowCreate(false)}
            onSubmit={(values) => createMut.mutate(values)}
          />
        </Modal>
      )}

      {earlyId && (
        <Modal
          title="Enregistrer un remboursement"
          onClose={() => setEarlyId(null)}
        >
          <div className="space-y-3" data-testid="liability-repay-modal">
            <p className="text-meta leading-snug">
              Le montant est prérempli avec la prochaine mensualité lorsque
              disponible. Partiel : réduit le capital restant. Total : solde le
              crédit.
            </p>
            {(() => {
              const row = rows.find((r) => r.id === earlyId);
              if (!row) return null;
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2 text-[11px]">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-[var(--muted-foreground)]">
                    {" "}
                    · restant{" "}
                    {formatCurrency(row.remainingAmount, row.currency)}
                    {row.monthlyPayment
                      ? ` · mensualité ${formatCurrency(row.monthlyPayment, row.currency)}`
                      : ""}
                  </span>
                </div>
              );
            })()}
            <Field label="Type">
              <select
                className="input"
                value={earlyKind}
                onChange={(e) =>
                  setEarlyKind(e.target.value as "PARTIAL" | "TOTAL")
                }
                data-testid="liability-repay-kind"
              >
                <option value="PARTIAL">Partiel (échéance / anticipé)</option>
                <option value="TOTAL">Total (solde le crédit)</option>
              </select>
            </Field>
            {earlyKind === "PARTIAL" && (
              <Field label="Montant remboursé">
                <input
                  className="input"
                  value={earlyAmount}
                  onChange={(e) => setEarlyAmount(e.target.value)}
                  placeholder="Montant"
                  inputMode="decimal"
                  data-testid="liability-repay-amount"
                />
              </Field>
            )}
            <Field label="Date de l’opération">
              <DateInput
                value={earlyDate}
                onChange={(e) => setEarlyDate(e.target.value)}
              />
            </Field>
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEarlyId(null)}
              >
                Annuler
              </Button>
              <Button
                onClick={() => earlyMut.mutate()}
                disabled={
                  earlyMut.isPending ||
                  (earlyKind === "PARTIAL" && !earlyAmount)
                }
                data-testid="liability-repay-submit"
              >
                Enregistrer
              </Button>
            </FormActions>
          </div>
        </Modal>
      )}

      {amendId && (
        <Modal
          title="Avenant — nouvelle mensualité"
          onClose={() => setAmendId(null)}
        >
          <div className="space-y-3">
            <p className="text-[11px] leading-snug text-slate-500">
              Nouvelle mensualité à effet donné. La durée résiduelle et les
              intérêts restants estimés sont recalculés sur le capital restant
              dû.
            </p>
            <Field label="Nouvelle mensualité">
              <input
                className="input"
                value={amendPayment}
                onChange={(e) => setAmendPayment(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Date d’effet">
              <DateInput
                value={amendDate}
                onChange={(e) => setAmendDate(e.target.value)}
              />
            </Field>
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAmendId(null)}
              >
                Annuler
              </Button>
              <Button
                onClick={() => amendMut.mutate()}
                disabled={amendMut.isPending || !amendPayment}
              >
                Appliquer l’avenant
              </Button>
            </FormActions>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Panneau détail : amortissement prévisionnel + historique + réglages rapides. */
function LiabilityDetailPanel({
  liability: l,
  onEditRate,
  onEditRemaining,
  onEditPaymentDay,
  onEditBank,
  onRepay,
}: {
  liability: LiabilityRow;
  onEditRate: (v: string) => void;
  onEditRemaining: (v: string) => void;
  onEditPaymentDay: (v: string) => void;
  onEditBank: (v: string) => void;
  onRepay: () => void;
}) {
  const schedule = useMemo(() => {
    if (!l.monthlyPayment || Number(l.monthlyPayment) <= 0) return [];
    if (!l.initialAmount || Number(l.initialAmount) <= 0) return [];
    return buildAmortizationSchedule({
      principal: l.initialAmount,
      annualPercent: l.interestRate || "0",
      monthlyPayment: l.monthlyPayment,
      startDate: l.startDate ? new Date(l.startDate) : new Date(),
      paymentDay: l.paymentDay ?? 1,
      maxMonths: 480,
    });
  }, [l]);

  const currentIdx = useMemo(
    () => currentScheduleIndex(schedule, l.remainingAmount),
    [schedule, l.remainingAmount]
  );

  // Afficher une fenêtre autour de l’échéance courante (perf grands tableaux)
  const windowRows = useMemo(() => {
    if (schedule.length <= 36) return schedule.map((r, i) => ({ r, i }));
    const start = Math.max(0, currentIdx - 6);
    const end = Math.min(schedule.length, start + 24);
    return schedule.slice(start, end).map((r, j) => ({ r, i: start + j }));
  }, [schedule, currentIdx]);

  return (
    <div className="space-y-4" data-testid={`liability-detail-${l.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
          <CalendarClock className="h-3.5 w-3.5 text-teal-500" />
          Détail & amortissement prévisionnel
        </div>
        <Button
          size="sm"
          className="text-[11px]"
          onClick={onRepay}
          data-testid={`liability-detail-repay-${l.id}`}
        >
          <Banknote className="h-3.5 w-3.5" />
          Enregistrer un remboursement
        </Button>
      </div>

      {/* Réglages compacts */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">Taux annuel %</span>
          <input
            className="input mt-0.5 !py-1 text-right text-xs"
            defaultValue={l.interestRate ?? ""}
            key={`${l.id}-rate-${l.interestRate}`}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (l.interestRate ?? "")) onEditRate(v);
            }}
          />
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">
            Capital restant dû
          </span>
          <input
            className="input mt-0.5 !py-1 text-right text-xs font-semibold"
            defaultValue={l.remainingAmount}
            key={`${l.id}-rem-${l.remainingAmount}`}
            onBlur={(e) => onEditRemaining(e.target.value)}
          />
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">
            Jour de prélèvement
          </span>
          <input
            className="input mt-0.5 !py-1 text-center text-xs"
            type="number"
            min={1}
            max={31}
            defaultValue={l.paymentDay ?? ""}
            key={`${l.id}-day-${l.paymentDay}`}
            onBlur={(e) => onEditPaymentDay(e.target.value)}
          />
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">Prêteur</span>
          <select
            className="input mt-0.5 !py-1 text-xs"
            defaultValue={l.bankName || ""}
            key={`${l.id}-bank-${l.bankName}`}
            onChange={(e) => onEditBank(e.target.value)}
          >
            <option value="">—</option>
            {l.bankName &&
              !(LIABILITY_LENDER_OPTIONS as readonly string[]).includes(
                l.bankName
              ) && <option value={l.bankName}>{l.bankName}</option>}
            {LIABILITY_LENDER_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Tableau d’amortissement */}
      {schedule.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Renseignez une mensualité et un capital pour générer le tableau
          d’amortissement.
        </p>
      ) : (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Tableau d’amortissement
            {schedule.length > 36
              ? ` · échéances ${windowRows[0]!.i + 1}–${windowRows[windowRows.length - 1]!.i + 1} / ${schedule.length}`
              : ` · ${schedule.length} échéances`}
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[var(--table-head)] text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Échéance</th>
                  <th className="px-2 py-1.5 text-right">Capital remboursé</th>
                  <th className="px-2 py-1.5 text-right">Intérêts</th>
                  <th className="px-2 py-1.5 text-right">Assurance</th>
                  <th className="px-2 py-1.5 text-right">Capital restant</th>
                </tr>
              </thead>
              <tbody>
                {windowRows.map(({ r, i }) => {
                  const isCurrent = i === currentIdx;
                  return (
                    <tr
                      key={r.index}
                      className={cn(
                        "border-t border-[var(--border)]/70",
                        isCurrent &&
                          "bg-teal-500/15 font-medium ring-1 ring-inset ring-teal-500/30"
                      )}
                      data-current={isCurrent ? "true" : undefined}
                    >
                      <td className="px-2 py-1 tabular-nums text-[var(--muted-foreground)]">
                        {r.index}
                        {isCurrent ? (
                          <span className="ml-1 text-[9px] font-semibold uppercase text-teal-500">
                            actuel
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {r.dueDate ? formatDate(r.dueDate) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCurrency(r.principalPaid, l.currency)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-amber-600/90 dark:text-amber-300/90">
                        {formatCurrency(r.interest, l.currency)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-[var(--muted-foreground)]">
                        {formatCurrency(r.insurance, l.currency)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCurrency(r.remainingAfter, l.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            Calculs en Decimal.js · assurance non modélisée en base (colonne à
            0 €) · échéance courante mise en évidence.
          </p>
        </div>
      )}

      {/* Historique événements */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Historique des événements
        </div>
        {l.events.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            Aucun événement — les prélèvements et remboursements apparaîtront
            ici.
          </p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {l.events.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/60 py-1.5 last:border-0"
              >
                <span>
                  <span className="font-medium">
                    {EVENT_LABELS[e.type] || e.type}
                  </span>
                  {e.notes ? (
                    <span className="text-[var(--muted-foreground)]">
                      {" "}
                      · {e.notes}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums text-[var(--muted-foreground)]">
                  {formatDate(e.eventDate)}
                  {e.amount
                    ? ` · ${formatCurrency(e.amount, l.currency)}`
                    : ""}
                  {e.remainingAfter != null
                    ? ` → restant ${formatCurrency(e.remainingAfter, l.currency)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
