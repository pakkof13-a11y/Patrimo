"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatOwnershipShare,
  grossRentalYieldPct,
  hasCommitment,
  isDvfEstimable,
  isFurnishedUsage,
  isRentalUsage,
  netRentalYieldPct,
  regimesForUsage,
  rentalRegimeLabel,
  RENTAL_REGIMES,
  TAX_SCHEMES,
  taxSchemeLabel,
  propertyTypeLabel,
  propertyUsageLabel,
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

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "élevée",
  MEDIUM: "moyenne",
  LOW: "faible",
};

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
      const out = await fetchJson<{ kind: string; valueEur?: string; reason?: string; comparables?: number }>(
        `/api/real-estate/properties/${assetId}/valuation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "dvf", force: true, apply: true }),
        }
      );
      if (out.kind === "updated") {
        toast.success(
          `${name} réévalué à ${formatCurrency(out.valueEur ?? "0", "EUR")} · ${out.comparables} ventes comparables`
        );
        refreshAfterValuation();
        return;
      }
      if (out.kind === "insufficient-data") {
        toast.warning(
          `Pas assez de ventes comparables autour de ${name} — aucune estimation produite.`
        );
        return;
      }
      toast.info(
        out.reason === "not-geocoded"
          ? `Adresse de ${name} non localisée — complétez-la pour permettre l'estimation.`
          : out.reason === "department-uncovered"
            ? `Département non couvert par DVF (Alsace-Moselle, Mayotte).`
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
          const net = netRentalYieldPct({
            monthlyRentEur: num(p.monthlyRentEur) || null,
            monthlyChargesEur: num(p.monthlyChargesEur) || null,
            annualPropertyTaxEur: num(p.annualPropertyTaxEur) || null,
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
                <p className="text-meta">
                  {p.valuationMode === "DVF_AUTO"
                    ? "Estimation DVF automatique"
                    : "Valeur saisie — non écrasée par l'estimation"}
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
