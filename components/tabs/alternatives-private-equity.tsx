"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import {
  PE_TYPES,
  PE_TYPE_LABELS,
  type PrivateEquityDto,
  type PrivateEquitySummary,
} from "@/app/lib/alternatives/types";

type FormState = {
  companyName: string;
  sector: string;
  peType: string;
  shares: string;
  acquisitionPricePerShare: string;
  investmentDate: string;
  currentNav: string;
  currency: string;
  notes: string;
};

const empty = (): FormState => ({
  companyName: "",
  sector: "",
  peType: "DIRECT",
  shares: "",
  acquisitionPricePerShare: "",
  investmentDate: "",
  currentNav: "",
  currency: "EUR",
  notes: "",
});

function toForm(l: PrivateEquityDto): FormState {
  return {
    companyName: l.companyName,
    sector: l.sector || "",
    peType: l.peType,
    shares: l.shares,
    acquisitionPricePerShare: l.acquisitionPricePerShare,
    investmentDate: l.investmentDate || "",
    currentNav: l.currentNav,
    currency: l.currency,
    notes: l.notes || "",
  };
}

export function AlternativesPrivateEquity({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["private-equity"],
    queryFn: () =>
      fetchJson<{ lines: PrivateEquityDto[]; summary: PrivateEquitySummary }>(
        "/api/private-equity"
      ),
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty());

  const lines = q.data?.lines ?? [];
  const summary = q.data?.summary;

  const investedPreview = useMemo(() => {
    const s = Number(String(form.shares).replace(",", ".")) || 0;
    const p = Number(String(form.acquisitionPricePerShare).replace(",", ".")) || 0;
    return s * p;
  }, [form.shares, form.acquisitionPricePerShare]);

  const moicPreview = useMemo(() => {
    const nav = Number(String(form.currentNav).replace(",", ".")) || 0;
    if (investedPreview <= 0) return 0;
    return nav / investedPreview;
  }, [form.currentNav, investedPreview]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        companyName: form.companyName,
        sector: form.sector || null,
        peType: form.peType,
        shares: form.shares || "0",
        acquisitionPricePerShare: form.acquisitionPricePerShare || "0",
        investmentDate: form.investmentDate || null,
        currentNav: form.currentNav || "0",
        currency: form.currency || "EUR",
        notes: form.notes || null,
      };
      if (editingId) {
        return fetchJson("/api/private-equity", {
          method: "PUT",
          body: JSON.stringify({ id: editingId, ...body }),
        });
      }
      return fetchJson("/api/private-equity", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      toast.success(editingId ? "Position mise à jour" : "Position ajoutée");
      setEditingId(null);
      setForm(empty());
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ["private-equity"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/private-equity?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Position supprimée");
      await qc.invalidateQueries({ queryKey: ["private-equity"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="card overflow-hidden" data-testid="private-equity-section">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Private Equity & Non-coté</h2>
          <p className="text-xs text-zinc-500">
            PME, startups, crowdequity · NAV manuelle · MOIC = valeur / investi
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
          data-testid="pe-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvelle position
        </Button>
      </div>

      <div className="grid gap-2 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-4">
        <MiniKpi label="Investi" value={formatCurrency(summary?.totalInvested || "0", baseCurrency)} />
        <MiniKpi label="NAV totale" value={formatCurrency(summary?.totalNav || "0", baseCurrency)} />
        <MiniKpi
          label="P&L"
          value={formatCurrency(summary?.totalPnl || "0", baseCurrency)}
          tone={Number(summary?.totalPnl || 0)}
        />
        <MiniKpi label="MOIC moyen" value={`${summary?.avgMoic ?? 0}×`} />
      </div>

      {showForm && (
        <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editingId ? "Modifier" : "Ajouter"} — Private Equity
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs">
              Société
              <input
                className="input mt-1"
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Secteur
              <input
                className="input mt-1"
                value={form.sector}
                onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Type
              <select
                className="input mt-1"
                value={form.peType}
                onChange={(e) => setForm((f) => ({ ...f, peType: e.target.value }))}
              >
                {PE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Nombre de parts
              <input
                className="input mt-1"
                inputMode="decimal"
                value={form.shares}
                onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Prix d&apos;acquisition / part
              <input
                className="input mt-1"
                inputMode="decimal"
                value={form.acquisitionPricePerShare}
                onChange={(e) =>
                  setForm((f) => ({ ...f, acquisitionPricePerShare: e.target.value }))
                }
              />
              <span className="mt-0.5 block text-[10px] text-zinc-400">
                Investi : {formatCurrency(String(investedPreview), form.currency)}
              </span>
            </label>
            <label className="text-xs">
              Date d&apos;investissement
              <input
                type="date"
                className="input mt-1"
                value={form.investmentDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, investmentDate: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Valorisation actuelle (NAV totale)
              <input
                className="input mt-1"
                inputMode="decimal"
                value={form.currentNav}
                onChange={(e) => setForm((f) => ({ ...f, currentNav: e.target.value }))}
              />
              <span className="mt-0.5 block text-[10px] text-zinc-400">
                MOIC estimé : {moicPreview.toFixed(2)}×
              </span>
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
            <label className="text-xs sm:col-span-2 lg:col-span-3">
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
              disabled={saveMut.isPending || !form.companyName.trim()}
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
        <table className="table-fluid text-sm" data-testid="private-equity-table">
          <thead className="table-head text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">Société</th>
              <th className="px-3 py-2 text-left">Secteur</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Parts</th>
              <th className="px-3 py-2 text-right">PRU / part</th>
              <th className="px-3 py-2 text-right">Investi</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-right">NAV</th>
              <th className="px-3 py-2 text-right">MOIC</th>
              <th className="px-3 py-2 text-right">+/- €</th>
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
                  Aucune position PE — ajoutez une startup ou un club deal
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 font-medium">{l.companyName}</td>
                <td className="px-3 py-2 text-xs">{l.sector || "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {PE_TYPE_LABELS[l.peType] || l.peType}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(l.shares).toLocaleString("fr-FR", { maximumFractionDigits: 4 })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrency(l.acquisitionPricePerShare, l.currency)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrency(l.investedTotal, l.currency)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {l.investmentDate
                    ? new Date(l.investmentDate).toLocaleDateString("fr-FR")
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatCurrency(l.currentNav, l.currency)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-teal-700 dark:text-teal-300">
                  {Number(l.moic).toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  ×
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums font-medium",
                    getChangeColor(l.unrealizedPnl)
                  )}
                >
                  {formatCurrency(l.unrealizedPnl, l.currency)}
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
                        if (confirm(`Supprimer « ${l.companyName} » ?`)) {
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
  );
}

function MiniKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone != null && tone !== 0 && getChangeColor(String(tone))
        )}
      >
        {value}
      </div>
    </div>
  );
}
