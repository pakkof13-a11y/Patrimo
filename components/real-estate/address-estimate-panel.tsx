"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import { PROPERTY_TYPES } from "@/app/lib/real-estate/constants";

type Comparable = {
  mutationId: string;
  soldOn: string;
  valueEur: string;
  builtAreaM2: number;
  rooms: number;
  pricePerM2: string;
  communeName: string;
  distanceM: number;
};

type Distribution = {
  median: string;
  q1: string;
  q3: string;
  iqr: string;
  min: string;
  max: string;
  count: number;
};

type EstimateSource =
  | "DVF_LOCAL"
  | "DVF_ELARGI"
  | "ADEME_COMMUNE_DPE"
  | "INDISPONIBLE";

type AdemeReference = {
  estimateEur: string;
  medianPricePerM2: string;
  sampleSize: number;
  scope: "COMMUNE_DPE" | "COMMUNE";
};

type EstimateResponse = {
  geocode: {
    latitude: number;
    longitude: number;
    label: string;
    postalCode: string | null;
    city: string | null;
    score: number;
  };
  lowConfidenceAddress: boolean;
  /** true si le département n'est de toute façon pas couvert par DVF. */
  departmentUncovered: boolean;
  estimate: {
    estimateEur: string | null;
    distribution: Distribution | null;
    comparableCount: number;
    radiusUsedM: number;
    monthsUsed: number;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    insufficientData: boolean;
    samples: Comparable[];
    source: EstimateSource;
    ademeReference: AdemeReference | null;
  };
};

const CONFIDENCE = {
  HIGH: { label: "élevée", tone: "text-teal-700 dark:text-teal-300" },
  MEDIUM: { label: "moyenne", tone: "text-amber-700 dark:text-amber-300" },
  LOW: { label: "faible", tone: "text-red-700 dark:text-red-400" },
} as const;

const SOURCE_LABELS: Record<EstimateSource, string> = {
  DVF_LOCAL: "DVF local",
  DVF_ELARGI: "DVF élargi",
  ADEME_COMMUNE_DPE: "ADEME (repli commune)",
  INDISPONIBLE: "Indisponible",
};

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * Estimation d'un bien à partir de son adresse, sur les ventes DVF réelles.
 *
 * Fonctionne sur une adresse **quelconque**, sans que le bien soit enregistré :
 * c'est l'outil qu'on veut avant d'acheter, pas seulement pour réévaluer un
 * bien détenu.
 *
 * Parti pris d'affichage : les ventes comparables sont montrées telles
 * quelles, avec leur date, leur surface et leur distance. Une estimation au
 * m² sans les ventes qui la fondent n'est pas vérifiable — et un chiffre
 * unique donne une fausse impression de précision là où le marché local est
 * dispersé, d'où la médiane encadrée par les quartiles.
 */
export function AddressEstimatePanel({ className }: { className?: string }) {
  const [addressLine, setAddressLine] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [propertyType, setPropertyType] = useState<"APPARTEMENT" | "MAISON">(
    "APPARTEMENT"
  );
  const [surfaceM2, setSurfaceM2] = useState("");
  const [rooms, setRooms] = useState("");

  const mutation = useMutation<EstimateResponse, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/real-estate/estimate/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressLine,
          postalCode: postalCode || null,
          city: city || null,
          propertyType,
          surfaceM2: Number(surfaceM2),
          rooms: rooms ? Number(rooms) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Estimation impossible");
      return json as EstimateResponse;
    },
  });

  const canSubmit = addressLine.trim().length >= 3 && Number(surfaceM2) > 0;
  const data = mutation.data;
  const est = data?.estimate;
  const dist = est?.distribution;

  return (
    <section className={cn("card p-4", className)} data-testid="re-address-estimate">
      <PanelHeader
        title="Estimer un bien"
        subtitle="Prix au m² d'après les ventes réelles enregistrées (DVF) autour de l'adresse"
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-meta block lg:col-span-3">
          Adresse
          <input
            className="input mt-1 w-full"
            placeholder="12 rue de la République"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            data-testid="re-est-address"
          />
        </label>

        <label className="text-meta block">
          Code postal
          <input
            className="input mt-1 w-full"
            placeholder="69002"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            data-testid="re-est-postal"
          />
        </label>

        <label className="text-meta block">
          Ville
          <input
            className="input mt-1 w-full"
            placeholder="Lyon"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            data-testid="re-est-city"
          />
        </label>

        <label className="text-meta block">
          Type de bien
          <select
            className="input mt-1 w-full"
            value={propertyType}
            onChange={(e) =>
              setPropertyType(e.target.value as "APPARTEMENT" | "MAISON")
            }
            data-testid="re-est-type"
          >
            <option value="APPARTEMENT">{PROPERTY_TYPES.APPARTEMENT}</option>
            <option value="MAISON">{PROPERTY_TYPES.MAISON}</option>
          </select>
        </label>

        <label className="text-meta block">
          Surface habitable (m²)
          <input
            className="input mt-1 w-full"
            inputMode="decimal"
            placeholder="65"
            value={surfaceM2}
            onChange={(e) => setSurfaceM2(e.target.value)}
            data-testid="re-est-surface"
          />
        </label>

        <label className="text-meta block">
          Pièces (optionnel)
          <input
            className="input mt-1 w-full"
            inputMode="numeric"
            placeholder="3"
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
            data-testid="re-est-rooms"
          />
        </label>

        <div className="flex items-end">
          <Button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            data-testid="re-est-submit"
          >
            {mutation.isPending ? "Estimation…" : "Estimer"}
          </Button>
        </div>
      </div>

      {mutation.isError ? (
        <p
          className="mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-[11px] text-red-800 dark:text-red-300"
          data-testid="re-est-error"
        >
          {mutation.error.message}
        </p>
      ) : null}

      {data ? (
        <div className="mt-4" data-testid="re-est-result">
          <p className="text-meta">
            Adresse retenue : <strong>{data.geocode.label}</strong>
            {data.lowConfidenceAddress ? (
              <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
                correspondance incertaine — vérifiez
              </span>
            ) : null}
          </p>

          {est?.insufficientData || !est?.estimateEur ? (
            <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-200">
              <p className="font-semibold">Estimation non concluante</p>
              <p className="mt-0.5">
                {data.departmentUncovered
                  ? "Ce département n'est pas couvert par DVF (Alsace-Moselle, Mayotte relèvent d'un autre registre foncier), "
                  : `${est?.comparableCount ?? 0} vente${(est?.comparableCount ?? 0) > 1 ? "s" : ""} comparable${(est?.comparableCount ?? 0) > 1 ? "s" : ""} trouvée${(est?.comparableCount ?? 0) > 1 ? "s" : ""} dans un rayon de ${formatDistance(est?.radiusUsedM ?? 0)}, `}
                et aucune référence ADEME (commune × DPE) disponible pour cette
                commune — trop peu pour produire un chiffre défendable. Aucune
                estimation de complaisance n&apos;est affichée.
              </p>
            </div>
          ) : (
            <>
              <p
                className="text-meta mt-2 inline-flex items-center gap-1.5"
                data-testid="re-est-source"
              >
                Source :
                <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--foreground)]">
                  {SOURCE_LABELS[est.source]}
                </span>
              </p>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/40 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    Estimation
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">
                    {formatCurrency(num(est.estimateEur))}
                  </p>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    Prix médian au m²
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {formatCurrency(
                      est.source === "ADEME_COMMUNE_DPE"
                        ? num(est.ademeReference?.medianPricePerM2)
                        : num(dist?.median)
                    )}
                  </p>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    Fourchette (Q1–Q3)
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {est.source === "ADEME_COMMUNE_DPE"
                      ? "—"
                      : `${formatCurrency(num(dist?.q1))} – ${formatCurrency(num(dist?.q3))}`}
                  </p>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    Confiance
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-sm font-semibold",
                      CONFIDENCE[est.confidence].tone
                    )}
                  >
                    {CONFIDENCE[est.confidence].label}
                  </p>
                </div>
              </div>

              <p className="text-meta mt-2">
                {est.source === "ADEME_COMMUNE_DPE" && est.ademeReference
                  ? `Fondée sur la médiane ADEME de ${est.ademeReference.sampleSize} diagnostic${est.ademeReference.sampleSize > 1 ? "s" : ""} DPE (${est.ademeReference.scope === "COMMUNE_DPE" ? "classe DPE ciblée" : "toutes classes confondues"}) — repli faute d'assez de ventes DVF.`
                  : `Fondée sur ${est.comparableCount} vente${est.comparableCount > 1 ? "s" : ""} dans un rayon de ${formatDistance(est.radiusUsedM)}, sur les ${est.monthsUsed} derniers mois.`}
              </p>

              {est.samples.length > 0 ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">Vendu le</th>
                        <th className="py-1.5 pr-2 font-medium">Commune</th>
                        <th className="py-1.5 pr-2 text-right font-medium">
                          Surface
                        </th>
                        <th className="py-1.5 pr-2 text-right font-medium">
                          Prix
                        </th>
                        <th className="py-1.5 pr-2 text-right font-medium">
                          €/m²
                        </th>
                        <th className="py-1.5 text-right font-medium">
                          Distance
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {est.samples.map((c) => (
                        <tr
                          key={c.mutationId}
                          className="border-t border-[var(--border)]"
                        >
                          <td className="py-1.5 pr-2 tabular-nums">
                            {new Date(c.soldOn).toLocaleDateString("fr-FR")}
                          </td>
                          <td className="py-1.5 pr-2">{c.communeName}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {c.builtAreaM2} m²
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {formatCurrency(num(c.valueEur))}
                          </td>
                          <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                            {formatCurrency(num(c.pricePerM2))}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-[var(--muted-foreground)]">
                            {formatDistance(c.distanceM)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-meta mt-2 leading-snug">
                    Les ventes DVF sont des transactions réelles enregistrées
                    par l&apos;administration fiscale. Elles ne disent rien de
                    l&apos;état, de l&apos;étage ni de l&apos;exposition du bien
                    vendu — d&apos;où une fourchette plutôt qu&apos;un prix.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
