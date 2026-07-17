"use client";

import { fetchJson } from "@/app/lib/api-client";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarClock,
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
import { formatCurrency, formatDate } from "@/app/lib/utils";
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
    onSuccess: () => refresh(),
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
          title="Vos crédits"
          subtitle="Cliquez un nom pour l’historique · actions : rembours. anticipé, avenant, suppression"
        />

        {listQ.isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            Chargement des passifs…
          </p>
        ) : rows.length === 0 ? (
          <ModuleGuidedEmpty
            title="Aucun crédit pour l’instant"
            description="Enregistrez un crédit immobilier, auto, consommation ou une dette privée pour suivre le capital restant, la charge mensuelle et le calendrier."
            bullets={[
              "Montant initial et capital restant dû",
              "Mensualité + jour de prélèvement → décrément auto",
              "Dates de début / fin estimée et prêteur",
              "Remboursements anticipés et avenants de mensualité",
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
                  <th className="px-3 py-2.5 text-left">Nom</th>
                  <th className="px-3 py-2.5 text-left">Prêteur</th>
                  <th className="px-3 py-2.5 text-right">Initial</th>
                  <th className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      Restant dû
                      <FinanceTip term="Capital restant dû" />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-right">Mensualité</th>
                  <th className="px-3 py-2.5 text-center">Jour</th>
                  <th className="px-3 py-2.5 text-left">Calendrier</th>
                  <th className="px-3 py-2.5 text-right">Reste</th>
                  <th className="px-3 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <Fragment key={l.id}>
                    <tr className={moduleTableRowClass}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left font-medium text-slate-800 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-300"
                          onClick={() =>
                            setExpandedId((id) => (id === l.id ? null : l.id))
                          }
                        >
                          {l.name}
                        </button>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                          <span>Taux</span>
                          <input
                            className="input !w-14 !py-0.5 text-right text-[11px]"
                            defaultValue={l.interestRate ?? ""}
                            key={`${l.id}-rate-${l.interestRate}`}
                            title="Taux annuel % — mise à jour sur blur"
                            aria-label="Taux d'intérêt annuel"
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v === (l.interestRate ?? "")) return;
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
                          />
                          <span>
                            % · int. est.{" "}
                            {formatCurrency(
                              l.estimatedInterestRemaining,
                              l.currency
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="input !max-w-[9rem] !py-1 text-xs"
                          defaultValue={l.bankName || ""}
                          key={`${l.id}-bank-${l.bankName}`}
                          aria-label="Prêteur"
                          onChange={(e) => {
                            if (e.target.value !== (l.bankName || ""))
                              patchMut.mutate({
                                id: l.id,
                                bankName: e.target.value || null,
                              });
                          }}
                        >
                          <option value="">—</option>
                          {l.bankName &&
                            !(
                              LIABILITY_LENDER_OPTIONS as readonly string[]
                            ).includes(l.bankName) && (
                              <option value={l.bankName}>{l.bankName}</option>
                            )}
                          {LIABILITY_LENDER_OPTIONS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-500">
                        {formatCurrency(l.initialAmount, l.currency)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          className="input !w-28 !py-1 text-right font-semibold tabular-nums"
                          defaultValue={l.remainingAmount}
                          key={`${l.id}-rem-${l.remainingAmount}`}
                          aria-label="Capital restant dû"
                          onBlur={(e) => {
                            if (e.target.value !== l.remainingAmount)
                              patchMut.mutate({
                                id: l.id,
                                remainingAmount: e.target.value,
                              });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.monthlyPayment
                          ? formatCurrency(l.monthlyPayment, l.currency)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          className="input !w-12 !py-1 text-center text-xs"
                          type="number"
                          min={1}
                          max={31}
                          defaultValue={l.paymentDay ?? ""}
                          key={`${l.id}-day-${l.paymentDay}`}
                          title="Jour de prélèvement (1–31)"
                          aria-label="Jour de prélèvement"
                          onBlur={(e) => {
                            const v = e.target.value;
                            const cur =
                              l.paymentDay != null ? String(l.paymentDay) : "";
                            if (v !== cur)
                              patchMut.mutate({
                                id: l.id,
                                paymentDay: v === "" ? null : v,
                              });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {l.startDate ? formatDate(l.startDate) : "—"}
                            {" → "}
                            {l.endDate ? formatDate(l.endDate) : "—"}
                          </span>
                          {l.lastPaymentAppliedAt && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                              Dernier prél. {formatDate(l.lastPaymentAppliedAt)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">
                        {l.monthsRemaining != null
                          ? `${l.monthsRemaining} mois`
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
                            title="Remboursement anticipé"
                            aria-label="Remboursement anticipé"
                            onClick={() => {
                              setEarlyId(l.id);
                              setEarlyKind("PARTIAL");
                              setEarlyAmount("");
                              setEarlyDate(
                                new Date().toISOString().slice(0, 10)
                              );
                            }}
                          >
                            <Banknote className="h-3.5 w-3.5" />
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
                    {expandedId === l.id && (
                      <tr className="border-t border-[var(--border)] bg-[var(--muted)]/25">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                            <CalendarClock className="h-3.5 w-3.5" />
                            Historique des événements
                          </div>
                          {l.events.length === 0 ? (
                            <p className="text-xs text-slate-400">
                              Aucun événement — les prélèvements et avenants
                              apparaîtront ici.
                            </p>
                          ) : (
                            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
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
                                      <span className="text-slate-500">
                                        {" "}
                                        · {e.notes}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="tabular-nums text-slate-500">
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
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
          title="Remboursement anticipé"
          onClose={() => setEarlyId(null)}
        >
          <div className="space-y-3">
            <p className="text-meta leading-snug">
              Remboursement hors échéance mensuelle. Partiel : réduit le
              capital. Total : solde le crédit.
            </p>
            <Field label="Type">
              <select
                className="input"
                value={earlyKind}
                onChange={(e) =>
                  setEarlyKind(e.target.value as "PARTIAL" | "TOTAL")
                }
              >
                <option value="PARTIAL">Partiel</option>
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
              >
                Valider
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
