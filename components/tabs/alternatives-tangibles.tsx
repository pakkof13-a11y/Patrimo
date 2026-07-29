"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  Vault,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import type {
  TangibleAssetDto,
  TangibleAssetsSummary,
} from "@/app/lib/alternatives/types";
import {
  COLLECTIBLE_TOGGLE_CATEGORIES,
  detailSectionsFor,
  fiscalNature,
  GEM_CLARITIES,
  GEM_CUT_LABELS,
  GEM_CUTS,
  GEM_TREATMENT_LABELS,
  GEM_TREATMENTS,
  GEM_TYPE_LABELS,
  GEM_TYPES,
  JEWELRY_TYPE_LABELS,
  JEWELRY_TYPES,
  METAL_BASE_LABELS,
  METAL_BASES,
  TANGIBLE_CATEGORIES,
  TANGIBLE_CATEGORY_ICONS,
  TANGIBLE_CATEGORY_LABELS,
  WATCH_MOVEMENT_LABELS,
  WATCH_MOVEMENTS,
  WINE_BOTTLE_FORMAT_LABELS,
  WINE_BOTTLE_FORMATS,
  WINE_STORAGE_TYPE_LABELS,
  WINE_STORAGE_TYPES,
  type TangibleCategory,
} from "@/app/lib/tangibles/constants";
import {
  breakEvenYear,
  computeMovableSaleTax,
  FULL_EXEMPTION_YEARS,
  HOLDING_ALLOWANCE_FREE_YEARS,
  SMALL_SALE_EXEMPTION_EUR,
} from "@/app/lib/tax/movable-assets";
import { completedYearsBetween } from "@/app/lib/tax/movable-assets";
import {
  coverageRatio,
  INSURANCE_STATUS_LABELS,
  INSURANCE_TYPE_LABELS,
  INSURANCE_TYPES,
  insuranceStatus,
  STORAGE_TYPE_LABELS,
  STORAGE_TYPES,
  type InsuranceStatus,
  type StorageType,
} from "@/app/lib/tangibles/ownership";
import {
  AltEmptyState,
  AltField,
  AltMiniKpi,
  AltModuleShell,
} from "@/components/tabs/alternatives-shell";
import {
  FormWizard,
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
  type WizardStep,
} from "@/components/ui/form-wizard";

const TANGIBLE_DRAFT_KEY = "patrimo.draft.tangible.v2";

const TANGIBLE_STEPS: WizardStep[] = [
  { id: "id", label: "Identification", description: "Catégorie et objet" },
  { id: "details", label: "Détails", description: "Selon la catégorie" },
  { id: "acq", label: "Acquisition", description: "Date, prix, justificatif" },
  { id: "val", label: "Valorisation", description: "Estimation et conservation" },
  { id: "recap", label: "Récap & fiscalité", description: "Contrôle final" },
];

type FormState = {
  category: string;
  brandOrArtist: string;
  modelName: string;
  yearOrVintage: string;
  purchasePrice: string;
  estimatedValue: string;
  currency: string;
  hasCertificate: boolean;
  notes: string;

  purchaseDate: string;
  purchaseSource: string;
  certificateRef: string;
  certificateIssuer: string;
  hasPurchaseProof: boolean;
  acquisitionFees: string;

  appraisalValue: string;
  appraisalDate: string;
  appraisalProvider: string;
  insuranceValue: string;
  storageLocation: string;
  isCollectible: boolean;

  insurancePremiumAnnual: string;
  insuranceProvider: string;
  insurancePolicyRef: string;
  insuranceExpiryDate: string;
  insuranceType: string;
  storageType: string;
  storageCostAnnual: string;
  storageProvider: string;
  storageContractRef: string;
  storageRenewalDate: string;

  includeInEstate: boolean;
  estateNote: string;

  gemType: string;
  caratWeight: string;
  gemClarity: string;
  gemColor: string;
  gemCut: string;
  gemTreatment: string;
  gemOrigin: string;
  jewelryType: string;
  metalBase: string;
  metalWeightG: string;
  hasPunchmarks: boolean;
  watchMovement: string;
  watchDiameterMm: string;
  watchReference: string;
  watchBoxPapers: boolean;
  wineAppellation: string;
  wineBottleCount: string;
  wineBottleFormat: string;
  wineStorageType: string;
  autoMileageKm: string;
  autoRegistration: string;
  autoInspectionOk: boolean;
  autoPreviousOwners: string;
};

const empty = (): FormState => ({
  category: "WATCHES",
  brandOrArtist: "",
  modelName: "",
  yearOrVintage: "",
  purchasePrice: "",
  estimatedValue: "",
  currency: "EUR",
  hasCertificate: false,
  notes: "",

  purchaseDate: "",
  purchaseSource: "",
  certificateRef: "",
  certificateIssuer: "",
  hasPurchaseProof: false,
  acquisitionFees: "",

  appraisalValue: "",
  appraisalDate: "",
  appraisalProvider: "",
  insuranceValue: "",
  storageLocation: "",
  isCollectible: false,

  insurancePremiumAnnual: "",
  insuranceProvider: "",
  insurancePolicyRef: "",
  insuranceExpiryDate: "",
  insuranceType: "",
  storageType: "",
  storageCostAnnual: "",
  storageProvider: "",
  storageContractRef: "",
  storageRenewalDate: "",

  includeInEstate: true,
  estateNote: "",

  gemType: "",
  caratWeight: "",
  gemClarity: "",
  gemColor: "",
  gemCut: "",
  gemTreatment: "",
  gemOrigin: "",
  jewelryType: "",
  metalBase: "",
  metalWeightG: "",
  hasPunchmarks: false,
  watchMovement: "",
  watchDiameterMm: "",
  watchReference: "",
  watchBoxPapers: false,
  wineAppellation: "",
  wineBottleCount: "",
  wineBottleFormat: "",
  wineStorageType: "",
  autoMileageKm: "",
  autoRegistration: "",
  autoInspectionOk: false,
  autoPreviousOwners: "",
});

function toForm(l: TangibleAssetDto): FormState {
  return {
    ...empty(),
    category: l.category,
    brandOrArtist: l.brandOrArtist,
    modelName: l.modelName,
    yearOrVintage: l.yearOrVintage ?? "",
    purchasePrice: l.purchasePrice,
    estimatedValue: l.estimatedValue,
    currency: l.currency,
    hasCertificate: l.hasCertificate,
    notes: l.notes ?? "",

    purchaseDate: l.purchaseDate ? l.purchaseDate.slice(0, 10) : "",
    purchaseSource: l.purchaseSource ?? "",
    certificateRef: l.certificateRef ?? "",
    certificateIssuer: l.certificateIssuer ?? "",
    hasPurchaseProof: l.hasPurchaseProof,
    acquisitionFees: l.acquisitionFees ?? "",

    appraisalValue: l.appraisalValue ?? "",
    appraisalDate: l.appraisalDate ? l.appraisalDate.slice(0, 10) : "",
    appraisalProvider: l.appraisalProvider ?? "",
    insuranceValue: l.insuranceValue ?? "",
    storageLocation: l.storageLocation ?? "",
    isCollectible: l.isCollectible,

    insurancePremiumAnnual: l.insurancePremiumAnnual ?? "",
    insuranceProvider: l.insuranceProvider ?? "",
    insurancePolicyRef: l.insurancePolicyRef ?? "",
    insuranceExpiryDate: l.insuranceExpiryDate
      ? l.insuranceExpiryDate.slice(0, 10)
      : "",
    insuranceType: l.insuranceType ?? "",
    storageType: l.storageType ?? "",
    storageCostAnnual: l.storageCostAnnual ?? "",
    storageProvider: l.storageProvider ?? "",
    storageContractRef: l.storageContractRef ?? "",
    storageRenewalDate: l.storageRenewalDate
      ? l.storageRenewalDate.slice(0, 10)
      : "",

    includeInEstate: l.includeInEstate,
    estateNote: l.estateNote ?? "",

    gemType: l.gemType ?? "",
    caratWeight: l.caratWeight ?? "",
    gemClarity: l.gemClarity ?? "",
    gemColor: l.gemColor ?? "",
    gemCut: l.gemCut ?? "",
    gemTreatment: l.gemTreatment ?? "",
    gemOrigin: l.gemOrigin ?? "",
    jewelryType: l.jewelryType ?? "",
    metalBase: l.metalBase ?? "",
    metalWeightG: l.metalWeightG ?? "",
    hasPunchmarks: l.hasPunchmarks ?? false,
    watchMovement: l.watchMovement ?? "",
    watchDiameterMm: l.watchDiameterMm ?? "",
    watchReference: l.watchReference ?? "",
    watchBoxPapers: l.watchBoxPapers ?? false,
    wineAppellation: l.wineAppellation ?? "",
    wineBottleCount: l.wineBottleCount !== null ? String(l.wineBottleCount) : "",
    wineBottleFormat: l.wineBottleFormat ?? "",
    wineStorageType: l.wineStorageType ?? "",
    autoMileageKm: l.autoMileageKm !== null ? String(l.autoMileageKm) : "",
    autoRegistration: l.autoRegistration ?? "",
    autoInspectionOk: l.autoInspectionOk ?? false,
    autoPreviousOwners:
      l.autoPreviousOwners !== null ? String(l.autoPreviousOwners) : "",
  };
}

const COVERAGE_LABEL = INSURANCE_STATUS_LABELS;

function num(value: string): number {
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Chaîne vide → `null` : ne jamais envoyer « rien » comme une valeur. */
function orNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function AlternativesTangibles({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["tangibles"],
    queryFn: () =>
      fetchJson<{ lines: TangibleAssetDto[]; summary: TangibleAssetsSummary }>(
        "/api/tangibles"
      ),
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty());
  const [wizStep, setWizStep] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /**
   * Ligne dont la suppression attend confirmation.
   *
   * La modale partagée remplace `window.confirm()` : même surface visuelle que
   * les autres modules du dépôt, et testable — une boîte native n'est pas
   * pilotable depuis un test de bout en bout.
   */
  const [pendingDelete, setPendingDelete] = useState<TangibleAssetDto | null>(
    null
  );

  const lines = useMemo(() => q.data?.lines ?? [], [q.data]);
  const summary = q.data?.summary;
  const hasLines = lines.length > 0;

  const sections = detailSectionsFor(form.category);
  const showCollectibleToggle = COLLECTIBLE_TOGGLE_CATEGORIES.includes(
    form.category as TangibleCategory
  );

  const pnlPreview = num(form.estimatedValue) - num(form.purchasePrice);
  const annualOwnershipCost =
    num(form.insurancePremiumAnnual) + num(form.storageCostAnnual);

  /** Couverture affichée en direct pendant la saisie. */
  const coverage = useMemo(() => {
    const ratio = coverageRatio(
      String(num(form.estimatedValue)),
      form.insuranceValue.trim() === "" ? null : String(num(form.insuranceValue))
    );
    return ratio ? ratio.toNumber() : null;
  }, [form.estimatedValue, form.insuranceValue]);

  const coverageStatus: InsuranceStatus = useMemo(
    () =>
      insuranceStatus({
        estimatedValue: String(num(form.estimatedValue)),
        insuranceValue:
          form.insuranceValue.trim() === ""
            ? null
            : String(num(form.insuranceValue)),
        insuranceExpiryDate: form.insuranceExpiryDate || null,
      }),
    [form.estimatedValue, form.insuranceValue, form.insuranceExpiryDate]
  );

  /**
   * Portage cumulé depuis l'achat.
   *
   * `null` sans date d'achat : afficher 0 laisserait croire que la détention
   * n'a rien coûté, alors qu'on ignore simplement depuis quand elle dure.
   */
  const carryPreview = useMemo(() => {
    if (!form.purchaseDate || annualOwnershipCost <= 0) return null;
    const bought = new Date(form.purchaseDate);
    if (Number.isNaN(bought.getTime())) return null;
    const years = completedYearsBetween(bought, new Date());
    const total = annualOwnershipCost * years;
    return { years, total, net: pnlPreview - total };
  }, [form.purchaseDate, annualOwnershipCost, pnlPreview]);

  /**
   * Simulation fiscale de la dernière étape, calculée dans le navigateur.
   *
   * Le moteur est une fonction pure sans dépendance serveur : le récapitulatif
   * suit la saisie et donne exactement ce que le service recalculera.
   */
  /**
   * Prix de cession simulé.
   *
   * Vide, il suit la valeur estimée ; saisi, il la remplace. Le vendeur teste
   * ainsi « et si je le cédais à tel prix ? » sans toucher à l'estimation
   * enregistrée, qui n'a pas à bouger pour une hypothèse.
   */
  const [simulatedPrice, setSimulatedPrice] = useState("");
  const effectiveSalePrice =
    simulatedPrice.trim() === ""
      ? num(form.estimatedValue)
      : num(simulatedPrice);

  const costBasisPreview =
    num(form.purchasePrice) + num(form.acquisitionFees);

  const simulation = useMemo(() => {
    if (effectiveSalePrice <= 0) return null;
    return computeMovableSaleTax({
      nature: fiscalNature(form.category, form.isCollectible),
      salePriceEur: String(effectiveSalePrice),
      costBasisEur: String(costBasisPreview),
      acquiredAt: form.purchaseDate || null,
      soldAt: new Date(),
      hasInvoice: Boolean(form.purchaseDate) && form.hasPurchaseProof,
    });
  }, [
    effectiveSalePrice,
    costBasisPreview,
    form.category,
    form.isCollectible,
    form.purchaseDate,
    form.hasPurchaseProof,
  ]);

  /** Année où le régime réel devient moins cher, au prix simulé. */
  const switchYear = useMemo(() => {
    if (effectiveSalePrice <= 0) return null;
    return breakEvenYear({
      nature: fiscalNature(form.category, form.isCollectible),
      salePriceEur: String(effectiveSalePrice),
      costBasisEur: String(costBasisPreview),
    });
  }, [effectiveSalePrice, costBasisPreview, form.category, form.isCollectible]);

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tangibles"] }),
      qc.invalidateQueries({ queryKey: ["holdings"] }),
      qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
    ]);
  }

  function validateTangibleStep(index: number): boolean {
    if (index === 0 && (!form.brandOrArtist.trim() || !form.modelName.trim())) {
      toast.error("Marque / artiste et modèle requis");
      return false;
    }
    return true;
  }

  function saveTangibleDraft() {
    saveWizardDraft(TANGIBLE_DRAFT_KEY, { form, step: wizStep, editingId });
    toast.success("Brouillon tangible enregistré");
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        category: form.category,
        brandOrArtist: form.brandOrArtist,
        modelName: form.modelName,
        yearOrVintage: orNull(form.yearOrVintage),
        purchasePrice: form.purchasePrice || "0",
        estimatedValue: form.estimatedValue || "0",
        currency: form.currency || "EUR",
        hasCertificate: form.hasCertificate,
        notes: orNull(form.notes),

        purchaseDate: orNull(form.purchaseDate),
        purchaseSource: orNull(form.purchaseSource),
        certificateRef: orNull(form.certificateRef),
        certificateIssuer: orNull(form.certificateIssuer),
        hasPurchaseProof: form.hasPurchaseProof,
        acquisitionFees: orNull(form.acquisitionFees),

        appraisalValue: orNull(form.appraisalValue),
        appraisalDate: orNull(form.appraisalDate),
        appraisalProvider: orNull(form.appraisalProvider),
        insuranceValue: orNull(form.insuranceValue),
        storageLocation: orNull(form.storageLocation),
        isCollectible: form.isCollectible,

        insurancePremiumAnnual: orNull(form.insurancePremiumAnnual),
        insuranceProvider: orNull(form.insuranceProvider),
        insurancePolicyRef: orNull(form.insurancePolicyRef),
        insuranceExpiryDate: orNull(form.insuranceExpiryDate),
        insuranceType: orNull(form.insuranceType),
        storageType: orNull(form.storageType),
        storageCostAnnual: orNull(form.storageCostAnnual),
        storageProvider: orNull(form.storageProvider),
        storageContractRef: orNull(form.storageContractRef),
        storageRenewalDate: orNull(form.storageRenewalDate),

        includeInEstate: form.includeInEstate,
        estateNote: orNull(form.estateNote),

        gemType: orNull(form.gemType),
        caratWeight: orNull(form.caratWeight),
        gemClarity: orNull(form.gemClarity),
        gemColor: orNull(form.gemColor),
        gemCut: orNull(form.gemCut),
        gemTreatment: orNull(form.gemTreatment),
        gemOrigin: orNull(form.gemOrigin),
        jewelryType: orNull(form.jewelryType),
        metalBase: orNull(form.metalBase),
        metalWeightG: orNull(form.metalWeightG),
        hasPunchmarks: form.hasPunchmarks,
        watchMovement: orNull(form.watchMovement),
        watchDiameterMm: orNull(form.watchDiameterMm),
        watchReference: orNull(form.watchReference),
        watchBoxPapers: form.watchBoxPapers,
        wineAppellation: orNull(form.wineAppellation),
        wineBottleCount: orNull(form.wineBottleCount),
        wineBottleFormat: orNull(form.wineBottleFormat),
        wineStorageType: orNull(form.wineStorageType),
        autoMileageKm: orNull(form.autoMileageKm),
        autoRegistration: orNull(form.autoRegistration),
        autoInspectionOk: form.autoInspectionOk,
        autoPreviousOwners: orNull(form.autoPreviousOwners),
      };
      return fetchJson("/api/tangibles", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(editingId ? { id: editingId, ...body } : body),
      });
    },
    onSuccess: async () => {
      toast.success(editingId ? "Actif mis à jour" : "Actif ajouté");
      clearWizardDraft(TANGIBLE_DRAFT_KEY);
      setEditingId(null);
      setForm(empty());
      setShowForm(false);
      setWizStep(0);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/tangibles?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Actif supprimé");
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startCreate() {
    setEditingId(null);
    const draft = loadWizardDraft<{ form?: FormState; step?: number }>(
      TANGIBLE_DRAFT_KEY
    );
    if (draft?.form) {
      setForm({ ...empty(), ...draft.form });
      setWizStep(draft.step ?? 0);
    } else {
      setForm(empty());
      setWizStep(0);
    }
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(empty());
    setWizStep(0);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <AltModuleShell
      testId="tangibles-section"
      title="Tangibles & collection"
      subtitle="Montres, bijoux, pierres, art, vins, véhicules… — estimation manuelle, et fiscalité de cession calculée par objet"
      action={
        <Button type="button" size="sm" onClick={startCreate} data-testid="tangible-add">
          <Plus className="h-3.5 w-3.5" />
          Nouvel actif
        </Button>
      }
      kpis={
        <>
          <AltMiniKpi
            label="Valeur estimée"
            value={formatCurrency(summary?.totalValue ?? "0", baseCurrency)}
            hint="Somme des estimations"
          />
          <AltMiniKpi
            label="Plus-value latente"
            value={formatCurrency(summary?.totalPnl ?? "0", baseCurrency)}
            tone={Number(summary?.totalPnl ?? 0)}
            hint="Estimé − achat (calculé)"
          />
          <AltMiniKpi
            label="Impôt si tout était vendu"
            value={formatCurrency(summary?.estimatedTaxBurden ?? "0", baseCurrency)}
            hint={`Projection — ${summary?.exemptCount ?? 0} objet(s) exonéré(s)`}
          />
          <AltMiniKpi
            label="Coût de possession / an"
            value={formatCurrency(
              summary?.totalAnnualOwnershipCost ?? "0",
              baseCurrency
            )}
            hint={`Primes + garde · dont ${formatCurrency(summary?.totalAnnualCustodyCost ?? "0", baseCurrency)} de garde`}
          />
          <AltMiniKpi
            label="Capital assuré"
            value={formatCurrency(summary?.totalInsuredValue ?? "0", baseCurrency)}
            hint={
              (summary?.underInsuredCount ?? 0) +
                (summary?.uninsuredHighValueCount ?? 0) >
              0
                ? `${summary?.underInsuredCount ?? 0} sous-assuré(s) · ${summary?.uninsuredHighValueCount ?? 0} non assuré(s)`
                : "Couverture déclarée"
            }
          />
        </>
      }
      formOpen={showForm}
      form={
        <div
          className="border-b border-[var(--primary)]/20 bg-[var(--primary-soft)] px-4 py-4 sm:px-5"
          data-testid="tangible-form"
        >
          <header className="mb-3 space-y-0.5">
            <h3 className="text-title text-sm">
              {editingId ? "Modifier l’actif" : "Nouvel actif tangible"}
            </h3>
            <p className="text-meta">
              Assistant en 5 étapes — les détails s’adaptent à la catégorie.
            </p>
          </header>
          <FormWizard
            steps={TANGIBLE_STEPS}
            current={wizStep}
            onStepChange={setWizStep}
            onValidateStep={validateTangibleStep}
            onSaveDraft={saveTangibleDraft}
            onCancel={cancelForm}
            onSubmit={() => saveMut.mutate()}
            submitLabel={editingId ? "Enregistrer" : "Créer l’actif"}
            submitDisabled={!form.brandOrArtist.trim() || !form.modelName.trim()}
            submitPending={saveMut.isPending}
            testId="tangible-wizard"
          >
            {wizStep === 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <AltField label="Catégorie">
                  <select
                    className="input"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                    data-testid="tangible-category"
                  >
                    {TANGIBLE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {TANGIBLE_CATEGORY_ICONS[c]} {TANGIBLE_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </AltField>
                <AltField label="Année / Millésime / Référence">
                  <input
                    className="input"
                    value={form.yearOrVintage}
                    onChange={(e) => set("yearOrVintage", e.target.value)}
                  />
                </AltField>
                <AltField label="Marque / Artiste / Maison">
                  <input
                    className="input"
                    value={form.brandOrArtist}
                    onChange={(e) => set("brandOrArtist", e.target.value)}
                    data-testid="tangible-brand"
                  />
                </AltField>
                <AltField label="Modèle / Nom / Description">
                  <input
                    className="input"
                    value={form.modelName}
                    onChange={(e) => set("modelName", e.target.value)}
                    data-testid="tangible-model"
                  />
                </AltField>
              </div>
            )}

            {wizStep === 1 && (
              <div className="space-y-3" data-testid="tangible-details-step">
                {sections.length === 0 && (
                  <p className="text-xs text-slate-500">
                    Cette catégorie n’a pas de champ spécifique. Décrivez
                    provenance, dimensions ou état dans les notes, à l’étape
                    finale.
                  </p>
                )}

                {sections.includes("jewelry") && (
                  <div className="grid gap-3 sm:grid-cols-2" data-testid="tangible-jewelry-fields">
                    <AltField label="Type de bijou">
                      <select
                        className="input"
                        value={form.jewelryType}
                        onChange={(e) => set("jewelryType", e.target.value)}
                      >
                        <option value="">—</option>
                        {JEWELRY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {JEWELRY_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField label="Métal de base">
                      <select
                        className="input"
                        value={form.metalBase}
                        onChange={(e) => set("metalBase", e.target.value)}
                      >
                        <option value="">—</option>
                        {METAL_BASES.map((m) => (
                          <option key={m} value={m}>
                            {METAL_BASE_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField label="Poids du métal (g)">
                      <input
                        className="input"
                        inputMode="decimal"
                        value={form.metalWeightG}
                        onChange={(e) => set("metalWeightG", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Poinçons d’État">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.hasPunchmarks}
                          onChange={(e) => set("hasPunchmarks", e.target.checked)}
                        />
                        Poinçons présents
                      </label>
                    </AltField>
                  </div>
                )}

                {sections.includes("gem") && (
                  <div className="grid gap-3 sm:grid-cols-2" data-testid="tangible-gem-fields">
                    <AltField label="Type de pierre">
                      <select
                        className="input"
                        value={form.gemType}
                        onChange={(e) => set("gemType", e.target.value)}
                        data-testid="tangible-gem-type"
                      >
                        <option value="">—</option>
                        {GEM_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {GEM_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField label="Poids (carats)">
                      <input
                        className="input"
                        inputMode="decimal"
                        value={form.caratWeight}
                        onChange={(e) => set("caratWeight", e.target.value)}
                        data-testid="tangible-carat"
                      />
                    </AltField>
                    <AltField label="Pureté">
                      <select
                        className="input"
                        value={form.gemClarity}
                        onChange={(e) => set("gemClarity", e.target.value)}
                      >
                        <option value="">—</option>
                        {GEM_CLARITIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField label="Couleur" hint="D à Z pour un diamant">
                      <input
                        className="input"
                        value={form.gemColor}
                        onChange={(e) => set("gemColor", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Taille">
                      <select
                        className="input"
                        value={form.gemCut}
                        onChange={(e) => set("gemCut", e.target.value)}
                      >
                        <option value="">—</option>
                        {GEM_CUTS.map((c) => (
                          <option key={c} value={c}>
                            {GEM_CUT_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField
                      label="Traitement"
                      hint="Une pierre chauffée ou synthétique vaut une fraction de l’équivalent naturel."
                    >
                      <select
                        className="input"
                        value={form.gemTreatment}
                        onChange={(e) => set("gemTreatment", e.target.value)}
                      >
                        <option value="">—</option>
                        {GEM_TREATMENTS.map((t) => (
                          <option key={t} value={t}>
                            {GEM_TREATMENT_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField label="Origine" hint="Cachemire, Myanmar, Colombie…">
                      <input
                        className="input"
                        value={form.gemOrigin}
                        onChange={(e) => set("gemOrigin", e.target.value)}
                      />
                    </AltField>
                  </div>
                )}

                {sections.includes("watch") && (
                  <div className="grid gap-3 sm:grid-cols-2" data-testid="tangible-watch-fields">
                    <AltField label="Référence fabricant" hint="Ex. 126610LN">
                      <input
                        className="input"
                        value={form.watchReference}
                        onChange={(e) => set("watchReference", e.target.value)}
                        data-testid="tangible-watch-ref"
                      />
                    </AltField>
                    <AltField label="Mouvement">
                      <select
                        className="input"
                        value={form.watchMovement}
                        onChange={(e) => set("watchMovement", e.target.value)}
                      >
                        <option value="">—</option>
                        {WATCH_MOVEMENTS.map((m) => (
                          <option key={m} value={m}>
                            {WATCH_MOVEMENT_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField label="Diamètre (mm)">
                      <input
                        className="input"
                        inputMode="decimal"
                        value={form.watchDiameterMm}
                        onChange={(e) => set("watchDiameterMm", e.target.value)}
                      />
                    </AltField>
                    <AltField
                      label="Boîte & papiers"
                      hint="Leur présence pèse lourd à la revente."
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.watchBoxPapers}
                          onChange={(e) => set("watchBoxPapers", e.target.checked)}
                        />
                        Full set
                      </label>
                    </AltField>
                  </div>
                )}

                {sections.includes("wine") && (
                  <div className="grid gap-3 sm:grid-cols-2" data-testid="tangible-wine-fields">
                    <AltField label="Appellation">
                      <input
                        className="input"
                        value={form.wineAppellation}
                        onChange={(e) => set("wineAppellation", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Nombre de bouteilles">
                      <input
                        className="input"
                        inputMode="numeric"
                        value={form.wineBottleCount}
                        onChange={(e) => set("wineBottleCount", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Format">
                      <select
                        className="input"
                        value={form.wineBottleFormat}
                        onChange={(e) => set("wineBottleFormat", e.target.value)}
                      >
                        <option value="">—</option>
                        {WINE_BOTTLE_FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {WINE_BOTTLE_FORMAT_LABELS[f]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField
                      label="Type de cave"
                      hint="Précision œnologique. Le mode de garde qui pilote les alertes se saisit à l’étape suivante."
                    >
                      <select
                        className="input"
                        value={form.wineStorageType}
                        onChange={(e) => set("wineStorageType", e.target.value)}
                      >
                        <option value="">—</option>
                        {WINE_STORAGE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {WINE_STORAGE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                  </div>
                )}

                {sections.includes("auto") && (
                  <div className="grid gap-3 sm:grid-cols-2" data-testid="tangible-auto-fields">
                    <AltField label="Kilométrage">
                      <input
                        className="input"
                        inputMode="numeric"
                        value={form.autoMileageKm}
                        onChange={(e) => set("autoMileageKm", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Immatriculation">
                      <input
                        className="input uppercase"
                        value={form.autoRegistration}
                        onChange={(e) => set("autoRegistration", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Nombre de propriétaires">
                      <input
                        className="input"
                        inputMode="numeric"
                        value={form.autoPreviousOwners}
                        onChange={(e) => set("autoPreviousOwners", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Contrôle technique">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.autoInspectionOk}
                          onChange={(e) => set("autoInspectionOk", e.target.checked)}
                        />
                        À jour
                      </label>
                    </AltField>
                  </div>
                )}

                {showCollectibleToggle && (
                  <div
                    className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs dark:bg-amber-950/30"
                    data-testid="tangible-collectible-toggle"
                  >
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={form.isCollectible}
                        onChange={(e) => set("isCollectible", e.target.checked)}
                        data-testid="tangible-is-collectible"
                      />
                      <span>
                        <strong>Objet de collection</strong> au sens fiscal.
                        Véhicules et mobilier sont exonérés d’impôt à la revente
                        par nature (art. 150 UA II 1°) ; cochée, cette case les
                        fait basculer dans le champ de la taxe sur les objets
                        précieux. Une voiture d’usage ne l’est pas, une pièce de
                        collection l’est.
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {wizStep === 2 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <AltField
                  label="Date d’achat"
                  hint="Sans elle, aucun abattement pour durée de détention n’est calculable."
                >
                  <input
                    type="date"
                    className="input"
                    value={form.purchaseDate}
                    onChange={(e) => set("purchaseDate", e.target.value)}
                    data-testid="tangible-purchase-date"
                  />
                </AltField>
                <AltField label="Source d’achat" hint="Vendeur, maison de vente, succession…">
                  <input
                    className="input"
                    value={form.purchaseSource}
                    onChange={(e) => set("purchaseSource", e.target.value)}
                  />
                </AltField>
                <AltField label="Prix d’achat">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.purchasePrice}
                    onChange={(e) => set("purchasePrice", e.target.value)}
                    data-testid="tangible-purchase-price"
                  />
                </AltField>
                <AltField label="Devise">
                  <input
                    className="input uppercase"
                    maxLength={3}
                    value={form.currency}
                    onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  />
                </AltField>
                <AltField
                  label="Frais d’acquisition"
                  hint="Commissaire-priseur, expertise, transport — ils réduisent la plus-value taxable."
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.acquisitionFees}
                    onChange={(e) => set("acquisitionFees", e.target.value)}
                    data-testid="tangible-acquisition-fees"
                  />
                </AltField>

                {/* Deux justificatifs distincts, et un seul compte fiscalement.
                    Les fusionner ouvrirait l'option du régime réel à des
                    objets certifiés mais sans facture — impôt sous-évalué. */}
                <label className="flex items-start gap-2 text-xs font-medium sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-teal-700"
                    checked={form.hasPurchaseProof}
                    onChange={(e) => set("hasPurchaseProof", e.target.checked)}
                    data-testid="tangible-has-purchase-proof"
                  />
                  <span>
                    J’ai les justificatifs d’achat (facture, acte, bordereau
                    d’adjudication)
                    <span className="block font-normal text-slate-500">
                      Seule pièce qui prouve le prix et la date — condition de
                      l’option pour le régime des plus-values.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs font-medium sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-teal-700"
                    checked={form.hasCertificate}
                    onChange={(e) => set("hasCertificate", e.target.checked)}
                    data-testid="tangible-has-certificate"
                  />
                  <span>
                    Certificat d’authenticité conservé
                    <span className="block font-normal text-slate-500">
                      Atteste ce qu’est l’objet, pas ce qu’il a coûté : sans
                      effet fiscal.
                    </span>
                  </span>
                </label>
                {form.hasCertificate && (
                  <>
                    <AltField label="Organisme certificateur" hint="GIA, IGI, LFG, manufacture…">
                      <input
                        className="input"
                        value={form.certificateIssuer}
                        onChange={(e) => set("certificateIssuer", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Numéro de certificat">
                      <input
                        className="input"
                        value={form.certificateRef}
                        onChange={(e) => set("certificateRef", e.target.value)}
                      />
                    </AltField>
                  </>
                )}
              </div>
            )}

            {wizStep === 3 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <AltField
                  label="Valeur estimée de marché"
                  hint={
                    form.purchasePrice || form.estimatedValue ? (
                      <>
                        Plus-value estimée :{" "}
                        <strong className={cn(getChangeColor(String(pnlPreview)))}>
                          {formatCurrency(String(pnlPreview), form.currency)}
                        </strong>
                      </>
                    ) : (
                      "Ce que l’objet vaudrait revendu aujourd’hui"
                    )
                  }
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.estimatedValue}
                    onChange={(e) => set("estimatedValue", e.target.value)}
                    data-testid="tangible-estimated-value"
                  />
                </AltField>
                <AltField
                  label="Valeur d’expertise"
                  hint="Notaire ou assureur — distincte de la valeur de revente."
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={form.appraisalValue}
                    onChange={(e) => set("appraisalValue", e.target.value)}
                    data-testid="tangible-appraisal-value"
                  />
                </AltField>
                <AltField label="Date d’expertise">
                  <input
                    type="date"
                    className="input"
                    value={form.appraisalDate}
                    onChange={(e) => set("appraisalDate", e.target.value)}
                  />
                </AltField>
                <AltField
                  label="Expert"
                  hint="Notaire, assureur, expert indépendant, maison de vente."
                >
                  <input
                    className="input"
                    value={form.appraisalProvider}
                    onChange={(e) => set("appraisalProvider", e.target.value)}
                  />
                </AltField>
                <AltField label="Lieu de conservation" hint="Coffre, domicile, cave…">
                  <input
                    className="input"
                    value={form.storageLocation}
                    onChange={(e) => set("storageLocation", e.target.value)}
                  />
                </AltField>

                {/* Assurance et garde côte à côte : ce sont les deux moitiés
                    du même coût annuel, et les séparer inviterait à n'en
                    renseigner qu'une. */}
                <fieldset className="sm:col-span-2 rounded-md border border-[var(--border)] p-3">
                  <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Assurance
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <AltField
                      label="Capital assuré"
                      hint="Ce que verse l'assureur en cas de sinistre."
                    >
                      <input
                        className="input"
                        inputMode="decimal"
                        value={form.insuranceValue}
                        onChange={(e) => set("insuranceValue", e.target.value)}
                        data-testid="tangible-insurance-value"
                      />
                    </AltField>
                    <AltField
                      label="Prime annuelle"
                      hint="Ce que vous payez chaque année — à ne pas confondre avec le capital."
                    >
                      <input
                        className="input"
                        inputMode="decimal"
                        value={form.insurancePremiumAnnual}
                        onChange={(e) =>
                          set("insurancePremiumAnnual", e.target.value)
                        }
                        data-testid="tangible-insurance-premium"
                      />
                    </AltField>
                    <AltField label="Assureur">
                      <input
                        className="input"
                        value={form.insuranceProvider}
                        onChange={(e) => set("insuranceProvider", e.target.value)}
                      />
                    </AltField>
                    <AltField label="N° de police">
                      <input
                        className="input"
                        value={form.insurancePolicyRef}
                        onChange={(e) => set("insurancePolicyRef", e.target.value)}
                      />
                    </AltField>
                    <AltField
                      label="Type de contrat"
                      hint="Une multirisque habitation plafonne les objets de valeur."
                    >
                      <select
                        className="input"
                        value={form.insuranceType}
                        onChange={(e) => set("insuranceType", e.target.value)}
                        data-testid="tangible-insurance-type"
                      >
                        <option value="">—</option>
                        {INSURANCE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {INSURANCE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField
                      label="Échéance de la police"
                      hint="Rappel automatique 30 jours avant."
                    >
                      <input
                        type="date"
                        className="input"
                        value={form.insuranceExpiryDate}
                        onChange={(e) => set("insuranceExpiryDate", e.target.value)}
                        data-testid="tangible-insurance-expiry"
                      />
                    </AltField>

                    {coverage !== null && (
                      <div
                        className="sm:col-span-3"
                        data-testid="tangible-coverage-bar"
                      >
                        <div className="flex items-baseline justify-between text-[11px]">
                          <span className="text-slate-500">
                            Couverture — {COVERAGE_LABEL[coverageStatus]}
                          </span>
                          <span className="font-medium tabular-nums">
                            {(coverage * 100).toLocaleString("fr-FR", {
                              maximumFractionDigits: 0,
                            })}{" "}
                            %
                          </span>
                        </div>
                        {/* Barre bornée à 100 % pour ne pas déborder, mais le
                            pourcentage réel reste lisible au-dessus. */}
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              coverageStatus === "OK"
                                ? "bg-emerald-500"
                                : coverageStatus === "OVER"
                                  ? "bg-sky-500"
                                  : "bg-[var(--danger)]"
                            )}
                            style={{ width: `${Math.min(100, coverage * 100)}%` }}
                          />
                        </div>
                        {num(form.appraisalValue) > 0 &&
                          num(form.appraisalValue) !== num(form.insuranceValue) && (
                            <button
                              type="button"
                              className="mt-1 text-[11px] font-medium text-[var(--primary)]"
                              onClick={() =>
                                set("insuranceValue", form.appraisalValue)
                              }
                              data-testid="tangible-align-insurance"
                            >
                              Aligner sur l’expertise (
                              {formatCurrency(form.appraisalValue, form.currency)})
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                </fieldset>

                <fieldset className="sm:col-span-2 rounded-md border border-[var(--border)] p-3">
                  <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Garde
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <AltField
                      label="Mode de garde"
                      hint="Un objet de valeur gardé au domicile sans assurance est signalé."
                    >
                      <select
                        className="input"
                        value={form.storageType}
                        onChange={(e) => set("storageType", e.target.value)}
                        data-testid="tangible-storage-type"
                      >
                        <option value="">—</option>
                        {STORAGE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {STORAGE_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </AltField>
                    <AltField label="Coût annuel de garde">
                      <input
                        className="input"
                        inputMode="decimal"
                        value={form.storageCostAnnual}
                        onChange={(e) => set("storageCostAnnual", e.target.value)}
                        data-testid="tangible-storage-cost"
                      />
                    </AltField>
                    <AltField label="Prestataire" hint="Banque, caviste, dépositaire…">
                      <input
                        className="input"
                        value={form.storageProvider}
                        onChange={(e) => set("storageProvider", e.target.value)}
                      />
                    </AltField>
                    <AltField label="Référence du contrat">
                      <input
                        className="input"
                        value={form.storageContractRef}
                        onChange={(e) => set("storageContractRef", e.target.value)}
                      />
                    </AltField>
                    <AltField
                      label="Échéance du contrat"
                      hint="Rappel automatique 60 jours avant."
                    >
                      <input
                        type="date"
                        className="input"
                        value={form.storageRenewalDate}
                        onChange={(e) => set("storageRenewalDate", e.target.value)}
                        data-testid="tangible-storage-renewal"
                      />
                    </AltField>
                    {annualOwnershipCost > 0 && (
                      <div className="self-end rounded-md bg-[var(--muted)]/40 px-2.5 py-2 text-[11px]">
                        <div className="text-slate-500">Coût de possession</div>
                        <div
                          className="text-sm font-semibold tabular-nums"
                          data-testid="tangible-ownership-cost"
                        >
                          {formatCurrency(
                            String(annualOwnershipCost),
                            form.currency
                          )}{" "}
                          / an
                        </div>
                      </div>
                    )}
                  </div>
                </fieldset>
              </div>
            )}

            {wizStep === 4 && (
              <div className="space-y-3">
                <AltField label="Notes">
                  <input
                    className="input"
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    placeholder="Provenance, état, dimensions…"
                  />
                </AltField>

                <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
                  {(
                    [
                      [
                        "Catégorie",
                        TANGIBLE_CATEGORY_LABELS[form.category as TangibleCategory] ??
                          form.category,
                      ],
                      ["Objet", `${form.brandOrArtist || "—"} ${form.modelName}`],
                      [
                        "Acheté le",
                        form.purchaseDate
                          ? new Date(form.purchaseDate).toLocaleDateString("fr-FR")
                          : "non renseigné",
                      ],
                      [
                        "Achat",
                        form.purchasePrice
                          ? formatCurrency(form.purchasePrice, form.currency)
                          : "—",
                      ],
                      [
                        "Estimation",
                        form.estimatedValue
                          ? formatCurrency(form.estimatedValue, form.currency)
                          : "—",
                      ],
                      [
                        "Plus-value",
                        formatCurrency(String(pnlPreview), form.currency),
                      ],
                    ] as const
                  ).map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-2.5 py-2"
                    >
                      <dt className="text-[10px] uppercase text-[var(--muted-foreground)]">
                        {k}
                      </dt>
                      <dd className="font-medium tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="rounded-md border border-[var(--border)] px-3 py-2.5">
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.includeInEstate}
                      onChange={(e) => set("includeInEstate", e.target.checked)}
                      data-testid="tangible-include-in-estate"
                    />
                    <span>
                      <strong>Inclure dans la transmission</strong> — décochez si
                      le bien a déjà été donné ou démembré. Aucun droit de
                      succession n&apos;est calculé ici : abattements et barèmes
                      relèvent d&apos;un module dédié.
                    </span>
                  </label>
                  {!form.includeInEstate && (
                    <input
                      className="input mt-2"
                      placeholder="Consigne notaire, donation déjà faite…"
                      value={form.estateNote}
                      onChange={(e) => set("estateNote", e.target.value)}
                      data-testid="tangible-estate-note"
                    />
                  )}
                </div>

                {annualOwnershipCost > 0 && carryPreview !== null && (
                  <div
                    className="rounded-md border border-[var(--border)] px-3 py-2.5"
                    data-testid="tangible-carry-preview"
                  >
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Plus-value nette des frais de détention
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                      <span
                        className={cn(
                          "text-lg font-semibold tabular-nums",
                          getChangeColor(String(carryPreview.net))
                        )}
                      >
                        {formatCurrency(String(carryPreview.net), form.currency)}
                      </span>
                      <span className="text-xs text-slate-500">
                        contre {formatCurrency(String(pnlPreview), form.currency)}{" "}
                        brut — {formatCurrency(String(carryPreview.total), form.currency)}{" "}
                        de garde et d&apos;assurance sur {carryPreview.years} an(s)
                      </span>
                    </div>
                    {/* Le rappel importe : ces frais ne réduisent pas l'assiette
                        imposable de l'article 150 VI. */}
                    <p className="mt-1 text-[11px] text-slate-400">
                      Indicatif : les frais de garde et les primes ne sont pas
                      déductibles de la plus-value imposable.
                    </p>
                  </div>
                )}

                <AltField
                  label="Prix de cession simulé"
                  hint={
                    simulatedPrice.trim() === ""
                      ? "Vide : la valeur estimée est utilisée."
                      : "Hypothèse — la valeur estimée enregistrée reste inchangée."
                  }
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder={form.estimatedValue || "0"}
                    value={simulatedPrice}
                    onChange={(e) => setSimulatedPrice(e.target.value)}
                    data-testid="tangible-simulated-price"
                  />
                </AltField>

                {simulation ? (
                  <div
                    className="rounded-md border border-[var(--border)] px-3 py-2.5"
                    data-testid="tangible-tax-sim"
                  >
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Si vous revendiez à ce prix aujourd’hui
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-lg font-semibold tabular-nums">
                        {formatCurrency(
                          simulation.recommended === "FORFAIT"
                            ? simulation.flat.taxEur
                            : simulation.capitalGain.taxEur,
                          form.currency
                        )}
                      </span>
                      <span className="text-xs text-slate-500">
                        {simulation.exempt
                          ? "aucun impôt dû"
                          : simulation.recommended === "FORFAIT"
                            ? "taxe forfaitaire · 2091-SD"
                            : "régime des plus-values · 2092-SD"}
                      </span>
                      {simulation.holdingYears > 0 && (
                        <span className="text-xs text-slate-400">
                          {simulation.holdingYears} an(s) de détention
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div
                        className={cn(
                          "rounded border px-2.5 py-2",
                          simulation.recommended === "FORFAIT"
                            ? "border-emerald-400/70 bg-emerald-50/40 dark:bg-emerald-950/20"
                            : "border-[var(--border)]"
                        )}
                        data-testid="tangible-card-forfait"
                      >
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          Taxe forfaitaire 6,5 %
                        </div>
                        <div className="text-sm font-semibold tabular-nums">
                          {formatCurrency(simulation.flat.taxEur, form.currency)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          sur le prix de vente · {simulation.flat.form}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "rounded border px-2.5 py-2",
                          simulation.recommended === "PLUS_VALUE"
                            ? "border-emerald-400/70 bg-emerald-50/40 dark:bg-emerald-950/20"
                            : "border-[var(--border)]",
                          !simulation.capitalGain.available && "opacity-60"
                        )}
                        data-testid="tangible-card-pv"
                      >
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          Plus-value 37,6 % abattue
                        </div>
                        <div className="text-sm font-semibold tabular-nums">
                          {formatCurrency(
                            simulation.capitalGain.taxEur,
                            form.currency
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          abattement{" "}
                          {(Number(simulation.allowanceRate) * 100).toLocaleString(
                            "fr-FR",
                            { maximumFractionDigits: 0 }
                          )}{" "}
                          % · {simulation.capitalGain.form}
                        </div>
                      </div>
                    </div>

                    {Number(simulation.savingsEur) > 0 && (
                      <p
                        className="mt-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                        data-testid="tangible-tax-savings"
                      >
                        {formatCurrency(simulation.savingsEur, form.currency)}{" "}
                        d&apos;économie sur le régime retenu.
                      </p>
                    )}

                    <p className="mt-1.5 text-[11px] text-slate-500">
                      {simulation.rationale}
                    </p>

                    {switchYear !== null &&
                      simulation.holdingYears < switchYear && (
                        <p
                          className="mt-1 text-[11px] text-slate-500"
                          data-testid="tangible-break-even"
                        >
                          Le régime des plus-values devient moins cher à partir de{" "}
                          <strong>{switchYear} ans</strong> de détention.
                        </p>
                      )}

                    {/* Jalons : les trois paliers qui structurent la durée —
                        début de l'abattement, moitié du chemin, exonération. */}
                    <ol
                      className="mt-2 flex flex-wrap gap-1.5"
                      data-testid="tangible-milestones"
                    >
                      {[HOLDING_ALLOWANCE_FREE_YEARS, 12, FULL_EXEMPTION_YEARS].map(
                        (milestone) => {
                          const reached = simulation.holdingYears >= milestone;
                          return (
                            <li
                              key={milestone}
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] ring-1",
                                reached
                                  ? "text-emerald-700 ring-emerald-400/50 dark:text-emerald-400"
                                  : "text-slate-400 ring-[var(--border)]"
                              )}
                            >
                              {milestone} ans ·{" "}
                              {milestone === HOLDING_ALLOWANCE_FREE_YEARS
                                ? "début de l’abattement"
                                : milestone === FULL_EXEMPTION_YEARS
                                  ? "exonération totale"
                                  : "50 % d’abattement"}
                            </li>
                          );
                        }
                      )}
                    </ol>

                    <p className="mt-2 text-[10px] italic text-slate-400">
                      Simulation indicative, non opposable à l&apos;administration
                      fiscale.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Renseignez une valeur estimée pour voir ce que coûterait une
                    revente.
                  </p>
                )}
              </div>
            )}
          </FormWizard>
        </div>
      }
    >
      {/* Les objets sans date d'achat perdent l'abattement pour durée de
          détention. L'alerte vaut des années avant la vente. */}
      {summary && summary.undatedCount > 0 && (
        <div
          className="mb-3 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="tangibles-undated-warning"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong>{summary.undatedCount}</strong> objet(s) sans date d’achat :
            à la revente, l’abattement pour durée de détention leur sera refusé
            et l’option pour le régime des plus-values fermée.
          </span>
        </div>
      )}

      {summary &&
        summary.underInsuredCount +
          summary.uninsuredHighValueCount +
          summary.expiringPolicyCount >
          0 && (
          <div
            className="mb-3 flex items-start gap-2 rounded-md border border-red-300/60 bg-red-50/50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/25 dark:text-red-200"
            data-testid="tangibles-insurance-warning"
          >
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {summary.uninsuredHighValueCount > 0 && (
                <>
                  <strong>{summary.uninsuredHighValueCount}</strong> objet(s) de
                  plus de 5 000 € sans assurance.{" "}
                </>
              )}
              {summary.underInsuredCount > 0 && (
                <>
                  <strong>{summary.underInsuredCount}</strong> couvert(s) à moins
                  de 80 % de leur valeur.{" "}
                </>
              )}
              {summary.expiringPolicyCount > 0 && (
                <>
                  <strong>{summary.expiringPolicyCount}</strong> police(s) échue(s)
                  ou expirant sous 30 jours.
                </>
              )}
            </span>
          </div>
        )}

      {summary && summary.ownershipAlertCount > 0 && (
        <div
          className="mb-3 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          data-testid="tangibles-ownership-warning"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong>{summary.ownershipAlertCount}</strong> alerte(s) de
            possession — échéance de contrat, garde coûteuse ou objet de valeur
            non assuré. Le détail est sous chaque ligne dépliée.
          </span>
        </div>
      )}

      {!q.isLoading && !hasLines && !showForm ? (
        <AltEmptyState
          title="Aucun actif de collection"
          description="Inventoriez montres, bijoux, pierres, œuvres, vins ou véhicules — avec ce qui fait leur valeur et ce que coûterait leur revente."
          bullets={[
            "Champs adaptés à la catégorie : carat et pureté, référence et papiers, appellation et format",
            "Date d’achat et certificat → abattement et option fiscale",
            "Fiscalité de cession calculée par objet, exonérations comprises",
          ]}
          primaryLabel="Nouvel actif"
          onPrimary={startCreate}
          primaryTestId="tangible-empty-add"
        />
      ) : (
        <div className="table-container-responsive table-fluid-wrap">
          <table className="table-fluid text-sm" data-testid="tangibles-table">
            <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Catégorie</th>
                <th className="px-3 py-2.5 text-left">Désignation</th>
                <th className="px-3 py-2.5 text-right">Achat</th>
                <th className="px-3 py-2.5 text-right">Estimation</th>
                <th className="px-3 py-2.5 text-right">+/-</th>
                <th className="px-3 py-2.5 text-right">Détention</th>
                <th className="px-3 py-2.5 text-center">Certif.</th>
                <th className="px-3 py-2.5 text-left">Régime conseillé</th>
                <th className="px-3 py-2.5 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                    Chargement…
                  </td>
                </tr>
              )}
              {lines.map((l) => (
                <TangibleRow
                  key={l.id}
                  line={l}
                  expanded={expandedId === l.id}
                  onToggle={() =>
                    setExpandedId((current) => (current === l.id ? null : l.id))
                  }
                  onEdit={() => {
                    setEditingId(l.id);
                    setForm(toForm(l));
                    setWizStep(0);
                    setShowForm(true);
                  }}
                  onDelete={() => setPendingDelete(l)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Supprimer cet objet ?"
        message={
          pendingDelete
            ? `« ${pendingDelete.brandOrArtist} ${pendingDelete.modelName} » sera retiré de l'inventaire. Son historique fiscal et ses frais de détention seront perdus.`
            : ""
        }
        onConfirm={() => {
          if (pendingDelete) delMut.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        testId="tangible-delete-confirm"
      />
    </AltModuleShell>
  );
}

/**
 * Une ligne du tableau, dépliable.
 *
 * La vue repliée ne montre que ce qui se compare d'une catégorie à l'autre ;
 * les caractéristiques propres — carat, référence, appellation — n'ont de sens
 * que déployées, et encombreraient dix colonnes vides sinon.
 */
function TangibleRow({
  line,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  line: TangibleAssetDto;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const details = detailRows(line);

  return (
    <>
      <tr
        data-testid="tangible-row"
        className="cursor-pointer border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <td className="px-3 py-2 text-xs">
          <span className="mr-1" aria-hidden>
            {TANGIBLE_CATEGORY_ICONS[line.category]}
          </span>
          {TANGIBLE_CATEGORY_LABELS[line.category]}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5 font-medium">
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
                expanded && "rotate-180"
              )}
              aria-hidden
            />
            {line.brandOrArtist} {line.modelName}
          </div>
          {line.yearOrVintage && (
            <div className="pl-5 text-[10px] text-slate-400">{line.yearOrVintage}</div>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {formatCurrency(line.purchasePrice, line.currency)}
        </td>
        <td className="px-3 py-2 text-right font-medium tabular-nums">
          {formatCurrency(line.estimatedValue, line.currency)}
        </td>
        <td
          className={cn(
            "px-3 py-2 text-right font-medium tabular-nums",
            getChangeColor(line.unrealizedPnl)
          )}
        >
          {formatCurrency(line.unrealizedPnl, line.currency)}
          <div className="text-[10px] font-normal">
            {Number(line.unrealizedPnlPct).toLocaleString("fr-FR", {
              maximumFractionDigits: 1,
            })}{" "}
            %
          </div>
        </td>
        <td className="px-3 py-2 text-right text-xs tabular-nums">
          {line.tax.holdingYears !== null ? (
            `${line.tax.holdingYears} an(s)`
          ) : (
            <span className="text-amber-600">non datée</span>
          )}
        </td>
        <td className="px-3 py-2 text-center text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            {line.hasCertificate ? "Oui" : "—"}
            {Number(line.ownership.annualCostEur) > 0 && (
              <Vault
                className="h-3 w-3 text-slate-400"
                aria-label={`Coût de possession : ${line.ownership.annualCostEur} € par an`}
              />
            )}
            <InsuranceBadge line={line} />
            {line.ownership.alerts.length > 0 && (
              <AlertTriangle
                className="h-3 w-3 text-amber-500"
                aria-label="Alerte de possession"
              />
            )}
          </span>
        </td>
        <td className="px-3 py-2">
          <TaxBadge line={line} />
        </td>
        <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex gap-0.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
              onClick={onEdit}
              aria-label="Modifier"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600"
              onClick={onDelete}
              aria-label="Supprimer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr data-testid="tangible-row-details" className="bg-[var(--muted)]/20">
          <td colSpan={9} className="px-4 py-3">
            {details.length > 0 ? (
              <dl className="grid gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-4">
                {details.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] uppercase text-slate-500">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-slate-500">
                Aucun détail spécifique renseigné pour cet objet.
              </p>
            )}
            {line.ownership.alerts.length > 0 && (
              <ul
                className="mt-2 space-y-0.5"
                data-testid="tangible-ownership-alerts"
              >
                {line.ownership.alerts.map((a) => (
                  <li
                    key={a.code}
                    className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {a.message}
                  </li>
                ))}
              </ul>
            )}

            {line.ownership.netPnlEur !== null &&
              Number(line.ownership.annualCostEur) > 0 && (
                <p
                  className="mt-2 text-[11px] text-slate-500"
                  data-testid="tangible-net-carry"
                >
                  Après {formatCurrency(line.ownership.totalCarryCostEur ?? "0", line.currency)}{" "}
                  de frais de détention, la plus-value réelle est de{" "}
                  <strong className={cn(getChangeColor(line.ownership.netPnlEur))}>
                    {formatCurrency(line.ownership.netPnlEur, line.currency)}
                  </strong>
                  {line.ownership.carryDragPct !== null && (
                    <>
                      {" "}— soit{" "}
                      {Number(line.ownership.carryDragPct).toLocaleString("fr-FR", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      % du gain brut absorbés. Ce montant reste sans effet sur
                      l&apos;impôt : ces frais ne sont pas déductibles.
                    </>
                  )}
                </p>
              )}

            <p className="mt-2 text-[11px] text-slate-500">{line.tax.rationale}</p>
            {line.notes && (
              <p className="mt-1 text-[11px] text-slate-400">{line.notes}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Pastille de couverture.
 *
 * Trois couleurs seulement : ce qui va, ce qui coûterait cher en cas de
 * sinistre, et ce qui coûte cher tout de suite. Le détail chiffré est dans
 * l'infobulle et dans la ligne dépliée.
 */
function InsuranceBadge({ line }: { line: TangibleAssetDto }) {
  const status = line.ownership.insuranceStatus as InsuranceStatus;
  if (status === "NONE") return null;

  const tone =
    status === "OK"
      ? "bg-emerald-500"
      : status === "OVER"
        ? "bg-sky-500"
        : status === "EXPIRING"
          ? "bg-amber-500"
          : "bg-[var(--danger)]";

  const ratio = line.ownership.coverageRatio;
  return (
    <span
      data-testid="tangible-insurance-badge"
      data-status={status}
      className={cn("inline-block h-2 w-2 rounded-full", tone)}
      title={`${INSURANCE_STATUS_LABELS[status]}${
        ratio !== null
          ? ` — ${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} % de la valeur`
          : ""
      }${
        line.insuranceExpiryDate
          ? ` · échéance ${new Date(line.insuranceExpiryDate).toLocaleDateString("fr-FR")}`
          : ""
      }`}
    />
  );
}

function TaxBadge({ line }: { line: TangibleAssetDto }) {
  if (line.tax.exempt) {
    return (
      <span
        data-testid="tangible-tax-badge"
        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-400/50 dark:text-emerald-400"
      >
        Exonéré
      </span>
    );
  }
  if (!line.purchaseDate) {
    // Sans date d'achat, désigner un régime serait deviner : la durée de
    // détention manque, donc l'abattement aussi.
    return <span className="text-[11px] text-slate-400">—</span>;
  }
  return (
    <span
      data-testid="tangible-tax-badge"
      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-[var(--border)] dark:text-slate-300"
      title={line.tax.rationale}
    >
      {line.tax.recommendedRegime === "FORFAIT" ? "Forfait 6,5 %" : "Plus-value"}
      {line.tax.breakEvenYear !== null &&
        line.tax.holdingYears !== null &&
        line.tax.holdingYears < line.tax.breakEvenYear && (
          <span className="ml-1 font-normal text-slate-400">
            → PV à {line.tax.breakEvenYear} ans
          </span>
        )}
    </span>
  );
}

/** Champs spécifiques réellement renseignés, dans l'ordre de lecture. */
function detailRows(line: TangibleAssetDto): [string, string][] {
  const rows: [string, string][] = [];
  const push = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      rows.push([label, String(value)]);
    }
  };

  push("Type de bijou", line.jewelryType ? JEWELRY_TYPE_LABELS[
    line.jewelryType as keyof typeof JEWELRY_TYPE_LABELS
  ] : null);
  push("Métal", line.metalBase ? METAL_BASE_LABELS[
    line.metalBase as keyof typeof METAL_BASE_LABELS
  ] : null);
  push("Poids métal", line.metalWeightG ? `${line.metalWeightG} g` : null);
  push("Poinçons", line.hasPunchmarks === null ? null : line.hasPunchmarks ? "Oui" : "Non");

  push("Pierre", line.gemType ? GEM_TYPE_LABELS[
    line.gemType as keyof typeof GEM_TYPE_LABELS
  ] : null);
  push("Carats", line.caratWeight);
  push("Pureté", line.gemClarity);
  push("Couleur", line.gemColor);
  push("Taille", line.gemCut ? GEM_CUT_LABELS[
    line.gemCut as keyof typeof GEM_CUT_LABELS
  ] : null);
  push("Traitement", line.gemTreatment ? GEM_TREATMENT_LABELS[
    line.gemTreatment as keyof typeof GEM_TREATMENT_LABELS
  ] : null);
  push("Origine", line.gemOrigin);

  push("Référence", line.watchReference);
  push("Mouvement", line.watchMovement ? WATCH_MOVEMENT_LABELS[
    line.watchMovement as keyof typeof WATCH_MOVEMENT_LABELS
  ] : null);
  push("Diamètre", line.watchDiameterMm ? `${line.watchDiameterMm} mm` : null);
  push(
    "Boîte & papiers",
    line.watchBoxPapers === null ? null : line.watchBoxPapers ? "Full set" : "Non"
  );

  push("Appellation", line.wineAppellation);
  push("Bouteilles", line.wineBottleCount);
  push("Format", line.wineBottleFormat ? WINE_BOTTLE_FORMAT_LABELS[
    line.wineBottleFormat as keyof typeof WINE_BOTTLE_FORMAT_LABELS
  ] : null);
  push("Type de cave", line.wineStorageType ? WINE_STORAGE_TYPE_LABELS[
    line.wineStorageType as keyof typeof WINE_STORAGE_TYPE_LABELS
  ] : null);

  push("Kilométrage", line.autoMileageKm ? `${line.autoMileageKm} km` : null);
  push("Immatriculation", line.autoRegistration);
  push("Propriétaires", line.autoPreviousOwners);
  push(
    "Contrôle technique",
    line.autoInspectionOk === null ? null : line.autoInspectionOk ? "À jour" : "À faire"
  );

  push("Acheté le", line.purchaseDate
    ? new Date(line.purchaseDate).toLocaleDateString("fr-FR")
    : null);
  push("Source", line.purchaseSource);
  push(
    "Frais d'acquisition",
    line.acquisitionFees
      ? formatCurrency(line.acquisitionFees, line.currency)
      : null
  );
  push(
    "Prix de revient",
    Number(line.tax.costBasisEur) > 0
      ? formatCurrency(line.tax.costBasisEur, line.currency)
      : null
  );
  push(
    "Justificatif d'achat",
    line.hasPurchaseProof ? "Conservé" : "Absent — option fiscale fermée"
  );
  push("Certificat", line.certificateIssuer
    ? `${line.certificateIssuer}${line.certificateRef ? ` — ${line.certificateRef}` : ""}`
    : line.certificateRef);
  push("Expertise", line.appraisalValue
    ? formatCurrency(line.appraisalValue, line.currency)
    : null);
  push("Valeur assurée", line.insuranceValue
    ? formatCurrency(line.insuranceValue, line.currency)
    : null);
  push("Conservation", line.storageLocation);
  push(
    "Mode de garde",
    line.storageType
      ? STORAGE_TYPE_LABELS[line.storageType as StorageType]
      : null
  );
  push(
    "Coût de garde",
    line.storageCostAnnual
      ? `${formatCurrency(line.storageCostAnnual, line.currency)} / an`
      : null
  );
  push("Dépositaire", line.storageProvider);
  push("Contrat de garde", line.storageContractRef);
  push(
    "Échéance de garde",
    line.storageRenewalDate
      ? new Date(line.storageRenewalDate).toLocaleDateString("fr-FR")
      : null
  );
  push(
    "Prime d'assurance",
    line.insurancePremiumAnnual
      ? `${formatCurrency(line.insurancePremiumAnnual, line.currency)} / an`
      : null
  );
  push("Assureur", line.insuranceProvider);
  push("N° de police", line.insurancePolicyRef);
  push(
    "Type de contrat",
    line.insuranceType
      ? INSURANCE_TYPE_LABELS[line.insuranceType as keyof typeof INSURANCE_TYPE_LABELS]
      : null
  );
  push(
    "Échéance de police",
    line.insuranceExpiryDate
      ? new Date(line.insuranceExpiryDate).toLocaleDateString("fr-FR")
      : null
  );
  push(
    "Couverture",
    line.ownership.coverageRatio !== null
      ? `${(line.ownership.coverageRatio * 100).toLocaleString("fr-FR", {
          maximumFractionDigits: 0,
        })} % — ${INSURANCE_STATUS_LABELS[line.ownership.insuranceStatus as InsuranceStatus]}`
      : null
  );
  push("Expert", line.appraisalProvider);
  push(
    "Coût de possession",
    Number(line.ownership.annualCostEur) > 0
      ? `${formatCurrency(line.ownership.annualCostEur, line.currency)} / an`
      : null
  );
  push(
    "Transmission",
    line.includeInEstate ? null : `Hors succession${line.estateNote ? ` — ${line.estateNote}` : ""}`
  );
  push(
    "Objet de collection",
    COLLECTIBLE_TOGGLE_CATEGORIES.includes(line.category)
      ? line.isCollectible
        ? "Oui — imposable"
        : `Non — exonéré (art. 150 UA II 1°)`
      : null
  );
  push(
    "Seuil d'exonération",
    Number(line.estimatedValue) <= Number(SMALL_SALE_EXEMPTION_EUR) &&
      line.tax.exemptionReason === "SMALL_SALE"
      ? "Sous 5 000 € — cession non imposable"
      : null
  );

  return rows;
}
