"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import {
  AltEmptyState,
  AltField,
  AltFormPanel,
  AltFormSection,
  AltMiniKpi,
  AltModuleShell,
} from "@/components/tabs/alternatives-shell";
import { moduleTableHeadClass } from "@/components/ui/module-shell";
import {
  COMMON_FINENESS,
  FORMAT_LABELS,
  METAL_LABELS,
  PRECIOUS_FORMATS,
  PRECIOUS_METALS,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABELS,
  type PreciousFormat,
  type PreciousMetal,
  type PreciousProductType,
} from "@/app/lib/precious-metals/constants";
import {
  computeMetalSaleTax,
  FULL_EXEMPTION_YEARS,
  REGIME_LABELS,
  type MetalTaxRegime,
} from "@/app/lib/precious-metals/tax";
import type {
  PreciousMetalDto,
  PreciousMetalsSummary,
} from "@/app/lib/alternatives/types";

type MetalsView = "lots" | "sales";

type SaleTax = ReturnType<typeof computeMetalSaleTax>;

type SaleDto = {
  id: string;
  positionId: string | null;
  denomination: string;
  quantity: string;
  salePriceEur: string;
  saleFeesEur: string;
  costBasisEur: string;
  soldAt: string;
  acquiredAt: string | null;
  regime: MetalTaxRegime;
  hasInvoice: boolean;
  notes: string | null;
  tax: SaleTax;
};

type FiscalYear = {
  year: number;
  saleCount: number;
  grossSalesEur: string;
  taxDueEur: string;
  byRegime: Record<MetalTaxRegime, { count: number; taxEur: string }>;
};

type FormState = {
  metal: string;
  format: string;
  productType: string;
  denomination: string;
  fineness: string;
  quantity: string;
  unitWeight: string;
  weightUnit: string;
  purchasePriceUnit: string;
  acquisitionFees: string;
  acquiredAt: string;
  hasInvoice: boolean;
  currentValue: string;
  currency: string;
  storageLocation: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  metal: "GOLD",
  format: "PHYSICAL",
  productType: "COIN",
  denomination: "",
  fineness: "999",
  quantity: "1",
  unitWeight: "",
  weightUnit: "GRAM",
  purchasePriceUnit: "",
  acquisitionFees: "0",
  acquiredAt: "",
  hasInvoice: false,
  currentValue: "",
  currency: "EUR",
  storageLocation: "",
  notes: "",
});

function lineToForm(l: PreciousMetalDto): FormState {
  return {
    metal: l.metal,
    format: l.format,
    productType: l.productType,
    denomination: l.denomination,
    fineness: l.fineness,
    quantity: l.quantity,
    unitWeight: l.unitWeightDisplay,
    weightUnit: l.weightUnit,
    purchasePriceUnit: l.purchasePriceUnit,
    acquisitionFees: l.acquisitionFees,
    acquiredAt: l.acquiredAt ? l.acquiredAt.slice(0, 10) : "",
    hasInvoice: l.hasInvoice,
    currentValue: l.currentValue,
    currency: l.currency,
    storageLocation: l.storageLocation ?? "",
    notes: l.notes ?? "",
  };
}

type SaleFormState = {
  positionId: string;
  quantity: string;
  salePriceEur: string;
  saleFeesEur: string;
  soldAt: string;
  regime: MetalTaxRegime;
  notes: string;
};

const emptySaleForm = (): SaleFormState => ({
  positionId: "",
  quantity: "1",
  salePriceEur: "",
  saleFeesEur: "0",
  soldAt: new Date().toISOString().slice(0, 10),
  regime: "FORFAIT",
  notes: "",
});

function num(value: string): number {
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function grams(value: string): string {
  return `${Number(value).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  })} g`;
}

export function AlternativesMetals({ baseCurrency }: { baseCurrency: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<MetalsView>("lots");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showSaleForm, setShowSaleForm] = useState(false);
  // Suppressions en attente de confirmation — modale partagée plutôt que
  // `window.confirm()`, pour la cohérence visuelle et la testabilité.
  const [pendingLotDelete, setPendingLotDelete] = useState<PreciousMetalDto | null>(
    null
  );
  const [pendingSaleDelete, setPendingSaleDelete] = useState<SaleDto | null>(null);
  const [saleForm, setSaleForm] = useState<SaleFormState>(emptySaleForm);

  const q = useQuery({
    queryKey: ["precious-metals"],
    queryFn: () =>
      fetchJson<{ lines: PreciousMetalDto[]; summary: PreciousMetalsSummary }>(
        "/api/precious-metals"
      ),
    staleTime: 30_000,
  });

  /*
    Cours des métaux : lecture seule au chargement — l'écran ne doit jamais
    attendre un fournisseur pour s'afficher — et rafraîchissement sur geste
    explicite, comme l'actualisation des cours du portefeuille.
  */
  const spotQ = useQuery({
    queryKey: ["metal-spot"],
    queryFn: () =>
      fetchJson<{
        spots: Record<string, { eurPerGram: number; day: string; source: string }>;
      }>("/api/precious-metals/spot"),
    staleTime: 5 * 60_000,
  });

  const refreshSpot = useMutation({
    mutationFn: () =>
      fetchJson<{ missing?: string[] }>("/api/precious-metals/spot", {
        method: "POST",
      }),
    onSuccess: async (data) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["metal-spot"] }),
        qc.invalidateQueries({ queryKey: ["precious-metals"] }),
      ]);
      const missing = data.missing ?? [];
      if (missing.length > 0) {
        toast.warning(
          `Cours indisponible pour ${missing.length} métal(aux) — les valeurs affichées datent`
        );
      } else {
        toast.success("Cours des métaux actualisés");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salesQ = useQuery({
    queryKey: ["precious-metal-sales"],
    queryFn: () =>
      fetchJson<{ sales: SaleDto[]; fiscalYears: FiscalYear[] }>(
        "/api/precious-metals/sales"
      ),
    staleTime: 30_000,
  });

  const lines = useMemo(() => q.data?.lines ?? [], [q.data]);
  const summary = q.data?.summary;
  const sales = useMemo(() => salesQ.data?.sales ?? [], [salesQ.data]);
  const fiscalYears = useMemo(
    () => salesQ.data?.fiscalYears ?? [],
    [salesQ.data]
  );

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["precious-metals"] }),
      qc.invalidateQueries({ queryKey: ["precious-metal-sales"] }),
      qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
    ]);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        metal: form.metal,
        format: form.format,
        productType: form.productType,
        denomination: form.denomination,
        fineness: form.fineness || "999",
        quantity: form.quantity || "0",
        unitWeight: form.unitWeight || "0",
        weightUnit: form.weightUnit,
        purchasePriceUnit: form.purchasePriceUnit || "0",
        acquisitionFees: form.acquisitionFees || "0",
        acquiredAt: form.acquiredAt || null,
        hasInvoice: form.hasInvoice,
        currentValue: form.currentValue || "0",
        currency: form.currency || "EUR",
        storageLocation: form.storageLocation || null,
        notes: form.notes || null,
      };
      return fetchJson("/api/precious-metals", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(editingId ? { id: editingId, ...body } : body),
      });
    },
    onSuccess: async () => {
      toast.success(editingId ? "Lot mis à jour" : "Lot ajouté");
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
      toast.success("Lot supprimé");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saleMut = useMutation({
    mutationFn: () =>
      fetchJson("/api/precious-metals/sales", {
        method: "POST",
        body: JSON.stringify({
          positionId: saleForm.positionId || null,
          quantity: saleForm.quantity || "0",
          salePriceEur: saleForm.salePriceEur || "0",
          saleFeesEur: saleForm.saleFeesEur || "0",
          soldAt: saleForm.soldAt,
          regime: saleForm.regime,
          notes: saleForm.notes || null,
        }),
      }),
    onSuccess: async () => {
      toast.success("Cession enregistrée");
      setSaleForm(emptySaleForm());
      setShowSaleForm(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delSaleMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/precious-metals/sales?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Cession supprimée");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedLot = useMemo(
    () => lines.find((l) => l.id === saleForm.positionId) ?? null,
    [lines, saleForm.positionId]
  );

  /**
   * Simulation en direct, calculée dans le navigateur.
   *
   * Le moteur fiscal est une fonction pure sans dépendance serveur : le
   * comparatif suit la frappe, sans aller-retour réseau, et reste identique à
   * celui qui sera stocké au moment de la vente.
   */
  const simulation = useMemo(() => {
    const price = num(saleForm.salePriceEur);
    if (!selectedLot || price <= 0) return null;
    const quantity = num(saleForm.quantity);
    const lotQuantity = num(selectedLot.quantity);
    if (quantity <= 0 || lotQuantity <= 0) return null;
    const share = Math.min(quantity / lotQuantity, 1);
    const costBasis =
      quantity * num(selectedLot.purchasePriceUnit) +
      num(selectedLot.acquisitionFees) * share;

    return computeMetalSaleTax({
      salePriceEur: String(price),
      costBasisEur: String(costBasis),
      saleFeesEur: String(num(saleForm.saleFeesEur)),
      acquiredAt: selectedLot.acquiredAt,
      soldAt: saleForm.soldAt,
      hasInvoice: selectedLot.hasInvoice,
    });
  }, [selectedLot, saleForm]);

  const costPreview = useMemo(
    () =>
      num(form.quantity) * num(form.purchasePriceUnit) +
      num(form.acquisitionFees),
    [form.quantity, form.purchasePriceUnit, form.acquisitionFees]
  );
  const pnlPreview = num(form.currentValue) - costPreview;

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setView("lots");
  }

  function startEdit(l: PreciousMetalDto) {
    setEditingId(l.id);
    setForm(lineToForm(l));
    setShowForm(true);
    setView("lots");
  }

  function startSale(l?: PreciousMetalDto) {
    setSaleForm({ ...emptySaleForm(), positionId: l?.id ?? "" });
    setShowSaleForm(true);
    setView("sales");
  }

  const physicalLots = lines.filter((l) => l.format === "PHYSICAL");
  const currentYear = fiscalYears[0];

  return (
    <AltModuleShell
      testId="metals-section"
      title="Métaux précieux"
      subtitle={
        <>
          Or, argent, platine, palladium — physique ou papier. Chaque ligne est
          un <strong>lot daté</strong> : c&apos;est la date d&apos;acquisition
          qui commande la fiscalité de l&apos;article 150 VI du CGI.
        </>
      }
      action={
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => startSale()}
            data-testid="metals-sale-add"
          >
            Enregistrer une cession
          </Button>
          <Button type="button" size="sm" onClick={startCreate} data-testid="metals-add">
            <Plus className="h-3.5 w-3.5" />
            Nouveau lot
          </Button>
        </div>
      }
      kpis={
        <>
          <AltMiniKpi
            label="Valeur actuelle"
            value={formatCurrency(summary?.totalValue ?? "0", baseCurrency)}
          />
          <AltMiniKpi
            label="Or fin & métal fin"
            value={grams(summary?.totalFineWeightG ?? "0")}
            hint="Poids brut × titre — le seul comparable d'un produit à l'autre"
          />
          <AltMiniKpi
            label="P&L latent"
            value={formatCurrency(summary?.totalPnl ?? "0", baseCurrency)}
            tone={Number(summary?.totalPnl ?? 0)}
          />
          <AltMiniKpi
            label="Impôt de l'année"
            value={formatCurrency(currentYear?.taxDueEur ?? "0", baseCurrency)}
            hint={
              currentYear
                ? `${currentYear.saleCount} cession(s) en ${currentYear.year}`
                : "Aucune cession déclarée"
            }
          />
        </>
      }
      formOpen={showForm}
      form={
        <AltFormPanel
          title={editingId ? "Modifier le lot" : "Nouveau lot de métal"}
          hint="Un lot = une acquisition homogène. Deux achats du même produit à des dates différentes font deux lots : leur fiscalité diffère."
          testId="metals-form"
          actions={
            <>
              <Button
                type="button"
                size="sm"
                disabled={saveMut.isPending || !form.denomination.trim()}
                onClick={() => saveMut.mutate()}
                data-testid="metals-submit"
              >
                {saveMut.isPending ? "…" : editingId ? "Enregistrer" : "Créer le lot"}
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
            </>
          }
        >
          <AltFormSection
            title="Nature du produit"
            hint="Métal, forme et titre — le titre décide du poids fin réellement détenu."
          >
            <AltField label="Métal">
              <select
                className="input w-full"
                value={form.metal}
                onChange={(e) => setForm((f) => ({ ...f, metal: e.target.value }))}
                data-testid="metals-metal"
              >
                {PRECIOUS_METALS.map((m) => (
                  <option key={m} value={m}>
                    {METAL_LABELS[m as PreciousMetal]}
                  </option>
                ))}
              </select>
            </AltField>
            <AltField
              label="Format"
              hint={
                form.format === "PAPER"
                  ? "Un ETC ou une minière relèvent du PFU, pas de la taxe sur les métaux."
                  : "Le physique relève de l'article 150 VI : taxe forfaitaire ou option pour le régime réel."
              }
            >
              <select
                className="input w-full"
                value={form.format}
                onChange={(e) => setForm((f) => ({ ...f, format: e.target.value }))}
                data-testid="metals-format"
              >
                {PRECIOUS_FORMATS.map((k) => (
                  <option key={k} value={k}>
                    {FORMAT_LABELS[k as PreciousFormat]}
                  </option>
                ))}
              </select>
            </AltField>
            <AltField label="Type de produit">
              <select
                className="input w-full"
                value={form.productType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, productType: e.target.value }))
                }
              >
                {PRODUCT_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {PRODUCT_TYPE_LABELS[k as PreciousProductType]}
                  </option>
                ))}
              </select>
            </AltField>
            <AltField label="Dénomination">
              <input
                className="input w-full"
                placeholder="Napoléon 20F, Lingot 1 kg…"
                value={form.denomination}
                onChange={(e) =>
                  setForm((f) => ({ ...f, denomination: e.target.value }))
                }
                data-testid="metals-denomination"
              />
            </AltField>
            <AltField
              label="Titre (millièmes)"
              hint="900 pour un Napoléon, 999,9 pour un lingot, 750 pour un bijou 18 carats."
            >
              <input
                className="input w-full"
                inputMode="decimal"
                list="metals-fineness-list"
                value={form.fineness}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fineness: e.target.value }))
                }
                data-testid="metals-fineness"
              />
              <datalist id="metals-fineness-list">
                {COMMON_FINENESS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </datalist>
            </AltField>
          </AltFormSection>

          <AltFormSection
            title="Quantité & poids"
            hint="Saisissez le poids **brut** de l'unité : le poids fin est déduit du titre."
          >
            <AltField label="Quantité">
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, quantity: e.target.value }))
                }
                data-testid="metals-quantity"
              />
            </AltField>
            <AltField
              label="Poids unitaire brut"
              hint={
                num(form.unitWeight) > 0 && num(form.fineness) > 0 ? (
                  <>
                    Poids fin total :{" "}
                    <strong>
                      {grams(
                        String(
                          (form.weightUnit === "OZ"
                            ? num(form.unitWeight) * 31.1034768
                            : num(form.unitWeight)) *
                            num(form.quantity) *
                            (num(form.fineness) / 1000)
                        )
                      )}
                    </strong>
                  </>
                ) : undefined
              }
            >
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
                  className="input w-28"
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
            </AltField>
            <AltField label="Lieu de stockage">
              <input
                className="input w-full"
                placeholder="Coffre, domicile…"
                value={form.storageLocation}
                onChange={(e) =>
                  setForm((f) => ({ ...f, storageLocation: e.target.value }))
                }
              />
            </AltField>
          </AltFormSection>

          <AltFormSection
            title="Acquisition & justificatif"
            hint="Ces deux champs conditionnent l'option pour le régime réel — ils se perdent des années avant la vente."
          >
            <AltField
              label="Date d'acquisition"
              hint="Sans elle, aucun abattement pour durée de détention n'est calculable."
            >
              <input
                type="date"
                className="input w-full"
                value={form.acquiredAt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, acquiredAt: e.target.value }))
                }
                data-testid="metals-acquired-at"
              />
            </AltField>
            <AltField label="PRU (prix d'achat unitaire)">
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.purchasePriceUnit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, purchasePriceUnit: e.target.value }))
                }
                data-testid="metals-pru"
              />
            </AltField>
            <AltField
              label="Frais d'acquisition"
              hint={
                <>
                  Prix de revient total :{" "}
                  {formatCurrency(String(costPreview), form.currency || "EUR")}
                </>
              }
            >
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.acquisitionFees}
                onChange={(e) =>
                  setForm((f) => ({ ...f, acquisitionFees: e.target.value }))
                }
              />
            </AltField>
            <AltField
              label="Facture nominative conservée"
              className="sm:col-span-2"
              hint="Condition de l'option 2092-SD. Sans elle, la taxe forfaitaire de 11,5 % s'impose, même à perte."
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.hasInvoice}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hasInvoice: e.target.checked }))
                  }
                  data-testid="metals-has-invoice"
                />
                J&apos;ai conservé la facture d&apos;achat datée
              </label>
            </AltField>
          </AltFormSection>

          <AltFormSection
            title="Valorisation"
            hint="Valeur actuelle saisie à la main — les cours ne sont pas automatiques."
          >
            <AltField
              label="Valeur actuelle (totale)"
              hint={
                <>
                  P&L estimé :{" "}
                  <strong>
                    {formatCurrency(String(pnlPreview), form.currency || "EUR")}
                  </strong>
                </>
              }
            >
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.currentValue}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currentValue: e.target.value }))
                }
                data-testid="metals-current-value"
              />
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
            <AltField label="Notes" className="sm:col-span-2 lg:col-span-3">
              <input
                className="input w-full"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </AltField>
          </AltFormSection>
        </AltFormPanel>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ["lots", `Lots détenus (${lines.length})`],
            ["sales", `Cessions & fiscalité (${sales.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-current={view === id ? "page" : undefined}
            data-testid={`metals-view-${id}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === id
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--muted)]/50 text-slate-500 hover:text-slate-800"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Les deux conditions de l'option fiscale se perdent silencieusement.
          L'avertissement vaut des années avant la vente, pas le jour où il est
          trop tard pour retrouver une facture. */}
      {view === "lots" &&
        summary &&
        summary.undatedCount + summary.noInvoiceCount > 0 && (
          <div
            className="mb-3 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            data-testid="metals-fiscal-warning"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {summary.undatedCount > 0 && (
                <>
                  <strong>{summary.undatedCount}</strong> lot(s) sans date
                  d&apos;acquisition.{" "}
                </>
              )}
              {summary.noInvoiceCount > 0 && (
                <>
                  <strong>{summary.noInvoiceCount}</strong> lot(s) physique(s)
                  sans facture conservée.{" "}
                </>
              )}
              À la revente, l&apos;option pour le régime des plus-values leur
              sera fermée : la taxe forfaitaire de 11,5 % du prix de vente
              s&apos;appliquera, même en cas de perte.
            </span>
          </div>
        )}

      {view === "lots" ? (
        !q.isLoading && lines.length === 0 && !showForm ? (
          <AltEmptyState
            title="Aucun lot de métal"
            description="Suivez lingots, pièces et exposition papier — avec la date d'acquisition qui commande toute la fiscalité à la revente."
            bullets={[
              "Métal, titre et poids brut → poids fin calculé",
              "Date d'acquisition et facture → abattement et option fiscale",
              "Cession → comparaison des deux régimes et formulaire à déposer",
            ]}
            primaryLabel="Nouveau lot"
            onPrimary={startCreate}
            primaryTestId="metals-empty-add"
          />
        ) : (
          <>
            {summary && summary.byMetal.length > 0 && (
              <div
                className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
                data-testid="metals-by-metal"
              >
                {summary.byMetal.map((m) => (
                  <div
                    key={m.metal}
                    className="rounded-md border border-[var(--border)] px-3 py-2"
                  >
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      {m.name}
                    </div>
                    <div className="text-sm font-semibold tabular-nums">
                      {formatCurrency(String(m.value), baseCurrency)}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {grams(m.fineWeightG)} fin
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/*
              Bandeau des cours : le gramme de métal fin, et la date à laquelle
              il a été relevé. Afficher la date n'est pas un détail — une
              valorisation d'hier reste utile, à condition de savoir qu'elle
              date d'hier.
            */}
            <div
              className="mb-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]"
              data-testid="metal-spot-bar"
            >
              <span className="text-label">Cours du gramme fin</span>
              {Object.entries(spotQ.data?.spots ?? {}).length === 0 ? (
                <span className="text-[length:var(--text-xs)] text-[var(--foreground-faint)]">
                  Aucun cours en cache — lancez une actualisation.
                </span>
              ) : (
                Object.entries(spotQ.data?.spots ?? {}).map(([metal, spot]) => (
                  <span
                    key={metal}
                    className="num text-[length:var(--text-xs)] text-[var(--foreground-secondary)]"
                    title={`Relevé du ${spot.day} · source ${spot.source}`}
                  >
                    {METAL_LABELS[metal as PreciousMetal] ?? metal}{" "}
                    <strong className="text-[var(--foreground)]">
                      {formatCurrency(String(spot.eurPerGram), "EUR")}
                    </strong>
                    <span className="text-[var(--foreground-faint)]"> · {spot.day}</span>
                  </span>
                ))
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto !h-7 !text-[11px]"
                data-testid="metal-spot-refresh"
                disabled={refreshSpot.isPending}
                onClick={() => refreshSpot.mutate()}
              >
                {refreshSpot.isPending ? "Actualisation…" : "Actualiser les cours"}
              </Button>
            </div>

            <div className="table-container-responsive table-fluid-wrap">
              <table
                className="table-fluid text-sm"
                data-testid="precious-metals-table"
              >
                <thead className={moduleTableHeadClass}>
                  <tr>
                    <th className="px-3 py-2.5 text-left">Dénomination</th>
                    <th className="px-3 py-2.5 text-left">Métal</th>
                    <th className="px-3 py-2.5 text-left">Format</th>
                    <th className="px-3 py-2.5 text-right">Qté</th>
                    <th className="px-3 py-2.5 text-right">Titre</th>
                    <th className="px-3 py-2.5 text-right">Poids fin</th>
                    <th className="px-3 py-2.5 text-left">Acquis le</th>
                    <th className="px-3 py-2.5 text-right">Prix de revient</th>
                    <th className="px-3 py-2.5 text-right">
                      Valeur métal
                      <div className="text-[9px] font-normal normal-case tracking-normal text-slate-400">
                        au cours du jour
                      </div>
                    </th>
                    <th className="px-3 py-2.5 text-right">Valeur act.</th>
                    <th className="px-3 py-2.5 text-right">+/- €</th>
                    <th className="px-3 py-2.5 text-right">+/- %</th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.isLoading && (
                    <tr>
                      <td colSpan={13} className="px-4 py-10 text-center text-sm text-slate-400">
                        Chargement…
                      </td>
                    </tr>
                  )}
                  {lines.map((l) => (
                    <tr
                      key={l.id}
                      data-testid="metals-row"
                      className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35"
                    >
                      <td className="px-3 py-2 font-medium">
                        {l.denomination}
                        <div className="text-[10px] font-normal text-slate-400">
                          {PRODUCT_TYPE_LABELS[l.productType]}
                          {l.storageLocation ? ` · ${l.storageLocation}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">{METAL_LABELS[l.metal]}</td>
                      <td className="px-3 py-2 text-xs">{FORMAT_LABELS[l.format]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(l.quantity).toLocaleString("fr-FR", {
                          maximumFractionDigits: 6,
                        })}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {Number(l.fineness).toLocaleString("fr-FR")}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {grams(l.fineWeightG)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {l.acquiredAt ? (
                          <span className="inline-flex items-center gap-1">
                            {new Date(l.acquiredAt).toLocaleDateString("fr-FR")}
                            {l.format === "PHYSICAL" && !l.hasInvoice && (
                              <AlertTriangle
                                className="h-3 w-3 text-amber-500"
                                aria-label="Sans facture : option fiscale fermée"
                              />
                            )}
                          </span>
                        ) : (
                          <span className="text-amber-600">non renseignée</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(l.costBasis, l.currency)}
                      </td>
                      {/*
                        Contenu métal au cours du jour, et prime payée
                        au-delà. Le lot garde sa valeur propre : une pièce de
                        collection ne vaut pas son poids de métal, et écraser
                        l'une par l'autre effacerait précisément l'écart qu'on
                        cherche à suivre.
                      */}
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {l.metalValueEur ? (
                          <>
                            <div className="text-[var(--foreground)]">
                              {formatCurrency(l.metalValueEur, "EUR")}
                            </div>
                            {l.premiumPct && (
                              <div
                                className={cn(
                                  "text-[10px]",
                                  Number(l.premiumPct) >= 0
                                    ? "text-slate-400"
                                    : "val-negative"
                                )}
                                title={`Prime sur le contenu métal — cours du ${l.spotDay ?? "jour"}`}
                              >
                                prime {Number(l.premiumPct) >= 0 ? "+" : ""}
                                {Number(l.premiumPct).toLocaleString("fr-FR", {
                                  maximumFractionDigits: 1,
                                })}
                                 %
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400" title="Aucun cours connu pour ce métal">
                            —
                          </span>
                        )}
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
                      <td className="px-2 py-1.5 text-right">
                        <div className="inline-flex gap-0.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="!h-7 !px-2 text-[11px] text-slate-500 hover:text-slate-900"
                            onClick={() => startSale(l)}
                            data-testid="metals-row-sell"
                          >
                            Céder
                          </Button>
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
                            onClick={() => setPendingLotDelete(l)}
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
        )
      ) : (
        <MetalsSalesView
          baseCurrency={baseCurrency}
          lots={physicalLots}
          allLots={lines}
          sales={sales}
          fiscalYears={fiscalYears}
          form={saleForm}
          setForm={setSaleForm}
          open={showSaleForm}
          setOpen={setShowSaleForm}
          simulation={simulation}
          pending={saleMut.isPending}
          onSubmit={() => saleMut.mutate()}
          onDelete={(sale) => setPendingSaleDelete(sale)}
          onCreateLot={startCreate}
        />
      )}
      <ConfirmDialog
        open={pendingLotDelete !== null}
        title="Supprimer ce lot ?"
        message={
          pendingLotDelete
            ? `« ${pendingLotDelete.denomination} » sera retiré. Les cessions déjà enregistrées sur ce lot sont conservées : l'historique fiscal reste complet.`
            : ""
        }
        onConfirm={() => {
          if (pendingLotDelete) delMut.mutate(pendingLotDelete.id);
          setPendingLotDelete(null);
        }}
        onCancel={() => setPendingLotDelete(null)}
        testId="metals-delete-confirm"
      />

      <ConfirmDialog
        open={pendingSaleDelete !== null}
        title="Supprimer cette cession ?"
        message={
          pendingSaleDelete
            ? `La vente de « ${pendingSaleDelete.denomination} » sortira du récapitulatif fiscal de l'année. Le stock du lot n'est pas rétabli pour autant.`
            : ""
        }
        onConfirm={() => {
          if (pendingSaleDelete) delSaleMut.mutate(pendingSaleDelete.id);
          setPendingSaleDelete(null);
        }}
        onCancel={() => setPendingSaleDelete(null)}
        testId="metals-sale-delete-confirm"
      />
    </AltModuleShell>
  );
}

function MetalsSalesView({
  baseCurrency,
  lots,
  allLots,
  sales,
  fiscalYears,
  form,
  setForm,
  open,
  setOpen,
  simulation,
  pending,
  onSubmit,
  onDelete,
  onCreateLot,
}: {
  baseCurrency: string;
  lots: PreciousMetalDto[];
  allLots: PreciousMetalDto[];
  sales: SaleDto[];
  fiscalYears: FiscalYear[];
  form: SaleFormState;
  setForm: React.Dispatch<React.SetStateAction<SaleFormState>>;
  open: boolean;
  setOpen: (value: boolean) => void;
  simulation: SaleTax | null;
  pending: boolean;
  onSubmit: () => void;
  onDelete: (sale: SaleDto) => void;
  onCreateLot: () => void;
}) {
  if (allLots.length === 0 && sales.length === 0) {
    return (
      <AltEmptyState
        title="Aucune cession"
        description="La détention n'est jamais taxée : seule la vente déclenche l'impôt. Créez d'abord un lot pour pouvoir en simuler la cession."
        primaryLabel="Nouveau lot"
        onPrimary={onCreateLot}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="metals-sales-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Chaque cession se déclare et se paie dans le <strong>mois</strong> qui
          suit la vente — pas à la déclaration annuelle de revenus.
        </p>
        <Button type="button" size="sm" onClick={() => setOpen(!open)}>
          {open ? "Fermer" : "Nouvelle cession"}
        </Button>
      </div>

      {open && (
        <div
          className="rounded-md border border-[var(--border)] p-3"
          data-testid="metals-sale-form"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AltField
              label="Lot cédé"
              hint="Le prix de revient et la date viennent du lot — ils ne se saisissent pas."
            >
              <select
                className="input w-full"
                value={form.positionId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, positionId: e.target.value }))
                }
                data-testid="metals-sale-lot"
              >
                <option value="">— Sélectionner —</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.denomination} · {Number(l.quantity).toLocaleString("fr-FR")}{" "}
                    unité(s)
                    {l.acquiredAt
                      ? ` · ${new Date(l.acquiredAt).getFullYear()}`
                      : " · sans date"}
                  </option>
                ))}
              </select>
            </AltField>
            <AltField label="Quantité cédée">
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, quantity: e.target.value }))
                }
                data-testid="metals-sale-quantity"
              />
            </AltField>
            <AltField label="Prix de cession (brut)">
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.salePriceEur}
                onChange={(e) =>
                  setForm((f) => ({ ...f, salePriceEur: e.target.value }))
                }
                data-testid="metals-sale-price"
              />
            </AltField>
            <AltField label="Frais de vente">
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.saleFeesEur}
                onChange={(e) =>
                  setForm((f) => ({ ...f, saleFeesEur: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Date de cession">
              <input
                type="date"
                className="input w-full"
                value={form.soldAt}
                onChange={(e) => setForm((f) => ({ ...f, soldAt: e.target.value }))}
                data-testid="metals-sale-date"
              />
            </AltField>
            <AltField label="Régime déclaré">
              <select
                className="input w-full"
                value={form.regime}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    regime: e.target.value as MetalTaxRegime,
                  }))
                }
                data-testid="metals-sale-regime"
              >
                <option value="FORFAIT">{REGIME_LABELS.FORFAIT}</option>
                <option
                  value="PLUS_VALUE"
                  disabled={simulation ? !simulation.capitalGain.available : false}
                >
                  {REGIME_LABELS.PLUS_VALUE}
                </option>
              </select>
            </AltField>
          </div>

          {simulation && (
            <MetalTaxComparison
              simulation={simulation}
              baseCurrency={baseCurrency}
            />
          )}

          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !form.salePriceEur}
              onClick={onSubmit}
              data-testid="metals-sale-submit"
            >
              {pending ? "…" : "Enregistrer la cession"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      {fiscalYears.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="metals-fiscal-years">
          {fiscalYears.map((y) => (
            <div
              key={y.year}
              className="rounded-md border border-[var(--border)] px-3 py-2"
            >
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Année {y.year} · {y.saleCount} cession(s)
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {formatCurrency(y.taxDueEur, baseCurrency)} d&apos;impôt
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                {formatCurrency(y.grossSalesEur, baseCurrency)} cédés ·{" "}
                {y.byRegime.FORFAIT.count} au forfait,{" "}
                {y.byRegime.PLUS_VALUE.count} au réel
              </div>
            </div>
          ))}
        </div>
      )}

      {sales.length > 0 && (
        <div className="table-container-responsive table-fluid-wrap">
          <table className="table-fluid text-sm" data-testid="metals-sales-table">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th className="px-3 py-2.5 text-left">Produit</th>
                <th className="px-3 py-2.5 text-left">Vendu le</th>
                <th className="px-3 py-2.5 text-right">Détention</th>
                <th className="px-3 py-2.5 text-right">Prix de cession</th>
                <th className="px-3 py-2.5 text-right">Plus-value</th>
                <th className="px-3 py-2.5 text-left">Régime</th>
                <th className="px-3 py-2.5 text-right">Impôt</th>
                <th className="px-3 py-2.5 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const line = s.regime === "FORFAIT" ? s.tax.flat : s.tax.capitalGain;
                return (
                  <tr
                    key={s.id}
                    data-testid="metals-sale-row"
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2 font-medium">
                      {s.denomination}
                      <div className="text-[10px] font-normal text-slate-400">
                        {Number(s.quantity).toLocaleString("fr-FR")} unité(s)
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(s.soldAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {s.tax.holdingYears} an(s)
                      {s.tax.exempt && (
                        <div className="text-[10px] text-emerald-600">exonéré</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(s.salePriceEur, baseCurrency)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        getChangeColor(s.tax.grossGainEur)
                      )}
                    >
                      {formatCurrency(s.tax.grossGainEur, baseCurrency)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.regime === "FORFAIT" ? "Forfaitaire" : "Plus-value"}
                      <div className="text-[10px] text-slate-400">{line.form}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(line.taxEur, baseCurrency)}
                      {Number(s.tax.forgoneSavingsEur) > 0 && (
                        <div className="text-[10px] font-normal text-amber-600">
                          +{formatCurrency(s.tax.forgoneSavingsEur, baseCurrency)}{" "}
                          faute de justificatif
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600"
                        onClick={() => onDelete(s)}
                        aria-label="Supprimer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Comparatif des deux régimes.
 *
 * Le régime le moins coûteux est mis en avant, mais celui qui est fermé reste
 * affiché : savoir ce qu'on aurait payé avec une facture est ce qui change le
 * comportement lors du prochain achat.
 */
function MetalTaxComparison({
  simulation,
  baseCurrency,
}: {
  simulation: SaleTax;
  baseCurrency: string;
}) {
  const options = [
    { key: "FORFAIT" as const, result: simulation.flat },
    { key: "PLUS_VALUE" as const, result: simulation.capitalGain },
  ];

  return (
    <div className="mt-3 space-y-2" data-testid="metals-tax-comparison">
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(({ key, result }) => {
          const chosen = simulation.recommended === key;
          return (
            <div
              key={key}
              data-testid={`metals-tax-${key.toLowerCase()}`}
              className={cn(
                "rounded-md border px-3 py-2",
                chosen
                  ? "border-emerald-400/70 bg-emerald-50/50 dark:bg-emerald-950/20"
                  : "border-[var(--border)]",
                !result.available && "opacity-60"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{REGIME_LABELS[key]}</span>
                <span className="text-[10px] text-slate-500">{result.form}</span>
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {formatCurrency(result.taxEur, baseCurrency)}
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                Assiette {formatCurrency(result.taxableBaseEur, baseCurrency)} ·
                net perçu {formatCurrency(result.netProceedsEur, baseCurrency)}
              </div>
              {!result.available && result.unavailableReason && (
                <div className="mt-1 text-[11px] text-amber-600">
                  {result.unavailableReason}
                </div>
              )}
              {chosen && (
                <div className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  Régime retenu
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500" data-testid="metals-tax-rationale">
        {simulation.rationale}
      </p>

      {!simulation.exempt && simulation.holdingYears > 0 && (
        <p className="text-[11px] text-slate-400">
          Abattement acquis :{" "}
          {(Number(simulation.allowanceRate) * 100).toLocaleString("fr-FR", {
            maximumFractionDigits: 0,
          })}{" "}
          % après {simulation.holdingYears} an(s) — exonération totale à{" "}
          {FULL_EXEMPTION_YEARS} ans.
        </p>
      )}
    </div>
  );
}
