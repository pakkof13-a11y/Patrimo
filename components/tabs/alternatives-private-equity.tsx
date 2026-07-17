"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import {
  PE_TYPES,
  PE_TYPE_LABELS,
  type PrivateEquityDto,
  type PrivateEquitySummary,
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
  const hasLines = lines.length > 0;

  const investedPreview = useMemo(() => {
    const s = Number(String(form.shares).replace(",", ".")) || 0;
    const p =
      Number(String(form.acquisitionPricePerShare).replace(",", ".")) || 0;
    return s * p;
  }, [form.shares, form.acquisitionPricePerShare]);

  const moicPreview = useMemo(() => {
    const nav = Number(String(form.currentNav).replace(",", ".")) || 0;
    if (investedPreview <= 0) return 0;
    return nav / investedPreview;
  }, [form.currentNav, investedPreview]);

  const pnlPreview = useMemo(() => {
    const nav = Number(String(form.currentNav).replace(",", ".")) || 0;
    return nav - investedPreview;
  }, [form.currentNav, investedPreview]);

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["private-equity"] }),
      qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
    ]);
  }

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
      await invalidate();
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
      testId="private-equity-section"
      title="Private Equity & non coté"
      subtitle={
        <>
          PME, startups, crowdequity —{" "}
          <span className="inline-flex items-center gap-0.5">
            NAV
            <FinanceTip term="NAV PE" />
          </span>{" "}
          saisie manuellement ·{" "}
          <span className="inline-flex items-center gap-0.5">
            MOIC
            <FinanceTip term="MOIC" />
          </span>{" "}
          = valorisation ÷ capital investi
        </>
      }
      action={
        <Button
          type="button"
          size="sm"
          onClick={startCreate}
          data-testid="pe-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvelle position
        </Button>
      }
      kpis={
        <>
          <AltMiniKpi
            label="Capital investi"
            value={formatCurrency(summary?.totalInvested || "0", baseCurrency)}
            hint="Saisi (parts × prix d’acquisition)"
          />
          <AltMiniKpi
            label="NAV totale"
            value={formatCurrency(summary?.totalNav || "0", baseCurrency)}
            hint="Somme des valorisations manuelles"
            tip={<FinanceTip term="NAV PE" />}
          />
          <AltMiniKpi
            label="P&L latent"
            value={formatCurrency(summary?.totalPnl || "0", baseCurrency)}
            tone={Number(summary?.totalPnl || 0)}
            hint="NAV − investi (calculé)"
          />
          <AltMiniKpi
            label="MOIC moyen"
            value={`${summary?.avgMoic ?? 0}×`}
            hint="NAV ÷ investi (calculé)"
            tip={<FinanceTip term="MOIC" />}
          />
        </>
      }
      formOpen={showForm}
      form={
        <AltFormPanel
          title={editingId ? "Modifier la position" : "Nouvelle position PE"}
          hint="« Nouvelle position » ouvre ce panneau. Validez avec Créer / Enregistrer."
          testId="pe-form"
          actions={
            <>
              <Button
                type="button"
                size="sm"
                disabled={saveMut.isPending || !form.companyName.trim()}
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending
                  ? "…"
                  : editingId
                    ? "Enregistrer"
                    : "Créer la position"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={cancelForm}>
                Annuler
              </Button>
            </>
          }
        >
          <AltFormSection
            title="Identité"
            hint="Société, secteur et type d’investissement."
          >
            <AltField label="Société">
              <input
                className="input"
                value={form.companyName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, companyName: e.target.value }))
                }
                placeholder="Nom de la société"
                data-testid="pe-company"
              />
            </AltField>
            <AltField label="Secteur">
              <input
                className="input"
                value={form.sector}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sector: e.target.value }))
                }
                placeholder="SaaS, santé…"
              />
            </AltField>
            <AltField label="Type">
              <select
                className="input"
                value={form.peType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, peType: e.target.value }))
                }
              >
                {PE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </AltField>
            <AltField label="Date d’investissement">
              <DateInput
                value={form.investmentDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, investmentDate: e.target.value }))
                }
              />
            </AltField>
          </AltFormSection>

          <AltFormSection
            title="Investissement (saisi)"
            hint="Capital engagé = parts × prix d’acquisition unitaire."
          >
            <AltField label="Nombre de parts">
              <input
                className="input"
                inputMode="decimal"
                value={form.shares}
                onChange={(e) =>
                  setForm((f) => ({ ...f, shares: e.target.value }))
                }
              />
            </AltField>
            <AltField
              label="Prix d’acquisition / part"
              hint={
                <>
                  Investi calculé :{" "}
                  {formatCurrency(String(investedPreview), form.currency)}
                </>
              }
            >
              <input
                className="input"
                inputMode="decimal"
                value={form.acquisitionPricePerShare}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    acquisitionPricePerShare: e.target.value,
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
          </AltFormSection>

          <AltFormSection
            title="Valorisation (manuelle)"
            hint="NAV saisie par vous · MOIC et P&L calculés automatiquement."
          >
            <AltField
              label={
                <span className="inline-flex items-center gap-1">
                  Valorisation actuelle (NAV totale)
                  <FinanceTip term="NAV PE" />
                </span>
              }
              hint={
                investedPreview > 0 ? (
                  <>
                    MOIC estimé :{" "}
                    <strong>{moicPreview.toFixed(2)}×</strong>
                    {" · "}
                    P&L :{" "}
                    <strong>
                      {formatCurrency(String(pnlPreview), form.currency)}
                    </strong>
                  </>
                ) : (
                  "Renseignez l’investi pour voir le MOIC"
                )
              }
            >
              <input
                className="input"
                inputMode="decimal"
                value={form.currentNav}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currentNav: e.target.value }))
                }
                data-testid="pe-nav"
              />
            </AltField>
            <AltField label="Notes" className="sm:col-span-2">
              <input
                className="input"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Tour, co-investisseurs, liquidité…"
              />
            </AltField>
          </AltFormSection>
        </AltFormPanel>
      }
    >
      {!q.isLoading && !hasLines && !showForm ? (
        <AltEmptyState
          title="Aucune position de private equity"
          description="Suivez le capital investi, la valorisation manuelle (NAV), le P&L latent et le MOIC de vos participations non cotées."
          bullets={[
            "Société, type (direct, fonds, crowdequity…)",
            "Parts et prix d’acquisition → capital investi (calculé)",
            "NAV actuelle saisie manuellement → MOIC et P&L (calculés)",
          ]}
          primaryLabel="Nouvelle position"
          onPrimary={startCreate}
          primaryTestId="pe-empty-add"
        />
      ) : (
        <div className="table-container-responsive table-fluid-wrap">
          <table
            className="table-fluid text-sm"
            data-testid="private-equity-table"
          >
            <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Société</th>
                <th className="px-3 py-2.5 text-left">Secteur</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-right">Parts</th>
                <th className="px-3 py-2.5 text-right">PRU / part</th>
                <th className="px-3 py-2.5 text-right">Investi</th>
                <th className="px-3 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-right">NAV</th>
                <th className="px-3 py-2.5 text-right">MOIC</th>
                <th className="px-3 py-2.5 text-right">+/- €</th>
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
                  <td className="px-3 py-2 font-medium">{l.companyName}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {l.sector || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {PE_TYPE_LABELS[l.peType] || l.peType}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(l.shares).toLocaleString("fr-FR", {
                      maximumFractionDigits: 4,
                    })}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {formatCurrency(l.acquisitionPricePerShare, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(l.investedTotal, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
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
                      "px-3 py-2 text-right font-medium tabular-nums",
                      getChangeColor(l.unrealizedPnl)
                    )}
                  >
                    {formatCurrency(l.unrealizedPnl, l.currency)}
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
                          if (confirm(`Supprimer « ${l.companyName} » ?`)) {
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
  );
}
