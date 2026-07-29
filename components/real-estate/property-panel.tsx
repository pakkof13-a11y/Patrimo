"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
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

type PropertyRow = {
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
export function PropertyPanel({
  holdings,
  className,
}: {
  /** Positions déjà chargées — évite un second calcul de valorisation. */
  holdings: Holding[];
  className?: string;
}) {
  const qc = useQueryClient();
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

  const propsQ = useQuery({
    queryKey: ["real-estate-properties"],
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<{ properties: PropertyRow[] }>("/api/real-estate/properties"),
  });

  const properties = useMemo(
    () => propsQ.data?.properties ?? [],
    [propsQ.data?.properties]
  );

  /** Position correspondante, pour la quote-part et le coût de revient réels. */
  const byAsset = useMemo(() => {
    const map = new Map<string, Holding>();
    for (const h of holdings) map.set(h.assetId, h);
    return map;
  }, [holdings]);

  const totals = useMemo(() => {
    let value = 0;
    let debt = 0;
    let cost = 0;
    for (const p of properties) {
      const pos = byAsset.get(p.assetId);
      value += num(pos?.marketValueEur);
      cost += num(pos?.costBasisEur);
      for (const l of p.loans) debt += num(l.remainingAmountEur);
    }
    return { value, debt, cost, net: value - debt };
  }, [properties, byAsset]);

  /**
   * Une revalorisation change la valeur de la position, donc le patrimoine
   * total : rafraîchir le seul panneau laisserait le reste de l'écran afficher
   * l'ancien chiffre.
   */
  function refreshAfterValuation() {
    void propsQ.refetch();
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
      void propsQ.refetch();
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
      void propsQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mise à jour impossible");
    } finally {
      setCharSaving(false);
    }
  }

  if (propsQ.isPending) {
    return <Skeleton className={cn("h-48 w-full", className)} />;
  }

  if (properties.length === 0) {
    return (
      <div className={cn("card p-3.5 sm:p-4", className)}>
        <PanelHeader
          title="Patrimoine immobilier"
          subtitle="Valeur, dette et rendement de vos biens"
        />
        <EmptyPlaceholder
          compact
          title="Aucun bien enregistré"
          description="Ajoutez un bien depuis une plateforme « Notaire / immobilier »."
        />
      </div>
    );
  }

  return (
    <div
      className={cn("card p-3.5 sm:p-4", className)}
      data-testid="property-panel"
    >
      <PanelHeader
        title="Patrimoine immobilier"
        subtitle={`${properties.length} bien${properties.length > 1 ? "s" : ""} · valeur, dette et rendement`}
      />

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Valeur (vos parts)", value: totals.value },
          { label: "Capital restant dû", value: -totals.debt },
          { label: "Net immobilier", value: totals.net, strong: true },
          { label: "Coût de revient", value: totals.cost },
        ].map((k) => (
          <div
            key={k.label}
            className={cn(
              "rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2",
              k.strong && "bg-[var(--muted)]/40"
            )}
          >
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
              {k.label}
            </p>
            <p
              className={cn(
                "mt-0.5 tabular-nums",
                k.strong ? "text-sm font-semibold" : "text-xs font-medium"
              )}
            >
              {formatCurrency(String(k.value), "EUR")}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2.5">
        {properties.map((p) => {
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
            <div
              key={p.assetId}
              className="rounded-[var(--radius-md)] border border-[var(--border)] p-2.5"
              data-testid="property-card"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={p.name}>
                    {p.name}
                  </p>
                  <p className="text-meta">
                    {propertyTypeLabel(p.propertyType)} ·{" "}
                    {propertyUsageLabel(p.usage)}
                    {p.livingAreaM2 ? ` · ${p.livingAreaM2} m²` : ""}
                    {pos ? ` · ${formatOwnershipShare(pos.quantity)}` : ""}
                    {p.city ? ` · ${p.city}` : ""}
                  </p>
                </div>
                <p className="tabular-nums text-sm font-semibold">
                  {formatCurrency(String(shareValue - debt), "EUR")}
                  <span className="text-meta ml-1 font-normal">net</span>
                </p>
              </div>

              {p.georisquesFetched && (
                <RiskBadgeRow
                  risks={{
                    flood: p.riskFlood,
                    seismic: p.riskSeismic,
                    radon: p.riskRadon,
                    claySoil: p.riskClaySoil,
                  }}
                />
              )}

              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
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

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
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
              </div>

              {rental && (p.rentalRegime || p.taxScheme) && fiscalAssetId !== p.assetId && (
                <p className="text-meta mt-1">
                  {p.rentalRegime ? rentalRegimeLabel(p.rentalRegime) : "Régime non renseigné"}
                  {p.taxScheme && p.taxScheme !== "AUCUN"
                    ? ` · ${taxSchemeLabel(p.taxScheme)}`
                    : ""}
                </p>
              )}

              {rental && fiscalAssetId === p.assetId && fiscalForm && (
                <form
                  className="mt-2 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2.5"
                  data-testid="property-fiscal-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveFiscal(p.assetId, p.name);
                  }}
                >
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

              {charAssetId === p.assetId && charForm && (
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

              {editing?.assetId === p.assetId && (
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
                    className="input h-8 w-40 text-xs"
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

              {rental && !p.monthlyRentEur && (
                <p className="text-meta mt-1">
                  Loyer non renseigné — le rendement ne peut pas être calculé.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-meta mt-3">
        Le capital restant dû est celui que vous devez réellement : il n&apos;est
        pas réduit à votre quote-part de propriété.
      </p>
    </div>
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
