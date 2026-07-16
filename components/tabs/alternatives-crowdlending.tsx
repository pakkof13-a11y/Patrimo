"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  CL_REPAYMENT_LABELS,
  CL_REPAYMENT_TYPES,
  CL_STATUS_LABELS,
  CL_STATUSES,
  type CrowdlendingDto,
  type CrowdlendingSummary,
} from "@/app/lib/alternatives/types";

type FormState = {
  projectName: string;
  platform: string;
  capitalInvested: string;
  annualYieldPercent: string;
  durationMonths: string;
  repaymentType: string;
  startDate: string;
  maturityDate: string;
  status: string;
  currency: string;
  notes: string;
};

const empty = (): FormState => ({
  projectName: "",
  platform: "",
  capitalInvested: "",
  annualYieldPercent: "",
  durationMonths: "24",
  repaymentType: "IN_FINE",
  startDate: "",
  maturityDate: "",
  status: "ACTIVE",
  currency: "EUR",
  notes: "",
});

function toForm(l: CrowdlendingDto): FormState {
  return {
    projectName: l.projectName,
    platform: l.platform || "",
    capitalInvested: l.capitalInvested,
    annualYieldPercent: l.annualYieldPercent,
    durationMonths: String(l.durationMonths),
    repaymentType: l.repaymentType,
    startDate: l.startDate || "",
    maturityDate: l.maturityDate || "",
    status: l.status,
    currency: l.currency,
    notes: l.notes || "",
  };
}

function countdownLabel(months: number | null, status: string): string {
  if (status === "REPAID") return "Remboursé";
  if (status === "DEFAULT") return "Défaut";
  if (months == null) return "—";
  if (months < 0) return `Échu depuis ${Math.abs(months)} mois`;
  if (months === 0) return "Échéance ce mois";
  if (months === 1) return "1 mois restant";
  return `${months} mois restants`;
}

export function AlternativesCrowdlending({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["crowdlending"],
    queryFn: () =>
      fetchJson<{ lines: CrowdlendingDto[]; summary: CrowdlendingSummary }>(
        "/api/crowdlending"
      ),
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty());

  const lines = q.data?.lines ?? [];
  const summary = q.data?.summary;

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        projectName: form.projectName,
        platform: form.platform || null,
        capitalInvested: form.capitalInvested || "0",
        annualYieldPercent: form.annualYieldPercent || "0",
        durationMonths: form.durationMonths || 12,
        repaymentType: form.repaymentType,
        startDate: form.startDate || null,
        maturityDate: form.maturityDate || null,
        status: form.status,
        currency: form.currency || "EUR",
        notes: form.notes || null,
      };
      if (editingId) {
        return fetchJson("/api/crowdlending", {
          method: "PUT",
          body: JSON.stringify({ id: editingId, ...body }),
        });
      }
      return fetchJson("/api/crowdlending", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      toast.success(editingId ? "Prêt mis à jour" : "Prêt ajouté");
      setEditingId(null);
      setForm(empty());
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["crowdlending"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/crowdlending?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Prêt supprimé");
      await qc.invalidateQueries({ queryKey: ["crowdlending"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="card overflow-hidden" data-testid="crowdlending-section">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Crowdlending & Dette privée</h2>
          <p className="text-xs text-zinc-500">
            Prêts participatifs · échéance et compte à rebours en mois
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditingId(null);
            setForm(empty());
            setShowForm(true);
          }}
          data-testid="cl-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouveau prêt
        </Button>
      </div>

      <div className="grid gap-2 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Capital total</div>
          <div className="text-sm font-semibold tabular-nums">
            {formatCurrency(summary?.totalCapital || "0", baseCurrency)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Capital en cours</div>
          <div className="text-sm font-semibold tabular-nums">
            {formatCurrency(summary?.activeCapital || "0", baseCurrency)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Projets</div>
          <div className="text-sm font-semibold">{summary?.lineCount ?? 0}</div>
        </div>
      </div>

      {showForm && (
        <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editingId ? "Modifier" : "Ajouter"} — Crowdlending
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs">
              Nom du projet
              <input
                className="input mt-1"
                value={form.projectName}
                onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Plateforme
              <input
                className="input mt-1"
                placeholder="October, Bienprêter…"
                value={form.platform}
                onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Capital investi
              <input
                className="input mt-1"
                inputMode="decimal"
                value={form.capitalInvested}
                onChange={(e) =>
                  setForm((f) => ({ ...f, capitalInvested: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Taux annuel (%)
              <input
                className="input mt-1"
                inputMode="decimal"
                value={form.annualYieldPercent}
                onChange={(e) =>
                  setForm((f) => ({ ...f, annualYieldPercent: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Durée (mois)
              <input
                className="input mt-1"
                inputMode="numeric"
                value={form.durationMonths}
                onChange={(e) =>
                  setForm((f) => ({ ...f, durationMonths: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Remboursement
              <select
                className="input mt-1"
                value={form.repaymentType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, repaymentType: e.target.value }))
                }
              >
                {CL_REPAYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CL_REPAYMENT_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Date de début
              <input
                type="date"
                className="input mt-1"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Échéance théorique
              <input
                type="date"
                className="input mt-1"
                value={form.maturityDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maturityDate: e.target.value }))
                }
              />
              <span className="mt-0.5 block text-[10px] text-zinc-400">
                Auto si vide : début + durée
              </span>
            </label>
            <label className="text-xs">
              Statut
              <select
                className="input mt-1"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {CL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CL_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Devise
              <input
                className="input mt-1"
                maxLength={3}
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              />
            </label>
            <label className="text-xs sm:col-span-2">
              Notes
              <input
                className="input mt-1"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saveMut.isPending || !form.projectName.trim()}
              onClick={() => saveMut.mutate()}
            >
              {editingId ? "Enregistrer" : "Créer"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      <div className="table-container-responsive table-fluid-wrap">
        <table className="table-fluid text-sm" data-testid="crowdlending-table">
          <thead className="table-head text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">Projet</th>
              <th className="px-3 py-2 text-left">Plateforme</th>
              <th className="px-3 py-2 text-right">Capital</th>
              <th className="px-3 py-2 text-right">Taux</th>
              <th className="px-3 py-2 text-left">Remb.</th>
              <th className="px-3 py-2 text-left">Échéance</th>
              <th className="px-3 py-2 text-left min-w-[10rem]">Compte à rebours</th>
              <th className="px-3 py-2 text-left">Statut</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                  Chargement…
                </td>
              </tr>
            )}
            {!q.isLoading && lines.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                  Aucun prêt — ajoutez un projet crowdlending
                </td>
              </tr>
            )}
            {lines.map((l) => {
              const overdue =
                l.monthsRemaining != null &&
                l.monthsRemaining < 0 &&
                l.status !== "REPAID";
              const soon =
                l.monthsRemaining != null &&
                l.monthsRemaining >= 0 &&
                l.monthsRemaining <= 3 &&
                l.status === "ACTIVE";
              return (
                <tr key={l.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-medium">{l.projectName}</td>
                  <td className="px-3 py-2 text-xs">{l.platform || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatCurrency(l.capitalInvested, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(l.annualYieldPercent).toLocaleString("fr-FR", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    %
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {CL_REPAYMENT_LABELS[l.repaymentType]}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {l.maturityDate
                      ? new Date(l.maturityDate).toLocaleDateString("fr-FR")
                      : "—"}
                    <div className="text-[10px] text-zinc-400">
                      {l.durationMonths} mois
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div
                      className={cn(
                        "text-xs font-medium",
                        overdue && "text-red-600 dark:text-red-400",
                        soon && "text-amber-600 dark:text-amber-400",
                        !overdue && !soon && "text-zinc-600 dark:text-zinc-300"
                      )}
                    >
                      {countdownLabel(l.monthsRemaining, l.status)}
                    </div>
                    {l.progressPct != null && l.status !== "REPAID" && (
                      <div className="mt-1 h-1.5 w-full max-w-[8rem] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            overdue
                              ? "bg-red-500"
                              : soon
                                ? "bg-amber-500"
                                : "bg-teal-600"
                          )}
                          style={{ width: `${l.progressPct}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(l.id);
                          setForm(toForm(l));
                          setShowForm(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(`Supprimer « ${l.projectName} » ?`)) {
                            delMut.mutate(l.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: CrowdlendingDto["status"] }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    LATE: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    REPAID: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    DEFAULT: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
        styles[status] || styles.ACTIVE
      )}
    >
      {CL_STATUS_LABELS[status]}
    </span>
  );
}
