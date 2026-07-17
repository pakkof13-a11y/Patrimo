"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Gem,
  Handshake,
  LayoutDashboard,
  Palette,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import {
  ASSET_KIND_LABELS,
  FORMAT_LABELS,
  PRECIOUS_ASSET_KINDS,
  PRECIOUS_FORMATS,
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABELS,
  type AlternativesDashboardPayload,
  type AlternativesPortfolioSlice,
  type AlternativesSubTab,
  type PreciousMetalDto,
  type PreciousMetalsSummary,
} from "@/app/lib/alternatives/types";
import { CHART_COLORS } from "@/app/lib/types/ui";
import { AlternativesPrivateEquity } from "@/components/tabs/alternatives-private-equity";
import { AlternativesCrowdlending } from "@/components/tabs/alternatives-crowdlending";
import { AlternativesTangibles } from "@/components/tabs/alternatives-tangibles";
import {
  AltDashKpi,
  AltEmptyState,
  AltField,
  AltFormPanel,
  AltFormSection,
  AltMiniKpi,
  AltModuleShell,
} from "@/components/tabs/alternatives-shell";

type FormState = {
  assetKind: string;
  format: string;
  denomination: string;
  quantity: string;
  unitWeight: string;
  weightUnit: string;
  purchasePriceUnit: string;
  currentValue: string;
  currency: string;
  storageLocation: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  assetKind: "METAL",
  format: "PHYSICAL",
  denomination: "",
  quantity: "1",
  unitWeight: "",
  weightUnit: "GRAM",
  purchasePriceUnit: "",
  currentValue: "",
  currency: "EUR",
  storageLocation: "",
  notes: "",
});

function lineToForm(l: PreciousMetalDto): FormState {
  return {
    assetKind: l.assetKind,
    format: l.format,
    denomination: l.denomination,
    quantity: l.quantity,
    unitWeight: l.unitWeightDisplay,
    weightUnit: l.weightUnit,
    purchasePriceUnit: l.purchasePriceUnit,
    currentValue: l.currentValue,
    currency: l.currency,
    storageLocation: l.storageLocation || "",
    notes: l.notes || "",
  };
}

const SUB_NAV: {
  id: AlternativesSubTab;
  label: string;
  short: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "dashboard",
    label: "Vue d’ensemble",
    short: "Dashboard",
    icon: <LayoutDashboard className="h-3.5 w-3.5" />,
  },
  {
    id: "metals",
    label: "Métaux précieux",
    short: "Métaux",
    icon: <Gem className="h-3.5 w-3.5" />,
  },
  {
    id: "private-equity",
    label: "Private Equity",
    short: "PE",
    icon: <Building2 className="h-3.5 w-3.5" />,
  },
  {
    id: "crowdlending",
    label: "Crowdlending",
    short: "Prêts",
    icon: <Handshake className="h-3.5 w-3.5" />,
  },
  {
    id: "tangibles",
    label: "Tangibles & collection",
    short: "Tangibles",
    icon: <Palette className="h-3.5 w-3.5" />,
  },
];

const ALT_SUBS = new Set<string>([
  "dashboard",
  "metals",
  "private-equity",
  "crowdlending",
  "tangibles",
]);

const MODULE_GUIDES: Record<
  Exclude<AlternativesSubTab, "dashboard">,
  { title: string; blurb: string; cta: string }
> = {
  metals: {
    title: "Métaux précieux",
    blurb: "Or, argent, platine — physique ou papier, PRU et valorisation manuelle.",
    cta: "Ajouter un métal",
  },
  "private-equity": {
    title: "Private Equity",
    blurb: "Participations non cotées — NAV manuelle, P&L et MOIC.",
    cta: "Ajouter une position PE",
  },
  crowdlending: {
    title: "Crowdlending",
    blurb: "Prêts participatifs — capital, échéance et compte à rebours.",
    cta: "Ajouter un prêt",
  },
  tangibles: {
    title: "Tangibles & collection",
    blurb: "Montres, vins, art… — achat vs estimation manuelle.",
    cta: "Ajouter un objet",
  },
};

export function AlternativesTab({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const searchParams = useSearchParams();
  const [sub, setSub] = useState<AlternativesSubTab>("dashboard");
  const qc = useQueryClient();

  useEffect(() => {
    const q = (searchParams.get("sub") || "").toLowerCase();
    if (ALT_SUBS.has(q)) setSub(q as AlternativesSubTab);
  }, [searchParams]);

  /** Dashboard : 1 seul HTTP (bundle). Sous-modules : listes lazy au besoin. */
  const dashQ = useQuery({
    queryKey: ["alternatives-summary", "dashboard"],
    queryFn: () =>
      fetchJson<AlternativesDashboardPayload>("/api/alternatives/summary"),
    enabled: sub === "dashboard",
    staleTime: 60_000,
  });

  const q = useQuery({
    queryKey: ["precious-metals"],
    queryFn: () =>
      fetchJson<{ lines: PreciousMetalDto[]; summary: PreciousMetalsSummary }>(
        "/api/precious-metals"
      ),
    enabled: sub === "metals",
    staleTime: 30_000,
  });

  const lines = q.data?.lines ?? [];
  const summary =
    sub === "metals" ? q.data?.summary : dashQ.data?.metals;
  const peSummary = dashQ.data?.privateEquity;
  const clSummary = dashQ.data?.crowdlending;
  const tangSummary = dashQ.data?.tangibles;
  const altAgg: AlternativesPortfolioSlice | undefined = dashQ.data?.summary;

  const pieData = useMemo(() => {
    const slices = (altAgg?.slices ?? []).filter((s) => s.value > 0);
    return slices.map((s, i) => ({
      ...s,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [altAgg]);

  const totalAlt = Number(altAgg?.totalEur ?? 0);
  const hasAnyAlt =
    (summary?.lineCount ?? 0) +
      (peSummary?.lineCount ?? 0) +
      (clSummary?.lineCount ?? 0) +
      (tangSummary?.lineCount ?? 0) >
    0;

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  async function refreshMetals() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["precious-metals"] }),
      qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
    ]);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        assetKind: form.assetKind,
        format: form.format,
        denomination: form.denomination,
        quantity: form.quantity || "0",
        unitWeight: form.unitWeight || "0",
        weightUnit: form.weightUnit,
        purchasePriceUnit: form.purchasePriceUnit || "0",
        currentValue: form.currentValue || "0",
        currency: form.currency || "EUR",
        storageLocation: form.storageLocation || null,
        notes: form.notes || null,
      };
      if (editingId) {
        return fetchJson("/api/precious-metals", {
          method: "PUT",
          body: JSON.stringify({ id: editingId, ...body }),
        });
      }
      return fetchJson("/api/precious-metals", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      toast.success(editingId ? "Position mise à jour" : "Position ajoutée");
      setEditingId(null);
      setForm(emptyForm());
      setShowForm(false);
      await refreshMetals();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/precious-metals?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Position supprimée");
      await refreshMetals();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const costPreview = useMemo(() => {
    const qn = Number(String(form.quantity).replace(",", ".")) || 0;
    const p = Number(String(form.purchasePriceUnit).replace(",", ".")) || 0;
    return qn * p;
  }, [form.quantity, form.purchasePriceUnit]);

  const pnlPreview = useMemo(() => {
    const cur = Number(String(form.currentValue).replace(",", ".")) || 0;
    return cur - costPreview;
  }, [form.currentValue, costPreview]);

  function startCreateMetals() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setSub("metals");
  }

  function startEdit(l: PreciousMetalDto) {
    setEditingId(l.id);
    setForm(lineToForm(l));
    setShowForm(true);
    setSub("metals");
  }

  function cancelMetalsForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function goModule(id: AlternativesSubTab) {
    setSub(id);
  }

  return (
    <div className="space-y-5" data-testid="alternatives-tab">
      {/* ── Header section ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-snug">
            Actifs alternatifs
          </h1>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Poche hors marchés cotés — métaux, private equity, crowdlending et
            tangibles. La vue d’ensemble synthétise ; chaque sous-module gère
            sa saisie experte.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-2 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Total poche alternative
          </div>
          <div className="text-xl font-semibold tabular-nums tracking-tight text-teal-700 dark:text-teal-300">
            {formatCurrency(String(totalAlt), baseCurrency)}
          </div>
        </div>
      </div>

      {/* ── Sub-nav ── */}
      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2"
        aria-label="Sous-modules actifs alternatifs"
      >
        {SUB_NAV.map((item) => {
          const active = sub === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`alt-sub-${item.id}`}
              onClick={() => setSub(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                active
                  ? "bg-teal-50 text-teal-900 ring-1 ring-teal-500/25 dark:bg-teal-950/60 dark:text-teal-100"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
              <span className="sm:hidden">{item.short}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Dashboard ── */}
      {sub === "dashboard" && (
        <section className="space-y-4" data-testid="alt-dashboard">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AltDashKpi
              label="Métaux précieux"
              value={formatCurrency(summary?.totalValue || "0", baseCurrency)}
              hint={
                (summary?.lineCount ?? 0) > 0
                  ? `${summary?.lineCount} pos. · P&L ${formatCurrency(summary?.totalPnl || "0", baseCurrency)}`
                  : "Lingots, pièces, papier — non renseigné"
              }
              tone={Number(summary?.totalPnl || 0)}
              onClick={() => goModule("metals")}
            />
            <AltDashKpi
              label="Private Equity (NAV)"
              value={formatCurrency(peSummary?.totalNav || "0", baseCurrency)}
              hint={
                (peSummary?.lineCount ?? 0) > 0
                  ? `${peSummary?.lineCount} pos. · MOIC moy. ${peSummary?.avgMoic ?? 0}×`
                  : "Participations non cotées — non renseigné"
              }
              tone={Number(peSummary?.totalPnl || 0)}
              onClick={() => goModule("private-equity")}
            />
            <AltDashKpi
              label="Crowdlending (en cours)"
              value={formatCurrency(
                clSummary?.activeCapital || "0",
                baseCurrency
              )}
              hint={
                (clSummary?.lineCount ?? 0) > 0
                  ? `${clSummary?.lineCount} prêt(s)`
                  : "Prêts participatifs — non renseigné"
              }
              onClick={() => goModule("crowdlending")}
            />
            <AltDashKpi
              label="Tangibles & collection"
              value={formatCurrency(
                tangSummary?.totalValue || "0",
                baseCurrency
              )}
              hint={
                (tangSummary?.lineCount ?? 0) > 0
                  ? `${tangSummary?.lineCount} objet(s) · P&L ${formatCurrency(tangSummary?.totalPnl || "0", baseCurrency)}`
                  : "Collection — non renseigné"
              }
              tone={Number(tangSummary?.totalPnl || 0)}
              onClick={() => goModule("tangibles")}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-hidden p-4">
              <h2 className="mb-0.5 text-sm font-semibold">
                Répartition de la poche
              </h2>
              <p className="mb-3 text-[11px] text-slate-400">
                Poids de chaque sous-catégorie dans les actifs alternatifs
              </p>
              {pieData.length === 0 ? (
                <div className="flex min-h-[14rem] flex-col items-center justify-center gap-2 px-2 py-6 text-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--muted)] text-slate-400">
                    <PieChartIcon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    La répartition apparaîtra ici
                  </p>
                  <p className="max-w-xs text-[11px] leading-relaxed text-slate-400">
                    Ajoutez une première position dans un sous-module pour
                    visualiser le poids de chaque poche.
                  </p>
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {pieData.map((e) => (
                          <Cell key={e.id} fill={e.fill} />
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
              <h2 className="mb-0.5 text-sm font-semibold">
                {hasAnyAlt ? "Détail par module" : "Démarrer la poche alternative"}
              </h2>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                {hasAnyAlt
                  ? "Total intégré au patrimoine net global. Cliquez une carte ou un module pour saisir."
                  : "Choisissez le type d’actif à suivre. Chaque module ouvre un formulaire à la demande — pas de saisie bloquante ici."}
              </p>

              {hasAnyAlt ? (
                <ul className="space-y-2 text-sm">
                  {pieData.map((s) => {
                    const pct =
                      totalAlt > 0
                        ? Math.round((s.value / totalAlt) * 1000) / 10
                        : 0;
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between border-t border-[var(--border)] pt-2"
                      >
                        <button
                          type="button"
                          className="text-left font-medium text-slate-700 hover:text-teal-700 dark:text-slate-200 dark:hover:text-teal-300"
                          onClick={() =>
                            goModule(
                              (s.id as AlternativesSubTab) || "dashboard"
                            )
                          }
                        >
                          {s.name}
                        </button>
                        <span className="tabular-nums font-medium">
                          {formatCurrency(String(s.value), baseCurrency)}
                          <span className="ml-2 text-xs text-slate-400">
                            {pct} %
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    Object.keys(MODULE_GUIDES) as Array<
                      keyof typeof MODULE_GUIDES
                    >
                  ).map((id) => {
                    const g = MODULE_GUIDES[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goModule(id)}
                        className={cn(
                          "rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 text-left transition",
                          "hover:border-teal-500/30 hover:bg-teal-500/[0.04]",
                          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                        )}
                      >
                        <div className="text-sm font-semibold">{g.title}</div>
                        <p className="mt-1 text-[11px] leading-snug text-slate-400">
                          {g.blurb}
                        </p>
                        <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 dark:text-teal-300">
                          <Plus className="h-3 w-3" />
                          {g.cta}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {hasAnyAlt && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("metals")}
                  >
                    Métaux
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("private-equity")}
                  >
                    Private Equity
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("crowdlending")}
                  >
                    Crowdlending
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => goModule("tangibles")}
                  >
                    Tangibles
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Métaux ── */}
      {sub === "metals" && (
        <AltModuleShell
          testId="metals-section"
          title="Métaux précieux"
          subtitle={
            <>
              Or, argent, platine… —{" "}
              <span className="inline-flex items-center gap-0.5">
                physique
                <FinanceTip term="Physique" />
              </span>{" "}
              ou{" "}
              <span className="inline-flex items-center gap-0.5">
                papier
                <FinanceTip term="Papier" />
              </span>
              . Valorisation manuelle (cours non automatiques pour l’instant).
            </>
          }
          action={
            <Button
              type="button"
              size="sm"
              onClick={startCreateMetals}
              data-testid="metals-add"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouvelle position
            </Button>
          }
          kpis={
            <>
              <AltMiniKpi
                label="Valeur actuelle"
                value={formatCurrency(
                  summary?.totalValue || "0",
                  baseCurrency
                )}
              />
              <AltMiniKpi
                label="Coût total"
                value={formatCurrency(summary?.totalCost || "0", baseCurrency)}
                hint="Quantité × PRU"
              />
              <AltMiniKpi
                label="P&L latent"
                value={formatCurrency(summary?.totalPnl || "0", baseCurrency)}
                tone={Number(summary?.totalPnl || 0)}
              />
              <AltMiniKpi
                label="Positions"
                value={String(summary?.lineCount ?? 0)}
              />
            </>
          }
          formOpen={showForm}
          form={
            <AltFormPanel
              title={
                editingId ? "Modifier la position" : "Nouvelle position métaux"
              }
              hint="« Nouvelle position » ouvre ce panneau. Coût = quantité × PRU ; P&L = valeur actuelle − coût."
              testId="metals-form"
              actions={
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      saveMut.isPending || !form.denomination.trim()
                    }
                    onClick={() => saveMut.mutate()}
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
                    onClick={cancelMetalsForm}
                  >
                    Annuler
                  </Button>
                </>
              }
            >
              <AltFormSection
                title="Nature de l’actif"
                hint="Type, format physique/papier et dénomination."
              >
                <AltField label="Type d’actif">
                  <select
                    className="input"
                    value={form.assetKind}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, assetKind: e.target.value }))
                    }
                  >
                    {PRECIOUS_ASSET_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ASSET_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </AltField>
                <AltField
                  label={
                    <span className="inline-flex items-center gap-1">
                      Format
                      <FinanceTip
                        term={
                          form.format === "PAPER" ? "Papier" : "Physique"
                        }
                      />
                    </span>
                  }
                >
                  <select
                    className="input"
                    value={form.format}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, format: e.target.value }))
                    }
                  >
                    {PRECIOUS_FORMATS.map((k) => (
                      <option key={k} value={k}>
                        {FORMAT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </AltField>
                <AltField label="Dénomination">
                  <input
                    className="input"
                    placeholder="Napoléon 20F, Lingot 1 kg…"
                    value={form.denomination}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        denomination: e.target.value,
                      }))
                    }
                    data-testid="metals-denomination"
                  />
                </AltField>
              </AltFormSection>

              <AltFormSection
                title="Quantité & poids"
                hint="Poids unitaire utile surtout en physique."
              >
                <AltField label="Quantité">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.quantity}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, quantity: e.target.value }))
                    }
                  />
                </AltField>
                <AltField label="Poids unitaire">
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      inputMode="decimal"
                      value={form.unitWeight}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          unitWeight: e.target.value,
                        }))
                      }
                    />
                    <select
                      className="input !w-28"
                      value={form.weightUnit}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          weightUnit: e.target.value,
                        }))
                      }
                    >
                      {WEIGHT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {WEIGHT_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </AltField>
                <AltField label="Lieu de stockage">
                  <input
                    className="input"
                    placeholder="Coffre, domicile…"
                    value={form.storageLocation}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        storageLocation: e.target.value,
                      }))
                    }
                  />
                </AltField>
              </AltFormSection>

              <AltFormSection
                title="Valorisation manuelle"
                hint="PRU et valeur actuelle saisis · coût et P&L calculés."
              >
                <AltField
                  label={
                    <span className="inline-flex items-center gap-1">
                      PRU (prix d’achat unitaire)
                      <FinanceTip term="PRU" />
                    </span>
                  }
                  hint={
                    <>
                      Coût total :{" "}
                      {formatCurrency(
                        String(costPreview),
                        form.currency || "EUR"
                      )}
                    </>
                  }
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.purchasePriceUnit}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        purchasePriceUnit: e.target.value,
                      }))
                    }
                  />
                </AltField>
                <AltField
                  label="Valeur actuelle (totale)"
                  hint={
                    costPreview > 0 || form.currentValue ? (
                      <>
                        P&L estimé :{" "}
                        <strong>
                          {formatCurrency(
                            String(pnlPreview),
                            form.currency || "EUR"
                          )}
                        </strong>
                      </>
                    ) : (
                      "Montant total de la position aujourd’hui"
                    )
                  }
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.currentValue}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        currentValue: e.target.value,
                      }))
                    }
                  />
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
                <AltField
                  label="Notes"
                  className="sm:col-span-2 lg:col-span-3"
                >
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
          {!q.isLoading && lines.length === 0 && !showForm ? (
            <AltEmptyState
              title="Aucune position métaux"
              description="Suivez lingots, pièces ou exposition papier : quantité, poids, PRU, valeur actuelle et stockage."
              bullets={[
                "Dénomination et format (physique / papier)",
                "Quantité × PRU → coût total (calculé)",
                "Valeur actuelle manuelle → P&L latent (calculé)",
              ]}
              primaryLabel="Nouvelle position"
              onPrimary={startCreateMetals}
              primaryTestId="metals-empty-add"
            />
          ) : (
            <div className="table-container-responsive table-fluid-wrap">
              <table
                className="table-fluid text-sm"
                data-testid="precious-metals-table"
              >
                <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Dénomination</th>
                    <th className="px-3 py-2.5 text-left">Type</th>
                    <th className="px-3 py-2.5 text-left">Format</th>
                    <th className="px-3 py-2.5 text-right">Qté</th>
                    <th className="px-3 py-2.5 text-right">Poids unit.</th>
                    <th className="px-3 py-2.5 text-right">PRU</th>
                    <th className="px-3 py-2.5 text-right">Coût</th>
                    <th className="px-3 py-2.5 text-right">Valeur act.</th>
                    <th className="px-3 py-2.5 text-right">+/- €</th>
                    <th className="px-3 py-2.5 text-right">+/- %</th>
                    <th className="px-3 py-2.5 text-left">Stockage</th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.isLoading && (
                    <tr>
                      <td
                        colSpan={12}
                        className="px-4 py-10 text-center text-sm text-slate-400"
                      >
                        Chargement…
                      </td>
                    </tr>
                  )}
                  {lines.map((l) => (
                    <tr
                      key={l.id}
                      className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35"
                    >
                      <td className="px-3 py-2 font-medium">
                        {l.denomination}
                        {l.notes && (
                          <div className="text-[10px] font-normal text-slate-400">
                            {l.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {ASSET_KIND_LABELS[l.assetKind] || l.assetKind}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {FORMAT_LABELS[l.format] || l.format}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(l.quantity).toLocaleString("fr-FR", {
                          maximumFractionDigits: 6,
                        })}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {l.unitWeightDisplay}{" "}
                        {l.weightUnit === "OZ" ? "oz" : "g"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(l.purchasePriceUnit, l.currency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(l.costBasis, l.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatCurrency(l.currentValue, l.currency)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-medium tabular-nums",
                          getChangeColor(l.unrealizedPnl)
                        )}
                      >
                        {formatCurrency(l.unrealizedPnl, l.currency)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          getChangeColor(l.unrealizedPnlPct)
                        )}
                      >
                        {Number(l.unrealizedPnlPct).toLocaleString("fr-FR", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        %
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {l.storageLocation || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex gap-0.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
                            onClick={() => startEdit(l)}
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
                              if (
                                confirm(`Supprimer « ${l.denomination} » ?`)
                              ) {
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AltModuleShell>
      )}

      {sub === "private-equity" && (
        <AlternativesPrivateEquity baseCurrency={baseCurrency} />
      )}
      {sub === "crowdlending" && (
        <AlternativesCrowdlending baseCurrency={baseCurrency} />
      )}
      {sub === "tangibles" && (
        <AlternativesTangibles baseCurrency={baseCurrency} />
      )}
    </div>
  );
}
