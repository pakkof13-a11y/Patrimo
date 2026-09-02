"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  type AlternativesDashboardPayload,
  CL_PAYMENT_FREQUENCIES,
  CL_PAYMENT_FREQUENCY_LABELS,
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
import { moduleTableHeadClass } from "@/components/ui/module-shell";

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
  // Mode expert — suivi de l'encours et des flux réellement perçus
  remainingCapital: string;
  interestReceivedToDate: string;
  paymentFrequency: string;
  nextPaymentDate: string;
  riskGrade: string;
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
  remainingCapital: "",
  interestReceivedToDate: "",
  paymentFrequency: "MONTHLY",
  nextPaymentDate: "",
  riskGrade: "",
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
    remainingCapital: l.remainingCapital,
    interestReceivedToDate: l.interestReceivedToDate,
    paymentFrequency: l.paymentFrequency,
    nextPaymentDate: l.nextPaymentDate || "",
    riskGrade: l.riskGrade || "",
  };
}

/**
 * Une ligne mérite le mode expert ouvert d'emblée dès qu'un de ses champs
 * avancés porte une valeur : la refermer masquerait des données saisies.
 */
function hasExpertData(l: CrowdlendingDto): boolean {
  return (
    Number(l.remainingCapital) > 0 ||
    Number(l.interestReceivedToDate) > 0 ||
    l.paymentFrequency !== "MONTHLY" ||
    !!l.nextPaymentDate ||
    !!l.riskGrade
  );
}

type RowFlags = { overdue: boolean; soon: boolean };

/** Source unique pour la coloration du tableau et les filtres rapides. */
function rowFlags(l: CrowdlendingDto): RowFlags {
  return {
    overdue:
      l.monthsRemaining != null &&
      l.monthsRemaining < 0 &&
      l.status !== "REPAID",
    soon:
      l.monthsRemaining != null &&
      l.monthsRemaining >= 0 &&
      l.monthsRemaining <= 3 &&
      l.status === "ACTIVE",
  };
}

const FILTERS = ["ALL", "ACTIVE", "LATE", "SOON"] as const;
type FilterKey = (typeof FILTERS)[number];

const FILTER_LABELS: Record<FilterKey, string> = {
  ALL: "Tous",
  ACTIVE: "Actifs",
  LATE: "En retard",
  SOON: "Échus bientôt",
};

function matchesFilter(l: CrowdlendingDto, filter: FilterKey): boolean {
  if (filter === "ALL") return true;
  const { overdue, soon } = rowFlags(l);
  if (filter === "ACTIVE") return l.status === "ACTIVE";
  // « En retard » couvre le statut déclaré et l'échéance dépassée sans
  // remboursement : les deux appellent la même relance côté plateforme.
  if (filter === "LATE") return l.status === "LATE" || overdue;
  return soon;
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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR");
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
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
  /**
   * Même queryKey que le dashboard Alternatifs — cache partagé (staleTime
   * 60s) : coût réseau nul si le dashboard a déjà été visité récemment.
   * Sert uniquement au KPI « Rôle dans la poche » ci-dessous.
   */
  const altSummaryQ = useQuery({
    queryKey: ["alternatives-summary", "dashboard"],
    queryFn: () =>
      fetchJson<AlternativesDashboardPayload>("/api/alternatives/summary"),
    staleTime: 60_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expert, setExpert] = useState(false);
  const [form, setForm] = useState<FormState>(empty());
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [deleteTarget, setDeleteTarget] = useState<CrowdlendingDto | null>(
    null
  );

  const lines = useMemo(() => q.data?.lines ?? [], [q.data?.lines]);
  const summary = q.data?.summary;
  const hasLines = lines.length > 0;

  const totalAlt = Number(altSummaryQ.data?.summary.totalEur ?? 0);
  const clShareOfAlt =
    totalAlt > 0 && summary
      ? (Number(summary.totalCapital) / totalAlt) * 100
      : null;

  const counts = useMemo(() => {
    const out = { ALL: lines.length, ACTIVE: 0, LATE: 0, SOON: 0 };
    for (const l of lines) {
      if (matchesFilter(l, "ACTIVE")) out.ACTIVE += 1;
      if (matchesFilter(l, "LATE")) out.LATE += 1;
      if (matchesFilter(l, "SOON")) out.SOON += 1;
    }
    return out as Record<FilterKey, number>;
  }, [lines]);

  const visible = useMemo(
    () => lines.filter((l) => matchesFilter(l, filter)),
    [lines, filter]
  );

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
        // Toujours transmis, y compris en mode simple : `toForm` a chargé les
        // valeurs existantes, les omettre reviendrait à les effacer côté API.
        remainingCapital: form.remainingCapital || "0",
        interestReceivedToDate: form.interestReceivedToDate || "0",
        paymentFrequency: form.paymentFrequency,
        nextPaymentDate: form.nextPaymentDate || null,
        riskGrade: form.riskGrade || null,
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
      setExpert(false);
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
    setExpert(false);
    setShowForm(true);
  }

  function startEdit(l: CrowdlendingDto) {
    setEditingId(l.id);
    setForm(toForm(l));
    setExpert(hasExpertData(l));
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(empty());
    setExpert(false);
  }

  return (
    <AltModuleShell
      testId="crowdlending-section"
      title="Crowdlending & dette privée"
      subtitle="Prêts participatifs — capital engagé, encours restant dû, flux d’intérêts et compte à rebours jusqu’au remboursement"
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
            label="Capital en cours"
            value={formatCurrency(summary?.activeCapital || "0", baseCurrency)}
            hint={
              clShareOfAlt != null
                ? `Sur ${formatCurrency(summary?.totalCapital || "0", baseCurrency)} engagés · ${clShareOfAlt.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de la poche alt.`
                : `Sur ${formatCurrency(summary?.totalCapital || "0", baseCurrency)} engagés`
            }
            tip={<FinanceTip term="Capital en cours" />}
            loading={q.isPending}
          />
          <AltMiniKpi
            label="Rendement moyen pondéré"
            value={fmtPct(summary?.weightedAverageYield)}
            hint="Pondéré par le capital restant dû"
            loading={q.isPending}
          />
          <AltMiniKpi
            label="Revenu annuel projeté"
            value={formatCurrency(
              summary?.projectedAnnualIncome || "0",
              baseCurrency
            )}
            hint="Au taux nominal, sur l’encours actif"
            loading={q.isPending}
          />
          <AltMiniKpi
            label="Projets"
            value={String(summary?.lineCount ?? 0)}
            hint={`Intérêts perçus : ${formatCurrency(
              summary?.interestReceivedTotal || "0",
              baseCurrency
            )}`}
            loading={q.isPending}
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
                className="input w-full"
                value={form.projectName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, projectName: e.target.value }))
                }
                data-testid="cl-project"
              />
            </AltField>
            <AltField label="Plateforme">
              <input
                className="input w-full"
                placeholder="October, Bienprêter…"
                value={form.platform}
                onChange={(e) =>
                  setForm((f) => ({ ...f, platform: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Statut">
              <select
                className="input w-full"
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
                className="input w-full"
                inputMode="decimal"
                value={form.capitalInvested}
                onChange={(e) =>
                  setForm((f) => ({ ...f, capitalInvested: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Taux annuel (%)">
              <input
                className="input w-full"
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
                className="input w-full"
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
                className="input w-full uppercase"
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
                className="input w-full"
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
                className="input w-full"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </AltField>
          </AltFormSection>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            aria-expanded={expert}
            onClick={() => setExpert((v) => !v)}
            data-testid="cl-expert-toggle"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expert && "rotate-180")}
            />
            Mode expert — encours, flux perçus et risque
          </button>

          {expert && (
            <div className="space-y-3" data-testid="cl-expert">
              <AltFormSection
                title="Suivi de l’encours"
                hint="Laissez vide tant qu’aucun remboursement partiel n’a eu lieu : le capital initial est alors considéré comme restant dû."
                cols={2}
              >
                <AltField
                  label="Capital restant dû"
                  hint="0 ou vide = capital initial (sauf prêt remboursé)"
                >
                  <input
                    className="input w-full"
                    inputMode="decimal"
                    value={form.remainingCapital}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, remainingCapital: e.target.value }))
                    }
                    data-testid="cl-remaining-capital"
                  />
                </AltField>
                <AltField
                  label="Intérêts perçus à ce jour"
                  hint="Cumul encaissé, hors capital remboursé"
                >
                  <input
                    className="input w-full"
                    inputMode="decimal"
                    value={form.interestReceivedToDate}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        interestReceivedToDate: e.target.value,
                      }))
                    }
                    data-testid="cl-interest-received"
                  />
                </AltField>
              </AltFormSection>

              <AltFormSection
                title="Flux & risque"
                hint="Rythme de versement des intérêts et notation de la plateforme."
              >
                <AltField
                  label="Fréquence de versement"
                  hint="Porte sur les intérêts, indépendamment du type de remboursement du capital"
                >
                  <select
                    className="input w-full"
                    value={form.paymentFrequency}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, paymentFrequency: e.target.value }))
                    }
                    data-testid="cl-payment-frequency"
                  >
                    {CL_PAYMENT_FREQUENCIES.map((p) => (
                      <option key={p} value={p}>
                        {CL_PAYMENT_FREQUENCY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </AltField>
                <AltField label="Prochain versement">
                  <DateInput
                    value={form.nextPaymentDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nextPaymentDate: e.target.value }))
                    }
                  />
                </AltField>
                <AltField
                  label="Notation de risque"
                  hint="Grade plateforme : A, B, C… ou saisie libre"
                >
                  <input
                    className="input w-full"
                    maxLength={12}
                    placeholder="A, B+, C…"
                    value={form.riskGrade}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, riskGrade: e.target.value }))
                    }
                    data-testid="cl-risk-grade"
                  />
                </AltField>
              </AltFormSection>
            </div>
          )}
        </AltFormPanel>
      }
    >
      {!q.isLoading && !hasLines && !showForm ? (
        <AltEmptyState
          title="Aucun prêt crowdlending"
          description="Suivez le capital engagé, l’encours restant dû, les intérêts déjà perçus et le compte à rebours jusqu’à l’échéance."
          bullets={[
            "Projet, plateforme, capital et taux annuel",
            "Date de début + durée → échéance théorique automatique",
            "Statut (actif, en retard, remboursé, défaut) et progression",
            "Mode expert : restant dû, intérêts perçus, fréquence des versements et notation de risque",
          ]}
          primaryLabel="Nouveau prêt"
          onPrimary={startCreate}
          primaryTestId="cl-empty-add"
        />
      ) : (
        <>
          {hasLines && (
            <div
              className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2.5 sm:px-5"
              data-testid="cl-filters"
            >
              <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
                Filtres
              </span>
              <div
                className="inline-flex rounded-md border border-[var(--border)] p-0.5"
                role="group"
                aria-label="Filtrer les prêts"
              >
                {FILTERS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "rounded px-2 py-1 text-[11px] font-medium transition",
                      filter === key
                        ? "bg-teal-700 text-white"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    )}
                    aria-pressed={filter === key}
                    data-testid={`cl-filter-${key.toLowerCase()}`}
                    onClick={() => setFilter(key)}
                  >
                    {FILTER_LABELS[key]}
                    <span className="ml-1 opacity-60 tabular-nums">
                      {counts[key]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="table-container-responsive table-fluid-wrap">
            <table className="table-fluid text-sm" data-testid="crowdlending-table">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th className="px-3 py-2.5 text-left">Projet</th>
                  <th className="px-3 py-2.5 text-left">Plateforme</th>
                  <th className="px-3 py-2.5 text-right">Capital</th>
                  <th className="px-3 py-2.5 text-right">Taux</th>
                  <th className="px-3 py-2.5 text-left">Remb.</th>
                  <th className="px-3 py-2.5 text-right">Intérêts</th>
                  <th className="px-3 py-2.5 text-left">Échéance</th>
                  <th className="px-3 py-2.5 text-left">Prochain flux</th>
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
                      colSpan={11}
                      className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]"
                    >
                      Chargement…
                    </td>
                  </tr>
                )}
                {!q.isLoading && hasLines && visible.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]"
                      data-testid="cl-no-match"
                    >
                      Aucun prêt ne correspond au filtre «{" "}
                      {FILTER_LABELS[filter]} ».
                    </td>
                  </tr>
                )}
                {visible.map((l) => {
                  const { overdue, soon } = rowFlags(l);
                  return (
                    <tr
                      key={l.id}
                      className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35"
                    >
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>{l.projectName}</span>
                          {l.riskGrade && <RiskBadge grade={l.riskGrade} />}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                        {l.platform || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatCurrency(l.capitalInvested, l.currency)}
                        <div
                          className={cn(
                            "text-[10px] font-normal",
                            l.remainingCapitalIsDerived
                              ? "text-[var(--muted-foreground)]"
                              : "text-[var(--muted-foreground)]"
                          )}
                          title={
                            l.remainingCapitalIsDerived
                              ? "Déduit du capital initial — aucun remboursement partiel saisi"
                              : "Capital restant dû saisi"
                          }
                        >
                          {formatCurrency(l.effectiveRemainingCapital, l.currency)}{" "}
                          dû
                          {l.remainingCapitalIsDerived && " *"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(l.annualYieldPercent).toLocaleString("fr-FR", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        %
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {CL_REPAYMENT_LABELS[l.repaymentType]}
                        <div className="text-[10px] text-[var(--muted-foreground)]">
                          {CL_PAYMENT_FREQUENCY_LABELS[l.paymentFrequency]}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        <span className="val-positive font-medium">
                          {formatCurrency(l.interestReceivedToDate, l.currency)}
                        </span>
                        <div
                          className="text-[10px] text-[var(--muted-foreground)]"
                          title="Estimation des intérêts totaux sur la durée du prêt"
                        >
                          / {formatCurrency(l.expectedTotalInterest, l.currency)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums text-[var(--muted-foreground)]">
                        {l.maturityDate
                          ? new Date(l.maturityDate).toLocaleDateString("fr-FR")
                          : "—"}
                        <div className="text-[10px] text-[var(--muted-foreground)]">
                          {l.durationMonths} mois
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums text-[var(--muted-foreground)]">
                        {fmtDate(l.nextPaymentDate)}
                      </td>
                      <td className="px-3 py-2">
                        <div
                          className={cn(
                            "text-xs font-medium",
                            overdue && "text-[var(--danger)]",
                            soon && "text-[var(--warning)]",
                            !overdue &&
                              !soon &&
                              "text-[var(--muted-foreground)]"
                          )}
                        >
                          {countdownLabel(l.monthsRemaining, l.status)}
                        </div>
                        {l.progressPct != null && l.status !== "REPAID" && (
                          <div className="mt-1 h-1.5 w-full max-w-[8rem] overflow-hidden rounded-full bg-[var(--muted)]">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                overdue
                                  ? "bg-[var(--danger)]"
                                  : soon
                                    ? "bg-[var(--warning)]"
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
                            className="!h-7 !w-7 !px-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                            onClick={() => startEdit(l)}
                            aria-label="Modifier"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="!h-7 !w-7 !px-0 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                            onClick={() => setDeleteTarget(l)}
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
          {visible.some((l) => l.remainingCapitalIsDerived) && (
            <p className="px-4 py-2 text-[10px] text-[var(--muted-foreground)] sm:px-5">
              * Capital restant dû déduit du capital initial — saisissez-le en
              mode expert pour suivre les remboursements partiels.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        title="Supprimer le prêt"
        message={
          deleteTarget
            ? `« ${deleteTarget.projectName} » sera définitivement supprimé. Cette action est irréversible.`
            : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) delMut.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        testId="cl-delete-confirm"
      />
    </AltModuleShell>
  );
}

function RiskBadge({ grade }: { grade: string }) {
  return (
    <span
      className="inline-flex rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-[var(--muted-foreground)] ring-1 ring-inset ring-[var(--border)]"
      title="Notation de risque plateforme"
    >
      {grade}
    </span>
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
