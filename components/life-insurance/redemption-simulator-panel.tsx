"use client";

import { useMemo, useState } from "react";
import {
  annualAllowanceEur,
  contractAge,
  type TaxHousehold,
} from "@/app/lib/life-insurance/fiscal";
import {
  computeRedemptionTax,
  gainsInPartialRedemption,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  PFU_REDUCED_RATE,
  PFU_STANDARD_RATE,
} from "@/app/lib/life-insurance/redemption-tax";
import { cn, formatCurrency } from "@/app/lib/utils";

export type SimulatorPolicy = {
  id: string;
  insurer: string;
  openDate: string | null;
  premiumsBefore2017Eur?: string;
  premiumsAfter2017Eur?: string;
};

export type SimulatorSupport = {
  assetId: string;
  lifeInsuranceId: string | null;
  name: string;
  currentValueEur: string | null;
  costBasisEur?: string | null;
  unrealizedPnlEur?: string | null;
};

function money(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function Row({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className={cn(muted && "text-[var(--muted-foreground)]")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums font-medium",
          emphasize && "text-sm font-semibold"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Simulateur de rachat d'assurance-vie (étape 3).
 *
 * Assemble les données déjà collectées (contrat, versements, foyer, encours)
 * et la quote-part de gains dérivée du journal, puis appelle le moteur pur
 * `computeRedemptionTax`. Aucune écriture en base : lecture seule.
 */
export function RedemptionSimulatorPanel({
  policies,
  supports,
  taxHousehold,
  totalOutstandingEur,
  className,
}: {
  policies: SimulatorPolicy[];
  supports: SimulatorSupport[];
  taxHousehold: TaxHousehold;
  /** Encours global (tous contrats) — seuil 150 k€. */
  totalOutstandingEur: string;
  className?: string;
}) {
  const [policyId, setPolicyId] = useState("");
  const [supportId, setSupportId] = useState(""); // "" = tout le contrat
  const [redemption, setRedemption] = useState("");
  const [allowanceUsed, setAllowanceUsed] = useState("0");
  /** Saisie manuelle de la quote-part de gains (optionnelle). */
  const [gainsOverride, setGainsOverride] = useState("");

  const policy = policies.find((p) => p.id === policyId) ?? null;

  const policySupports = useMemo(() => {
    if (!policyId) return [];
    const linked = supports.filter(
      (s) => s.lifeInsuranceId === policyId && money(s.currentValueEur) > 0
    );
    if (linked.length > 0) return linked;
    // Enveloppe Positions : supports sans rattachement contrat — on les
    // agrège pour permettre une simulation tant que le journal n'est pas lié.
    const anyLinked = supports.some((s) => s.lifeInsuranceId);
    if (!anyLinked) {
      return supports.filter((s) => money(s.currentValueEur) > 0);
    }
    return [];
  }, [supports, policyId]);

  const position = useMemo(() => {
    if (!policyId) return { value: 0, cost: 0, label: "" };
    if (supportId) {
      const s = policySupports.find((x) => x.assetId === supportId);
      if (!s) return { value: 0, cost: 0, label: "" };
      return {
        value: money(s.currentValueEur),
        cost: money(s.costBasisEur),
        label: s.name,
      };
    }
    // Agrégat contrat : somme des supports rattachés.
    const value = policySupports.reduce(
      (acc, s) => acc + money(s.currentValueEur),
      0
    );
    const cost = policySupports.reduce(
      (acc, s) => acc + money(s.costBasisEur),
      0
    );
    return {
      value,
      cost,
      label:
        policySupports.length > 0
          ? `${policySupports.length} support(s)`
          : "contrat (sans support valorisé)",
    };
  }, [policyId, supportId, policySupports]);

  const redemptionN = money(redemption);

  const splitGains = useMemo(() => {
    if (gainsOverride.trim() !== "") {
      const gains = Math.min(Math.max(0, money(gainsOverride)), redemptionN);
      return {
        ok: true as const,
        gainsInRedemptionEur: String(gains),
        capitalInRedemptionEur: String(Math.max(0, redemptionN - gains)),
        gainRatio: redemptionN > 0 ? gains / redemptionN : 0,
        latentGainEur: String(Math.max(0, position.value - position.cost)),
        fromOverride: true,
      };
    }
    const r = gainsInPartialRedemption({
      redemptionEur: redemptionN || 0,
      positionValueEur: position.value,
      costBasisEur: position.cost,
    });
    return { ...r, fromOverride: false };
  }, [gainsOverride, redemptionN, position.value, position.cost]);

  const hasAnteriority = policy?.openDate
    ? contractAge(new Date(policy.openDate)).hasAnteriority
    : false;

  const tax = useMemo(() => {
    if (!policy || redemptionN <= 0 || !splitGains.ok) return null;
    return computeRedemptionTax({
      redemptionEur: redemptionN,
      gainsInRedemptionEur: splitGains.gainsInRedemptionEur,
      hasAnteriority,
      premiumsBefore2017Eur: policy.premiumsBefore2017Eur ?? "0",
      premiumsAfter2017Eur: policy.premiumsAfter2017Eur ?? "0",
      totalOutstandingAllContractsEur: totalOutstandingEur,
      taxHousehold,
      allowanceAlreadyUsedThisYearEur: allowanceUsed || "0",
    });
  }, [
    policy,
    redemptionN,
    splitGains,
    hasAnteriority,
    totalOutstandingEur,
    taxHousehold,
    allowanceUsed,
  ]);

  const allowanceCap = annualAllowanceEur(taxHousehold);
  const outstandingN = money(totalOutstandingEur);

  if (policies.length === 0) {
    return null;
  }

  return (
    <section
      className={cn("card p-4", className)}
      data-testid="av-redemption-simulator"
    >
      <h2 className="mb-1 text-base font-semibold">Simuler un rachat</h2>
      <p className="text-meta mb-3">
        Estimation PFU + prélèvements sociaux à partir de vos contrats et du
        prix de revient au journal. Ce n&apos;est{" "}
        <strong>pas</strong> un avis fiscal : option barème, PS déjà prélevés
        sur fonds euro, etc. restent hors scope.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--muted-foreground)]">
            Contrat
          </span>
          <select
            className="input w-full"
            value={policyId}
            onChange={(e) => {
              setPolicyId(e.target.value);
              setSupportId("");
            }}
            data-testid="sim-policy"
          >
            <option value="">—</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.insurer}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--muted-foreground)]">
            Périmètre
          </span>
          <select
            className="input w-full"
            value={supportId}
            disabled={!policyId}
            onChange={(e) => setSupportId(e.target.value)}
            data-testid="sim-support"
          >
            <option value="">Tout le contrat (agrégat)</option>
            {policySupports.map((s) => (
              <option key={s.assetId} value={s.assetId}>
                {s.name} · {formatCurrency(s.currentValueEur ?? "0", "EUR")}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--muted-foreground)]">
            Montant du rachat (€)
          </span>
          <input
            className="input w-full"
            inputMode="decimal"
            placeholder="10000"
            value={redemption}
            onChange={(e) => setRedemption(e.target.value)}
            data-testid="sim-redemption"
          />
        </label>

        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--muted-foreground)]">
            Abattement déjà consommé cette année (€)
          </span>
          <input
            className="input w-full"
            inputMode="decimal"
            value={allowanceUsed}
            onChange={(e) => setAllowanceUsed(e.target.value)}
            data-testid="sim-allowance-used"
          />
          <span className="text-meta mt-0.5 block">
            Plafond foyer : {formatCurrency(String(allowanceCap), "EUR")} — non
            reportable d&apos;une année sur l&apos;autre.
          </span>
        </label>

        <label className="block text-xs sm:col-span-2">
          <span className="mb-1 block font-medium text-[var(--muted-foreground)]">
            Quote-part de gains (€) — optionnel
          </span>
          <input
            className="input w-full"
            inputMode="decimal"
            placeholder={
              splitGains.ok && !("fromOverride" in splitGains && gainsOverride)
                ? `auto : ${splitGains.gainsInRedemptionEur}`
                : "laisser vide = calcul auto"
            }
            value={gainsOverride}
            onChange={(e) => setGainsOverride(e.target.value)}
            data-testid="sim-gains-override"
          />
          <span className="text-meta mt-0.5 block">
            Par défaut : proportionnelle au P&amp;L latent (valeur − prix de
            revient). Un rachat n&apos;impose jamais le capital.
          </span>
        </label>
      </div>

      {policy && (
        <div
          className="mt-4 grid gap-4 lg:grid-cols-2"
          data-testid="sim-results"
        >
          <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/20 p-3">
            <p className="mb-2 text-xs font-semibold">Hypothèses</p>
            <Row
              label="Antériorité 8 ans"
              value={
                policy.openDate
                  ? hasAnteriority
                    ? "acquise"
                    : "non acquise → PFU 12,8 %, pas d'abattement"
                  : "date d'ouverture manquante"
              }
            />
            <Row
              label="Position"
              value={`${position.label} · ${formatCurrency(String(position.value), "EUR")}`}
            />
            <Row
              label="Prix de revient"
              value={formatCurrency(String(position.cost), "EUR")}
            />
            <Row
              label="Gain latent"
              value={formatCurrency(
                splitGains.ok ? splitGains.latentGainEur : "0",
                "EUR"
              )}
            />
            <Row
              label="Encours tous contrats"
              value={`${formatCurrency(totalOutstandingEur, "EUR")}${
                outstandingN > PFU_OUTSTANDING_THRESHOLD_EUR
                  ? " · > 150 k€"
                  : " · ≤ 150 k€"
              }`}
            />
            <Row
              label="Versements avant / après 2017"
              value={`${formatCurrency(policy.premiumsBefore2017Eur ?? "0", "EUR")} / ${formatCurrency(policy.premiumsAfter2017Eur ?? "0", "EUR")}`}
            />
          </div>

          <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <p className="mb-2 text-xs font-semibold">Résultat</p>
            {!tax || !tax.ok ? (
              <p className="text-meta">
                {tax?.error ||
                  (redemptionN <= 0
                    ? "Saisissez un montant de rachat."
                    : "Calcul impossible.")}
              </p>
            ) : (
              <>
                <Row
                  label="Capital retiré (non imposable)"
                  value={formatCurrency(tax.capitalInRedemptionEur, "EUR")}
                />
                <Row
                  label="Gains dans le rachat"
                  value={formatCurrency(tax.gainsInRedemptionEur, "EUR")}
                />
                <Row
                  label="Abattement IR appliqué"
                  value={formatCurrency(tax.allowanceAppliedEur, "EUR")}
                />
                <Row
                  label="Gains imposables (IR)"
                  value={formatCurrency(tax.taxableGainsEur, "EUR")}
                />
                <Row
                  label={`PFU ${
                    money(tax.pfuReducedBaseEur) > 0 &&
                    money(tax.pfuStandardBaseEur) > 0
                      ? "mixte"
                      : money(tax.pfuStandardBaseEur) > 0
                        ? `${(PFU_STANDARD_RATE * 100).toFixed(1)} %`
                        : `${(PFU_REDUCED_RATE * 100).toFixed(1)} %`
                  }`}
                  value={formatCurrency(tax.pfuTaxEur, "EUR")}
                />
                <Row
                  label={`Prélèvements sociaux (${(tax.socialChargesRate * 100).toFixed(1)} %)`}
                  value={formatCurrency(tax.socialChargesEur, "EUR")}
                />
                <Row
                  label="Total impôts"
                  value={formatCurrency(tax.totalTaxEur, "EUR")}
                />
                <div className="border-t border-[var(--border)] pt-2">
                  <Row
                    label="Net perçu estimé"
                    value={formatCurrency(tax.netReceivedEur, "EUR")}
                    emphasize
                  />
                </div>
                <p className="text-meta pt-1">
                  Reliquat d&apos;abattement cette année :{" "}
                  {formatCurrency(tax.allowanceRemainingThisYearEur, "EUR")}{" "}
                  (repart à zéro l&apos;an prochain).
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
