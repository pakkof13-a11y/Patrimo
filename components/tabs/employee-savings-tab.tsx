"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileUp,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { formatCurrency, cn } from "@/app/lib/utils";
import {
  COMMON_MANAGERS,
  EMPLOYEE_SAVINGS_PLAN_TYPES,
  EMPLOYEE_SAVINGS_SOURCES,
  PLAN_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  type EmployeeSavingsLineDto,
  type EmployeeSavingsSummary,
} from "@/app/lib/employee-savings/types";
import { PEE_LOCK_YEARS } from "@/app/lib/employee-savings/logic";
import { CHART_COLORS } from "@/app/lib/types/ui";
import {
  ModuleGuidedEmpty,
  ModuleKpi,
  ModulePageHeader,
  ModuleCard,
  ModuleCardHeader,
  moduleTableHeadClass,
  moduleTableRowClass,
} from "@/components/ui/module-shell";
import {
  emptyEsForm,
  EsChartEmptyState as ChartEmptyState,
  EsFieldLabel as FieldLabel,
  EsFormSection as FormSection,
  lineToEsForm as lineToForm,
  ManagerCombobox,
  planFull,
  planShort,
  UnlockHint,
  type EsFormState as FormState,
} from "@/components/tabs/employee-savings-form-parts";

const emptyForm = emptyEsForm;

export function EmployeeSavingsTab({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const qc = useQueryClient();
  const formRef = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["employee-savings"],
    queryFn: () =>
      fetchJson<{
        lines: EmployeeSavingsLineDto[];
        summary: EmployeeSavingsSummary;
      }>("/api/employee-savings"),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [managerOther, setManagerOther] = useState("");
  const [showUnlockHelp, setShowUnlockHelp] = useState(false);

  const lines = q.data?.lines ?? [];
  const summary = q.data?.summary;
  const hasLines = lines.length > 0;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["employee-savings"] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const manager =
        form.manager === "Autre" ? managerOther.trim() || "Autre" : form.manager;
      const body = {
        planType: form.planType,
        manager,
        fundName: form.fundName,
        isin: form.isin || null,
        units: form.units || "0",
        nav: form.nav || "0",
        currency: form.currency || "EUR",
        sourceType: form.sourceType,
        contributionDate: form.contributionDate || null,
        unlockDate:
          form.unlockMode === "RETIREMENT" ? null : form.unlockDate || null,
        unlockMode: form.unlockMode,
        notes: form.notes || null,
      };
      if (editingId) {
        return fetchJson("/api/employee-savings", {
          method: "PUT",
          body: JSON.stringify({ id: editingId, ...body }),
        });
      }
      return fetchJson("/api/employee-savings", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      toast.success(editingId ? "Position mise à jour" : "Position ajoutée");
      setEditingId(null);
      setForm(emptyForm());
      setManagerOther("");
      setShowForm(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/employee-savings?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Position supprimée");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importMut = useMutation({
    mutationFn: async (csvText: string) =>
      fetchJson<{
        created: number;
        errors: Array<{ line: number; message: string }>;
      }>("/api/employee-savings/import", {
        method: "POST",
        body: JSON.stringify({ csvText }),
      }),
    onSuccess: async (res) => {
      toast.success(`${res.created} position(s) importée(s)`);
      if (res.errors?.length) {
        toast.message(`${res.errors.length} ligne(s) en erreur`);
      }
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const planChart = useMemo(
    () =>
      (summary?.byPlanType || []).map((x, i) => ({
        name: planShort(x.planType || x.name),
        fullName: planFull(x.planType || x.name),
        value: x.value,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [summary]
  );

  const managerChart = useMemo(
    () =>
      (summary?.byManager || []).map((x, i) => ({
        name: x.name,
        value: x.value,
        fill: CHART_COLORS[(i + 2) % CHART_COLORS.length],
      })),
    [summary]
  );

  const total = Number(summary?.totalValue || 0);
  const available = Number(summary?.availableValue || 0);
  const blocked = Number(summary?.blockedValue || 0);
  const availPct = summary?.availablePct ?? 0;
  const blockedPct = summary?.blockedPct ?? 0;

  function scrollToForm() {
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function startEdit(l: EmployeeSavingsLineDto) {
    setEditingId(l.id);
    setForm(lineToForm(l));
    const known = (COMMON_MANAGERS as readonly string[]).includes(l.manager);
    if (!known) {
      setForm((f) => ({ ...f, manager: "Autre" }));
      setManagerOther(l.manager);
    } else {
      setManagerOther("");
    }
    setShowForm(true);
    scrollToForm();
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setManagerOther("");
    setShowForm(true);
    scrollToForm();
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
    setManagerOther("");
  }

  function setPlanType(planType: string) {
    setForm((f) => ({
      ...f,
      planType,
      unlockMode: planType === "PEE" ? "DATE" : "RETIREMENT",
    }));
  }

  function onImportFile(file: File) {
    void file.text().then((text) => importMut.mutate(text));
  }

  const previewValue = useMemo(() => {
    const u = Number(String(form.units).replace(",", "."));
    const n = Number(String(form.nav).replace(",", "."));
    if (!Number.isFinite(u) || !Number.isFinite(n) || u <= 0 || n < 0) return null;
    return u * n;
  }, [form.units, form.nav]);

  return (
    <div className="section-stack" data-testid="employee-savings-tab">
      <ModulePageHeader
        title="Épargne salariale"
        subtitle={
          <>
            Positions{" "}
            <span className="inline-flex items-center gap-0.5 font-medium text-[var(--foreground)]/80">
              FCPE
              <FinanceTip term="FCPE" />
            </span>{" "}
            (PEE, PER, PERCO) — valorisation (parts ×{" "}
            <span className="inline-flex items-center gap-0.5">
              VL
              <FinanceTip term="VL" />
            </span>
            ), origine des fonds et calendrier de déblocage théorique.
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ModuleKpi
          label="Valeur totale"
          value={formatCurrency(summary?.totalValue || "0", baseCurrency)}
          hint={
            hasLines
              ? `${summary?.lineCount ?? 0} position${(summary?.lineCount ?? 0) !== 1 ? "s" : ""} FCPE`
              : "Somme des positions (parts × VL)"
          }
        />
        <ModuleKpi
          label={
            <span className="inline-flex items-center gap-1.5 text-[var(--success)]">
              <Unlock className="h-3.5 w-3.5" />
              Disponible
            </span>
          }
          tip={<FinanceTip term="Déblocage" />}
          value={formatCurrency(summary?.availableValue || "0", baseCurrency)}
          valueClassName="text-[var(--success)]"
          hint={
            hasLines
              ? `${availPct} % du total`
              : "Montant dont la date de déblocage est passée"
          }
        />
        <ModuleKpi
          label={
            <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <Lock className="h-3.5 w-3.5" />
              Bloqué
            </span>
          }
          value={formatCurrency(summary?.blockedValue || "0", baseCurrency)}
          valueClassName="text-amber-700 dark:text-amber-300"
          hint={
            hasLines
              ? `${blockedPct} % du total`
              : "Encore sous contrainte (date future ou retraite)"
          }
        />
        <div className="card p-3.5 sm:p-4">
          <div className="text-label">Liquidité</div>
          {hasLines ? (
            <>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--muted)]">
                <div
                  className="h-full rounded-full bg-[var(--success)] transition-all"
                  style={{ width: `${total > 0 ? availPct : 0}%` }}
                  title="Disponible"
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-[var(--muted-foreground)]">
                <span className="text-[var(--success)]">Dispo {availPct}%</span>
                <span className="text-amber-600 dark:text-amber-400">
                  Bloqué {blockedPct}%
                </span>
              </div>
            </>
          ) : (
            <p className="text-meta mt-2 leading-relaxed">
              Barre disponible / bloqué une fois les positions renseignées.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden p-4">
          <h3 className="text-title mb-0.5">Répartition par plan</h3>
          <p className="text-meta mb-2">
            PEE · PER · PERCO — poids de chaque enveloppe salariale
          </p>
          {planChart.length === 0 ? (
            <ChartEmptyState
              title="Les parts par type de plan apparaîtront ici"
              description="Ajoutez des positions ou importez un CSV pour voir la répartition PEE / PER / PERCO."
              onAdd={startCreate}
            />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={planChart}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {planChart.map((e) => (
                      <Cell key={e.name} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [
                      formatCurrency(String(v ?? 0), baseCurrency),
                      planFull(String(name)),
                    ]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="card overflow-hidden p-4">
          <h3 className="text-title mb-0.5">Répartition par gestionnaire</h3>
          <p className="text-meta mb-2">
            Concentration chez Amundi, Natixis, AXA…
          </p>
          {managerChart.length === 0 ? (
            <ChartEmptyState
              title="La répartition gestionnaires apparaîtra ici"
              description="Chaque position FCPE est rattachée à un gestionnaire d’épargne salariale."
              onAdd={startCreate}
            />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={managerChart}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {managerChart.map((e) => (
                      <Cell key={e.name} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) =>
                      formatCurrency(String(v ?? 0), baseCurrency)
                    }
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* ── Timeline déblocage ── */}
      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-title">Timeline de déblocage</h3>
            <p className="text-meta mt-0.5">
              Projection théorique des montants qui deviennent disponibles
            </p>
          </div>
          <button
            type="button"
            className="text-[11px] font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
            onClick={() => setShowUnlockHelp((v) => !v)}
            aria-expanded={showUnlockHelp}
          >
            {showUnlockHelp ? "Masquer les règles" : "Comprendre le déblocage"}
          </button>
        </div>

        {showUnlockHelp && (
          <div className="mb-3 space-y-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            <p>
              <strong>PEE</strong> — blocage usuel de {PEE_LOCK_YEARS} ans après
              la date de versement. Sans date de déblocage saisie, Patrimo
              calcule versement + {PEE_LOCK_YEARS} ans.
            </p>
            <p>
              <strong>PER / PERCO</strong> — horizon retraite par défaut
              (montant groupé « Retraite »). Passez en « Date fixe » pour un
              déblocage anticipé connu.
            </p>
            <p className="text-slate-500">
              Les cas légaux non saisis (mariage, acquisition résidence, etc.)
              ne sont pas déduits automatiquement — indiquez la date si
              applicable.
            </p>
          </div>
        )}

        {!summary?.unlockTimeline?.length ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/20 px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Le calendrier de liquidité se construira ici
            </p>
            <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-slate-400">
              Après saisie des positions : barres par année de déblocage, montant
              déjà disponible, et part « Retraite » pour PER / PERCO.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={startCreate}>
                <Plus className="h-3.5 w-3.5" />
                Ajouter une position
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  window.open("/api/employee-savings/template", "_blank")
                }
              >
                <Download className="h-3.5 w-3.5" />
                Modèle CSV
              </Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {summary.unlockTimeline.map((b) => {
              const amt = Number(b.amount) || 0;
              const barPct = total > 0 ? Math.max(4, (amt / total) * 100) : 0;
              const isAvail = b.key === "available";
              const isRet = b.key === "retirement";
              return (
                <li key={b.key} className="flex flex-wrap items-center gap-3">
                  <div
                    className={cn(
                      "w-28 shrink-0 text-sm font-medium",
                      isAvail && "text-emerald-600 dark:text-emerald-400",
                      isRet && "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {b.label}
                  </div>
                  <div className="min-w-[8rem] flex-1">
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          isAvail
                            ? "bg-emerald-500"
                            : isRet
                              ? "bg-amber-500"
                              : "bg-teal-600"
                        )}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-32 shrink-0 text-right text-sm font-medium tabular-nums">
                    {formatCurrency(b.amount, baseCurrency)}
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-slate-400">
                    {b.lineCount} pos.
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hasLines && blocked > 0 && available >= 0 && (
          <p className="mt-3 text-[11px] text-slate-400">
            PEE : +{PEE_LOCK_YEARS} ans après versement · PER / PERCO : retraite
            (sauf date fixe saisie).
          </p>
        )}
      </section>

      <ModuleCard>
        <ModuleCardHeader
          title="Positions FCPE"
          subtitle="Saisie manuelle ou import CSV gestionnaire"
          actions={
            <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                window.open("/api/employee-savings/template", "_blank")
              }
            >
              <Download className="h-3.5 w-3.5" />
              Modèle CSV
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs font-medium transition hover:border-[var(--border-strong)] hover:bg-[var(--muted)]/60">
              <FileUp className="h-3.5 w-3.5" />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onImportFile(file);
                }}
              />
            </label>
            <Button
              type="button"
              size="sm"
              onClick={startCreate}
              data-testid="es-add-line"
              aria-expanded={showForm && !editingId}
            >
              <Plus className="h-3.5 w-3.5" />
              {showForm && !editingId ? "Nouvelle position" : "Ajouter"}
            </Button>
            </div>
          }
        />

        {showForm && (
          <div
            ref={formRef}
            className="space-y-3 border-b border-[var(--primary)]/20 bg-[var(--primary-soft)] px-4 py-4 sm:px-5"
            data-testid="es-line-form"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-title text-sm">
                  {editingId ? "Modifier la position" : "Nouvelle position"}
                </h3>
                <p className="text-meta mt-0.5">
                  {editingId
                    ? "Ajustez les champs puis validez avec Enregistrer."
                    : "Remplissez les sections ci-dessous, puis validez. « Ajouter » ouvre uniquement ce formulaire."}
                </p>
              </div>
              {previewValue != null && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-right">
                  <div className="text-label normal-case">Aperçu valeur</div>
                  <div className="kpi-value text-sm">
                    {formatCurrency(String(previewValue), form.currency || "EUR")}
                  </div>
                </div>
              )}
            </div>

            <FormSection
              title="Plan & gestionnaire"
              hint="Enveloppe salariale et teneur de compte / société de gestion."
            >
              <label className="block min-w-0">
                <FieldLabel tip={form.planType}>Type de plan</FieldLabel>
                <select
                  className="input"
                  value={form.planType}
                  onChange={(e) => setPlanType(e.target.value)}
                  data-testid="es-plan-type"
                >
                  {EMPLOYEE_SAVINGS_PLAN_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {PLAN_TYPE_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0 sm:col-span-2">
                <FieldLabel>Gestionnaire</FieldLabel>
                <ManagerCombobox
                  value={form.manager}
                  otherValue={managerOther}
                  onChange={(v) => setForm((f) => ({ ...f, manager: v }))}
                  onOtherChange={setManagerOther}
                />
              </label>
            </FormSection>

            <FormSection
              title="Fonds & valorisation"
              hint="Identité du FCPE et calcul de valeur (parts × VL)."
            >
              <label className="block min-w-0 sm:col-span-2">
                <FieldLabel tip="FCPE">Fonds (FCPE)</FieldLabel>
                <input
                  className="input"
                  value={form.fundName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fundName: e.target.value }))
                  }
                  placeholder="Ex. FCPE Actions Monde…"
                  data-testid="es-fund-name"
                />
              </label>
              <label className="block min-w-0">
                <FieldLabel>ISIN</FieldLabel>
                <input
                  className="input font-mono uppercase"
                  value={form.isin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, isin: e.target.value }))
                  }
                  placeholder="FR001…"
                />
              </label>
              <label className="block min-w-0">
                <FieldLabel>Nombre de parts</FieldLabel>
                <input
                  className="input"
                  value={form.units}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, units: e.target.value }))
                  }
                  inputMode="decimal"
                  data-testid="es-units"
                />
              </label>
              <label className="block min-w-0">
                <FieldLabel tip="VL">Valeur liquidative (VL)</FieldLabel>
                <input
                  className="input"
                  value={form.nav}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nav: e.target.value }))
                  }
                  inputMode="decimal"
                  data-testid="es-nav"
                />
              </label>
              <label className="block min-w-0">
                <FieldLabel>Devise</FieldLabel>
                <input
                  className="input uppercase"
                  value={form.currency}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      currency: e.target.value.toUpperCase(),
                    }))
                  }
                  maxLength={3}
                />
              </label>
            </FormSection>

            <FormSection
              title="Origine des fonds"
              hint="Nature du versement (volontaire, intéressement, participation, abondement)."
            >
              <label className="block min-w-0 sm:col-span-2">
                <FieldLabel tip="Abondement">Origine</FieldLabel>
                <select
                  className="input"
                  value={form.sourceType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sourceType: e.target.value }))
                  }
                >
                  {EMPLOYEE_SAVINGS_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_TYPE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0">
                <FieldLabel>Date de versement</FieldLabel>
                <DateInput
                  value={form.contributionDate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      contributionDate: e.target.value,
                    }))
                  }
                />
              </label>
            </FormSection>

            <FormSection
              title="Déblocage"
              hint="Règle de liquidité théorique pour cette ligne."
            >
              <label className="block min-w-0">
                <FieldLabel tip="Déblocage">Mode de déblocage</FieldLabel>
                <select
                  className="input"
                  value={form.unlockMode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, unlockMode: e.target.value }))
                  }
                  data-testid="es-unlock-mode"
                >
                  <option value="DATE">
                    Date fixe (PEE +{PEE_LOCK_YEARS} ans ou date connue)
                  </option>
                  <option value="RETIREMENT">
                    Retraite (défaut PER / PERCO)
                  </option>
                </select>
                <UnlockHint
                  planType={form.planType}
                  unlockMode={form.unlockMode}
                />
              </label>
              {form.unlockMode === "DATE" && (
                <label className="block min-w-0">
                  <FieldLabel>Date de déblocage</FieldLabel>
                  <DateInput
                    value={form.unlockDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, unlockDate: e.target.value }))
                    }
                    data-testid="es-unlock-date"
                  />
                  <span className="mt-1 block text-[10px] text-slate-400">
                    Optionnel si PEE + date de versement : calcul auto +
                    {PEE_LOCK_YEARS} ans
                  </span>
                </label>
              )}
            </FormSection>

            <FormSection title="Notes">
              <label className="block min-w-0 sm:col-span-2 lg:col-span-3">
                <FieldLabel>Commentaire (optionnel)</FieldLabel>
                <input
                  className="input"
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Référence bulletin, cas de déblocage anticipé…"
                />
              </label>
            </FormSection>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                disabled={saveMut.isPending || !form.fundName.trim()}
                onClick={() => saveMut.mutate()}
                data-testid="es-submit"
              >
                {saveMut.isPending
                  ? "…"
                  : editingId
                    ? "Enregistrer"
                    : "Créer la position"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelForm}
              >
                Annuler
              </Button>
              {!form.fundName.trim() && (
                <span className="text-[11px] text-slate-400">
                  Le nom du fonds est requis pour valider.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tableau */}
        <div className="table-container-responsive table-fluid-wrap">
          <table
            className="table-fluid text-sm"
            data-testid="employee-savings-table"
          >
            <thead className={moduleTableHeadClass}>
              <tr>
                <th className="px-3 py-2.5 text-left">Plan</th>
                <th className="px-3 py-2.5 text-left">Gestionnaire</th>
                <th className="px-3 py-2.5 text-left">Fonds</th>
                <th className="px-3 py-2.5 text-left">ISIN</th>
                <th className="px-3 py-2.5 text-right">Parts</th>
                <th className="px-3 py-2.5 text-right">VL</th>
                <th className="px-3 py-2.5 text-right">Valeur</th>
                <th className="px-3 py-2.5 text-left">Origine</th>
                <th className="px-3 py-2.5 text-left">Déblocage</th>
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
                    Chargement des positions…
                  </td>
                </tr>
              )}
              {!q.isLoading && lines.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-2 py-4">
                    <ModuleGuidedEmpty
                      testId="es-empty"
                      title="Aucune position FCPE pour l’instant"
                      description="Ajoutez une ligne manuellement pour alimenter les KPI et graphiques — ou importez un export gestionnaire via le modèle CSV."
                      bullets={[
                        "Plan (PEE / PER / PERCO) et gestionnaire",
                        "Parts × VL pour la valorisation",
                        "Origine des fonds et date de déblocage",
                      ]}
                      primaryLabel="Ajouter une position"
                      onPrimary={startCreate}
                      primaryTestId="es-empty-add"
                      secondary={
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              "/api/employee-savings/template",
                              "_blank"
                            )
                          }
                        >
                          <Download className="h-3.5 w-3.5" />
                          Télécharger le modèle
                        </Button>
                      }
                    />
                  </td>
                </tr>
              )}
              {lines.map((l) => (
                <tr key={l.id} className={moduleTableRowClass}>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
                      title={planFull(l.planType)}
                    >
                      {planShort(l.planType)}
                    </span>
                  </td>
                  <td className="max-w-[9rem] truncate px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                    {l.manager}
                  </td>
                  <td className="min-w-0 max-w-[12rem] px-3 py-2">
                    <div className="truncate font-medium text-slate-800 dark:text-slate-100">
                      {l.fundName}
                    </div>
                    {l.notes && (
                      <div className="mt-0.5 truncate text-[10px] text-slate-400">
                        {l.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-400">
                    {l.isin || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(l.units).toLocaleString("fr-FR", {
                      maximumFractionDigits: 6,
                    })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {formatCurrency(l.nav, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatCurrency(l.marketValue, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {SOURCE_TYPE_LABELS[l.sourceType] || l.sourceType}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {l.unlockLabel}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                        l.liquidityStatus === "AVAILABLE"
                          ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800/50"
                          : "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/50"
                      )}
                    >
                      {l.liquidityStatus === "AVAILABLE" ? (
                        <Unlock className="h-3 w-3" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                      {l.liquidityStatus === "AVAILABLE"
                        ? "Disponible"
                        : "Bloqué"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                        onClick={() => startEdit(l)}
                        title="Modifier"
                        aria-label="Modifier la position"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        onClick={() => {
                          if (confirm("Supprimer cette position ?")) {
                            delMut.mutate(l.id);
                          }
                        }}
                        title="Supprimer"
                        aria-label="Supprimer la position"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ModuleCard>
    </div>
  );
}
