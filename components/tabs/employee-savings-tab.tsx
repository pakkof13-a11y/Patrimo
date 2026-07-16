"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
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
import { CHART_COLORS } from "@/app/lib/types/ui";

type FormState = {
  planType: string;
  manager: string;
  fundName: string;
  isin: string;
  units: string;
  nav: string;
  currency: string;
  sourceType: string;
  contributionDate: string;
  unlockDate: string;
  unlockMode: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  planType: "PEE",
  manager: "Amundi",
  fundName: "",
  isin: "",
  units: "",
  nav: "",
  currency: "EUR",
  sourceType: "VOLUNTARY",
  contributionDate: "",
  unlockDate: "",
  unlockMode: "DATE",
  notes: "",
});

function lineToForm(l: EmployeeSavingsLineDto): FormState {
  return {
    planType: l.planType,
    manager: l.manager,
    fundName: l.fundName,
    isin: l.isin || "",
    units: l.units,
    nav: l.nav,
    currency: l.currency,
    sourceType: l.sourceType,
    contributionDate: l.contributionDate || "",
    unlockDate: l.unlockDate || "",
    unlockMode: l.unlockMode,
    notes: l.notes || "",
  };
}

export function EmployeeSavingsTab({ baseCurrency = "EUR" }: { baseCurrency?: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["employee-savings"],
    queryFn: () =>
      fetchJson<{ lines: EmployeeSavingsLineDto[]; summary: EmployeeSavingsSummary }>(
        "/api/employee-savings"
      ),
  });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [managerOther, setManagerOther] = useState("");

  const lines = q.data?.lines ?? [];
  const summary = q.data?.summary;

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
        unlockDate: form.unlockMode === "RETIREMENT" ? null : form.unlockDate || null,
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
      toast.success(editingId ? "Ligne mise à jour" : "Ligne ajoutée");
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
      toast.success("Ligne supprimée");
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
      toast.success(`${res.created} ligne(s) importée(s)`);
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
        name: x.planType,
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
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setManagerOther("");
    setShowForm(true);
  }

  // When plan type changes, default unlock mode
  function setPlanType(planType: string) {
    setForm((f) => ({
      ...f,
      planType,
      unlockMode: planType === "PEE" ? "DATE" : "RETIREMENT",
    }));
  }

  return (
    <div className="space-y-6" data-testid="employee-savings-tab">
      {/* KPI strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Valeur totale
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatCurrency(summary?.totalValue || "0", baseCurrency)}
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {summary?.lineCount ?? 0} ligne(s) FCPE
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            <Unlock className="h-3.5 w-3.5" />
            Disponible
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {formatCurrency(summary?.availableValue || "0", baseCurrency)}
          </div>
          <div className="mt-1 text-xs text-zinc-400">{availPct} % du total</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <Lock className="h-3.5 w-3.5" />
            Bloqué
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
            {formatCurrency(summary?.blockedValue || "0", baseCurrency)}
          </div>
          <div className="mt-1 text-xs text-zinc-400">{blockedPct} % du total</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Liquidité
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${total > 0 ? availPct : 0}%` }}
              title="Disponible"
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
            <span className="text-emerald-600">Dispo {availPct}%</span>
            <span className="text-amber-600">Bloqué {blockedPct}%</span>
          </div>
        </div>
      </section>

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Répartition par type de plan</h3>
          {planChart.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">Aucune donnée</p>
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
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Répartition par gestionnaire</h3>
          {managerChart.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">Aucune donnée</p>
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

      {/* Unlock timeline */}
      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">Timeline de déblocage</h3>
        {!summary?.unlockTimeline?.length ? (
          <p className="text-sm text-zinc-400">
            Ajoutez des lignes avec date de versement (PEE +5 ans) ou mode retraite.
          </p>
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
                      isAvail && "text-emerald-600",
                      isRet && "text-amber-600"
                    )}
                  >
                    {b.label}
                  </div>
                  <div className="min-w-[8rem] flex-1">
                    <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={cn(
                          "h-full rounded-full",
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
                  <div className="w-32 shrink-0 text-right text-sm tabular-nums font-medium">
                    {formatCurrency(b.amount, baseCurrency)}
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-zinc-400">
                    {b.lineCount} lig.
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {blocked > 0 && available >= 0 && (
          <p className="mt-3 text-[11px] text-zinc-400">
            PEE : déblocage théorique 5 ans après le versement · PER / PERCO : retraite
            (sauf cas de déblocage anticipé saisis en mode « Date »).
          </p>
        )}
      </section>

      {/* Actions + table */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Positions FCPE</h2>
            <p className="text-xs text-zinc-500">
              PEE · PER · PERCO — parts × valeur liquidative
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open("/api/employee-savings/template", "_blank")}
            >
              <Download className="h-3.5 w-3.5" />
              Modèle CSV
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">
              <FileUp className="h-3.5 w-3.5" />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const text = await file.text();
                  importMut.mutate(text);
                }}
              />
            </label>
            <Button type="button" size="sm" onClick={startCreate} data-testid="es-add-line">
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>
        </div>

        {showForm && (
          <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4">
            <h3 className="mb-3 text-sm font-semibold">
              {editingId ? "Modifier la ligne" : "Nouvelle ligne"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs">
                Type de plan
                <select
                  className="input mt-1"
                  value={form.planType}
                  onChange={(e) => setPlanType(e.target.value)}
                >
                  {EMPLOYEE_SAVINGS_PLAN_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {PLAN_TYPE_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Gestionnaire
                <select
                  className="input mt-1"
                  value={form.manager}
                  onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))}
                >
                  {COMMON_MANAGERS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              {form.manager === "Autre" && (
                <label className="text-xs">
                  Nom du gestionnaire
                  <input
                    className="input mt-1"
                    value={managerOther}
                    onChange={(e) => setManagerOther(e.target.value)}
                    placeholder="Ex. Epsens"
                  />
                </label>
              )}
              <label className="text-xs">
                Fonds (FCPE)
                <input
                  className="input mt-1"
                  value={form.fundName}
                  onChange={(e) => setForm((f) => ({ ...f, fundName: e.target.value }))}
                  placeholder="FCPE Actions…"
                />
              </label>
              <label className="text-xs">
                ISIN
                <input
                  className="input mt-1"
                  value={form.isin}
                  onChange={(e) => setForm((f) => ({ ...f, isin: e.target.value }))}
                  placeholder="FR001…"
                />
              </label>
              <label className="text-xs">
                Nombre de parts
                <input
                  className="input mt-1"
                  value={form.units}
                  onChange={(e) => setForm((f) => ({ ...f, units: e.target.value }))}
                  inputMode="decimal"
                />
              </label>
              <label className="text-xs">
                Valeur liquidative (NAV)
                <input
                  className="input mt-1"
                  value={form.nav}
                  onChange={(e) => setForm((f) => ({ ...f, nav: e.target.value }))}
                  inputMode="decimal"
                />
              </label>
              <label className="text-xs">
                Devise
                <input
                  className="input mt-1"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  maxLength={3}
                />
              </label>
              <label className="text-xs">
                Origine des fonds
                <select
                  className="input mt-1"
                  value={form.sourceType}
                  onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}
                >
                  {EMPLOYEE_SAVINGS_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_TYPE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Date de versement
                <input
                  type="date"
                  className="input mt-1"
                  value={form.contributionDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contributionDate: e.target.value }))
                  }
                />
              </label>
              <label className="text-xs">
                Mode de déblocage
                <select
                  className="input mt-1"
                  value={form.unlockMode}
                  onChange={(e) => setForm((f) => ({ ...f, unlockMode: e.target.value }))}
                >
                  <option value="DATE">Date fixe (ex. PEE +5 ans)</option>
                  <option value="RETIREMENT">Retraite (PER / PERCO)</option>
                </select>
              </label>
              {form.unlockMode === "DATE" && (
                <label className="text-xs">
                  Date de déblocage
                  <input
                    type="date"
                    className="input mt-1"
                    value={form.unlockDate}
                    onChange={(e) => setForm((f) => ({ ...f, unlockDate: e.target.value }))}
                    placeholder="Auto si PEE + date versement"
                  />
                  <span className="mt-0.5 block text-[10px] text-zinc-400">
                    Laisser vide + date de versement (PEE) → +5 ans automatique
                  </span>
                </label>
              )}
              <label className="text-xs sm:col-span-2 lg:col-span-3">
                Notes
                <input
                  className="input mt-1"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={saveMut.isPending || !form.fundName.trim()}
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
                  setForm(emptyForm());
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}

        <div className="table-container-responsive table-fluid-wrap">
          <table className="table-fluid text-sm" data-testid="employee-savings-table">
            <thead className="table-head text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Plan</th>
                <th className="px-3 py-2 text-left">Gestionnaire</th>
                <th className="px-3 py-2 text-left">Fonds</th>
                <th className="px-3 py-2 text-left">ISIN</th>
                <th className="px-3 py-2 text-right">Parts</th>
                <th className="px-3 py-2 text-right">VL</th>
                <th className="px-3 py-2 text-right">Valeur</th>
                <th className="px-3 py-2 text-left">Origine</th>
                <th className="px-3 py-2 text-left">Déblocage</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-zinc-400">
                    Chargement…
                  </td>
                </tr>
              )}
              {!q.isLoading && lines.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-zinc-400">
                    Aucune position — ajoutez une ligne ou importez un CSV
                  </td>
                </tr>
              )}
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-medium">{l.planType}</td>
                  <td className="px-3 py-2">{l.manager}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.fundName}</div>
                    {l.notes && (
                      <div className="text-[10px] text-zinc-400">{l.notes}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                    {l.isin || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(l.units).toLocaleString("fr-FR", { maximumFractionDigits: 6 })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(l.nav, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatCurrency(l.marketValue, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {SOURCE_TYPE_LABELS[l.sourceType] || l.sourceType}
                  </td>
                  <td className="px-3 py-2 text-xs">{l.unlockLabel}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                        l.liquidityStatus === "AVAILABLE"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                          : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      )}
                    >
                      {l.liquidityStatus === "AVAILABLE" ? (
                        <Unlock className="h-3 w-3" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                      {l.liquidityStatus === "AVAILABLE" ? "Disponible" : "Bloqué"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(l)}
                        title="Modifier"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm("Supprimer cette ligne ?")) delMut.mutate(l.id);
                        }}
                        title="Supprimer"
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
      </section>
    </div>
  );
}
