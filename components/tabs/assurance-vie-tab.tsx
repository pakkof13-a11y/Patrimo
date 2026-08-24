"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  PlatformCombobox,
  type PlatformComboboxOption,
} from "@/components/ui/platform-combobox";
import {
  ASSURANCE_VIE_SUBTYPES,
  PLATFORM_PRESETS,
} from "@/app/lib/platforms/presets";
import {
  COUPON_FREQUENCIES,
  SUPPORT_KINDS,
  annualCouponEur,
  couponFrequencyLabel,
  isAboveBarrier,
  periodicCouponEur,
  supportKindLabel,
  underlyingPerformancePct,
} from "@/app/lib/life-insurance/constants";
import {
  annualAllowanceEur,
  checkPremiumsSplit,
  contractAgeLabel,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  type TaxHousehold,
} from "@/app/lib/life-insurance/fiscal";
import { CouponSchedulePanel } from "@/components/life-insurance/coupon-schedule-panel";
import { RedemptionSimulatorPanel } from "@/components/life-insurance/redemption-simulator-panel";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";

/* ─── Types API ─────────────────────────────────────────────────────── */

type Policy = {
  id: string;
  insurer: string;
  openDate: string | null;
  cashEuro: string;
  currency: string;
  notes: string | null;
  premiumsBefore2017Eur?: string;
  premiumsAfter2017Eur?: string;
  premiumsTotalEur?: string;
  outstandingEur?: string;
  products: Array<{ id: string; name: string; currentValue: string }>;
};

type LifeInsuranceResponse = {
  policies: Policy[];
  taxHousehold?: TaxHousehold;
  totalOutstandingEur?: string;
  /** Primes tous contrats — base du seuil de 150 k€ (pas l'encours). */
  totalPremiumsBefore2017Eur?: string;
  totalPremiumsAfter2017Eur?: string;
  exceedsPfuThreshold?: boolean;
};

type Support = {
  assetId: string;
  supportId: string;
  lifeInsuranceId: string | null;
  name: string;
  kind: string;
  isin: string | null;
  issuer: string | null;
  underlying: string | null;
  nominalEur: string | null;
  strikeLevel: string | null;
  couponRatePct: string | null;
  couponFrequency: string;
  couponBarrierPct: string | null;
  couponMemory: boolean;
  autocallBarrierPct: string | null;
  capitalProtectionPct: string | null;
  strikeDate: string | null;
  maturityDate: string | null;
  nextObservationDate: string | null;
  entryFeePct: string | null;
  managementFeePct: string | null;
  notes: string | null;
  /** Valorisation totale de la position, quantité incluse. */
  currentValueEur: string | null;
  costBasisEur?: string | null;
  unrealizedPnlEur?: string | null;
  quantity: string;
};

/* ─── Helpers ───────────────────────────────────────────────────────── */

const AV_SUBTYPE_RANK = new Map(
  ASSURANCE_VIE_SUBTYPES.map((s, i) => [s, i] as const)
);

function assuranceVieOptions(): PlatformComboboxOption[] {
  return PLATFORM_PRESETS.filter((p) => p.types.includes("ASSURANCE_VIE"))
    .slice()
    .sort((a, b) => {
      const ra =
        AV_SUBTYPE_RANK.get(a.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]) ?? 99;
      const rb =
        AV_SUBTYPE_RANK.get(b.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]) ?? 99;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    })
    .map((p) => ({
      value: p.key,
      label: p.name,
      subtitle: p.subtype || "Assurance-vie",
      logoUrl: p.logoUrl,
      preset: p,
    }));
}

const num = (v: string | null | undefined): number | null => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block text-xs", className)}>
      <span className="mb-1 block font-medium text-[var(--muted-foreground)]">
        {label}
      </span>
      {children}
      {hint && <span className="text-meta mt-0.5 block">{hint}</span>}
    </label>
  );
}

/* ─── Formulaire de support ─────────────────────────────────────────── */

type SupportForm = {
  kind: string;
  name: string;
  amountEur: string;
  entryFeesEur: string;
  investedAt: string;
  isin: string;
  issuer: string;
  underlying: string;
  nominalEur: string;
  strikeLevel: string;
  couponRatePct: string;
  couponFrequency: string;
  couponBarrierPct: string;
  couponMemory: boolean;
  autocallBarrierPct: string;
  capitalProtectionPct: string;
  strikeDate: string;
  maturityDate: string;
  nextObservationDate: string;
  entryFeePct: string;
  managementFeePct: string;
  notes: string;
};

const EMPTY_SUPPORT: SupportForm = {
  kind: "UC",
  name: "",
  amountEur: "",
  entryFeesEur: "",
  investedAt: "",
  isin: "",
  issuer: "",
  underlying: "",
  nominalEur: "",
  strikeLevel: "",
  couponRatePct: "",
  couponFrequency: "ANNUAL",
  couponBarrierPct: "",
  couponMemory: false,
  autocallBarrierPct: "",
  capitalProtectionPct: "",
  strikeDate: "",
  maturityDate: "",
  nextObservationDate: "",
  entryFeePct: "",
  managementFeePct: "",
  notes: "",
};

/**
 * Saisie d'un support.
 *
 * Les champs de produit structuré n'apparaissent que pour un structuré : les
 * afficher pour un fonds euro inviterait à renseigner une barrière de coupon
 * là où le capital est garanti, et laisserait en base des caractéristiques
 * qu'un affichage finirait par prendre au sérieux.
 */
function SupportForm({
  policies,
  onCreated,
}: {
  policies: Policy[];
  onCreated: () => void | Promise<void>;
}) {
  const [contractId, setContractId] = useState("");
  const [form, setForm] = useState<SupportForm>(EMPTY_SUPPORT);
  const set = <K extends keyof SupportForm>(k: K, v: SupportForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const structured = form.kind === "STRUCTURED";

  const nominal = num(form.nominalEur) ?? num(form.amountEur);
  const periodic = periodicCouponEur({
    nominalEur: nominal,
    couponRatePct: num(form.couponRatePct),
    couponFrequency: form.couponFrequency,
  });
  const annual = annualCouponEur({
    nominalEur: nominal,
    couponRatePct: num(form.couponRatePct),
  });

  const create = useMutation({
    mutationFn: () =>
      fetchJson<{ assetId: string }>("/api/life-insurance/supports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lifeInsuranceId: contractId,
          name: form.name,
          kind: form.kind,
          amountEur: form.amountEur,
          entryFeesEur: form.entryFeesEur || null,
          investedAt: form.investedAt || null,
          isin: form.isin || null,
          issuer: form.issuer || null,
          entryFeePct: form.entryFeePct || null,
          managementFeePct: form.managementFeePct || null,
          notes: form.notes || null,
          ...(structured
            ? {
                underlying: form.underlying || null,
                nominalEur: form.nominalEur || null,
                strikeLevel: form.strikeLevel || null,
                couponRatePct: form.couponRatePct || null,
                couponFrequency: form.couponFrequency,
                couponBarrierPct: form.couponBarrierPct || null,
                couponMemory: form.couponMemory,
                autocallBarrierPct: form.autocallBarrierPct || null,
                capitalProtectionPct: form.capitalProtectionPct || null,
                strikeDate: form.strikeDate || null,
                maturityDate: form.maturityDate || null,
                nextObservationDate: form.nextObservationDate || null,
              }
            : {}),
        }),
      }),
    onSuccess: async () => {
      toast.success(`${form.name} ajouté`);
      setForm(EMPTY_SUPPORT);
      await onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit =
    Boolean(contractId) &&
    form.name.trim().length > 0 &&
    (num(form.amountEur) ?? 0) > 0 &&
    (!structured || Boolean(form.maturityDate));

  return (
    <section className="card p-4" data-testid="av-support-form">
      <h3 className="mb-1 text-sm font-semibold">Ajouter un support</h3>
      <p className="text-meta mb-3">
        Le versement est enregistré au journal — le support a donc un prix de
        revient et une plus-value, comme une action.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Contrat">
          <select
            className="input w-full"
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            data-testid="support-contract"
          >
            <option value="">—</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.insurer}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Nature du support">
          <select
            className="input w-full"
            value={form.kind}
            onChange={(e) => set("kind", e.target.value)}
            data-testid="support-kind"
          >
            {Object.entries(SUPPORT_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Nom du support" className="sm:col-span-2">
          <input
            className="input w-full"
            placeholder="Amundi MSCI World, Athena Autocall 2031…"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            data-testid="support-name"
          />
        </Field>

        <Field label="Montant investi (€)">
          <input
            className="input w-full"
            inputMode="decimal"
            placeholder="10000"
            value={form.amountEur}
            onChange={(e) => set("amountEur", e.target.value)}
            data-testid="support-amount"
          />
        </Field>

        <Field label="Frais d'entrée (€)" hint="Montant réellement prélevé">
          <input
            className="input w-full"
            inputMode="decimal"
            value={form.entryFeesEur}
            onChange={(e) => set("entryFeesEur", e.target.value)}
          />
        </Field>

        <Field
          label="Date du versement"
          hint="À défaut : aujourd'hui. Renseignez-la pour un versement passé."
        >
          <input
            type="date"
            className="input w-full"
            value={form.investedAt}
            onChange={(e) => set("investedAt", e.target.value)}
            data-testid="support-date"
          />
        </Field>

        <Field label="ISIN">
          <input
            className="input w-full"
            placeholder="FR0010315770"
            value={form.isin}
            onChange={(e) => set("isin", e.target.value)}
          />
        </Field>
      </div>

      {structured && (
        <div
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/30 p-3"
          data-testid="support-structured-fields"
        >
          <p className="mb-2 text-xs font-semibold">
            Caractéristiques du produit structuré
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Émetteur" hint="Porte le risque de contrepartie">
              <input
                className="input w-full"
                placeholder="BNP Paribas, Société Générale…"
                value={form.issuer}
                onChange={(e) => set("issuer", e.target.value)}
              />
            </Field>

            <Field label="Sous-jacent">
              <input
                className="input w-full"
                placeholder="Euro Stoxx 50"
                value={form.underlying}
                onChange={(e) => set("underlying", e.target.value)}
                data-testid="support-underlying"
              />
            </Field>

            <Field label="Nominal (€)" hint="À défaut : le montant investi">
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.nominalEur}
                onChange={(e) => set("nominalEur", e.target.value)}
              />
            </Field>

            <Field
              label="Niveau initial (strike)"
              hint="Niveau du sous-jacent à la constatation"
            >
              <input
                className="input w-full"
                inputMode="decimal"
                placeholder="4200"
                value={form.strikeLevel}
                onChange={(e) => set("strikeLevel", e.target.value)}
                data-testid="support-strike"
              />
            </Field>

            <Field label="Coupon annuel (%)" hint="Taux annuel, pas par période">
              <input
                className="input w-full"
                inputMode="decimal"
                placeholder="8"
                value={form.couponRatePct}
                onChange={(e) => set("couponRatePct", e.target.value)}
                data-testid="support-coupon"
              />
            </Field>

            <Field label="Périodicité du coupon">
              <select
                className="input w-full"
                value={form.couponFrequency}
                onChange={(e) => set("couponFrequency", e.target.value)}
                data-testid="support-coupon-frequency"
              >
                {Object.entries(COUPON_FREQUENCIES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Barrière de coupon (%)"
              hint="En % du niveau initial — coupon versé au-dessus"
            >
              <input
                className="input w-full"
                inputMode="decimal"
                placeholder="70"
                value={form.couponBarrierPct}
                onChange={(e) => set("couponBarrierPct", e.target.value)}
              />
            </Field>

            <Field
              label="Barrière de rappel (%)"
              hint="Autocall : remboursement anticipé au-dessus"
            >
              <input
                className="input w-full"
                inputMode="decimal"
                placeholder="100"
                value={form.autocallBarrierPct}
                onChange={(e) => set("autocallBarrierPct", e.target.value)}
              />
            </Field>

            <Field
              label="Protection du capital (%)"
              hint="En % du niveau initial — capital préservé au-dessus"
            >
              <input
                className="input w-full"
                inputMode="decimal"
                placeholder="60"
                value={form.capitalProtectionPct}
                onChange={(e) => set("capitalProtectionPct", e.target.value)}
              />
            </Field>

            <Field label="Constatation initiale">
              <input
                type="date"
                className="input w-full"
                value={form.strikeDate}
                onChange={(e) => set("strikeDate", e.target.value)}
              />
            </Field>

            <Field label="Échéance" hint="Obligatoire pour un structuré">
              <input
                type="date"
                className="input w-full"
                value={form.maturityDate}
                onChange={(e) => set("maturityDate", e.target.value)}
                data-testid="support-maturity"
              />
            </Field>

            <Field label="Prochaine constatation">
              <input
                type="date"
                className="input w-full"
                value={form.nextObservationDate}
                onChange={(e) => set("nextObservationDate", e.target.value)}
              />
            </Field>

            <Field label="Frais de gestion annuels (%)">
              <input
                className="input w-full"
                inputMode="decimal"
                value={form.managementFeePct}
                onChange={(e) => set("managementFeePct", e.target.value)}
              />
            </Field>

            <label className="flex items-center gap-2 self-end text-xs">
              <input
                type="checkbox"
                checked={form.couponMemory}
                onChange={(e) => set("couponMemory", e.target.checked)}
              />
              Coupon à mémoire
              <span
                className="text-meta"
                title="Les coupons non versés se rattrapent lors d'une constatation favorable"
              >
                (?)
              </span>
            </label>
          </div>

          {(periodic != null || annual != null) && (
            <p className="text-meta mt-2" data-testid="support-coupon-recap">
              {periodic != null ? (
                <>
                  Coupon attendu :{" "}
                  <strong>{formatCurrency(String(periodic), "EUR")}</strong> par
                  échéance ({couponFrequencyLabel(form.couponFrequency).toLowerCase()})
                  {annual != null
                    ? ` · ${formatCurrency(String(annual), "EUR")} par an`
                    : ""}
                </>
              ) : (
                <>
                  Coupon capitalisé jusqu&apos;à l&apos;échéance :{" "}
                  <strong>{formatCurrency(String(annual), "EUR")}</strong> par an
                </>
              )}
            </p>
          )}
        </div>
      )}

      {!structured && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Société de gestion">
            <input
              className="input w-full"
              placeholder="Amundi, Carmignac…"
              value={form.issuer}
              onChange={(e) => set("issuer", e.target.value)}
            />
          </Field>
          <Field label="Frais de gestion annuels (%)">
            <input
              className="input w-full"
              inputMode="decimal"
              value={form.managementFeePct}
              onChange={(e) => set("managementFeePct", e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!canSubmit || create.isPending}
          onClick={() => create.mutate()}
          data-testid="support-submit"
        >
          <Plus className="h-3.5 w-3.5" />
          {create.isPending ? "Enregistrement…" : "Ajouter le support"}
        </Button>
        {structured && !form.maturityDate && (
          <span className="text-meta">
            L&apos;échéance est requise : c&apos;est elle qui commande le
            remboursement du capital.
          </span>
        )}
      </div>
    </section>
  );
}

/* ─── Fiche d'un support ────────────────────────────────────────────── */

function SupportRow({
  support,
  onChanged,
}: {
  support: Support;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState("");

  const structured = support.kind === "STRUCTURED";
  const strike = num(support.strikeLevel);
  const current = num(level);

  const perf = underlyingPerformancePct({
    currentLevel: current,
    strikeLevel: strike,
  });
  const aboveCoupon = isAboveBarrier({
    currentLevel: current,
    strikeLevel: strike,
    barrierPct: num(support.couponBarrierPct),
  });
  const aboveProtection = isAboveBarrier({
    currentLevel: current,
    strikeLevel: strike,
    barrierPct: num(support.capitalProtectionPct),
  });
  const aboveAutocall = isAboveBarrier({
    currentLevel: current,
    strikeLevel: strike,
    barrierPct: num(support.autocallBarrierPct),
  });

  const revalue = useMutation({
    mutationFn: (value: string) =>
      fetchJson("/api/life-insurance/supports", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revalue",
          assetId: support.assetId,
          valueEur: value,
        }),
      }),
    onSuccess: async () => {
      toast.success("Valorisation mise à jour");
      await onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () =>
      fetchJson(`/api/life-insurance/supports?assetId=${support.assetId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Support supprimé");
      await onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--border)] p-2.5"
      data-testid="av-support-row"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              open && "rotate-180"
            )}
          />
          <span className="truncate text-sm font-medium" title={support.name}>
            {support.name}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
              structured
                ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                : support.kind === "FONDS_EURO"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-stone-500/10 text-stone-700 dark:text-stone-300"
            )}
          >
            {supportKindLabel(support.kind)}
          </span>
        </button>

        <div className="flex flex-col items-end">
          <input
            className="input w-32 text-right text-xs"
            defaultValue={
              support.currentValueEur
                ? Number(support.currentValueEur).toFixed(2)
                : ""
            }
            aria-label={`Valorisation totale de ${support.name}`}
            title="Encours total du support, tel qu'il figure au relevé"
            data-testid="support-value"
            onBlur={(e) => {
              const v = e.target.value.trim();
              const current = support.currentValueEur
                ? Number(support.currentValueEur).toFixed(2)
                : "";
              if (v && v !== current) revalue.mutate(v);
            }}
          />
          {/*
            Quantité affichée seulement quand elle n'est pas 1 : l'encours saisi
            est un total, et sans cette mention on pourrait croire saisir un
            prix unitaire sur une position qui en compte des milliers.
          */}
          {Number(support.quantity) !== 1 && (
            <span className="text-meta mt-0.5">
              encours total ·{" "}
              {Number(support.quantity).toLocaleString("fr-FR", {
                maximumFractionDigits: 4,
              })}{" "}
              parts
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Supprimer ${support.name}`}
          onClick={() => remove.mutate()}
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>

      {open && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
          {support.isin && (
            <div>
              <dt className="text-[var(--muted-foreground)]">ISIN</dt>
              <dd className="font-mono">{support.isin}</dd>
            </div>
          )}
          {support.issuer && (
            <div>
              <dt className="text-[var(--muted-foreground)]">
                {structured ? "Émetteur" : "Gestionnaire"}
              </dt>
              <dd>{support.issuer}</dd>
            </div>
          )}
          {structured && (
            <>
              {support.underlying && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">Sous-jacent</dt>
                  <dd>{support.underlying}</dd>
                </div>
              )}
              {support.strikeLevel && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Niveau initial
                  </dt>
                  <dd className="tabular-nums">{support.strikeLevel}</dd>
                </div>
              )}
              {support.couponRatePct && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">Coupon</dt>
                  <dd className="tabular-nums">
                    {support.couponRatePct} % ·{" "}
                    {couponFrequencyLabel(support.couponFrequency)}
                    {support.couponMemory ? " · mémoire" : ""}
                  </dd>
                </div>
              )}
              {support.couponBarrierPct && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Barrière coupon
                  </dt>
                  <dd className="tabular-nums">{support.couponBarrierPct} %</dd>
                </div>
              )}
              {support.autocallBarrierPct && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">Rappel</dt>
                  <dd className="tabular-nums">
                    {support.autocallBarrierPct} %
                  </dd>
                </div>
              )}
              {support.capitalProtectionPct && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Protection capital
                  </dt>
                  <dd className="tabular-nums">
                    {support.capitalProtectionPct} %
                  </dd>
                </div>
              )}
              {support.maturityDate && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">Échéance</dt>
                  <dd>{formatDate(support.maturityDate)}</dd>
                </div>
              )}
              {support.nextObservationDate && (
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    Prochaine constatation
                  </dt>
                  <dd>{formatDate(support.nextObservationDate)}</dd>
                </div>
              )}
            </>
          )}
          {support.managementFeePct && (
            <div>
              <dt className="text-[var(--muted-foreground)]">Frais gestion</dt>
              <dd className="tabular-nums">{support.managementFeePct} %</dd>
            </div>
          )}
        </dl>
      )}

      {open && structured && strike != null && (
        <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/30 p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold">
            Où en est le sous-jacent ?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input w-32 text-xs"
              inputMode="decimal"
              placeholder={`Niveau actuel (${support.underlying ?? "sous-jacent"})`}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              aria-label="Niveau actuel du sous-jacent"
              data-testid="support-current-level"
            />
            {perf != null && (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  perf >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
                )}
              >
                {perf >= 0 ? "+" : ""}
                {perf.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %
                depuis la constatation
              </span>
            )}
          </div>
          {current != null && (
            <ul className="text-meta mt-1.5 space-y-0.5">
              {aboveCoupon != null && (
                <li>
                  Coupon : {aboveCoupon ? "versé" : "non versé"} au niveau actuel
                  {support.couponMemory && !aboveCoupon
                    ? " (mémorisé, rattrapable)"
                    : ""}
                </li>
              )}
              {aboveAutocall != null && aboveAutocall && (
                <li>Rappel anticipé atteint — remboursement possible</li>
              )}
              {aboveProtection != null && (
                <li>
                  Capital :{" "}
                  {aboveProtection
                    ? "au-dessus de la barrière de protection"
                    : "sous la barrière — perte en capital possible à l'échéance"}
                </li>
              )}
            </ul>
          )}
          <p className="text-meta mt-1.5">
            Indicatif : ce niveau n&apos;est pas enregistré, il sert à situer le
            produit au moment où vous le consultez.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Onglet ────────────────────────────────────────────────────────── */

/**
 * Saisie des contrats d'assurance-vie et de leurs supports.
 *
 * Écran de saisie, sur le modèle de l'onglet Banques — distinct de l'enveloppe
 * AV de Positions, qui n'affiche que des positions déjà enregistrées.
 *
 * Les valorisations saisies ici entrent au patrimoine **par le journal** : un
 * support crée un actif et une transaction d'achat, comme une action. C'est ce
 * qui lui donne un prix de revient, donc une plus-value.
 */
/**
 * Gestion des contrats — ouverture, versements, supports, rattachements.
 *
 * Cet écran reste ce qu'il était : une surface de **saisie**. Il vit désormais
 * sous un repli, derrière la vue d'ensemble, parce qu'on consulte son épargne
 * dix fois pour une fois qu'on la modifie.
 */
export function AssuranceVieManagement() {
  const qc = useQueryClient();

  const policiesQ = useQuery({
    queryKey: ["life-insurance"],
    queryFn: () => fetchJson<LifeInsuranceResponse>("/api/life-insurance"),
  });
  const supportsQ = useQuery({
    queryKey: ["life-insurance-supports"],
    queryFn: () =>
      fetchJson<{ supports: Support[] }>("/api/life-insurance/supports"),
  });

  const [insurer, setInsurer] = useState("");
  const [openDate, setOpenDate] = useState("");
  const [premiumsBefore, setPremiumsBefore] = useState("");
  const [premiumsAfter, setPremiumsAfter] = useState("");

  const avOptions = useMemo(() => assuranceVieOptions(), []);
  const policies = policiesQ.data?.policies ?? [];
  const taxHousehold: TaxHousehold = policiesQ.data?.taxHousehold ?? "SINGLE";
  const supports = useMemo(
    () => supportsQ.data?.supports ?? [],
    [supportsQ.data?.supports]
  );

  /** Encours global = max(API legacy, somme des supports au marché). */
  const totalOutstandingEur = useMemo(() => {
    const fromSupports = supports.reduce(
      (acc, s) => acc + (num(s.currentValueEur) ?? 0),
      0
    );
    const fromApi = Number(policiesQ.data?.totalOutstandingEur ?? 0);
    return String(Math.max(fromSupports, fromApi));
  }, [supports, policiesQ.data?.totalOutstandingEur]);

  const newSplit = useMemo(
    () =>
      checkPremiumsSplit({
        premiumsBefore2017Eur: premiumsBefore || "0",
        premiumsAfter2017Eur: premiumsAfter || "0",
      }),
    [premiumsBefore, premiumsAfter]
  );

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["life-insurance"] }),
      qc.invalidateQueries({ queryKey: ["life-insurance-supports"] }),
      qc.invalidateQueries({ queryKey: ["holdings"] }),
      qc.invalidateQueries({ queryKey: ["transactions"] }),
    ]);
  };

  const saveTaxHousehold = useMutation({
    mutationFn: (next: TaxHousehold) =>
      fetchJson("/api/life-insurance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "tax-profile", taxHousehold: next }),
      }),
    onSuccess: async () => {
      toast.success("Situation fiscale enregistrée");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addPolicy = useMutation({
    mutationFn: () => {
      if (!newSplit.ok) {
        throw new Error(newSplit.error || "Répartition des versements invalide");
      }
      return fetchJson("/api/life-insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insurer,
          openDate: openDate || null,
          cashEuro: "0",
          currency: "EUR",
          premiumsBefore2017Eur: newSplit.premiumsBefore2017Eur,
          premiumsAfter2017Eur: newSplit.premiumsAfter2017Eur,
          totalPremiumsEur: newSplit.totalPremiumsEur,
        }),
      });
    },
    onSuccess: async () => {
      toast.success("Contrat ajouté");
      setInsurer("");
      setOpenDate("");
      setPremiumsBefore("");
      setPremiumsAfter("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePolicy = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/life-insurance?id=${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Contrat supprimé");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const byContract = useMemo(() => {
    const map = new Map<string, Support[]>();
    for (const s of supports) {
      const key = s.lifeInsuranceId ?? "__orphan__";
      const bucket = map.get(key);
      if (bucket) bucket.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [supports]);

  const orphans = byContract.get("__orphan__") ?? [];

  return (
    <div className="space-y-4" data-testid="av-management">
      {/*
        En tête : une constatation échue est une décision en attente, elle passe
        avant la saisie. Le panneau disparaît quand il n'y a rien à trancher.
      */}
      <CouponSchedulePanel />

      <RedemptionSimulatorPanel
        policies={policies}
        supports={supports}
        taxHousehold={taxHousehold}
        totalOutstandingEur={totalOutstandingEur}
        totalPremiumsBefore2017Eur={
          policiesQ.data?.totalPremiumsBefore2017Eur ?? "0"
        }
        totalPremiumsAfter2017Eur={
          policiesQ.data?.totalPremiumsAfter2017Eur ?? "0"
        }
      />

      <section className="card p-4" data-testid="av-tax-profile">
        <h2 className="mb-1 text-base font-semibold">Situation fiscale</h2>
        <p className="text-meta mb-3">
          Abattement annuel sur les gains après 8 ans :{" "}
          {formatCurrency(String(annualAllowanceEur("SINGLE")), "EUR")} (seul)
          ou {formatCurrency(String(annualAllowanceEur("COUPLE")), "EUR")}{" "}
          (couple). Seuil d&apos;encours{" "}
          {formatCurrency(String(PFU_OUTSTANDING_THRESHOLD_EUR), "EUR")} tous
          contrats.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Foyer fiscal">
            <select
              className="input w-full"
              value={taxHousehold}
              data-testid="av-tax-household"
              onChange={(e) =>
                saveTaxHousehold.mutate(e.target.value as TaxHousehold)
              }
            >
              <option value="SINGLE">Personne seule</option>
              <option value="COUPLE">Couple (imposition commune)</option>
            </select>
          </Field>
          <p className="text-meta" data-testid="av-total-outstanding">
            Encours tous contrats :{" "}
            {formatCurrency(totalOutstandingEur, "EUR")}
          </p>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-base font-semibold">Nouveau contrat</h2>
        <p className="text-meta mb-3">
          Date d&apos;ouverture (antériorité 8 ans) et répartition des
          versements avant / après le 27/09/2017 (taux PFU).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1 text-xs sm:max-w-sm">
            <span className="mb-1 block font-medium text-[var(--muted-foreground)]">
              Courtier / Assureur
            </span>
            <PlatformCombobox
              value={insurer}
              options={avOptions}
              allowCustom
              placeholder="Linxea, Generali, Yomoni…"
              testId="av-insurer"
              onValueChange={setInsurer}
              onSelect={(sel) => {
                if ("custom" in sel && sel.custom) {
                  setInsurer(sel.label);
                  return;
                }
                if ("label" in sel) setInsurer(sel.label);
              }}
            />
          </label>
          <Field label="Date d'ouverture">
            <input
              type="date"
              className="input w-full"
              value={openDate}
              onChange={(e) => setOpenDate(e.target.value)}
              data-testid="av-open-date"
            />
          </Field>
          <Field label="Versé avant le 27/09/2017 (€)">
            <input
              className="input w-36"
              inputMode="decimal"
              placeholder="0"
              value={premiumsBefore}
              onChange={(e) => setPremiumsBefore(e.target.value)}
              data-testid="av-premiums-before"
            />
          </Field>
          <Field label="Versé à partir du 27/09/2017 (€)">
            <input
              className="input w-36"
              inputMode="decimal"
              placeholder="0"
              value={premiumsAfter}
              onChange={(e) => setPremiumsAfter(e.target.value)}
              data-testid="av-premiums-after"
            />
          </Field>
          <Button
            size="sm"
            disabled={!insurer || addPolicy.isPending || !newSplit.ok}
            onClick={() => addPolicy.mutate()}
            data-testid="av-add-policy"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>
      </section>

      {policies.map((p) => {
        const mine = byContract.get(p.id) ?? [];
        const total = mine.reduce(
          (sum, s) => sum + (num(s.currentValueEur) ?? 0),
          0
        );
        return (
          <section
            key={p.id}
            className="card overflow-hidden"
            data-testid="av-contract"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <input
                  className="input w-auto font-semibold"
                  defaultValue={p.insurer}
                  aria-label="Assureur"
                  onBlur={(e) => {
                    if (e.target.value !== p.insurer) {
                      fetchJson("/api/life-insurance", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          id: p.id,
                          insurer: e.target.value,
                        }),
                      }).then(refresh);
                    }
                  }}
                />
                <div className="text-meta mt-1">
                  Ouverture : {p.openDate ? formatDate(p.openDate) : "—"}
                  {p.openDate ? ` · ${contractAgeLabel(p.openDate)}` : ""}
                </div>
              </div>
              <div className="text-right">
                <p className="text-meta">Encours</p>
                <p className="tabular-nums text-sm font-semibold">
                  {formatCurrency(String(total), "EUR")}
                </p>
                <p className="text-meta">
                  {mine.length} support{mine.length > 1 ? "s" : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Supprimer ${p.insurer}`}
                onClick={() => deletePolicy.mutate(p.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>

            <div className="space-y-2 border-b border-[var(--border)] px-4 py-3">
              <p className="text-xs font-medium">Versements (répartition PFU)</p>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Avant le 27/09/2017 (€)">
                  <input
                    className="input w-36"
                    inputMode="decimal"
                    defaultValue={p.premiumsBefore2017Eur ?? "0"}
                    key={`${p.id}-b-${p.premiumsBefore2017Eur ?? "0"}`}
                    data-testid="av-contract-premiums-before"
                    onBlur={(e) => {
                      const before = e.target.value || "0";
                      const after = p.premiumsAfter2017Eur ?? "0";
                      const split = checkPremiumsSplit({
                        premiumsBefore2017Eur: before,
                        premiumsAfter2017Eur: after,
                      });
                      if (!split.ok) {
                        toast.error(split.error || "Répartition invalide");
                        return;
                      }
                      fetchJson("/api/life-insurance", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          id: p.id,
                          premiumsBefore2017Eur: split.premiumsBefore2017Eur,
                          premiumsAfter2017Eur: split.premiumsAfter2017Eur,
                          totalPremiumsEur: split.totalPremiumsEur,
                        }),
                      })
                        .then(refresh)
                        .catch((err: Error) => toast.error(err.message));
                    }}
                  />
                </Field>
                <Field label="À partir du 27/09/2017 (€)">
                  <input
                    className="input w-36"
                    inputMode="decimal"
                    defaultValue={p.premiumsAfter2017Eur ?? "0"}
                    key={`${p.id}-a-${p.premiumsAfter2017Eur ?? "0"}`}
                    data-testid="av-contract-premiums-after"
                    onBlur={(e) => {
                      const after = e.target.value || "0";
                      const before = p.premiumsBefore2017Eur ?? "0";
                      const split = checkPremiumsSplit({
                        premiumsBefore2017Eur: before,
                        premiumsAfter2017Eur: after,
                      });
                      if (!split.ok) {
                        toast.error(split.error || "Répartition invalide");
                        return;
                      }
                      fetchJson("/api/life-insurance", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          id: p.id,
                          premiumsBefore2017Eur: split.premiumsBefore2017Eur,
                          premiumsAfter2017Eur: split.premiumsAfter2017Eur,
                          totalPremiumsEur: split.totalPremiumsEur,
                        }),
                      })
                        .then(refresh)
                        .catch((err: Error) => toast.error(err.message));
                    }}
                  />
                </Field>
                <p className="text-meta">
                  Total :{" "}
                  {formatCurrency(
                    p.premiumsTotalEur ??
                      String(
                        (num(p.premiumsBefore2017Eur) ?? 0) +
                          (num(p.premiumsAfter2017Eur) ?? 0)
                      ),
                    "EUR"
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-2 px-4 py-3">
              {mine.length === 0 ? (
                <p className="text-meta">
                  Aucun support. Ajoutez-en un ci-dessous.
                </p>
              ) : (
                mine.map((s) => (
                  <SupportRow
                    key={s.assetId}
                    support={s}
                    onChanged={refresh}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}

      {policies.length > 0 && (
        <SupportForm policies={policies} onCreated={refresh} />
      )}

      {policies.length === 0 && !policiesQ.isPending && (
        <section className="card p-4">
          <p className="text-meta">
            Créez d&apos;abord un contrat : les supports s&apos;y rattachent.
          </p>
        </section>
      )}

      {orphans.length > 0 && (
        <section className="card p-4" data-testid="av-orphans">
          <h3 className="mb-1 text-sm font-semibold">
            Supports sans contrat rattaché
          </h3>
          <p className="text-meta mb-2">
            Ces positions sont dans l&apos;enveloppe AV mais ne sont reliées à
            aucun contrat — le plus souvent après une reprise depuis
            l&apos;ancienne saisie. Rattachez-les pour qu&apos;elles comptent
            dans l&apos;encours d&apos;un contrat.
          </p>
          <div className="space-y-2">
            {orphans.map((s) => (
              <div
                key={s.assetId}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                <span className="tabular-nums text-xs">
                  {formatCurrency(s.currentValueEur ?? "0", "EUR")}
                </span>
                <select
                  className="input w-auto text-xs"
                  defaultValue=""
                  aria-label={`Rattacher ${s.name}`}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    fetchJson("/api/life-insurance/supports", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "attach",
                        assetId: s.assetId,
                        lifeInsuranceId: e.target.value,
                      }),
                    })
                      .then(refresh)
                      .catch((err: Error) => toast.error(err.message));
                  }}
                >
                  <option value="">Rattacher à…</option>
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.insurer}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
