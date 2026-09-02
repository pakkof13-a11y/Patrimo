"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  INDIRECT_VEHICLES,
  TAX_TRANSPARENCY,
  DEFAULT_REAL_ESTATE_SHARE_PCT,
  type IndirectVehicle,
} from "@/app/lib/real-estate/indirect";

type VehicleRow = {
  assetId: string;
  label: string;
  vehicle: string;
  manager: string | null;
  marketValueEur: string;
  quantity: string;
  distributionRatePct: string | null;
  debtRatioPct: string | null;
  taxTransparency: string | null;
  expectedAnnualIncomeEur: string;
  ifiSharePct: string;
  ifiTaxableValueEur: string;
  ifiExcluded: boolean;
  ifiExclusionReason: string | null;
};

type PlatformRow = { id: string; name: string; type?: string | null };

/** Un ratio d'endettement au-delà de ce seuil mérite d'être signalé. */
const DEBT_RATIO_ALERT_PCT = 40;

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const emptyForm = {
  platformId: "",
  name: "",
  vehicle: "SCPI" as IndirectVehicle,
  manager: "",
  shares: "",
  sharePriceEur: "",
  currentSharePriceEur: "",
  subscriptionFeesEur: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  distributionRatePct: "",
  debtRatioPct: "",
  realEstateSharePct: "",
  ownershipStakePct: "",
  taxTransparency: "IR",
};

/**
 * Véhicules immobiliers indirects — SCPI, SCI, OPCI, foncières.
 *
 * Une part de SCPI est une position ordinaire du journal : parts × prix de
 * part. Ce panneau n'ajoute donc pas de valorisation, il expose ce que la
 * position ne dit pas — société de gestion, taux de distribution, levier du
 * véhicule, et surtout la fraction qui entre dans l'assiette IFI.
 */
export function IndirectPanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const q = useQuery({
    queryKey: ["real-estate-indirect"],
    queryFn: () =>
      fetchJson<{ vehicles: VehicleRow[] }>("/api/real-estate/indirect"),
  });

  const platformsQ = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fetchJson<{ platforms: PlatformRow[] }>("/api/platforms"),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["real-estate-indirect"] });
    void qc.invalidateQueries({ queryKey: ["real-estate-tax"] });
    // Le véhicule pèse au patrimoine : la vue Positions doit suivre.
    void qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/real-estate/indirect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          manager: form.manager || null,
          currentSharePriceEur: form.currentSharePriceEur || null,
          subscriptionFeesEur: form.subscriptionFeesEur || null,
          distributionRatePct: form.distributionRatePct || null,
          debtRatioPct: form.debtRatioPct || null,
          realEstateSharePct: form.realEstateSharePct || null,
          ownershipStakePct: form.ownershipStakePct || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Création impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("Véhicule enregistré");
      setForm(emptyForm);
      setShowForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (assetId: string) => {
      const res = await fetch(
        `/api/real-estate/indirect?assetId=${encodeURIComponent(assetId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Suppression impossible");
      }
    },
    onSuccess: () => {
      toast.success("Véhicule retiré");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data?.vehicles ?? [];
  const totalValue = rows.reduce((s, r) => s + num(r.marketValueEur), 0);
  const totalIfi = rows.reduce((s, r) => s + num(r.ifiTaxableValueEur), 0);
  const totalIncome = rows.reduce(
    (s, r) => s + num(r.expectedAnnualIncomeEur),
    0
  );

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const canSubmit =
    form.platformId && form.name.trim() && form.shares && form.sharePriceEur;

  return (
    <section className={cn("card p-4", className)} data-testid="re-indirect-panel">
      <PanelHeader
        title="Immobilier indirect"
        subtitle="SCPI, SCI, OPCI, foncières — valeur issue du journal, part IFI calculée"
        actions={
          <Button
            type="button"
            variant={showForm ? "outline" : "default"}
            onClick={() => setShowForm((v) => !v)}
            data-testid="re-indirect-toggle"
          >
            {showForm ? "Annuler" : "Ajouter un véhicule"}
          </Button>
        }
      />

      {showForm ? (
        <div
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3"
          data-testid="re-indirect-form"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-meta block">
              Plateforme
              <select
                className="input mt-1 w-full"
                value={form.platformId}
                onChange={(e) => set("platformId", e.target.value)}
                data-testid="re-ind-platform"
              >
                <option value="">— choisir —</option>
                {(platformsQ.data?.platforms ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Type de véhicule
              <select
                className="input mt-1 w-full"
                value={form.vehicle}
                onChange={(e) => {
                  const v = e.target.value as IndirectVehicle;
                  setForm((f) => ({
                    ...f,
                    vehicle: v,
                    // Pré-remplit la quote-part par le défaut du véhicule ;
                    // l'utilisateur la corrige avec le chiffre publié.
                    realEstateSharePct: String(
                      DEFAULT_REAL_ESTATE_SHARE_PCT[v] ?? 100
                    ),
                  }));
                }}
                data-testid="re-ind-vehicle"
              >
                {Object.entries(INDIRECT_VEHICLES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Nom
              <input
                className="input mt-1 w-full"
                placeholder="SCPI Primovie"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                data-testid="re-ind-name"
              />
            </label>

            <label className="text-meta block">
              Société de gestion
              <input
                className="input mt-1 w-full"
                placeholder="Primonial REIM"
                value={form.manager}
                onChange={(e) => set("manager", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Nombre de parts
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                value={form.shares}
                onChange={(e) => set("shares", e.target.value)}
                data-testid="re-ind-shares"
              />
            </label>

            <label className="text-meta block">
              Prix de part à l&apos;achat (€)
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                value={form.sharePriceEur}
                onChange={(e) => set("sharePriceEur", e.target.value)}
                data-testid="re-ind-price"
              />
            </label>

            <label className="text-meta block">
              Prix de part actuel (€)
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                placeholder="défaut : prix d'achat"
                value={form.currentSharePriceEur}
                onChange={(e) => set("currentSharePriceEur", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Frais de souscription (€)
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                value={form.subscriptionFeesEur}
                onChange={(e) => set("subscriptionFeesEur", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Date d&apos;acquisition
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.purchaseDate}
                onChange={(e) => set("purchaseDate", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Taux de distribution (%)
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                placeholder="4.5"
                value={form.distributionRatePct}
                onChange={(e) => set("distributionRatePct", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Ratio d&apos;endettement du véhicule (%)
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                value={form.debtRatioPct}
                onChange={(e) => set("debtRatioPct", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Quote-part immobilière IFI (%)
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                placeholder={String(
                  DEFAULT_REAL_ESTATE_SHARE_PCT[form.vehicle] ?? 100
                )}
                value={form.realEstateSharePct}
                onChange={(e) => set("realEstateSharePct", e.target.value)}
                data-testid="re-ind-share"
              />
            </label>

            <label className="text-meta block">
              Participation détenue (%)
              <input
                className="input mt-1 w-full"
                inputMode="decimal"
                placeholder="< 5 % exonère une foncière cotée"
                value={form.ownershipStakePct}
                onChange={(e) => set("ownershipStakePct", e.target.value)}
              />
            </label>

            <label className="text-meta block">
              Transparence fiscale
              <select
                className="input mt-1 w-full"
                value={form.taxTransparency}
                onChange={(e) => set("taxTransparency", e.target.value)}
              >
                {Object.entries(TAX_TRANSPARENCY).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              disabled={!canSubmit || create.isPending}
              onClick={() => create.mutate()}
              data-testid="re-ind-submit"
            >
              {create.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <p className="text-meta">
              La position est écrite au journal comme une souscription — la
              valeur suit le prix de part.
            </p>
          </div>
        </div>
      ) : null}

      {q.isPending ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : rows.length === 0 ? (
        <EmptyPlaceholder
          title="Aucun véhicule enregistré"
          description="Ajoutez une SCPI, une SCI ou un OPCI pour l'intégrer au patrimoine et à l'assiette IFI."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: "Valeur des parts", value: totalValue, strong: true },
              { label: "Retenu à l'IFI", value: totalIfi },
              { label: "Revenu annuel attendu", value: totalIncome },
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
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {formatCurrency(k.value)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Véhicule</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Parts</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Valeur</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Distrib.</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Revenu/an</th>
                  <th className="py-1.5 pr-2 text-right font-medium">IFI</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const debt = num(r.debtRatioPct);
                  return (
                    <tr
                      key={r.assetId}
                      className="border-t border-[var(--border)]"
                      data-testid={`re-ind-row-${r.assetId}`}
                    >
                      <td className="py-1.5 pr-2">
                        <p className="font-medium">{r.label}</p>
                        <p className="text-[10px] text-[var(--muted-foreground)]">
                          {INDIRECT_VEHICLES[r.vehicle as IndirectVehicle] ??
                            r.vehicle}
                          {r.manager ? ` · ${r.manager}` : ""}
                          {debt > DEBT_RATIO_ALERT_PCT ? (
                            <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-amber-800 dark:text-amber-300">
                              levier {debt.toFixed(0)} %
                            </span>
                          ) : null}
                        </p>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {num(r.quantity).toLocaleString("fr-FR", {
                          maximumFractionDigits: 4,
                        })}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                        {formatCurrency(num(r.marketValueEur))}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {r.distributionRatePct
                          ? `${num(r.distributionRatePct).toFixed(2)} %`
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {num(r.expectedAnnualIncomeEur) > 0
                          ? formatCurrency(num(r.expectedAnnualIncomeEur))
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {r.ifiExcluded ? (
                          <span
                            className="text-[10px] text-[var(--muted-foreground)]"
                            title={r.ifiExclusionReason ?? ""}
                          >
                            hors assiette
                          </span>
                        ) : (
                          <>
                            {formatCurrency(num(r.ifiTaxableValueEur))}
                            <span className="text-meta ml-1 text-[10px]">
                              ({num(r.ifiSharePct).toFixed(0)} %)
                            </span>
                          </>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          className="text-[10px] text-[var(--muted-foreground)] underline hover:text-[var(--danger)]"
                          onClick={() => remove.mutate(r.assetId)}
                          disabled={remove.isPending}
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-meta mt-2 leading-snug">
            Les titres de foncières cotées détenus à moins de 5 % du capital
            sont hors assiette IFI. Le taux de distribution affiché est un
            historique publié par la société de gestion, pas un engagement.
          </p>
        </>
      )}
    </section>
  );
}
