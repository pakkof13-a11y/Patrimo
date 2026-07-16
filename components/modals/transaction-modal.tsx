"use client";

import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PlatformCombobox } from "@/components/ui/platform-combobox";
import { AssetAutocomplete } from "@/components/ui/asset-autocomplete";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import { currencyLabel } from "@/app/lib/money/currencies";
import { formatCurrency } from "@/app/lib/utils";
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
  // amount → EUR → to
  const inEur = f === "EUR" ? amount : amount / fromRate;
  return t === "EUR" ? inEur : inEur * toRate;
}

function fxRateToEurFromRates(code: string, rates: Record<string, number>): string {
  const c = code.toUpperCase();
  if (c === "EUR") return "1";
  const r = rates[c];
  if (!r || r <= 0) return "1";
  // amountEur = amount * fxRateToEur ; 1 foreign = (1/r) EUR
  return String(Number((1 / r).toPrecision(10)));
}

function formatFormAmount(n: number): string {
  if (!Number.isFinite(n)) return "";
  // Keep enough precision for prices, trim trailing zeros lightly
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

  const [fxLoading, setFxLoading] = useState(false);
  const [fxHint, setFxHint] = useState<string | null>(null);
  /** When true, changing currency converts unitPrice/cash/fees so € equivalent stays the same (display). */
  const [convertAmounts, setConvertAmounts] = useState(true);

  const prevCurrencyRef = useRef<string | null>(null);
  const ratesCacheRef = useRef<Record<string, number> | null>(null);
  const skipNextCurrencyEffect = useRef(false);

  // Reset tracking when modal opens/closes so first paint does not re-convert
  useEffect(() => {
    if (!open) {
      prevCurrencyRef.current = null;
      setFxHint(null);
      setConvertAmounts(true);
      return;
    }
    const initial = (form.getValues("currency") || "EUR").toUpperCase();
    prevCurrencyRef.current = initial;
    skipNextCurrencyEffect.current = true;
  }, [open, form]);

  // Auto FX + optional amount conversion when currency changes
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
            form.setValue(field, formatFormAmount(converted), { shouldDirty: true });
          }
          setFxHint(
            `Devise ${prev} → ${next} · taux auto ${newFx} · montants convertis (équivalent € conservé, affichage uniquement)`
          );
        } else {
          setFxHint(
            `Devise ${prev} → ${next} · taux auto ${newFx} · montants inchangés (le PRU € sera recalculé à l'enregistrement)`
          );
        }
        prevCurrencyRef.current = next;
      } catch {
        if (!cancelled) {
          if (next === "EUR") {
            form.setValue("fxRateToEur", "1", { shouldDirty: true });
          }
          setFxHint("Impossible de charger le taux — saisissez-le manuellement");
          prevCurrencyRef.current = next;
        }
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // convertAmounts is read when currency changes; intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, open, form]);

  // Live EUR preview for display (does not write to DB until save)
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
    const wht = isIncome ? gross * whtFrac : 0;
    previewEur = isIncome ? gross - wht + feesN * rate : gross + feesN * rate;
    // net cash = gross - wht - fees for income
    if (isIncome) previewEur = Math.max(0, gross - wht - feesN * rate);
  } else if (feesN > 0) {
    previewEur = feesN * rate;
  }

  // Revenus : recharger FX historique quand paymentDate / occurredAt change
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
          setFxHint(
            `Taux historique ${cur}→EUR au ${day} : ${data.fxRateToEur}`
          );
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

  return (
    <Modal
      title={editing ? "Modifier la transaction" : "Nouvelle transaction"}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit((values) => {
          const assetId = values.assetId || form.getValues("assetId") || "";
          onSubmit({ ...values, assetId });
        })}
        data-testid="tx-form"
      >
        <Field label="Type">
          <select className="input" {...form.register("type")}>
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
              Aucune plateforme — créez-en une dans l&apos;onglet Plateformes.
            </p>
          )}
        </Field>
        <Field label="Actif (recherche)">
          <input type="hidden" {...form.register("assetId")} />
          <AssetAutocomplete
            platformId={form.watch("platformId") || ""}
            valueId={form.watch("assetId") || ""}
            valueLabel={assetLabel}
            onSelect={(hit) => {
              form.setValue("assetId", hit.id, { shouldValidate: true });
              form.setValue("ticker", hit.ticker || "", { shouldDirty: true });
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
            Tapez un nom ou ticker (MC.PA, AAPL, Bitcoin…). Créez un actif s&apos;il n&apos;existe
            pas.
          </p>
        </Field>
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
              const namePart = assetLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
              if (namePart) {
                onAssetLabelChange(t ? `${namePart} (${t})` : namePart);
              }
            }}
          />
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-slate-400">
            Prérempli par l&apos;autocomplétion — corrigez-le s&apos;il n&apos;est pas le bon.
            Enregistré sur l&apos;actif à la validation.
          </p>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={
              txType === "SPLIT"
                ? "Ratio de split (ex. 2 = 2-for-1)"
                : "Quantité"
            }
          >
            <input
              className="input"
              data-testid="tx-qty"
              placeholder={txType === "SPLIT" ? "2" : undefined}
              {...form.register("quantity")}
            />
          </Field>
          <Field label="Prix unitaire">
            <input className="input" data-testid="tx-price" {...form.register("unitPrice")} />
          </Field>
          <Field label="Montant cash">
            <input className="input" data-testid="tx-cash" {...form.register("cashAmount")} />
          </Field>
          <Field label="Frais">
            <input className="input" data-testid="tx-fees" {...form.register("fees")} />
          </Field>
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
          <Field label={`Taux → EUR${fxLoading ? " …" : ""}`}>
            <input
              className="input"
              data-testid="tx-fx"
              {...form.register("fxRateToEur")}
            />
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2 text-[11px] text-zinc-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={convertAmounts}
            onChange={(e) => setConvertAmounts(e.target.checked)}
          />
          <span>
            <strong>Convertir les montants à l&apos;affichage</strong> lors d&apos;un
            changement de devise (prix, cash, frais) pour conserver l&apos;équivalent
            en euros. Décochez si les montants sont déjà dans la bonne devise et que
            seule l&apos;étiquette devise était incorrecte.
          </span>
        </label>

        {fxHint && (
          <p className="text-[11px] text-sky-700 dark:text-sky-300" data-testid="tx-fx-hint">
            {fxHint}
          </p>
        )}

        {previewEur != null && Number.isFinite(previewEur) && (
          <p
            className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-[11px] text-zinc-600 dark:text-slate-400"
            data-testid="tx-eur-preview"
          >
            <strong>Aperçu équivalent €</strong> (affichage, avant enregistrement) :{" "}
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

        <Field label={isIncome ? "Date (compta / défaut)" : "Date"}>
          <input
            type="datetime-local"
            className="input"
            data-testid="tx-date"
            {...form.register("occurredAt")}
          />
        </Field>

        {isIncome && (
          <div className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
              Dividende / revenu — fiscalité &amp; calendrier
            </p>
            <p className="text-[10px] text-slate-500">
              Montant cash = <strong>brut</strong> en devise. Net = brut × (1 −
              WHT) − frais. Le PFU FR (CTO) n&apos;est pas déduit ici.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ex-date (détachement)">
                <input
                  type="date"
                  className="input"
                  data-testid="tx-ex-date"
                  {...form.register("exDate")}
                />
              </Field>
              <Field label="Payment date">
                <input
                  type="date"
                  className="input"
                  data-testid="tx-payment-date"
                  {...form.register("paymentDate")}
                />
              </Field>
              <Field label="Taux WHT source (0–1 ou %)">
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
          </div>
        )}

        <Field label="Notes">
          <input className="input" {...form.register("notes")} />
        </Field>
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-[11px] text-zinc-600 dark:text-slate-400">
          <strong>Cash banques</strong> = uniquement Apport / Retrait (livrets, comptes courants).
          Les achats et ventes d&apos;actifs n&apos;impactent <em>pas</em> ce solde.
          {isIncome && (
            <>
              {" "}
              Si ex-date &lt; payment date, la perf total return accrute le net au
              détachement (évite le creux cours).
            </>
          )}
          {editing && (
            <>
              {" "}
              En modifiant la devise d&apos;une transaction existante, le PRU / impact
              cash en euros est recalculé à l&apos;enregistrement.
            </>
          )}
        </p>
        <div className="flex justify-end gap-2 pt-2">
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
