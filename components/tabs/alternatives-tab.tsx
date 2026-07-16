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
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import {
  ASSET_KIND_LABELS,
  FORMAT_LABELS,
  PRECIOUS_ASSET_KINDS,
  PRECIOUS_FORMATS,
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABELS,
  type AlternativesPortfolioSlice,
  type AlternativesSubTab,
  type CrowdlendingSummary,
  type PreciousMetalDto,
  type PreciousMetalsSummary,
  type PrivateEquitySummary,
  type TangibleAssetsSummary,
} from "@/app/lib/alternatives/types";
import { CHART_COLORS } from "@/app/lib/types/ui";
import { AlternativesPrivateEquity } from "@/components/tabs/alternatives-private-equity";
import { AlternativesCrowdlending } from "@/components/tabs/alternatives-crowdlending";
import { AlternativesTangibles } from "@/components/tabs/alternatives-tangibles";

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

const SUB_NAV: { id: AlternativesSubTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "dashboard",
    label: "Dashboard Alternatifs",
    icon: <LayoutDashboard className="h-3.5 w-3.5" />,
  },
  { id: "metals", label: "Métaux Précieux", icon: <Gem className="h-3.5 w-3.5" /> },
  {
    id: "private-equity",
    label: "Private Equity",
    icon: <Building2 className="h-3.5 w-3.5" />,
  },
  {
    id: "crowdlending",
    label: "Crowdlending",
    icon: <Handshake className="h-3.5 w-3.5" />,
  },
  {
    id: "tangibles",
    label: "Tangibles & Collection",
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

export function AlternativesTab({ baseCurrency = "EUR" }: { baseCurrency?: string }) {
  const searchParams = useSearchParams();
  const [sub, setSub] = useState<AlternativesSubTab>("dashboard");
  const qc = useQueryClient();

  // Deep-link / e2e : ?sub=metals
  useEffect(() => {
    const q = (searchParams.get("sub") || "").toLowerCase();
    if (ALT_SUBS.has(q)) setSub(q as AlternativesSubTab);
  }, [searchParams]);

  const q = useQuery({
    queryKey: ["precious-metals"],
    queryFn: () =>
      fetchJson<{ lines: PreciousMetalDto[]; summary: PreciousMetalsSummary }>(
        "/api/precious-metals"
      ),
  });

  const peQ = useQuery({
    queryKey: ["private-equity"],
    queryFn: () =>
      fetchJson<{ summary: PrivateEquitySummary }>("/api/private-equity"),
  });

  const clQ = useQuery({
    queryKey: ["crowdlending"],
    queryFn: () =>
      fetchJson<{ summary: CrowdlendingSummary }>("/api/crowdlending"),
  });

  const tangQ = useQuery({
    queryKey: ["tangibles"],
    queryFn: () =>
      fetchJson<{ summary: TangibleAssetsSummary }>("/api/tangibles"),
  });

  const altSummaryQ = useQuery({
    queryKey: ["alternatives-summary"],
    queryFn: () =>
      fetchJson<{ summary: AlternativesPortfolioSlice }>(
        "/api/alternatives/summary"
      ),
  });

  const lines = q.data?.lines ?? [];
  const summary = q.data?.summary;
  const peSummary = peQ.data?.summary;
  const clSummary = clQ.data?.summary;
  const tangSummary = tangQ.data?.summary;
  const altAgg = altSummaryQ.data?.summary;

  const pieData = useMemo(() => {
    const slices = altAgg?.slices?.length
      ? altAgg.slices
      : [
          { id: "metals", name: "Métaux précieux", value: Number(summary?.totalValue || 0) },
          {
            id: "private-equity",
            name: "Private Equity",
            value: Number(peSummary?.totalNav || 0),
          },
          {
            id: "crowdlending",
            name: "Crowdlending",
            value: Number(clSummary?.activeCapital || 0),
          },
          {
            id: "tangibles",
            name: "Actifs tangibles",
            value: Number(tangSummary?.totalValue || 0),
          },
        ].filter((s) => s.value > 0);
    return slices.map((s, i) => ({
      ...s,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [altAgg, summary, peSummary, clSummary, tangSummary]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const refresh = () => qc.invalidateQueries({ queryKey: ["precious-metals"] });

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
      await refresh();
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
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const costPreview = useMemo(() => {
    const qn = Number(String(form.quantity).replace(",", ".")) || 0;
    const p = Number(String(form.purchasePriceUnit).replace(",", ".")) || 0;
    return qn * p;
  }, [form.quantity, form.purchasePriceUnit]);

  function startCreate() {
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

  return (
    <div className="space-y-4" data-testid="alternatives-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Actifs Alternatifs</h1>
          <p className="text-xs text-zinc-500">
            Métaux · Private equity · Crowdlending · Tangibles — hors marchés cotés
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            Total poche alternative
          </div>
          <div className="text-xl font-semibold tabular-nums text-teal-700 dark:text-teal-300">
            {formatCurrency(
              String(altAgg?.totalEur ?? 0),
              baseCurrency
            )}
          </div>
        </div>
      </div>

      {/* Sub-nav */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">
        {SUB_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`alt-sub-${item.id}`}
            onClick={() => setSub(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
              sub === item.id
                ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-slate-300 dark:hover:bg-slate-800"
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {sub === "dashboard" && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Métaux précieux"
              value={formatCurrency(summary?.totalValue || "0", baseCurrency)}
              hint={`${summary?.lineCount ?? 0} pos. · P&L ${formatCurrency(summary?.totalPnl || "0", baseCurrency)}`}
              tone={Number(summary?.totalPnl || 0)}
            />
            <KpiCard
              label="Private Equity (NAV)"
              value={formatCurrency(peSummary?.totalNav || "0", baseCurrency)}
              hint={`${peSummary?.lineCount ?? 0} pos. · MOIC moy. ${peSummary?.avgMoic ?? 0}×`}
              tone={Number(peSummary?.totalPnl || 0)}
            />
            <KpiCard
              label="Crowdlending (en cours)"
              value={formatCurrency(clSummary?.activeCapital || "0", baseCurrency)}
              hint={`${clSummary?.lineCount ?? 0} prêt(s)`}
            />
            <KpiCard
              label="Tangibles & collection"
              value={formatCurrency(tangSummary?.totalValue || "0", baseCurrency)}
              hint={`${tangSummary?.lineCount ?? 0} objet(s) · P&L ${formatCurrency(tangSummary?.totalPnl || "0", baseCurrency)}`}
              tone={Number(tangSummary?.totalPnl || 0)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-1 text-sm font-semibold">Répartition de la poche</h2>
              <p className="mb-2 text-xs text-zinc-500">
                Poids de chaque sous-catégorie dans les actifs alternatifs
              </p>
              {pieData.length === 0 ? (
                <p className="py-12 text-center text-sm text-zinc-400">
                  Aucune valorisation — renseignez vos positions
                </p>
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
              <h2 className="mb-2 text-sm font-semibold">Dashboard Alternatifs</h2>
              <p className="text-sm text-zinc-500">
                Total intégré au patrimoine net global de l&apos;application.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {pieData.map((s) => {
                  const pct =
                    (altAgg?.totalEur || 0) > 0
                      ? Math.round((s.value / (altAgg?.totalEur || 1)) * 1000) / 10
                      : 0;
                  return (
                    <li
                      key={s.id}
                      className="flex items-center justify-between border-t border-[var(--border)] pt-2"
                    >
                      <span>{s.name}</span>
                      <span className="tabular-nums font-medium">
                        {formatCurrency(String(s.value), baseCurrency)}
                        <span className="ml-2 text-xs text-zinc-400">{pct} %</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setSub("metals")}>
                  Métaux
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSub("private-equity")}
                >
                  Private Equity
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSub("crowdlending")}
                >
                  Crowdlending
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSub("tangibles")}
                >
                  Tangibles
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {sub === "metals" && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Métaux Précieux</h2>
              <p className="text-xs text-zinc-500">
                Or, argent, platine… physique ou papier · VL manuelle pour l&apos;instant
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" />
              Nouvelle position
            </Button>
          </div>

          {showForm && (
            <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4">
              <h3 className="mb-3 text-sm font-semibold">
                {editingId ? "Modifier la position" : "Ajouter une position"}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Type d'actif">
                  <select
                    className="input"
                    value={form.assetKind}
                    onChange={(e) => setForm((f) => ({ ...f, assetKind: e.target.value }))}
                  >
                    {PRECIOUS_ASSET_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ASSET_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Format">
                  <select
                    className="input"
                    value={form.format}
                    onChange={(e) => setForm((f) => ({ ...f, format: e.target.value }))}
                  >
                    {PRECIOUS_FORMATS.map((k) => (
                      <option key={k} value={k}>
                        {FORMAT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Dénomination">
                  <input
                    className="input"
                    placeholder="Napoléon 20F, Lingot 1 kg…"
                    value={form.denomination}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, denomination: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Quantité">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                </Field>
                <Field label="Poids unitaire">
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      inputMode="decimal"
                      value={form.unitWeight}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, unitWeight: e.target.value }))
                      }
                    />
                    <select
                      className="input !w-28"
                      value={form.weightUnit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, weightUnit: e.target.value }))
                      }
                    >
                      {WEIGHT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {WEIGHT_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
                <Field label="PRU (prix d'achat unitaire)">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.purchasePriceUnit}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, purchasePriceUnit: e.target.value }))
                    }
                  />
                  <span className="mt-0.5 block text-[10px] text-zinc-400">
                    Coût total estimé :{" "}
                    {formatCurrency(String(costPreview), form.currency || "EUR")}
                  </span>
                </Field>
                <Field label="Valeur actuelle (totale)">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.currentValue}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, currentValue: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Devise">
                  <input
                    className="input"
                    maxLength={3}
                    value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  />
                </Field>
                <Field label="Lieu de stockage">
                  <input
                    className="input"
                    placeholder="Coffre, domicile…"
                    value={form.storageLocation}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, storageLocation: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
                  <input
                    className="input"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={saveMut.isPending || !form.denomination.trim()}
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
            <table className="table-fluid text-sm" data-testid="precious-metals-table">
              <thead className="table-head text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Dénomination</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Format</th>
                  <th className="px-3 py-2 text-right">Qté</th>
                  <th className="px-3 py-2 text-right">Poids unit.</th>
                  <th className="px-3 py-2 text-right">PRU</th>
                  <th className="px-3 py-2 text-right">Coût</th>
                  <th className="px-3 py-2 text-right">Valeur act.</th>
                  <th className="px-3 py-2 text-right">+/- €</th>
                  <th className="px-3 py-2 text-right">+/- %</th>
                  <th className="px-3 py-2 text-left">Stockage</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-zinc-400">
                      Chargement…
                    </td>
                  </tr>
                )}
                {!q.isLoading && lines.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-zinc-400">
                      Aucune position métaux — ajoutez un lingot, une pièce…
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-medium">
                      {l.denomination}
                      {l.notes && (
                        <div className="text-[10px] font-normal text-zinc-400">{l.notes}</div>
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
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
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
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {l.storageLocation || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(l)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (confirm(`Supprimer « ${l.denomination} » ?`)) {
                              delMut.mutate(l.id);
                            }
                          }}
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

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone != null && tone !== 0 && getChangeColor(String(tone))
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-zinc-400">{hint}</div>}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("text-xs", className)}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
