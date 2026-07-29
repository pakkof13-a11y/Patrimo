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
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import {
  PE_TYPES,
  PE_TYPE_LABELS,
  type PeType,
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
  // Mode expert — cycle de vie du capital et identité du véhicule
  committedCapital: string;
  calledCapital: string;
  distributionsReceived: string;
  ownershipPercent: string;
  vehicleName: string;
  round: string;
  expectedExitDate: string;
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
  committedCapital: "",
  calledCapital: "",
  distributionsReceived: "",
  ownershipPercent: "",
  vehicleName: "",
  round: "",
  expectedExitDate: "",
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
    committedCapital: l.committedCapital,
    // Valeur brute : un 0 stocké reste un champ vide à l'écran, le repli
    // n'est appliqué qu'à l'affichage et dans les ratios.
    calledCapital: Number(l.calledCapital) > 0 ? l.calledCapital : "",
    distributionsReceived: l.distributionsReceived,
    ownershipPercent: l.ownershipPercent || "",
    vehicleName: l.vehicleName || "",
    round: l.round || "",
    expectedExitDate: l.expectedExitDate || "",
  };
}

/** Une ligne portant des données expertes ouvre la section d'emblée. */
function hasExpertData(l: PrivateEquityDto): boolean {
  return (
    Number(l.committedCapital) > 0 ||
    Number(l.calledCapital) > 0 ||
    Number(l.distributionsReceived) > 0 ||
    !!l.ownershipPercent ||
    !!l.vehicleName ||
    !!l.round ||
    !!l.expectedExitDate
  );
}

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtMultiple(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  return `${Number(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}×`;
}

// ─── Filtres ────────────────────────────────────────────────────────────────

const PERF_FILTERS = ["ALL", "ABOVE", "BELOW", "DISTRIBUTING"] as const;
type PerfFilter = (typeof PERF_FILTERS)[number];

const PERF_LABELS: Record<PerfFilter, string> = {
  ALL: "Tous",
  ABOVE: "TVPI > 1×",
  BELOW: "TVPI < 1×",
  DISTRIBUTING: "Distribuant",
};

function matchesPerf(l: PrivateEquityDto, f: PerfFilter): boolean {
  if (f === "ALL") return true;
  if (f === "DISTRIBUTING") return Number(l.distributionsReceived) > 0;
  // TVPI null = aucun capital appelé : ni au-dessus ni en dessous de 1×,
  // la ligne est écartée des deux filtres de performance.
  if (l.tvpi == null) return false;
  return f === "ABOVE" ? Number(l.tvpi) > 1 : Number(l.tvpi) < 1;
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
  const [expert, setExpert] = useState(false);
  const [form, setForm] = useState<FormState>(empty());
  const [typeFilter, setTypeFilter] = useState<"ALL" | PeType>("ALL");
  const [perfFilter, setPerfFilter] = useState<PerfFilter>("ALL");
  const [deleteTarget, setDeleteTarget] = useState<PrivateEquityDto | null>(
    null
  );

  const lines = useMemo(() => q.data?.lines ?? [], [q.data?.lines]);
  const summary = q.data?.summary;
  const hasLines = lines.length > 0;

  const visible = useMemo(
    () =>
      lines.filter(
        (l) =>
          (typeFilter === "ALL" || l.peType === typeFilter) &&
          matchesPerf(l, perfFilter)
      ),
    [lines, typeFilter, perfFilter]
  );

  /**
   * Aperçu live des multiples sur les valeurs non encore enregistrées.
   *
   * Reproduit volontairement la règle de `private-equity.ts` : il n'existe
   * pas encore de DTO à lire pour une saisie en cours. Toute évolution de
   * `effectiveCalledCapital` côté service doit être répercutée ici.
   */
  const preview = useMemo(() => {
    const invested = num(form.shares) * num(form.acquisitionPricePerShare);
    const nav = num(form.currentNav);
    const distributions = num(form.distributionsReceived);
    const entered = num(form.calledCapital);
    const called = entered > 0 ? entered : invested;
    const calledIsDerived = entered <= 0;
    return {
      invested,
      nav,
      called,
      calledIsDerived,
      pnl: nav - invested,
      dpi: called > 0 ? distributions / called : null,
      rvpi: called > 0 ? nav / called : null,
      tvpi: called > 0 ? (nav + distributions) / called : null,
    };
  }, [
    form.shares,
    form.acquisitionPricePerShare,
    form.currentNav,
    form.distributionsReceived,
    form.calledCapital,
  ]);

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["private-equity"] }),
      qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
    ]);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        companyName: form.companyName,
        sector: form.sector || null,
        peType: form.peType,
        shares: form.shares || "0",
        acquisitionPricePerShare: form.acquisitionPricePerShare || "0",
        investmentDate: form.investmentDate || null,
        currentNav: form.currentNav || "0",
        currency: form.currency || "EUR",
        notes: form.notes || null,
        committedCapital: form.committedCapital || "0",
        distributionsReceived: form.distributionsReceived || "0",
        ownershipPercent: form.ownershipPercent || null,
        vehicleName: form.vehicleName || null,
        round: form.round || null,
        expectedExitDate: form.expectedExitDate || null,
      };
      // Capital appelé laissé vide : à la création on omet le champ pour que
      // le service l'initialise à parts × PRU ; en édition on envoie 0, seule
      // façon de revenir au mode dérivé après une saisie manuelle.
      if (form.calledCapital.trim()) {
        body.calledCapital = form.calledCapital;
      } else if (editingId) {
        body.calledCapital = "0";
      }
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
      setExpert(false);
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
    setExpert(false);
    setShowForm(true);
  }

  function startEdit(l: PrivateEquityDto) {
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
            TVPI
            <FinanceTip term="MOIC" />
          </span>{" "}
          = (NAV + distributions) ÷ capital appelé
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
            label="Capital appelé"
            value={formatCurrency(
              summary?.totalCalledCapital || "0",
              baseCurrency
            )}
            hint={`Sur ${formatCurrency(summary?.totalInvested || "0", baseCurrency)} investis`}
          />
          <AltMiniKpi
            label="NAV totale"
            value={formatCurrency(summary?.totalNav || "0", baseCurrency)}
            hint="Somme des valorisations manuelles"
            tip={<FinanceTip term="NAV PE" />}
          />
          <AltMiniKpi
            label="TVPI moyen"
            value={fmtMultiple(summary?.avgTvpi)}
            hint={`DPI ${fmtMultiple(summary?.avgDpi)} · RVPI ${fmtMultiple(summary?.avgRvpi)}`}
            tip={<FinanceTip term="MOIC" />}
          />
          <AltMiniKpi
            label="Distributions"
            value={formatCurrency(
              summary?.totalDistributions || "0",
              baseCurrency
            )}
            hint={`P&L latent : ${formatCurrency(summary?.totalPnl || "0", baseCurrency)}`}
            tone={Number(summary?.totalPnl || 0)}
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
                  {formatCurrency(String(preview.invested), form.currency)}
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
            hint="NAV saisie par vous · multiples et P&L calculés automatiquement."
          >
            <AltField
              label={
                <span className="inline-flex items-center gap-1">
                  Valorisation actuelle (NAV totale)
                  <FinanceTip term="NAV PE" />
                </span>
              }
              hint={
                preview.invested > 0 ? (
                  <>
                    P&L latent :{" "}
                    <strong>
                      {formatCurrency(String(preview.pnl), form.currency)}
                    </strong>
                  </>
                ) : (
                  "Renseignez l’investi pour voir le P&L"
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

          {/* Multiples live — visibles quel que soit le mode, ils dépendent
              de champs simples (NAV) autant qu'experts (distributions). */}
          <div
            className="grid gap-2 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)]/50 p-3 sm:grid-cols-3"
            data-testid="pe-multiples-preview"
          >
            <MultiplePreview
              label="DPI"
              value={preview.dpi}
              hint="Distributions ÷ appelé"
            />
            <MultiplePreview
              label="RVPI"
              value={preview.rvpi}
              hint="NAV ÷ appelé"
            />
            <MultiplePreview
              label="TVPI"
              value={preview.tvpi}
              hint="(NAV + distributions) ÷ appelé"
              strong
            />
            <p className="text-[10px] leading-snug text-[var(--muted-foreground)] sm:col-span-3">
              Capital appelé retenu :{" "}
              <strong>
                {formatCurrency(String(preview.called), form.currency)}
              </strong>{" "}
              —{" "}
              {preview.calledIsDerived
                ? "dérivé des parts × PRU"
                : "saisi manuellement"}
              .
            </p>
          </div>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            aria-expanded={expert}
            onClick={() => setExpert((v) => !v)}
            data-testid="pe-expert-toggle"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expert && "rotate-180")}
            />
            Mode expert — appels de capital, distributions et véhicule
          </button>

          {expert && (
            <div className="space-y-3" data-testid="pe-expert">
              <AltFormSection
                title="Cycle du capital"
                hint="Engagement total, part réellement appelée et distributions déjà perçues."
              >
                <AltField
                  label="Capital engagé (commitment)"
                  hint="Montant total promis au véhicule, appelé ou non"
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.committedCapital}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, committedCapital: e.target.value }))
                    }
                    data-testid="pe-committed-capital"
                  />
                </AltField>
                <AltField
                  label="Capital appelé"
                  hint={
                    preview.calledIsDerived
                      ? "Vide = dérivé des parts × PRU. Dénominateur du DPI / RVPI / TVPI."
                      : "Saisi manuellement. Videz le champ pour revenir au calcul parts × PRU."
                  }
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={String(preview.invested || "")}
                    value={form.calledCapital}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, calledCapital: e.target.value }))
                    }
                    data-testid="pe-called-capital"
                  />
                </AltField>
                <AltField
                  label="Distributions perçues"
                  hint="Cumul : dividendes, cessions partielles, retour de capital"
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.distributionsReceived}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        distributionsReceived: e.target.value,
                      }))
                    }
                    data-testid="pe-distributions"
                  />
                </AltField>
              </AltFormSection>

              <AltFormSection
                title="Véhicule & sortie"
                hint="Structure de détention, tour de table et horizon de liquidité."
              >
                <AltField
                  label="Quote-part détenue (%)"
                  hint="Pourcentage du capital de la société"
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="12,5"
                    value={form.ownershipPercent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, ownershipPercent: e.target.value }))
                    }
                    data-testid="pe-ownership"
                  />
                </AltField>
                <AltField
                  label="Véhicule"
                  hint="Fonds, holding, SPV portant la participation"
                >
                  <input
                    className="input"
                    value={form.vehicleName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vehicleName: e.target.value }))
                    }
                    placeholder="FPCI, SPV, holding…"
                  />
                </AltField>
                <AltField label="Tour de table">
                  <input
                    className="input"
                    value={form.round}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, round: e.target.value }))
                    }
                    placeholder="Seed, Série A…"
                  />
                </AltField>
                <AltField
                  label="Sortie envisagée"
                  hint="Horizon de liquidité estimé, purement indicatif"
                >
                  <DateInput
                    value={form.expectedExitDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, expectedExitDate: e.target.value }))
                    }
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
          title="Aucune position de private equity"
          description="Suivez le capital appelé, la valorisation manuelle (NAV), les distributions perçues et les multiples DPI / RVPI / TVPI de vos participations non cotées."
          bullets={[
            "Société, type (direct, fonds, crowdequity…)",
            "Parts et prix d’acquisition → capital investi (calculé)",
            "NAV actuelle saisie manuellement → P&L latent (calculé)",
            "Mode expert : commitment, capital appelé, distributions, quote-part et véhicule",
          ]}
          primaryLabel="Nouvelle position"
          onPrimary={startCreate}
          primaryTestId="pe-empty-add"
        />
      ) : (
        <>
          {hasLines && (
            <div
              className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 sm:px-5"
              data-testid="pe-filters"
            >
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
                Type
                <select
                  className="input !h-7 !py-0 text-[11px]"
                  value={typeFilter}
                  onChange={(e) =>
                    setTypeFilter(e.target.value as "ALL" | PeType)
                  }
                  data-testid="pe-filter-type"
                >
                  <option value="ALL">Tous ({lines.length})</option>
                  {PE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PE_TYPE_LABELS[t]} (
                      {lines.filter((l) => l.peType === t).length})
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="inline-flex rounded-md border border-[var(--border)] p-0.5"
                role="group"
                aria-label="Filtrer par performance"
              >
                {PERF_FILTERS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "rounded px-2 py-1 text-[11px] font-medium transition",
                      perfFilter === key
                        ? "bg-teal-700 text-white"
                        : "text-slate-500 hover:bg-[var(--muted)] hover:text-slate-800 dark:hover:text-slate-200"
                    )}
                    aria-pressed={perfFilter === key}
                    data-testid={`pe-filter-${key.toLowerCase()}`}
                    onClick={() => setPerfFilter(key)}
                  >
                    {PERF_LABELS[key]}
                    <span className="ml-1 opacity-60 tabular-nums">
                      {lines.filter((l) => matchesPerf(l, key)).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
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
                  <th className="px-3 py-2.5 text-right">Investi</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-right">NAV</th>
                  <th className="px-3 py-2.5 text-right">Distributions</th>
                  <th className="px-3 py-2.5 text-right">DPI</th>
                  <th className="px-3 py-2.5 text-right">TVPI</th>
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
                {!q.isLoading && hasLines && visible.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-4 py-10 text-center text-sm text-slate-400"
                      data-testid="pe-no-match"
                    >
                      Aucune position ne correspond aux filtres.
                    </td>
                  </tr>
                )}
                {visible.map((l) => (
                  <tr
                    key={l.id}
                    className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35"
                  >
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{l.companyName}</span>
                        {l.round && <RoundBadge round={l.round} />}
                      </div>
                      {l.ownershipPercent && (
                        <div
                          className="text-[10px] font-normal text-slate-400"
                          title="Quote-part détenue"
                        >
                          {Number(l.ownershipPercent).toLocaleString("fr-FR", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          % du capital
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {l.sector || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {PE_TYPE_LABELS[l.peType] || l.peType}
                      {l.vehicleName && (
                        <div className="text-[10px] text-slate-400">
                          {l.vehicleName}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(l.investedTotal, l.currency)}
                      <div
                        className="text-[10px] font-normal text-slate-400"
                        title={
                          l.calledCapitalIsDerived
                            ? "Capital appelé dérivé des parts × PRU — aucun appel saisi"
                            : "Capital appelé saisi manuellement"
                        }
                      >
                        {l.calledCapitalIsDerived
                          ? `${Number(l.shares).toLocaleString("fr-FR", {
                              maximumFractionDigits: 4,
                            })} × ${formatCurrency(l.acquisitionPricePerShare, l.currency)}`
                          : `${formatCurrency(l.calledCapital, l.currency)} appelé`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {l.investmentDate
                        ? new Date(l.investmentDate).toLocaleDateString("fr-FR")
                        : "—"}
                      {l.expectedExitDate && (
                        <div
                          className="text-[10px] text-slate-400"
                          title="Sortie envisagée"
                        >
                          →{" "}
                          {new Date(l.expectedExitDate).toLocaleDateString(
                            "fr-FR"
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(l.currentNav, l.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(l.distributionsReceived) > 0 ? (
                        <span className="font-medium text-emerald-700 dark:text-emerald-300">
                          {formatCurrency(l.distributionsReceived, l.currency)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {fmtMultiple(l.dpi)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-teal-700 dark:text-teal-300">
                      {fmtMultiple(l.tvpi)}
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
                          onClick={() => setDeleteTarget(l)}
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
        </>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        title="Supprimer la position"
        message={
          deleteTarget
            ? `« ${deleteTarget.companyName} » sera définitivement supprimée. Cette action est irréversible.`
            : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) delMut.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        testId="pe-delete-confirm"
      />
    </AltModuleShell>
  );
}

function MultiplePreview({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: number | null;
  hint: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-label normal-case tracking-wide">{label}</div>
      <div
        className={cn(
          "mt-0.5 tabular-nums tracking-tight",
          strong
            ? "text-base font-semibold text-teal-700 dark:text-teal-300"
            : "text-sm font-semibold"
        )}
      >
        {fmtMultiple(value)}
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
        {hint}
      </div>
    </div>
  );
}

function RoundBadge({ round }: { round: string }) {
  return (
    <span
      className="inline-flex rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-600 ring-1 ring-inset ring-slate-300 dark:text-slate-300 dark:ring-slate-600"
      title="Tour de table"
    >
      {round}
    </span>
  );
}
