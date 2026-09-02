"use client";

import { useMemo, useState } from "react";
import { PanelHeader } from "@/components/ui/panel";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  computeCapitalGain,
  irAbatementRate,
  socialAbatementRate,
} from "@/app/lib/real-estate/tax/capital-gain";

type PropertyOption = {
  assetId: string;
  label: string;
  /** Coût de revient de la quote-part (issu du journal). */
  purchasePriceEur: string | null;
  purchaseDate: string | null;
  /** Valeur actuelle de la quote-part. */
  shareValueEur: string;
  isPrimaryResidence: boolean;
};

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Simulateur de plus-value immobilière à la cession.
 *
 * Le calcul tourne **dans le navigateur** : le moteur est pur et sans accès
 * base, et l'utilisateur fait varier prix et date de vente en continu. Un
 * aller-retour serveur par frappe n'apporterait rien.
 *
 * Le point que la simulation rend visible, et qu'on ne devine pas : l'IR et
 * les prélèvements sociaux s'éteignent à des rythmes différents. Entre 22 et
 * 30 ans de détention, l'impôt sur le revenu est nul alors que les PS restent
 * dus — d'où l'affichage séparé des deux abattements.
 */
export function CapitalGainSimulator({
  properties,
  className,
}: {
  properties: PropertyOption[];
  className?: string;
}) {
  const [assetId, setAssetId] = useState(properties[0]?.assetId ?? "");
  const selected = properties.find((p) => p.assetId === assetId) ?? properties[0];

  const [salePrice, setSalePrice] = useState<string>(
    selected ? String(Math.round(num(selected.shareValueEur))) : ""
  );
  const [saleDate, setSaleDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  // Décoché par défaut, à dessein : le prix de revient vient du journal et
  // contient déjà les frais d'acquisition réellement saisis à l'achat. Cocher
  // le forfait de 7,5 % par-dessus les compterait une seconde fois — l'option
  // n'a de sens que si aucun frais n'a été enregistré.
  const [useFlatFees, setUseFlatFees] = useState(false);
  const [useFlatWorks, setUseFlatWorks] = useState(false);

  const result = useMemo(() => {
    if (!selected?.purchaseDate) return null;
    const purchase = num(selected.purchasePriceEur);
    if (purchase <= 0) return null;

    return computeCapitalGain({
      salePriceEur: num(salePrice),
      purchasePriceEur: purchase,
      useFlatAcquisitionFees: useFlatFees,
      useFlatWorks,
      purchaseDate: new Date(selected.purchaseDate),
      saleDate: new Date(saleDate),
      isPrimaryResidence: selected.isPrimaryResidence,
    });
  }, [selected, salePrice, saleDate, useFlatFees, useFlatWorks]);

  if (properties.length === 0) return null;

  const onSelect = (id: string) => {
    setAssetId(id);
    const p = properties.find((x) => x.assetId === id);
    if (p) setSalePrice(String(Math.round(num(p.shareValueEur))));
  };

  return (
    <section className={cn("card p-4", className)} data-testid="re-pv-simulator">
      <PanelHeader
        title="Simulateur de plus-value"
        subtitle="Impôt dû en cas de cession, selon la durée de détention"
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-meta block">
          Bien
          <select
            className="input mt-1 w-full"
            value={assetId}
            onChange={(e) => onSelect(e.target.value)}
            data-testid="re-pv-asset"
          >
            {properties.map((p) => (
              <option key={p.assetId} value={p.assetId}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-meta block">
          Prix de cession simulé
          <input
            className="input mt-1 w-full"
            inputMode="decimal"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            data-testid="re-pv-price"
          />
        </label>

        <label className="text-meta block">
          Date de cession
          <input
            type="date"
            className="input mt-1 w-full"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            data-testid="re-pv-date"
          />
        </label>

        <div className="text-meta flex flex-col justify-end gap-1">
          <label
            className="flex items-center gap-1.5"
            title="Le prix de revient inclut déjà les frais saisis à l'achat : ne cochez que si aucun frais n'a été enregistré."
          >
            <input
              type="checkbox"
              checked={useFlatFees}
              onChange={(e) => setUseFlatFees(e.target.checked)}
            />
            Forfait frais d&apos;acquisition (7,5 %)
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={useFlatWorks}
              onChange={(e) => setUseFlatWorks(e.target.checked)}
            />
            Forfait travaux (15 %, dès 5 ans)
          </label>
        </div>
      </div>

      {!selected?.purchaseDate || num(selected?.purchasePriceEur) <= 0 ? (
        <p className="text-meta mt-3">
          Ce bien n&apos;a ni date ni prix d&apos;acquisition dans le journal —
          la plus-value ne peut pas être calculée.
        </p>
      ) : result ? (
        <div className="mt-3">
          {result.exempt ? (
            <div
              className="rounded-lg border border-teal-500/25 bg-teal-500/5 px-3 py-2 text-[11px] leading-snug text-teal-900 dark:text-teal-200"
              data-testid="re-pv-exempt"
            >
              <p className="font-semibold">Cession exonérée</p>
              <p className="mt-0.5">
                {result.exemptionReason === "PRIMARY_RESIDENCE"
                  ? "Résidence principale : exonération totale de plus-value, quelle que soit la durée de détention."
                  : `Détention de ${result.holdingYears} ans : exonération acquise à l'impôt sur le revenu (22 ans) comme aux prélèvements sociaux (30 ans).`}
              </p>
            </div>
          ) : null}

          <p className="text-meta mt-2">
            Prix de revient retenu :{" "}
            {formatCurrency(result.adjustedPurchasePriceEur.toNumber())} — issu
            du journal, frais d&apos;acquisition enregistrés compris.
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Détention", raw: `${result.holdingYears} ans` },
              {
                label: "Plus-value brute",
                value: result.grossGainEur.toNumber(),
              },
              { label: "Impôt total", value: result.totalTaxEur.toNumber() },
              {
                label: "Net après impôt",
                value: result.netProceedsEur.toNumber(),
                strong: true,
              },
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
                  {k.raw ?? formatCurrency(k.value ?? 0)}
                </p>
              </div>
            ))}
          </div>

          {!result.exempt ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium" />
                    <th className="py-1.5 pr-2 text-right font-medium">
                      Abattement
                    </th>
                    <th className="py-1.5 pr-2 text-right font-medium">
                      Base imposable
                    </th>
                    <th className="py-1.5 text-right font-medium">Impôt</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2">Impôt sur le revenu (19 %)</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--muted-foreground)]">
                      {(irAbatementRate(result.holdingYears).toNumber() * 100).toFixed(0)} %
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {formatCurrency(result.taxableGainIrEur.toNumber())}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">
                      {formatCurrency(result.irTaxEur.toNumber())}
                    </td>
                  </tr>
                  <tr className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2">
                      Prélèvements sociaux (17,2 %)
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--muted-foreground)]">
                      {(socialAbatementRate(result.holdingYears).toNumber() * 100).toFixed(1)} %
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {formatCurrency(result.taxableGainSocialEur.toNumber())}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">
                      {formatCurrency(result.socialTaxEur.toNumber())}
                    </td>
                  </tr>
                  {result.surtaxEur.gt(0) ? (
                    <tr className="border-t border-[var(--border)]">
                      <td className="py-1.5 pr-2" colSpan={3}>
                        Surtaxe sur plus-value élevée (&gt; 50 000 €)
                      </td>
                      <td className="py-1.5 text-right font-medium tabular-nums">
                        {formatCurrency(result.surtaxEur.toNumber())}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <p className="text-meta mt-2 leading-snug">
                Les deux abattements ne courent pas au même rythme :
                exonération d&apos;impôt sur le revenu à 22 ans, de
                prélèvements sociaux seulement à 30 ans.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
