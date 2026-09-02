"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import {
  ENERGY_RATINGS,
  GES_RATINGS,
  HEATING_TYPES,
  ORIENTATIONS,
  RISK_LEVEL_SEVERITY,
  RISK_TYPES,
  VIEW_TYPES,
  WINDOW_QUALITIES,
  formatOwnershipShare,
  grossRentalYieldPct,
  hasCommitment,
  isDvfEstimable,
  isFurnishedUsage,
  isRentalUsage,
  isSecondaryResidenceUsage,
  netRentalYieldPct,
  totalAnnualFiscalBurden,
  regimesForUsage,
  rentalRegimeLabel,
  riskLevelLabel,
  RENTAL_REGIMES,
  TAX_SCHEMES,
  taxSchemeLabel,
  propertyTypeLabel,
  propertyUsageLabel,
  type RiskLevel,
  type RiskTypeKey,
} from "@/app/lib/real-estate/constants";
import { cn, formatCurrency } from "@/app/lib/utils";
import type { Holding } from "@/app/lib/types/ui";

/**
 * Ligne renvoyée par `/api/real-estate/properties`.
 *
 * Exportée parce que l'écran la charge et la passe déjà sélectionnée : le
 * panneau reste la seule pièce à connaître la totalité des champs, mais le
 * contrat doit être partagé plutôt que redéclaré en plus lâche à côté.
 */
export type PropertyRow = {
  assetId: string;
  name: string;
  propertyType: string;
  usage: string;
  livingAreaM2: number | null;
  rooms: number | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  valuationMode: string;
  lastValuedAt: string | null;
  propertyValueEur: string | null;
  dvfEstimateEur: string | null;
  dvfConfidence: string | null;
  dvfComparables: number | null;
  /** DVF_LOCAL | DVF_ELARGI — palier ayant produit `dvfEstimateEur`. */
  dvfSource: string | null;
  monthlyRentEur: string | null;
  monthlyChargesEur: string | null;
  annualPropertyTaxEur: string | null;
  occupancyRatePct: string | null;
  rentalRegime: string | null;
  taxScheme: string | null;
  commitmentEndDate: string | null;
  isClassifiedTourism: boolean;
  schemeStartYear: number | null;
  schemeCommitmentYears: number | null;
  schemeBaseEur: string | null;
  schemeRatePct: string | null;
  // ── Physique ──
  constructionYear: number | null;
  energyRating: string | null;
  parkingSpots: number | null;
  floor: number | null;
  hasElevator: boolean | null;
  totalFloors: number | null;
  orientation: string | null;
  viewType: string | null;
  hasBalcony: boolean | null;
  balconyAreaM2: number | null;
  hasGarden: boolean | null;
  gardenAreaM2: number | null;
  hasCellar: boolean | null;
  // ── État et performance énergétique ──
  dpeKwhM2Year: number | null;
  gesRating: string | null;
  heatingType: string | null;
  windowQuality: string | null;
  // ── Copropriété ──
  isCopropriete: boolean | null;
  annualCoproChargesEur: string | null;
  annualCoproProvisions: string | null;
  // ── Fiscalité locale ──
  annualHabitationTaxEur: string | null;
  // ── Équipements complémentaires ──
  hasPool: boolean | null;
  bathroomCount: number | null;
  hasAirConditioning: boolean | null;
  hasFireplace: boolean | null;
  hasAlarm: boolean | null;
  // ── Risques (Géorisques) — lecture seule, jamais saisis ──
  riskFlood: string | null;
  riskSeismic: string | null;
  riskRadon: string | null;
  riskClaySoil: string | null;
  georisquesFetched: boolean;
  loans: Array<{ id: string; name: string; remainingAmountEur: string }>;
};

type FiscalForm = {
  rentalRegime: string;
  taxScheme: string;
  commitmentEndDate: string;
  isClassifiedTourism: boolean;
  schemeStartYear: string;
  schemeCommitmentYears: string;
  schemeBaseEur: string;
};

function fiscalFormFrom(p: PropertyRow): FiscalForm {
  return {
    rentalRegime: p.rentalRegime ?? "",
    taxScheme: p.taxScheme ?? "AUCUN",
    commitmentEndDate: p.commitmentEndDate
      ? p.commitmentEndDate.slice(0, 10)
      : "",
    isClassifiedTourism: p.isClassifiedTourism,
    schemeStartYear: p.schemeStartYear ? String(p.schemeStartYear) : "",
    schemeCommitmentYears: p.schemeCommitmentYears
      ? String(p.schemeCommitmentYears)
      : "",
    schemeBaseEur: p.schemeBaseEur ?? "",
  };
}

type CharacteristicsForm = {
  constructionYear: string;
  floor: string;
  totalFloors: string;
  hasElevator: boolean;
  orientation: string;
  viewType: string;
  hasBalcony: boolean;
  balconyAreaM2: string;
  hasGarden: boolean;
  gardenAreaM2: string;
  hasCellar: boolean;
  parkingSpots: string;
  energyRating: string;
  dpeKwhM2Year: string;
  gesRating: string;
  heatingType: string;
  windowQuality: string;
  isCopropriete: boolean;
  annualCoproChargesEur: string;
  annualCoproProvisions: string;
  annualHabitationTaxEur: string;
  hasPool: boolean;
  bathroomCount: string;
  hasAirConditioning: boolean;
  hasFireplace: boolean;
  hasAlarm: boolean;
};

function characteristicsFormFrom(p: PropertyRow): CharacteristicsForm {
  return {
    constructionYear: p.constructionYear ? String(p.constructionYear) : "",
    floor: p.floor != null ? String(p.floor) : "",
    totalFloors: p.totalFloors != null ? String(p.totalFloors) : "",
    hasElevator: p.hasElevator ?? false,
    orientation: p.orientation ?? "",
    viewType: p.viewType ?? "",
    hasBalcony: p.hasBalcony ?? false,
    balconyAreaM2: p.balconyAreaM2 != null ? String(p.balconyAreaM2) : "",
    hasGarden: p.hasGarden ?? false,
    gardenAreaM2: p.gardenAreaM2 != null ? String(p.gardenAreaM2) : "",
    hasCellar: p.hasCellar ?? false,
    parkingSpots: p.parkingSpots != null ? String(p.parkingSpots) : "",
    energyRating: p.energyRating ?? "",
    dpeKwhM2Year: p.dpeKwhM2Year != null ? String(p.dpeKwhM2Year) : "",
    gesRating: p.gesRating ?? "",
    heatingType: p.heatingType ?? "",
    windowQuality: p.windowQuality ?? "",
    isCopropriete: p.isCopropriete ?? false,
    annualCoproChargesEur: p.annualCoproChargesEur ?? "",
    annualCoproProvisions: p.annualCoproProvisions ?? "",
    annualHabitationTaxEur: p.annualHabitationTaxEur ?? "",
    hasPool: p.hasPool ?? false,
    bathroomCount: p.bathroomCount != null ? String(p.bathroomCount) : "",
    hasAirConditioning: p.hasAirConditioning ?? false,
    hasFireplace: p.hasFireplace ?? false,
    hasAlarm: p.hasAlarm ?? false,
  };
}

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "élevée",
  MEDIUM: "moyenne",
  LOW: "faible",
};

/** Palier ayant produit l'estimation — voir `EstimateSource` dans estimate.ts. */
const ESTIMATE_SOURCE_LABELS: Record<string, string> = {
  DVF_LOCAL: "DVF local",
  DVF_ELARGI: "DVF élargi",
};

/**
 * Coefficient DPE (« valeur verte » simplifiée) — même barème que
 * `DPE_PRICE_COEFFICIENTS` dans `estimate.ts`, dupliqué ici pour l'affichage
 * client sans importer un module serveur (Prisma) dans le bundle navigateur.
 */
const DPE_PRICE_COEFFICIENTS: Record<string, number> = {
  A: 1.1,
  B: 1.06,
  C: 1.02,
  D: 1.0,
  E: 0.93,
  F: 0.85,
  G: 0.78,
};

function dpePriceCoefficient(dpeClass: string | null | undefined): number {
  if (!dpeClass) return 1;
  return DPE_PRICE_COEFFICIENTS[dpeClass.trim().toUpperCase()] ?? 1;
}

function formatDpeAdjustmentPct(dpeClass: string | null | undefined): string {
  const pct = (dpePriceCoefficient(dpeClass) - 1) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`;
}

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Synthèse d'un patrimoine immobilier, bien par bien.
 *
 * Le tableau Positions montre déjà la valeur de chaque bien ; ce panneau montre
 * ce qu'il ne peut pas montrer : la dette rattachée, le net qui en découle, et
 * les rendements. Ce sont les chiffres qu'on regarde pour décider de garder ou
 * de vendre, et ils n'ont de sens que rapprochés.
 */
/** Sections de la fiche d'un bien. */
const PROPERTY_SECTIONS = [
  { id: "summary", label: "Résumé" },
  { id: "financing", label: "Financement" },
  { id: "rents", label: "Loyers" },
  { id: "valuation", label: "Valorisation" },
  { id: "fiscal", label: "Fiscalité" },
  { id: "characteristics", label: "Caractéristiques" },
] as const;

type PropertySectionId = (typeof PROPERTY_SECTIONS)[number]["id"];

export function PropertyDetailPanel({
  property,
  holdings,
  onClose,
  className,
}: {
  /** Bien sélectionné, ou `null` quand la liste n'a rien de choisi. */
  property: PropertyRow | null;
  /** Positions déjà chargées — évite un second calcul de valorisation. */
  holdings: Holding[];
  onClose: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const [section, setSection] = useState<PropertySectionId>("summary");
  /** Bien dont la valeur est en cours de saisie, et le montant tapé. */
  const [editing, setEditing] = useState<{ assetId: string; value: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [fiscalAssetId, setFiscalAssetId] = useState<string | null>(null);
  const [fiscalForm, setFiscalForm] = useState<FiscalForm | null>(null);
  const [fiscalSaving, setFiscalSaving] = useState(false);
  const [charAssetId, setCharAssetId] = useState<string | null>(null);
  const [charForm, setCharForm] = useState<CharacteristicsForm | null>(null);
  const [charSaving, setCharSaving] = useState(false);
  const [charOpenSections, setCharOpenSections] = useState<Set<string>>(
    new Set(["physique"])
  );

  /*
    Changer de bien ramène au résumé et referme les saisies en cours.

    Rester sur « Caractéristiques » parce que c'est là qu'on avait laissé le
    bien précédent n'aide personne, et un formulaire ouvert sur l'ancien bien
    afficherait ses valeurs sous le nom du nouveau. Recalage pendant le rendu,
    comme le fait le panneau d'actif.
  */
  const propertyId = property?.assetId ?? null;
  const [seenProperty, setSeenProperty] = useState(propertyId);
  if (propertyId !== seenProperty) {
    setSeenProperty(propertyId);
    setSection("summary");
    setEditing(null);
    setFiscalAssetId(null);
    setFiscalForm(null);
    setCharAssetId(null);
    setCharForm(null);
  }

  /*
    Le panneau ne charge plus la liste des biens : elle appartient à l'écran,
    qui la passe déjà sélectionnée. Les rafraîchissements passent donc par le
    cache React Query partagé, sous la même clé.
  */
  const refetchProperties = () =>
    qc.invalidateQueries({ queryKey: ["real-estate-properties"] });

  /** Position correspondante, pour la quote-part et le coût de revient réels. */
  const byAsset = useMemo(() => {
    const map = new Map<string, Holding>();
    for (const h of holdings) map.set(h.assetId, h);
    return map;
  }, [holdings]);


  /**
   * Une revalorisation change la valeur de la position, donc le patrimoine
   * total : rafraîchir le seul panneau laisserait le reste de l'écran afficher
   * l'ancien chiffre.
   */
  function refreshAfterValuation() {
    void refetchProperties();
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
  }

  /** Valeur du bien entier saisie à la main — bascule le bien en mode manuel. */
  async function saveManual(assetId: string, name: string, raw: string) {
    const value = raw.trim().replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
      toast.error("Montant invalide");
      return;
    }
    setSaving(true);
    try {
      await fetchJson(`/api/real-estate/properties/${assetId}/valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual", valueEur: value }),
      });
      toast.success(`${name} valorisé à ${formatCurrency(value, "EUR")}`);
      setEditing(null);
      refreshAfterValuation();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Valorisation impossible");
    } finally {
      setSaving(false);
    }
  }

  async function estimate(assetId: string, name: string) {
    try {
      const out = await fetchJson<{
        kind: string;
        valueEur?: string;
        reason?: string;
        comparables?: number;
        estimateSource?: string;
        departmentUncovered?: boolean;
      }>(`/api/real-estate/properties/${assetId}/valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dvf", force: true, apply: true }),
      });
      if (out.kind === "updated") {
        const sourceLabel = out.estimateSource
          ? (ESTIMATE_SOURCE_LABELS[out.estimateSource] ?? out.estimateSource)
          : null;
        toast.success(
          `${name} réévalué à ${formatCurrency(out.valueEur ?? "0", "EUR")}` +
            (sourceLabel
              ? ` · source : ${sourceLabel}`
              : ` · ${out.comparables} ventes comparables`)
        );
        refreshAfterValuation();
        return;
      }
      if (out.kind === "insufficient-data") {
        // `departmentUncovered` précise pourquoi DVF ne pouvait de toute
        // façon rien trouver — aucun repli au-delà de DVF n'est tenté.
        toast.warning(
          out.departmentUncovered
            ? `${name} : département non couvert par DVF (Alsace-Moselle, Mayotte) — aucune estimation possible.`
            : `Pas assez de ventes comparables autour de ${name} — aucune estimation produite.`
        );
        return;
      }
      toast.info(
        out.reason === "not-geocoded"
          ? `Adresse de ${name} non localisée — complétez-la pour permettre l'estimation.`
          : `Aucune réévaluation pour ${name}.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Estimation impossible");
    }
  }

  async function saveFiscal(assetId: string, name: string) {
    if (!fiscalForm) return;
    setFiscalSaving(true);
    try {
      await fetchJson(`/api/real-estate/properties/${assetId}/fiscal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalRegime: fiscalForm.rentalRegime || null,
          taxScheme: fiscalForm.taxScheme,
          commitmentEndDate: fiscalForm.commitmentEndDate || null,
          isClassifiedTourism: fiscalForm.isClassifiedTourism,
          schemeStartYear: fiscalForm.schemeStartYear
            ? Number(fiscalForm.schemeStartYear)
            : null,
          schemeCommitmentYears: fiscalForm.schemeCommitmentYears
            ? Number(fiscalForm.schemeCommitmentYears)
            : null,
          schemeBaseEur: fiscalForm.schemeBaseEur || null,
        }),
      });
      toast.success(`Régime fiscal de ${name} mis à jour`);
      setFiscalAssetId(null);
      setFiscalForm(null);
      void refetchProperties();
      void qc.invalidateQueries({ queryKey: ["real-estate-tax"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mise à jour impossible");
    } finally {
      setFiscalSaving(false);
    }
  }

  function toggleCharSection(id: string) {
    setCharOpenSections((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveCharacteristics(assetId: string, name: string) {
    if (!charForm) return;
    setCharSaving(true);
    try {
      await fetchJson(`/api/real-estate/properties/${assetId}/characteristics`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          constructionYear: charForm.constructionYear
            ? Number(charForm.constructionYear)
            : null,
          floor: charForm.floor ? Number(charForm.floor) : null,
          totalFloors: charForm.totalFloors ? Number(charForm.totalFloors) : null,
          hasElevator: charForm.hasElevator,
          orientation: charForm.orientation || null,
          viewType: charForm.viewType || null,
          hasBalcony: charForm.hasBalcony,
          balconyAreaM2: charForm.balconyAreaM2 ? Number(charForm.balconyAreaM2) : null,
          hasGarden: charForm.hasGarden,
          gardenAreaM2: charForm.gardenAreaM2 ? Number(charForm.gardenAreaM2) : null,
          hasCellar: charForm.hasCellar,
          parkingSpots: charForm.parkingSpots ? Number(charForm.parkingSpots) : null,
          energyRating: charForm.energyRating || null,
          dpeKwhM2Year: charForm.dpeKwhM2Year ? Number(charForm.dpeKwhM2Year) : null,
          gesRating: charForm.gesRating || null,
          heatingType: charForm.heatingType || null,
          windowQuality: charForm.windowQuality || null,
          isCopropriete: charForm.isCopropriete,
          annualCoproChargesEur: charForm.annualCoproChargesEur
            ? charForm.annualCoproChargesEur.replace(",", ".")
            : null,
          annualCoproProvisions: charForm.annualCoproProvisions
            ? charForm.annualCoproProvisions.replace(",", ".")
            : null,
          annualHabitationTaxEur: charForm.annualHabitationTaxEur
            ? charForm.annualHabitationTaxEur.replace(",", ".")
            : null,
          hasPool: charForm.hasPool,
          bathroomCount: charForm.bathroomCount ? Number(charForm.bathroomCount) : null,
          hasAirConditioning: charForm.hasAirConditioning,
          hasFireplace: charForm.hasFireplace,
          hasAlarm: charForm.hasAlarm,
        }),
      });
      toast.success(`Caractéristiques de ${name} mises à jour`);
      setCharAssetId(null);
      setCharForm(null);
      void refetchProperties();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mise à jour impossible");
    } finally {
      setCharSaving(false);
    }
  }

  /*
    Colonne de détail du bien sélectionné.

    Le panneau listait tous les biens, chacun avec ses formulaires de
    valorisation, de fiscalité et de caractéristiques dépliables : quatre biens
    ouverts et l'écran devenait un formulaire de six cents champs. Il ne montre
    plus qu'un bien — celui qu'on a choisi dans la liste — et partage la
    géométrie du panneau d'actif du Portefeuille (`.asset-panel`), comme les
    Banques et l'Assurance-vie.

    Rien n'a été retiré : valorisation manuelle, estimation DVF, régime fiscal,
    caractéristiques physiques, énergie, copropriété et risques Géorisques sont
    tous là, répartis dans les sections du panneau.
  */
  if (!property) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="property-detail-panel"
        data-open="false"
        aria-label="Détail du bien"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucun bien sélectionné
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez un bien pour afficher son détail ici. La liste reste en
            place.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="property-detail-panel"
      data-open="true"
      aria-label={`Bien — ${property.name}`}
    >
      <div className="asset-panel-bar">
        <div className="min-w-0">
          <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
            {property.name}
          </p>
          <p className="text-meta truncate">
            {propertyTypeLabel(property.propertyType)} ·{" "}
            {propertyUsageLabel(property.usage)}
            {property.city ? ` · ${property.city}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="property-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <nav
        className="workspace-tabs"
        role="tablist"
        aria-label="Sections du bien"
      >
        {PROPERTY_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className="workspace-tab"
            data-active={section === s.id ? "true" : "false"}
            data-testid={`property-tab-${s.id}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="asset-panel-body">
        {(() => {
          const p = property;
          const pos = byAsset.get(p.assetId);
          const shareValue = num(pos?.marketValueEur);
          const cost = num(pos?.costBasisEur);
          const debt = p.loans.reduce(
            (s, l) => s + num(l.remainingAmountEur),
            0
          );
          const wholeValue = num(p.propertyValueEur);
          const rental = isRentalUsage(p.usage);

          const gross = grossRentalYieldPct({
            monthlyRentEur: num(p.monthlyRentEur) || null,
            occupancyRatePct: p.occupancyRatePct
              ? num(p.occupancyRatePct)
              : null,
            propertyValueEur: wholeValue || null,
          });
          const fiscalBurden = totalAnnualFiscalBurden({
            usage: p.usage,
            annualPropertyTaxEur: num(p.annualPropertyTaxEur) || null,
            annualHabitationTaxEur: num(p.annualHabitationTaxEur) || null,
            isCopropriete: p.isCopropriete,
            annualCoproChargesEur: num(p.annualCoproChargesEur) || null,
          });
          const net = netRentalYieldPct({
            monthlyRentEur: num(p.monthlyRentEur) || null,
            monthlyChargesEur: num(p.monthlyChargesEur) || null,
            totalAnnualFiscalBurdenEur: fiscalBurden,
            occupancyRatePct: p.occupancyRatePct
              ? num(p.occupancyRatePct)
              : null,
            // Rapporté à ce que vous avez engagé sur votre part.
            costBasisEur: cost || null,
          });

          return (
            <div key={p.assetId} data-testid="property-card">
              {/*
                Chiffre de tête : la valeur de la part, et l'equity dessous.
                C'est l'ordre dans lequel on lit un bien financé — ce qu'il
                vaut, puis ce qu'il en reste une fois la dette retirée.
              */}
              <p className="num text-[length:var(--text-2xl)] font-semibold tracking-tight text-[var(--foreground)]">
                {formatCurrency(String(shareValue), "EUR")}
              </p>
              <p className="text-meta">
                Equity{" "}
                <span className="num">
                  {formatCurrency(String(shareValue - debt), "EUR")}
                </span>
                {pos ? ` · votre part ${formatOwnershipShare(pos.quantity)}` : ""}
                {p.livingAreaM2 ? ` · ${p.livingAreaM2} m²` : ""}
              </p>

              {section === "characteristics" && p.georisquesFetched && (
                <RiskBadgeRow
                  risks={{
                    flood: p.riskFlood,
                    seismic: p.riskSeismic,
                    radon: p.riskRadon,
                    claySoil: p.riskClaySoil,
                  }}
                />
              )}

              {section === "summary" && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Valeur de votre part
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {formatCurrency(String(shareValue), "EUR")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Capital restant dû
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {debt > 0 ? formatCurrency(String(-debt), "EUR") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Rendement brut
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {gross != null
                      ? `${gross.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Rendement net
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {net != null
                      ? `${net.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                      : "—"}
                  </dd>
                </div>
              </dl>
              )}

              {/* ── Financement ─────────────────────────────────────── */}
              {section === "financing" && (
                <div className="mt-3">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                    <div>
                      <dt className="text-[var(--muted-foreground)]">Valeur de votre part</dt>
                      <dd className="num font-medium">
                        {formatCurrency(String(shareValue), "EUR")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted-foreground)]">Capital restant dû</dt>
                      <dd className="num font-medium">
                        {debt > 0 ? formatCurrency(String(debt), "EUR") : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted-foreground)]">Equity</dt>
                      <dd className="num font-medium">
                        {formatCurrency(String(shareValue - debt), "EUR")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted-foreground)]">Dette / valeur</dt>
                      <dd className="num font-medium">
                        {shareValue > 0
                          ? `${((debt / shareValue) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  <h4 className="text-label mt-4">Emprunts adossés</h4>
                  {p.loans.length === 0 ? (
                    <p className="text-meta mt-1">
                      Aucun emprunt rattaché à ce bien.
                    </p>
                  ) : (
                    <ul
                      className="mt-1 divide-y divide-[var(--border)] border-y border-[var(--border)]"
                      data-testid="property-loans"
                    >
                      {p.loans.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-baseline justify-between gap-3 py-2"
                        >
                          <span className="min-w-0 truncate text-[11px] text-[var(--foreground)]">
                            {l.name}
                          </span>
                          <span className="num shrink-0 text-[11px] font-medium">
                            {formatCurrency(l.remainingAmountEur, "EUR")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-meta mt-2">
                    Le capital restant dû est celui que vous devez réellement :
                    il n&apos;est pas réduit à votre quote-part de propriété.
                  </p>
                </div>
              )}

              {/* ── Loyers & charges ────────────────────────────────── */}
              {section === "rents" && (
                <dl
                  className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]"
                  data-testid="property-rents"
                >
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Loyer mensuel</dt>
                    <dd className="num font-medium">
                      {p.monthlyRentEur
                        ? formatCurrency(p.monthlyRentEur, "EUR")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Charges mensuelles</dt>
                    <dd className="num font-medium">
                      {p.monthlyChargesEur
                        ? formatCurrency(p.monthlyChargesEur, "EUR")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Taux d&apos;occupation</dt>
                    <dd className="num font-medium">
                      {p.occupancyRatePct ? `${p.occupancyRatePct} %` : "100 %"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Taxe foncière</dt>
                    <dd className="num font-medium">
                      {p.annualPropertyTaxEur
                        ? formatCurrency(p.annualPropertyTaxEur, "EUR")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Charges annuelles totales</dt>
                    <dd className="num font-medium">
                      {formatCurrency(String(fiscalBurden), "EUR")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted-foreground)]">Rendement net</dt>
                    <dd className="num font-medium">
                      {net != null
                        ? `${net.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                        : "—"}
                    </dd>
                  </div>
                </dl>
              )}

              {/* ── Valorisation ────────────────────────────────────── */}
              {section === "valuation" && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-meta" data-testid="property-estimate-source">
                    {p.valuationMode === "DVF_AUTO"
                      ? "Estimation DVF automatique"
                      : "Valeur saisie — non écrasée par l'estimation"}
                    {p.dvfSource && ESTIMATE_SOURCE_LABELS[p.dvfSource]
                      ? ` · source : ${ESTIMATE_SOURCE_LABELS[p.dvfSource]}`
                      : ""}
                    {p.dvfComparables
                      ? ` · ${p.dvfComparables} comparables${
                          p.dvfConfidence
                            ? `, confiance ${CONFIDENCE_LABELS[p.dvfConfidence] ?? p.dvfConfidence.toLowerCase()}`
                            : ""
                        }`
                      : ""}
                    {p.lastValuedAt
                      ? ` · au ${new Date(p.lastValuedAt).toLocaleDateString("fr-FR")}`
                      : ""}
                  </p>
                  {/* Ajustement DPE : appliqué au prix DVF brut, affiché à
                      côté sans jamais être stocké silencieusement. Absent
                      sans DPE renseigné — pas d'ajustement de complaisance. */}
                  {p.dvfEstimateEur && p.energyRating ? (
                    <p className="text-meta" data-testid="property-dpe-adjustment">
                      Ajustement DPE {p.energyRating.toUpperCase()} :{" "}
                      {formatDpeAdjustmentPct(p.energyRating)} →{" "}
                      {formatCurrency(
                        String(
                          num(p.dvfEstimateEur) *
                            dpePriceCoefficient(p.energyRating)
                        ),
                        "EUR"
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px]"
                    data-testid="property-set-value"
                    onClick={() =>
                      setEditing((cur) =>
                        cur?.assetId === p.assetId
                          ? null
                          : {
                              assetId: p.assetId,
                              value: wholeValue ? String(wholeValue) : "",
                            }
                      )
                    }
                  >
                    Saisir une valeur
                  </button>
                  {isDvfEstimable(p.propertyType) && (
                    <button
                      type="button"
                      className="btn btn-ghost text-[11px]"
                      data-testid="property-estimate"
                      onClick={() => estimate(p.assetId, p.name)}
                    >
                      Estimer depuis les ventes réelles
                    </button>
                  )}
                </div>
              </div>
              )}

              {section === "fiscal" && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {rental && (
                    <button
                      type="button"
                      className="btn btn-ghost text-[11px]"
                      data-testid="property-fiscal-toggle"
                      onClick={() =>
                        setFiscalAssetId((cur) => {
                          if (cur === p.assetId) {
                            setFiscalForm(null);
                            return null;
                          }
                          setFiscalForm(fiscalFormFrom(p));
                          return p.assetId;
                        })
                      }
                    >
                      Régime &amp; dispositif fiscal
                    </button>
                  )}
                </div>
              )}

              {section === "fiscal" && rental && (p.rentalRegime || p.taxScheme) && fiscalAssetId !== p.assetId && (
                <p className="text-meta mt-1">
                  {p.rentalRegime ? rentalRegimeLabel(p.rentalRegime) : "Régime non renseigné"}
                  {p.taxScheme && p.taxScheme !== "AUCUN"
                    ? ` · ${taxSchemeLabel(p.taxScheme)}`
                    : ""}
                </p>
              )}

              {section === "fiscal" && rental && fiscalAssetId === p.assetId && fiscalForm && (
                <form
                  className="mt-2 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2.5"
                  data-testid="property-fiscal-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveFiscal(p.assetId, p.name);
                  }}
                >
                  {/*
                    Grille compacte : libellé et champ à la même taille, 11 px.

                    C'est ce que les `text-xs` de cette fiche demandaient depuis
                    toujours, sans l'obtenir — `.input` étant hors couche, ils
                    étaient écrasés et les champs sortaient à 13 px, plus gros
                    que les libellés qui les nomment. La cascade corrigée, la
                    paire tient : les valeurs y sont moins tronquées qu'à 13 px,
                    la fiche du bien étant le formulaire le plus dense d'Aurea.

                    Les saisies isolées de cette même fiche — la valeur du bien,
                    par exemple — ne suivent pas cette règle : elles n'ont pas de
                    libellé de 11 px à côté d'elles et gardent la taille du
                    champ standard.
                  */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">
                        Régime d&apos;imposition
                      </span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        data-testid="fiscal-rental-regime"
                        value={fiscalForm.rentalRegime}
                        onChange={(ev) =>
                          setFiscalForm({ ...fiscalForm, rentalRegime: ev.target.value })
                        }
                      >
                        <option value="">Non renseigné</option>
                        {regimesForUsage(p.usage).map((k) => (
                          <option key={k} value={k}>
                            {RENTAL_REGIMES[k]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">Dispositif</span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        data-testid="fiscal-tax-scheme"
                        value={fiscalForm.taxScheme}
                        onChange={(ev) =>
                          setFiscalForm({ ...fiscalForm, taxScheme: ev.target.value })
                        }
                      >
                        {Object.entries(TAX_SCHEMES).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {isFurnishedUsage(p.usage) && (
                      <label className="flex items-end gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          data-testid="fiscal-classified-tourism"
                          checked={fiscalForm.isClassifiedTourism}
                          onChange={(ev) =>
                            setFiscalForm({
                              ...fiscalForm,
                              isClassifiedTourism: ev.target.checked,
                            })
                          }
                        />
                        <span className="text-[var(--muted-foreground)]">
                          Meublé de tourisme classé
                        </span>
                      </label>
                    )}
                  </div>

                  {fiscalForm.taxScheme !== "AUCUN" && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="text-[11px]">
                        <span className="text-[var(--muted-foreground)]">
                          Année de départ
                        </span>
                        <input
                          inputMode="numeric"
                          className="input mt-0.5 h-8 w-full text-xs"
                          data-testid="fiscal-scheme-start-year"
                          value={fiscalForm.schemeStartYear}
                          onChange={(ev) =>
                            setFiscalForm({
                              ...fiscalForm,
                              schemeStartYear: ev.target.value,
                            })
                          }
                        />
                      </label>
                      {hasCommitment(fiscalForm.taxScheme) && (
                        <label className="text-[11px]">
                          <span className="text-[var(--muted-foreground)]">
                            Engagement (années)
                          </span>
                          <input
                            inputMode="numeric"
                            className="input mt-0.5 h-8 w-full text-xs"
                            data-testid="fiscal-scheme-commitment-years"
                            value={fiscalForm.schemeCommitmentYears}
                            onChange={(ev) =>
                              setFiscalForm({
                                ...fiscalForm,
                                schemeCommitmentYears: ev.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                      <label className="text-[11px]">
                        <span className="text-[var(--muted-foreground)]">
                          Base éligible (€)
                        </span>
                        <input
                          inputMode="decimal"
                          className="input mt-0.5 h-8 w-full text-xs"
                          data-testid="fiscal-scheme-base"
                          value={fiscalForm.schemeBaseEur}
                          onChange={(ev) =>
                            setFiscalForm({
                              ...fiscalForm,
                              schemeBaseEur: ev.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-[11px]">
                        <span className="text-[var(--muted-foreground)]">
                          Fin d&apos;engagement
                        </span>
                        <input
                          type="date"
                          className="input mt-0.5 h-8 w-full text-xs"
                          data-testid="fiscal-commitment-end"
                          value={fiscalForm.commitmentEndDate}
                          onChange={(ev) =>
                            setFiscalForm({
                              ...fiscalForm,
                              commitmentEndDate: ev.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="btn btn-primary text-[11px]"
                      disabled={fiscalSaving}
                      data-testid="fiscal-save"
                    >
                      {fiscalSaving ? "Enregistrement…" : "Valider"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-[11px]"
                      onClick={() => {
                        setFiscalAssetId(null);
                        setFiscalForm(null);
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </form>
              )}

              {section === "characteristics" && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px]"
                    data-testid="property-characteristics-toggle"
                    onClick={() =>
                      setCharAssetId((cur) => {
                        if (cur === p.assetId) {
                          setCharForm(null);
                          return null;
                        }
                        setCharForm(characteristicsFormFrom(p));
                        return p.assetId;
                      })
                    }
                  >
                    Caractéristiques du bien
                  </button>
                </div>
              )}

              {section === "characteristics" && charAssetId === p.assetId && charForm && (
                <form
                  className="mt-2 space-y-2"
                  data-testid="property-characteristics-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveCharacteristics(p.assetId, p.name);
                  }}
                >
                  <CharSection
                    id="physique"
                    title="Physique"
                    open={charOpenSections.has("physique")}
                    onToggle={() => toggleCharSection("physique")}
                  >
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">
                        Année de construction
                      </span>
                      <input
                        inputMode="numeric"
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.constructionYear}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, constructionYear: ev.target.value })
                        }
                      />
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">Étage</span>
                      <input
                        inputMode="numeric"
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.floor}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, floor: ev.target.value })
                        }
                      />
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">
                        Étages de l&apos;immeuble
                      </span>
                      <input
                        inputMode="numeric"
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.totalFloors}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, totalFloors: ev.target.value })
                        }
                      />
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">Orientation</span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.orientation}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, orientation: ev.target.value })
                        }
                      >
                        <option value="">Non renseignée</option>
                        {Object.entries(ORIENTATIONS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">Vue</span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.viewType}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, viewType: ev.target.value })
                        }
                      >
                        <option value="">Non renseignée</option>
                        {Object.entries(VIEW_TYPES).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">
                        Places de parking
                      </span>
                      <input
                        inputMode="numeric"
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.parkingSpots}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, parkingSpots: ev.target.value })
                        }
                      />
                    </label>
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasElevator}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, hasElevator: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Ascenseur</span>
                    </label>
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasCellar}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, hasCellar: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Cave</span>
                    </label>
                    <div />
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasBalcony}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, hasBalcony: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Balcon</span>
                    </label>
                    {charForm.hasBalcony && (
                      <label className="text-[11px] sm:col-span-2">
                        <span className="text-[var(--muted-foreground)]">
                          Surface du balcon (m²)
                        </span>
                        <input
                          inputMode="numeric"
                          className="input mt-0.5 h-8 w-full text-xs"
                          value={charForm.balconyAreaM2}
                          onChange={(ev) =>
                            setCharForm({ ...charForm, balconyAreaM2: ev.target.value })
                          }
                        />
                      </label>
                    )}
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasGarden}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, hasGarden: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Jardin</span>
                    </label>
                    {charForm.hasGarden && (
                      <label className="text-[11px] sm:col-span-2">
                        <span className="text-[var(--muted-foreground)]">
                          Surface du jardin (m²)
                        </span>
                        <input
                          inputMode="numeric"
                          className="input mt-0.5 h-8 w-full text-xs"
                          value={charForm.gardenAreaM2}
                          onChange={(ev) =>
                            setCharForm({ ...charForm, gardenAreaM2: ev.target.value })
                          }
                        />
                      </label>
                    )}
                  </CharSection>

                  <CharSection
                    id="etat"
                    title="État"
                    hint="Performance énergétique"
                    open={charOpenSections.has("etat")}
                    onToggle={() => toggleCharSection("etat")}
                  >
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">DPE</span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.energyRating}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, energyRating: ev.target.value })
                        }
                      >
                        <option value="">Non renseigné</option>
                        {ENERGY_RATINGS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">
                        Consommation (kWh/m²/an)
                      </span>
                      <input
                        inputMode="numeric"
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.dpeKwhM2Year}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, dpeKwhM2Year: ev.target.value })
                        }
                      />
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">GES</span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.gesRating}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, gesRating: ev.target.value })
                        }
                      >
                        <option value="">Non renseigné</option>
                        {GES_RATINGS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">Chauffage</span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.heatingType}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, heatingType: ev.target.value })
                        }
                      >
                        <option value="">Non renseigné</option>
                        {Object.entries(HEATING_TYPES).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">Vitrage</span>
                      <select
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.windowQuality}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, windowQuality: ev.target.value })
                        }
                      >
                        <option value="">Non renseigné</option>
                        {Object.entries(WINDOW_QUALITIES).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </CharSection>

                  <CharSection
                    id="copro"
                    title="Copropriété"
                    open={charOpenSections.has("copro")}
                    onToggle={() => toggleCharSection("copro")}
                  >
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.isCopropriete}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, isCopropriete: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">
                        Bien en copropriété
                      </span>
                    </label>
                    {charForm.isCopropriete && (
                      <>
                        <label className="text-[11px]">
                          <span className="text-[var(--muted-foreground)]">
                            Charges de copropriété annuelles (€)
                          </span>
                          <input
                            inputMode="decimal"
                            className="input mt-0.5 h-8 w-full text-xs"
                            value={charForm.annualCoproChargesEur}
                            onChange={(ev) =>
                              setCharForm({
                                ...charForm,
                                annualCoproChargesEur: ev.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="text-[11px]">
                          <span className="text-[var(--muted-foreground)]">
                            Provisions travaux annuelles (€)
                          </span>
                          <input
                            inputMode="decimal"
                            className="input mt-0.5 h-8 w-full text-xs"
                            value={charForm.annualCoproProvisions}
                            onChange={(ev) =>
                              setCharForm({
                                ...charForm,
                                annualCoproProvisions: ev.target.value,
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                  </CharSection>

                  <CharSection
                    id="equipements"
                    title="Équipements"
                    hint="Piscine, climatisation, sécurité…"
                    open={charOpenSections.has("equipements")}
                    onToggle={() => toggleCharSection("equipements")}
                  >
                    <label className="text-[11px]">
                      <span className="text-[var(--muted-foreground)]">
                        Salles de bain / d&apos;eau
                      </span>
                      <input
                        inputMode="numeric"
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.bathroomCount}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, bathroomCount: ev.target.value })
                        }
                      />
                    </label>
                    <div />
                    <div />
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasPool}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, hasPool: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Piscine</span>
                    </label>
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasAirConditioning}
                        onChange={(ev) =>
                          setCharForm({
                            ...charForm,
                            hasAirConditioning: ev.target.checked,
                          })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Climatisation</span>
                    </label>
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasFireplace}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, hasFireplace: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Cheminée</span>
                    </label>
                    <label className="flex items-end gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={charForm.hasAlarm}
                        onChange={(ev) =>
                          setCharForm({ ...charForm, hasAlarm: ev.target.checked })
                        }
                      />
                      <span className="text-[var(--muted-foreground)]">Alarme</span>
                    </label>
                  </CharSection>

                  <CharSection
                    id="fiscalite"
                    title="Fiscalité locale"
                    hint="Taxe d'habitation"
                    open={charOpenSections.has("fiscalite")}
                    onToggle={() => toggleCharSection("fiscalite")}
                  >
                    <label className="text-[11px] sm:col-span-2">
                      <span className="text-[var(--muted-foreground)]">
                        Taxe d&apos;habitation annuelle (€)
                      </span>
                      <input
                        inputMode="decimal"
                        className="input mt-0.5 h-8 w-full text-xs"
                        value={charForm.annualHabitationTaxEur}
                        onChange={(ev) =>
                          setCharForm({
                            ...charForm,
                            annualHabitationTaxEur: ev.target.value,
                          })
                        }
                      />
                    </label>
                    <p className="text-meta sm:col-span-3">
                      {isSecondaryResidenceUsage(p.usage)
                        ? "Résidence secondaire — la taxe d'habitation reste due."
                        : "Supprimée depuis 2023 pour les résidences principales — ne concerne en pratique que les résidences secondaires."}
                    </p>
                  </CharSection>

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="btn btn-primary text-[11px]"
                      disabled={charSaving}
                      data-testid="characteristics-save"
                    >
                      {charSaving ? "Enregistrement…" : "Valider"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-[11px]"
                      onClick={() => {
                        setCharAssetId(null);
                        setCharForm(null);
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </form>
              )}

              {section === "valuation" && editing?.assetId === p.assetId && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveManual(p.assetId, p.name, editing.value);
                  }}
                >
                  <input
                    autoFocus
                    inputMode="decimal"
                    className="input h-8 w-40"
                    placeholder="Valeur du bien entier"
                    aria-label={`Valeur de ${p.name}`}
                    data-testid="property-value-input"
                    value={editing.value}
                    onChange={(ev) =>
                      setEditing({ assetId: p.assetId, value: ev.target.value })
                    }
                  />
                  <button
                    type="submit"
                    className="btn btn-primary text-[11px]"
                    disabled={saving}
                    data-testid="property-value-save"
                  >
                    {saving ? "Enregistrement…" : "Valider"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px]"
                    onClick={() => setEditing(null)}
                  >
                    Annuler
                  </button>
                  <span className="text-meta">
                    Valeur du bien <strong>entier</strong>
                    {pos ? ` — votre part : ${formatOwnershipShare(pos.quantity)}` : ""}
                  </span>
                </form>
              )}

              {section === "rents" && rental && !p.monthlyRentEur && (
                <p className="text-meta mt-1">
                  Loyer non renseigné — le rendement ne peut pas être calculé.
                </p>
              )}
            </div>
          );
        })()}
      </div>
    </aside>
  );
}

/** Classes de couleur par niveau de risque — même échelle que `RISK_LEVEL_SEVERITY`. */
const RISK_BADGE_CLASSES: Record<RiskLevel, string> = {
  AUCUN:
    "text-emerald-700 ring-emerald-300 dark:text-emerald-300 dark:ring-emerald-700",
  FAIBLE:
    "text-amber-700 ring-amber-300 dark:text-amber-400 dark:ring-amber-700",
  MOYEN:
    "text-orange-700 ring-orange-300 dark:text-orange-400 dark:ring-orange-700",
  FORT: "text-red-700 ring-red-300 dark:text-red-400 dark:ring-red-700",
};

/**
 * Badges de risques Géorisques (inondation, sismique, radon, argiles).
 *
 * N'affiche que les risques effectivement renvoyés par l'API — un risque
 * absent de la réponse (nomenclature non reconnue, catégorie hors des cas
 * couverts) ne produit aucun badge plutôt qu'un badge « inconnu » qui
 * n'apporterait rien. Trié du plus au moins sévère : c'est ce qu'on veut voir
 * en premier sur une fiche bien.
 */
function RiskBadgeRow({
  risks,
}: {
  risks: Record<RiskTypeKey, string | null>;
}) {
  const entries = (Object.keys(RISK_TYPES) as RiskTypeKey[])
    .map((key) => ({ key, level: risks[key] as RiskLevel | null }))
    .filter(
      (r): r is { key: RiskTypeKey; level: RiskLevel } =>
        r.level != null && r.level in RISK_LEVEL_SEVERITY
    )
    .sort((a, b) => RISK_LEVEL_SEVERITY[b.level] - RISK_LEVEL_SEVERITY[a.level]);

  if (entries.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1" data-testid="property-risk-badges">
      {entries.map(({ key, level }) => (
        <span
          key={key}
          className={cn(
            "inline-flex rounded px-1 py-0.5 text-[9px] font-semibold uppercase ring-1 ring-inset",
            RISK_BADGE_CLASSES[level]
          )}
          title={`${RISK_TYPES[key]} — ${riskLevelLabel(level)}`}
        >
          {RISK_TYPES[key]}
        </span>
      ))}
    </div>
  );
}

/**
 * Section repliable du formulaire « Caractéristiques du bien ».
 *
 * Un accordéon par groupe (Physique / État / Copro / Fiscalité) plutôt qu'un
 * formulaire mur : la plupart des champs sont facultatifs et rarement tous
 * renseignés à la fois, autant ne montrer que ce que l'on ouvre.
 */
function CharSection({
  id,
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[11px] font-medium"
        aria-expanded={open}
        onClick={onToggle}
        data-testid={`char-section-${id}`}
      >
        <span>
          {title}
          {hint && (
            <span className="ml-1.5 font-normal text-[var(--muted-foreground)]">
              {hint}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="grid gap-2 border-t border-[var(--border)] p-2.5 sm:grid-cols-3">
          {children}
        </div>
      )}
    </div>
  );
}
