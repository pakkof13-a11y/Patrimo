"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  CL_REPAYMENT_LABELS,
  CL_REPAYMENT_TYPES,
  CL_STATUS_LABELS,
  CL_STATUSES,
  type CrowdlendingDto,
  type CrowdlendingSummary,
} from "@/app/lib/alternatives/types";
import {
  AltEmptyState,
  AltField,
  AltFormPanel,
  AltFormSection,
  AltMiniKpi,
  AltModuleShell,
} from "@/components/tabs/alternatives-shell";

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

/** Preview: start + duration months → ISO date YYYY-MM-DD */
function autoMaturityPreview(
  startDate: string,
  durationMonths: string
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const months = Number(durationMonths);
  if (!Number.isFinite(months) || months <= 0) return null;
  const d = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + Math.floor(months));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const hasLines = lines.length > 0;

  const maturityPreview = useMemo(
    () => autoMaturityPreview(form.startDate, form.durationMonths),
    [form.startDate, form.durationMonths]
  );

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["crowdlending"] }),
      qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
    ]);
  }

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
      await invalidate();
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
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startCreate() {
    setEditingId(null);
    setForm(empty());
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(empty());
  }

  return (
    <AltModuleShell
      testId="crowdlending-section"
      title="Crowdlending & dette privée"
      subtitle="Prêts participatifs — capital engagé, échéance théorique et compte à rebours jusqu’au remboursement"
      action={
        <Button
          type="button"
          size="sm"
          onClick={startCreate}
          data-testid="cl-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouveau prêt
        </Button>
      }
      kpis={
        <>
          <AltMiniKpi
            label="Capital total"
            value={formatCurrency(summary?.totalCapital || "0", baseCurrency)}
            hint="Tous statuts confondus"
          />
          <AltMiniKpi
            label="Capital en cours"
            value={formatCurrency(summary?.activeCapital || "0", baseCurrency)}
            hint="Prêts encore actifs"
            tip={<FinanceTip term="Capital en cours" />}
          />
          <AltMiniKpi
            label="Projets"
            value={String(summary?.lineCount ?? 0)}
            hint="Lignes enregistrées"
          />
          <AltMiniKpi
            label="Rôle dans la poche"
            value="Alternatif"
            hint="Intégré au dashboard Alternatifs"
          />
        </>
      }
      formOpen={showForm}
      form={
        <AltFormPanel
          title={editingId ? "Modifier le prêt" : "Nouveau prêt"}
          hint="« Nouveau prêt » ouvre ce panneau. L’échéance peut être calculée automatiquement (début + durée)."
          testId="cl-form"
          actions={
            <>
              <Button
                type="button"
                size="sm"
                disabled={saveMut.isPending || !form.projectName.trim()}
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending
                  ? "…"
                  : editingId
                    ? "Enregistrer"
                    : "Créer le prêt"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={cancelForm}>
                Annuler
              </Button>
            </>
          }
        >
          <AltFormSection title="Projet" hint="Identité du prêt et plateforme.">
            <AltField label="Nom du projet">
              <input
                className="input"
                value={form.projectName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, projectName: e.target.value }))
                }
                data-testid="cl-project"
              />
            </AltField>
            <AltField label="Plateforme">
              <input
                className="input"
                placeholder="October, Bienprêter…"
                value={form.platform}
                onChange={(e) =>
                  setForm((f) => ({ ...f, platform: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Statut">
              <select
                className="input"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value }))
                }
              >
                {CL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CL_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </AltField>
          </AltFormSection>

          <AltFormSection
            title="Capital & rendement"
            hint="Montant engagé, taux et type de remboursement."
          >
            <AltField label="Capital investi">
              <input
                className="input"
                inputMode="decimal"
                value={form.capitalInvested}
                onChange={(e) =>
                  setForm((f) => ({ ...f, capitalInvested: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Taux annuel (%)">
              <input
                className="input"
                inputMode="decimal"
                value={form.annualYieldPercent}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    annualYieldPercent: e.target.value,
                  }))
                }
              />
            </AltField>
            <AltField label="Remboursement">
              <select
                className="input"
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
            </AltField>
            <AltField label="Devise">
              <input
                className="input uppercase"
                maxLength={3}
                value={form.currency}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    currency: e.target.value.toUpperCase(),
                  }))
                }
              />
            </AltField>
          </AltFormSection>

          <AltFormSection
            title="Calendrier"
            hint="Début + durée → échéance auto si le champ échéance est laissé vide."
          >
            <AltField label="Date de début">
              <DateInput
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startDate: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Durée (mois)">
              <input
                className="input"
                inputMode="numeric"
                value={form.durationMonths}
                onChange={(e) =>
                  setForm((f) => ({ ...f, durationMonths: e.target.value }))
                }
              />
            </AltField>
            <AltField
              label={
                <span className="inline-flex items-center gap-1">
                  Échéance théorique
                  <FinanceTip term="Échéance" />
                </span>
              }
              hint={
                form.maturityDate
                  ? "Date manuelle prioritaire"
                  : maturityPreview
                    ? `Auto si vide : ${new Date(maturityPreview + "T12:00:00").toLocaleDateString("fr-FR")} (début + durée)`
                    : "Renseignez début + durée pour un calcul automatique"
              }
            >
              <DateInput
                value={form.maturityDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maturityDate: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Notes" className="sm:col-span-2 lg:col-span-3">
              <input
                className="input"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </AltField>
          </AltFormSection>
        </AltFormPanel>
      }
    >
      {!q.isLoading && !hasLines && !showForm ? (
        <AltEmptyState
          title="Aucun prêt crowdlending"
          description="Suivez le capital engagé, le taux, le type de remboursement et le compte à rebours jusqu’à l’échéance."
          bullets={[
            "Projet, plateforme, capital et taux annuel",
            "Date de début + durée → échéance théorique automatique",
            "Statut (actif, en retard, remboursé, défaut) et progression",
          ]}
          primaryLabel="Nouveau prêt"
          onPrimary={startCreate}
          primaryTestId="cl-empty-add"
        />
      ) : (
        <div className="table-container-responsive table-fluid-wrap">
          <table className="table-fluid text-sm" data-testid="crowdlending-table">
            <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Projet</th>
                <th className="px-3 py-2.5 text-left">Plateforme</th>
                <th className="px-3 py-2.5 text-right">Capital</th>
                <th className="px-3 py-2.5 text-right">Taux</th>
                <th className="px-3 py-2.5 text-left">Remb.</th>
                <th className="px-3 py-2.5 text-left">Échéance</th>
                <th className="min-w-[10rem] px-3 py-2.5 text-left">
                  Compte à rebours
                </th>
                <th className="px-3 py-2.5 text-left">Statut</th>
                <th className="px-3 py-2.5 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-sm text-slate-400"
                  >
                    Chargement…
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
                  <tr
                    key={l.id}
                    className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35"
                  >
                    <td className="px-3 py-2 font-medium">{l.projectName}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {l.platform || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
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
                    <td className="px-3 py-2 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                      {l.maturityDate
                        ? new Date(l.maturityDate).toLocaleDateString("fr-FR")
                        : "—"}
                      <div className="text-[10px] text-slate-400">
                        {l.durationMonths} mois
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div
                        className={cn(
                          "text-xs font-medium",
                          overdue && "text-red-600 dark:text-red-400",
                          soon && "text-amber-600 dark:text-amber-400",
                          !overdue &&
                            !soon &&
                            "text-slate-600 dark:text-slate-300"
                        )}
                      >
                        {countdownLabel(l.monthsRemaining, l.status)}
                      </div>
                      {l.progressPct != null && l.status !== "REPAID" && (
                        <div className="mt-1 h-1.5 w-full max-w-[8rem] overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
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
                    <td className="px-2 py-1.5 text-right">
                      <div className="inline-flex gap-0.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
                          onClick={() => {
                            setEditingId(l.id);
                            setForm(toForm(l));
                            setShowForm(true);
                          }}
                          aria-label="Modifier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600"
                          onClick={() => {
                            if (confirm(`Supprimer « ${l.projectName} » ?`)) {
                              delMut.mutate(l.id);
                            }
                          }}
                          aria-label="Supprimer"
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
      )}
    </AltModuleShell>
  );
}

function StatusBadge({ status }: { status: CrowdlendingDto["status"] }) {
  const styles: Record<string, string> = {
    ACTIVE:
      "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800/50",
    LATE: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/50",
    REPAID:
      "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
    DEFAULT:
      "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200/80 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-800/50",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        styles[status] || styles.ACTIVE
      )}
    >
      {CL_STATUS_LABELS[status]}
    </span>
  );
}
