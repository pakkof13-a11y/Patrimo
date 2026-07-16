"use client";

import { fetchJson } from "@/app/lib/api-client";
import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, CalendarClock, Banknote, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { liabilitySchema, type LiabilityForm } from "@/app/lib/schemas";
import { LIABILITY_LENDER_OPTIONS } from "@/app/lib/constants";
import { currencyLabel } from "@/app/lib/money/currencies";
import { formatCurrency, formatDate } from "@/app/lib/utils";

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
  const [earlyDate, setEarlyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amendId, setAmendId] = useState<string | null>(null);
  const [amendPayment, setAmendPayment] = useState("");
  const [amendDate, setAmendDate] = useState(() => new Date().toISOString().slice(0, 10));

  const form = useForm<LiabilityForm>({
    resolver: zodResolver(liabilitySchema) as never,
    defaultValues: {
      name: "",
      bankName: "",
      initialAmount: "0",
      remainingAmount: "0",
      currency: "EUR",
      interestRate: "",
      monthlyPayment: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: "",
      paymentDay: 5,
      notes: "",
    },
  });

  const listQ = useQuery({
    queryKey: ["liabilities"],
    queryFn: () =>
      fetchJson<{ liabilities: LiabilityRow[]; totalRemainingEur: string }>(
        "/api/liabilities"
      ),
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["liabilities"] });
    await qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const createMut = useMutation({
    mutationFn: (body: LiabilityForm) =>
      fetchJson("/api/liabilities", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      toast.success("Crédit enregistré");
      setShowCreate(false);
      form.reset({
        name: "",
        bankName: "",
        initialAmount: "0",
        remainingAmount: "0",
        currency: "EUR",
        interestRate: "",
        monthlyPayment: "",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
        paymentDay: 5,
        notes: "",
      });
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMut = useMutation({
    mutationFn: (body: Record<string, string | number | null>) =>
      fetchJson("/api/liabilities", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/liabilities?id=${id}`, { method: "DELETE" }),
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
          : "Remboursement partiel enregistré — capital recalculé"
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
      toast.success("Avenant mensualité appliqué — durée / intérêts réestimés");
      setAmendId(null);
      setAmendPayment("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = listQ.data?.liabilities || [];

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Passifs / Crédits</h2>
            <p className="text-xs text-slate-500">
              Prélèvement auto au jour défini · remboursements anticipés · avenants mensualité ·
              Total : {formatCurrency(listQ.data?.totalRemainingEur || "0", "EUR")}
              {baseCurrency !== "EUR" ? ` (reporting ${baseCurrency})` : ""}
            </p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> Nouveau crédit
          </Button>
        </div>

        <div className="table-container-responsive table-fluid-wrap">
          <table className="table-fluid text-sm">
            <thead className="table-head text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Banque</th>
                <th className="px-3 py-2 text-right">Initial</th>
                <th className="px-3 py-2 text-right">Restant dû</th>
                <th className="px-3 py-2 text-right">Mensualité</th>
                <th className="px-3 py-2 text-center">Jour prél.</th>
                <th className="px-3 py-2 text-left">Début → Fin</th>
                <th className="px-3 py-2 text-right">Reste / mois</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <Fragment key={l.id}>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        onClick={() =>
                          setExpandedId((id) => (id === l.id ? null : l.id))
                        }
                      >
                        {l.name}
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
                        <span>Taux</span>
                        <input
                          className="input !w-16 !py-0.5 text-right text-[11px]"
                          defaultValue={l.interestRate ?? ""}
                          key={`${l.id}-rate-${l.interestRate}`}
                          title="Taux annuel % — avenant à la volée"
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
                                toast.success("Taux mis à jour — projections recalculées");
                                return refresh();
                              })
                              .catch((err: Error) => toast.error(err.message));
                          }}
                        />
                        <span>
                          % · int. rest. est.{" "}
                          {formatCurrency(l.estimatedInterestRemaining, l.currency)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="input !py-1"
                        defaultValue={l.bankName || ""}
                        key={`${l.id}-bank-${l.bankName}`}
                        onChange={(e) => {
                          if (e.target.value !== (l.bankName || ""))
                            patchMut.mutate({ id: l.id, bankName: e.target.value || null });
                        }}
                      >
                        <option value="">—</option>
                        {/* Keep custom value if not in catalog */}
                        {l.bankName &&
                          !(LIABILITY_LENDER_OPTIONS as readonly string[]).includes(
                            l.bankName
                          ) && (
                            <option value={l.bankName}>{l.bankName}</option>
                          )}
                        {LIABILITY_LENDER_OPTIONS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(l.initialAmount, l.currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        className="input !w-28 !py-1 text-right font-semibold tabular-nums"
                        defaultValue={l.remainingAmount}
                        key={`${l.id}-rem-${l.remainingAmount}`}
                        onBlur={(e) => {
                          if (e.target.value !== l.remainingAmount)
                            patchMut.mutate({ id: l.id, remainingAmount: e.target.value });
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
                        className="input !w-14 !py-1 text-center"
                        type="number"
                        min={1}
                        max={31}
                        defaultValue={l.paymentDay ?? ""}
                        key={`${l.id}-day-${l.paymentDay}`}
                        title="Jour de prélèvement (1–31)"
                        onBlur={(e) => {
                          const v = e.target.value;
                          const cur = l.paymentDay != null ? String(l.paymentDay) : "";
                          if (v !== cur)
                            patchMut.mutate({
                              id: l.id,
                              paymentDay: v === "" ? null : v,
                            });
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <div className="flex flex-col gap-0.5">
                        <span>
                          {l.startDate ? formatDate(l.startDate) : "—"} →{" "}
                          {l.endDate ? formatDate(l.endDate) : "—"}
                        </span>
                        {l.lastPaymentAppliedAt && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                            Dernier prél. {formatDate(l.lastPaymentAppliedAt)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {l.monthsRemaining != null ? `${l.monthsRemaining} mois` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          title="Remboursement anticipé"
                          onClick={() => {
                            setEarlyId(l.id);
                            setEarlyKind("PARTIAL");
                            setEarlyAmount("");
                            setEarlyDate(new Date().toISOString().slice(0, 10));
                          }}
                        >
                          <Banknote className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Modifier la mensualité"
                          onClick={() => {
                            setAmendId(l.id);
                            setAmendPayment(l.monthlyPayment || "");
                            setAmendDate(new Date().toISOString().slice(0, 10));
                          }}
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMut.mutate(l.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === l.id && (
                    <tr className="border-t border-[var(--border)] bg-zinc-50/50 dark:bg-zinc-900/40">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                          <CalendarClock className="h-3.5 w-3.5" />
                          Historique des événements
                        </div>
                        {l.events.length === 0 ? (
                          <p className="text-xs text-zinc-400">Aucun événement pour l&apos;instant</p>
                        ) : (
                          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                            {l.events.map((e) => (
                              <li
                                key={e.id}
                                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/60 py-1 last:border-0"
                              >
                                <span>
                                  <span className="font-medium">
                                    {EVENT_LABELS[e.type] || e.type}
                                  </span>
                                  {e.notes ? (
                                    <span className="text-zinc-500"> · {e.notes}</span>
                                  ) : null}
                                </span>
                                <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                    Aucun crédit — créez un passif avec date de début, fin et jour de prélèvement
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && (
        <Modal title="Nouveau crédit / passif" onClose={() => setShowCreate(false)}>
          <form
            className="space-y-3"
            onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
          >
            <Field label="Nom">
              <input className="input" {...form.register("name")} placeholder="ex. Crédit immo" />
            </Field>
            <Field label="Banque / prêteur">
              <select className="input" {...form.register("bankName")}>
                <option value="">— Sélectionner —</option>
                {LIABILITY_LENDER_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Montant initial">
                <input className="input" {...form.register("initialAmount")} />
              </Field>
              <Field label="Capital restant dû">
                <input className="input" {...form.register("remainingAmount")} />
              </Field>
              <Field label="Devise">
                <select className="input" {...form.register("currency")}>
                  {["EUR", "USD", "CHF", "GBP"].map((c) => (
                    <option key={c} value={c}>
                      {currencyLabel(c)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Taux d'intérêt %">
                <input className="input" {...form.register("interestRate")} />
              </Field>
              <Field label="Mensualité">
                <input className="input" {...form.register("monthlyPayment")} />
              </Field>
              <Field label="Jour de prélèvement (1–31)">
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="input"
                  {...form.register("paymentDay")}
                />
              </Field>
              <Field label="Date de début">
                <input type="date" className="input" {...form.register("startDate")} />
              </Field>
              <Field label="Date de fin (estimée)">
                <input type="date" className="input" {...form.register("endDate")} />
              </Field>
            </div>
            <Field label="Notes">
              <input className="input" {...form.register("notes")} />
            </Field>
            <p className="text-[11px] text-zinc-500">
              À chaque passage du jour de prélèvement, la mensualité est déduite automatiquement du
              capital restant dû (sans double comptage).
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                Enregistrer
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {earlyId && (
        <Modal title="Remboursement anticipé" onClose={() => setEarlyId(null)}>
          <div className="space-y-3">
            <Field label="Type">
              <select
                className="input"
                value={earlyKind}
                onChange={(e) => setEarlyKind(e.target.value as "PARTIAL" | "TOTAL")}
              >
                <option value="PARTIAL">Partiel</option>
                <option value="TOTAL">Total</option>
              </select>
            </Field>
            {earlyKind === "PARTIAL" && (
              <Field label="Montant">
                <input
                  className="input"
                  value={earlyAmount}
                  onChange={(e) => setEarlyAmount(e.target.value)}
                  placeholder="Montant remboursé"
                />
              </Field>
            )}
            <Field label="Date">
              <input
                type="date"
                className="input"
                value={earlyDate}
                onChange={(e) => setEarlyDate(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEarlyId(null)}>
                Annuler
              </Button>
              <Button
                onClick={() => earlyMut.mutate()}
                disabled={earlyMut.isPending || (earlyKind === "PARTIAL" && !earlyAmount)}
              >
                Valider
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {amendId && (
        <Modal title="Avenant — nouvelle mensualité" onClose={() => setAmendId(null)}>
          <div className="space-y-3">
            <Field label="Nouvelle mensualité">
              <input
                className="input"
                value={amendPayment}
                onChange={(e) => setAmendPayment(e.target.value)}
              />
            </Field>
            <Field label="Date d'effet">
              <input
                type="date"
                className="input"
                value={amendDate}
                onChange={(e) => setAmendDate(e.target.value)}
              />
            </Field>
            <p className="text-[11px] text-zinc-500">
              La durée résiduelle et les intérêts restants estimés sont recalculés sur la base du
              capital restant dû et de cette mensualité.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAmendId(null)}>
                Annuler
              </Button>
              <Button
                onClick={() => amendMut.mutate()}
                disabled={amendMut.isPending || !amendPayment}
              >
                Appliquer
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="card max-h-[90vh] w-[min(66vw,calc(100vw-2rem))] max-w-[66vw] overflow-y-auto p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800/40 hover:text-slate-100"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
