"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PlatformCombobox } from "@/components/ui/platform-combobox";
import { AssetAutocomplete } from "@/components/ui/asset-autocomplete";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import { currencyLabel } from "@/app/lib/money/currencies";
import { cn, formatCurrency } from "@/app/lib/utils";
import type { CreateTransactionForm } from "@/app/lib/schemas";

const FORM_TX_TYPES = Object.fromEntries(
  Object.entries(TRANSACTION_TYPES).filter(
    ([k]) => k !== "TRANSFERT_CASH" && k !== "TRANSFERT_TITRE"
  )
) as Omit<typeof TRANSACTION_TYPES, "TRANSFERT_CASH" | "TRANSFERT_TITRE">;

const CURRENCY_OPTIONS = ["EUR", "USD", "CHF", "GBP", "JPY"] as const;

type PlatformOption = {
  value: string;
  label: string;
  subtitle?: string;
  logoUrl?: string | null;
};

type FieldVisibility = {
  asset: boolean;
  ticker: boolean;
  quantity: boolean;
  unitPrice: boolean;
  cashAmount: boolean;
  fees: boolean;
  incomeFiscal: boolean;
  quantityLabel: string;
  typeHint: string;
};

function visibilityForType(txType: string): FieldVisibility {
  const t = String(txType || "");
  const isIncome = ["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(t);
  const isTrade = t === "ACHAT" || t === "VENTE";
  const isReward = t === "REWARD";
  const isCashMove = t === "APPORT" || t === "RETRAIT";
  const isFees = t === "FRAIS";
  const isSplit = t === "SPLIT";

  if (isReward) {
    return {
      asset: true,
      ticker: true,
      quantity: true,
      unitPrice: true,
      cashAmount: false,
      fees: false,
      incomeFiscal: false,
      quantityLabel: "Quantité reçue",
      typeHint:
        "Staking / reward / airdrop : tokens reçus sans dépense. Quantité en portefeuille, coût d’acquisition 0 (pas un achat). Prix unitaire optionnel = valeur marché à la réception (info).",
    };
  }
  if (isSplit) {
    return {
      asset: true,
      ticker: true,
      quantity: true,
      unitPrice: false,
      cashAmount: false,
      fees: false,
      incomeFiscal: false,
      quantityLabel: "Ratio de split (ex. 2 = 2-for-1)",
      typeHint:
        "Split / division de titres : le ratio ajuste la quantité et le CUMP sans mouvement de cash.",
    };
  }
  if (isCashMove) {
    return {
      asset: false,
      ticker: false,
      quantity: false,
      unitPrice: false,
      cashAmount: true,
      fees: true,
      incomeFiscal: false,
      quantityLabel: "Quantité",
      typeHint:
        "Apport ou retrait de liquidités (banque / livret). N’impacte pas le CUMP des titres.",
    };
  }
  if (isFees) {
    return {
      asset: true,
      ticker: false,
      quantity: false,
      unitPrice: false,
      cashAmount: true,
      fees: true,
      incomeFiscal: false,
      quantityLabel: "Quantité",
      typeHint:
        "Frais ou commission hors ordre d’achat/vente. Le montant cash (ou frais) détermine l’impact.",
    };
  }
  if (isIncome) {
    return {
      asset: true,
      ticker: true,
      quantity: false,
      unitPrice: false,
      cashAmount: true,
      fees: true,
      incomeFiscal: true,
      quantityLabel: "Quantité",
      typeHint:
        "Revenu (dividende, coupon, loyer, intérêts). Montant cash = brut en devise de l’opération.",
    };
  }
  if (isTrade) {
    return {
      asset: true,
      ticker: true,
      quantity: true,
      unitPrice: true,
      cashAmount: false,
      fees: true,
      incomeFiscal: false,
      quantityLabel: "Quantité",
      typeHint:
        t === "ACHAT"
          ? "Achat de titres : quantité × prix unitaire (+ frais) alimente le CUMP et l’impact cash."
          : "Vente de titres : quantité × prix unitaire (− frais) réalise le P&L et l’impact cash.",
    };
  }
  return {
    asset: true,
    ticker: true,
    quantity: true,
    unitPrice: true,
    cashAmount: true,
    fees: true,
    incomeFiscal: false,
    quantityLabel: "Quantité",
    typeHint: "Renseignez les champs pertinents pour ce type d’opération.",
  };
}

function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 p-3",
        className
      )}
    >
      <header className="space-y-0.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </h4>
        {hint ? (
          <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
            {hint}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Convert amount from `from` to `to` using rates where 1 EUR = rates[code]. */
function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>
): number {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (!Number.isFinite(amount) || f === t) return amount;
  const fromRate = rates[f] ?? 1;
  const toRate = rates[t] ?? 1;
  if (!fromRate || !toRate) return amount;
  const inEur = f === "EUR" ? amount : amount / fromRate;
  return t === "EUR" ? inEur : inEur * toRate;
}

function fxRateToEurFromRates(code: string, rates: Record<string, number>): string {
  const c = code.toUpperCase();
  if (c === "EUR") return "1";
  const r = rates[c];
  if (!r || r <= 0) return "1";
  return String(Number((1 / r).toPrecision(10)));
}

function formatFormAmount(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = n.toFixed(8).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

export function TransactionModal({
  open,
  editing,
  form,
  platformLabel,
  assetLabel,
  platformOptions,
  platformsEmpty,
  pending,
  onClose,
  onSubmit,
  onPlatformLabelChange,
  onAssetLabelChange,
}: {
  open: boolean;
  editing: boolean;
  form: UseFormReturn<CreateTransactionForm>;
  platformLabel: string;
  assetLabel: string;
  platformOptions: PlatformOption[];
  platformsEmpty: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: CreateTransactionForm) => void;
  onPlatformLabelChange: (label: string) => void;
  onAssetLabelChange: (label: string) => void;
}) {
  const currency = form.watch("currency") || "EUR";
  const fxRateToEur = form.watch("fxRateToEur") || "1";
  const unitPrice = form.watch("unitPrice");
  const cashAmount = form.watch("cashAmount");
  const fees = form.watch("fees");
  const quantity = form.watch("quantity");
  const txType = form.watch("type");
  const paymentDate = form.watch("paymentDate");
  const occurredAt = form.watch("occurredAt");
  const isIncome = ["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(
    String(txType || "")
  );

  const vis = useMemo(() => visibilityForType(String(txType || "")), [txType]);

  const [fxLoading, setFxLoading] = useState(false);
  const [fxHint, setFxHint] = useState<string | null>(null);
  const [showFxHelp, setShowFxHelp] = useState(false);
  /** When true, changing currency converts unitPrice/cash/fees so € equivalent stays the same. */
  const [convertAmounts, setConvertAmounts] = useState(true);

  const prevCurrencyRef = useRef<string | null>(null);
  const ratesCacheRef = useRef<Record<string, number> | null>(null);
  const skipNextCurrencyEffect = useRef(false);

  useEffect(() => {
    if (!open) {
      prevCurrencyRef.current = null;
      setFxHint(null);
      setConvertAmounts(true);
      setShowFxHelp(false);
      return;
    }
    const initial = (form.getValues("currency") || "EUR").toUpperCase();
    prevCurrencyRef.current = initial;
    skipNextCurrencyEffect.current = true;
  }, [open, form]);

  useEffect(() => {
    if (!open) return;
    const next = (currency || "EUR").toUpperCase();
    const prev = prevCurrencyRef.current;

    if (skipNextCurrencyEffect.current) {
      skipNextCurrencyEffect.current = false;
      prevCurrencyRef.current = next;
      return;
    }
    if (!prev || prev === next) {
      prevCurrencyRef.current = next;
      return;
    }

    let cancelled = false;
    (async () => {
      setFxLoading(true);
      setFxHint(null);
      try {
        let rates = ratesCacheRef.current;
        if (!rates) {
          const res = await fetch("/api/fx", { cache: "no-store" });
          if (!res.ok) throw new Error("FX indisponible");
          const data = (await res.json()) as { rates?: Record<string, number> };
          rates = { EUR: 1, ...(data.rates ?? {}) };
          ratesCacheRef.current = rates;
        }
        if (cancelled) return;

        const newFx = fxRateToEurFromRates(next, rates);
        form.setValue("fxRateToEur", newFx, { shouldDirty: true });
        form.setValue("currency", next, { shouldDirty: true });

        if (convertAmounts) {
          const fields = ["unitPrice", "cashAmount", "fees"] as const;
          for (const field of fields) {
            const raw = form.getValues(field);
            if (raw == null || raw === "") continue;
            const n = Number(String(raw).replace(",", "."));
            if (!Number.isFinite(n)) continue;
            const converted = convertAmount(n, prev, next, rates);
            form.setValue(field, formatFormAmount(converted), {
              shouldDirty: true,
            });
          }
          setFxHint(
            `${prev} → ${next} · taux ${newFx} · montants convertis (équivalent € conservé)`
          );
        } else {
          setFxHint(
            `${prev} → ${next} · taux ${newFx} · montants inchangés (recalcul € à l’enregistrement)`
          );
        }
        prevCurrencyRef.current = next;
      } catch {
        if (!cancelled) {
          if (next === "EUR") {
            form.setValue("fxRateToEur", "1", { shouldDirty: true });
          }
          setFxHint("Taux indisponible — saisissez-le manuellement");
          prevCurrencyRef.current = next;
        }
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, open, form]);

  const rate = Number(String(fxRateToEur).replace(",", ".")) || 1;
  const qtyN = Number(String(quantity ?? "").replace(",", "."));
  const priceN = Number(String(unitPrice ?? "").replace(",", "."));
  const cashN = Number(String(cashAmount ?? "").replace(",", "."));
  const feesN = Number(String(fees ?? "").replace(",", ".")) || 0;
  const whtRateN = Number(
    String(form.watch("withholdingTaxRate") ?? "").replace(",", ".")
  );
  const whtFrac =
    Number.isFinite(whtRateN) && whtRateN > 0
      ? whtRateN > 1
        ? whtRateN / 100
        : whtRateN
      : 0;

  let previewEur: number | null = null;
  if (Number.isFinite(qtyN) && Number.isFinite(priceN) && qtyN > 0) {
    previewEur = qtyN * priceN * rate + feesN * rate;
  } else if (Number.isFinite(cashN) && cashN > 0) {
    const gross = cashN * rate;
    if (isIncome) {
      previewEur = Math.max(0, gross - gross * whtFrac - feesN * rate);
    } else {
      previewEur = gross + feesN * rate;
    }
  } else if (feesN > 0) {
    previewEur = feesN * rate;
  }

  useEffect(() => {
    if (!open || !isIncome) return;
    const cur = (currency || "EUR").toUpperCase();
    if (cur === "EUR") {
      form.setValue("fxRateToEur", "1", { shouldDirty: false });
      return;
    }
    const day = String(paymentDate || occurredAt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/fx?from=${encodeURIComponent(cur)}&date=${encodeURIComponent(day)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { fxRateToEur?: string };
        if (data.fxRateToEur && !cancelled) {
          form.setValue("fxRateToEur", data.fxRateToEur, { shouldDirty: true });
          setFxHint(`Taux historique ${cur}→EUR au ${day} : ${data.fxRateToEur}`);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isIncome, currency, paymentDate, occurredAt, form]);

  if (!open) return null;

  const typeLabel =
    TRANSACTION_TYPES[String(txType) as keyof typeof TRANSACTION_TYPES] ||
    String(txType || "—");

  return (
    <Modal
      title={editing ? "Modifier la transaction" : "Nouvelle transaction"}
      onClose={onClose}
      wide
    >
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit((values) => {
          const assetId = values.assetId || form.getValues("assetId") || "";
          onSubmit({ ...values, assetId });
        })}
        data-testid="tx-form"
      >
        {/* ── 1. Identité ── */}
        <Section
          title="Identité"
          hint="Type d’opération et plateforme de règlement."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select
                className="input"
                data-testid="tx-type"
                {...form.register("type")}
              >
                {Object.entries(FORM_TX_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Plateforme">
              <input type="hidden" {...form.register("platformId")} />
              <PlatformCombobox
                value={platformLabel}
                testId="tx-platform"
                allowCustom={false}
                placeholder="Rechercher une plateforme…"
                options={platformOptions}
                onValueChange={onPlatformLabelChange}
                onSelect={(sel) => {
                  if ("custom" in sel && sel.custom) return;
                  if ("value" in sel) {
                    form.setValue("platformId", sel.value);
                    onPlatformLabelChange(sel.label);
                  }
                }}
              />
              {platformsEmpty && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  Aucune plateforme — créez-en une dans l&apos;onglet
                  Plateformes.
                </p>
              )}
            </Field>
          </div>
          <p
            className="rounded-lg border border-teal-500/20 bg-teal-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-teal-800 dark:text-teal-200"
            data-testid="tx-type-hint"
          >
            <span className="font-semibold">{typeLabel}</span>
            {" — "}
            {vis.typeHint}
          </p>
        </Section>

        {/* ── 2. Actif ── */}
        {vis.asset && (
          <Section
            title="Actif"
            hint="Recherchez un titre existant ou corrigez le ticker."
          >
            <Field label="Actif (recherche)">
              <input type="hidden" {...form.register("assetId")} />
              <AssetAutocomplete
                platformId={form.watch("platformId") || ""}
                valueId={form.watch("assetId") || ""}
                valueLabel={assetLabel}
                onSelect={(hit) => {
                  form.setValue("assetId", hit.id, { shouldValidate: true });
                  form.setValue("ticker", hit.ticker || "", {
                    shouldDirty: true,
                  });
                  onAssetLabelChange(
                    hit.name
                      ? `${hit.name}${hit.ticker ? ` (${hit.ticker})` : ""}`
                      : ""
                  );
                  if (hit.currency) {
                    form.setValue("currency", hit.currency);
                  }
                }}
              />
              <p className="mt-1 text-[11px] text-zinc-500 dark:text-slate-400">
                Nom ou ticker (MC.PA, AAPL, Bitcoin…). Créez l&apos;actif s&apos;il
                n&apos;existe pas encore.
              </p>
            </Field>
            {vis.ticker && (
              <Field label="Ticker">
                <input
                  className="input font-mono uppercase"
                  data-testid="tx-ticker"
                  placeholder="ex. MC.PA, AAPL, BTC"
                  autoComplete="off"
                  spellCheck={false}
                  {...form.register("ticker")}
                  onBlur={(e) => {
                    const t = e.target.value.trim().toUpperCase();
                    form.setValue("ticker", t, { shouldDirty: true });
                    const namePart = assetLabel
                      .replace(/\s*\([^)]*\)\s*$/, "")
                      .trim();
                    if (namePart) {
                      onAssetLabelChange(t ? `${namePart} (${t})` : namePart);
                    }
                  }}
                />
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-slate-400">
                  Prérempli par l&apos;autocomplétion — enregistré sur l&apos;actif
                  à la validation.
                </p>
              </Field>
            )}
          </Section>
        )}

        {/* ── 3. Montants & devise ── */}
        <Section
          title="Montants & devise"
          hint="Seuls les champs utiles pour ce type sont mis en avant."
        >
          <div className="grid grid-cols-2 gap-3">
            {vis.quantity && (
              <Field label={vis.quantityLabel}>
                <input
                  className="input"
                  data-testid="tx-qty"
                  placeholder={
                    String(txType) === "SPLIT" ? "2" : undefined
                  }
                  {...form.register("quantity")}
                />
              </Field>
            )}
            {vis.unitPrice && (
              <Field label="Prix unitaire">
                <input
                  className="input"
                  data-testid="tx-price"
                  {...form.register("unitPrice")}
                />
              </Field>
            )}
            {vis.cashAmount && (
              <Field
                label={
                  isIncome ? "Montant cash (brut)" : "Montant cash"
                }
              >
                <input
                  className="input"
                  data-testid="tx-cash"
                  {...form.register("cashAmount")}
                />
              </Field>
            )}
            {vis.fees && (
              <Field label="Frais">
                <input
                  className="input"
                  data-testid="tx-fees"
                  {...form.register("fees")}
                />
              </Field>
            )}
            <Field label="Devise">
              <select
                className="input"
                data-testid="tx-currency"
                value={(currency || "EUR").toUpperCase()}
                onChange={(e) => {
                  form.setValue("currency", e.target.value.toUpperCase(), {
                    shouldDirty: true,
                  });
                }}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {currencyLabel(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1">
                  {`Taux → EUR${fxLoading ? " …" : ""}`}
                  <FinanceTip term="PRU" />
                </span>
              }
            >
              <input
                className="input"
                data-testid="tx-fx"
                {...form.register("fxRateToEur")}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/60 px-2.5 py-2 text-[11px] text-zinc-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={convertAmounts}
                onChange={(e) => setConvertAmounts(e.target.checked)}
              />
              <span>
                <strong>Convertir les montants</strong> lors d&apos;un changement
                de devise (équivalent € conservé à l&apos;affichage). Décochez si
                seule l&apos;étiquette devise était incorrecte.
              </span>
            </label>

            <button
              type="button"
              className="text-[11px] font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              onClick={() => setShowFxHelp((v) => !v)}
              aria-expanded={showFxHelp}
            >
              {showFxHelp
                ? "Masquer l’aide conversion"
                : "Aide conversion & impact €"}
            </button>
            {showFxHelp && (
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                <p>
                  Le <strong>taux → EUR</strong> convertit prix, cash et frais
                  pour le PRU et l&apos;impact cash en euros. En revenu non-EUR,
                  un taux historique peut être rechargé à la date de paiement.
                </p>
                {editing && (
                  <p className="mt-1 text-slate-500">
                    En modification, le PRU / impact € est recalculé à
                    l&apos;enregistrement.
                  </p>
                )}
              </div>
            )}

            {fxHint && (
              <p
                className="text-[11px] text-sky-700 dark:text-sky-300"
                data-testid="tx-fx-hint"
              >
                {fxHint}
              </p>
            )}

            {previewEur != null && Number.isFinite(previewEur) && (
              <p
                className="rounded-lg border border-[var(--border)] bg-[var(--card)]/70 px-2.5 py-2 text-[11px] text-zinc-600 dark:text-slate-400"
                data-testid="tx-eur-preview"
              >
                <strong>Aperçu équivalent €</strong>{" "}
                <span className="text-slate-400">(avant enregistrement)</span>
                {" : "}
                <span className="font-semibold tabular-nums text-zinc-800 dark:text-slate-100">
                  {formatCurrency(previewEur, "EUR")}
                </span>
                {currency.toUpperCase() !== "EUR" && (
                  <span className="text-zinc-500">
                    {" "}
                    · taux {String(fxRateToEur)} {currency.toUpperCase()}→EUR
                  </span>
                )}
              </p>
            )}
          </div>
        </Section>

        {/* ── 4. Dates & notes ── */}
        <Section title="Date & notes">
          <Field label={isIncome ? "Date (compta / défaut)" : "Date"}>
            <input
              type="datetime-local"
              className="input"
              data-testid="tx-date"
              {...form.register("occurredAt")}
            />
          </Field>
          <Field label="Notes">
            <input
              className="input"
              placeholder="Référence courtier, commentaire…"
              {...form.register("notes")}
            />
          </Field>
        </Section>

        {/* ── 5. Fiscalité revenu (conditionnel) ── */}
        {vis.incomeFiscal && (
          <Section
            title="Revenu — fiscalité & calendrier"
            className="border-amber-500/25 bg-amber-500/5"
            hint="Montant cash = brut en devise. Net ≈ brut × (1 − WHT) − frais. Le PFU FR (CTO) n’est pas déduit ici."
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ex-date (détachement)">
                <input
                  type="date"
                  className="input"
                  data-testid="tx-ex-date"
                  {...form.register("exDate")}
                />
              </Field>
              <Field label="Date de paiement">
                <input
                  type="date"
                  className="input"
                  data-testid="tx-payment-date"
                  {...form.register("paymentDate")}
                />
              </Field>
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    Taux WHT source (0–1 ou %)
                    <FinanceTip term="WHT" />
                  </span>
                }
              >
                <input
                  className="input"
                  data-testid="tx-wht-rate"
                  placeholder="ex. 0.15 ou 15"
                  {...form.register("withholdingTaxRate")}
                />
              </Field>
            </div>
            {whtFrac > 0 && Number.isFinite(cashN) && cashN > 0 && (
              <p className="text-[10px] tabular-nums text-slate-500">
                Estim. WHT {(whtFrac * 100).toFixed(2)} % · net ≈{" "}
                {formatCurrency(
                  Math.max(0, cashN * rate * (1 - whtFrac) - feesN * rate),
                  "EUR"
                )}
              </p>
            )}
            <p className="text-[10px] leading-snug text-slate-500">
              Si ex-date &lt; date de paiement, la perf total return accrute le
              net au détachement (évite le creux de cours).
            </p>
          </Section>
        )}

        {/* ── Aide métier compacte ── */}
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-[11px] leading-snug text-zinc-600 dark:text-slate-400">
          <strong>Cash banques</strong> = uniquement Apport / Retrait. Les
          achats et ventes de titres n&apos;impactent pas ce solde.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending} data-testid="tx-submit">
            {pending ? "…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
