"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormActions } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { liabilitySchema, type LiabilityForm } from "@/app/lib/schemas";
import { LIABILITY_LENDER_OPTIONS } from "@/app/lib/constants";
import { currencyLabel } from "@/app/lib/money/currencies";
import {
  estimateRemainingInterest,
  estimateRemainingMonths,
  projectEndDate,
} from "@/app/lib/liabilities/amortization";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";

/** Types UX uniquement — guident placeholders, non stockés en API. */
const LIABILITY_KINDS = [
  {
    id: "MORTGAGE",
    label: "Immobilier",
    namePh: "ex. Crédit immo résidence principale",
  },
  {
    id: "AUTO",
    label: "Auto",
    namePh: "ex. Crédit auto 2024",
  },
  {
    id: "CONSUMER",
    label: "Conso",
    namePh: "ex. Crédit conso travaux",
  },
  {
    id: "PRIVATE",
    label: "Dette privée",
    namePh: "ex. Prêt familial",
  },
  {
    id: "OTHER",
    label: "Autre",
    namePh: "ex. Prêt personnel, découvert…",
  },
] as const;

type LiabilityKind = (typeof LIABILITY_KINDS)[number]["id"];

function Section({
  step,
  title,
  hint,
  children,
  optional,
}: {
  step?: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <section className="space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/12 p-3.5">
      <header className="flex flex-wrap items-start gap-2">
        {step != null && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600/15 text-[10px] font-bold text-teal-800 dark:text-teal-200">
            {step}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {title}
            {optional ? (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">
                — optionnel
              </span>
            ) : null}
          </h4>
          {hint ? (
            <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
              {hint}
            </p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function LenderCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const isKnown = (LIABILITY_LENDER_OPTIONS as readonly string[]).includes(
    value
  );

  useEffect(() => {
    if (value && !isKnown && value !== "Autre") setCustomMode(true);
  }, [value, isKnown]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...LIABILITY_LENDER_OPTIONS];
    return LIABILITY_LENDER_OPTIONS.filter((m) =>
      m.toLowerCase().includes(q)
    );
  }, [query]);

  const display = !value
    ? "Choisir une banque ou un prêteur…"
    : customMode && value
      ? value
      : value === "Autre"
        ? "Autre prêteur"
        : value;

  return (
    <div ref={rootRef} className="relative" data-testid="liability-lender">
      <button
        type="button"
        className="input flex w-full items-center justify-between gap-2 text-left text-sm"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={cn("min-w-0 truncate", !value && "text-slate-400")}>
          {display}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-slate-400 transition",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
          <div className="border-b border-[var(--border)] px-2 py-1.5">
            <input
              autoFocus
              className="input !border-0 !bg-transparent !px-1 !py-1 !shadow-none"
              placeholder="Rechercher (BNP, Crédit Agricole…)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1" role="listbox">
            {filtered.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === m}
                  className={cn(
                    "flex w-full px-3 py-1.5 text-left text-sm transition hover:bg-[var(--muted)]",
                    value === m &&
                      "bg-teal-500/10 font-medium text-teal-800 dark:text-teal-200"
                  )}
                  onClick={() => {
                    if (m === "Autre") {
                      setCustomMode(true);
                      onChange("");
                    } else {
                      setCustomMode(false);
                      onChange(m);
                    }
                    setOpen(false);
                  }}
                >
                  {m === "Autre" ? "Autre prêteur (saisie libre)…" : m}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {customMode && (
        <input
          className="input mt-2"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nom exact du prêteur"
          data-testid="liability-lender-other"
        />
      )}
    </div>
  );
}

const emptyDefaults = (): LiabilityForm => ({
  name: "",
  bankName: "",
  initialAmount: "",
  remainingAmount: "",
  currency: "EUR",
  interestRate: "",
  monthlyPayment: "",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  paymentDay: 5,
  notes: "",
});

export function LiabilityCreateForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: LiabilityForm) => void;
}) {
  const [kind, setKind] = useState<LiabilityKind>("MORTGAGE");
  /** true = capital restant = montant initial (crédit neuf) */
  const [remainingLocked, setRemainingLocked] = useState(true);
  const [endDateManual, setEndDateManual] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const form = useForm<LiabilityForm>({
    resolver: zodResolver(liabilitySchema) as never,
    defaultValues: emptyDefaults(),
  });

  const bankName = form.watch("bankName") || "";
  const paymentDay = form.watch("paymentDay");
  const startDate = form.watch("startDate") || "";
  const endDate = form.watch("endDate") || "";
  const initialAmount = form.watch("initialAmount") || "";
  const remainingAmount = form.watch("remainingAmount") || "";
  const monthlyPayment = form.watch("monthlyPayment") || "";
  const interestRate = form.watch("interestRate") || "";
  const currency = form.watch("currency") || "EUR";
  const name = form.watch("name") || "";

  const kindMeta = LIABILITY_KINDS.find((k) => k.id === kind)!;

  // Mirror initial → remaining when locked
  useEffect(() => {
    if (!remainingLocked) return;
    if (initialAmount) {
      form.setValue("remainingAmount", initialAmount, { shouldDirty: false });
    } else {
      form.setValue("remainingAmount", "", { shouldDirty: false });
    }
  }, [initialAmount, remainingLocked, form]);

  const principalForEstimate =
    remainingAmount || initialAmount || "0";

  const estimatedMonths = useMemo(
    () =>
      estimateRemainingMonths(
        principalForEstimate,
        monthlyPayment || "0",
        interestRate || "0"
      ),
    [principalForEstimate, monthlyPayment, interestRate]
  );

  const estimatedEndIso = useMemo(() => {
    if (!estimatedMonths) return null;
    const from = startDate
      ? new Date(`${startDate}T12:00:00`)
      : new Date();
    if (Number.isNaN(from.getTime())) return null;
    const d = projectEndDate(
      principalForEstimate,
      monthlyPayment || "0",
      interestRate || "0",
      from
    );
    if (!d) return null;
    return d.toISOString().slice(0, 10);
  }, [
    estimatedMonths,
    principalForEstimate,
    monthlyPayment,
    interestRate,
    startDate,
  ]);

  const estimatedInterest = useMemo(() => {
    if (!monthlyPayment || !principalForEstimate) return null;
    const n = Number(principalForEstimate);
    const m = Number(monthlyPayment);
    if (!(n > 0) || !(m > 0)) return null;
    return estimateRemainingInterest(
      principalForEstimate,
      monthlyPayment,
      interestRate || "0"
    );
  }, [principalForEstimate, monthlyPayment, interestRate]);

  // Soft-suggest end date when not manually set
  useEffect(() => {
    if (endDateManual) return;
    if (estimatedEndIso) {
      form.setValue("endDate", estimatedEndIso, { shouldDirty: false });
    }
  }, [estimatedEndIso, endDateManual, form]);

  const alreadyStarted =
    !remainingLocked &&
    Number(remainingAmount) > 0 &&
    Number(initialAmount) > 0 &&
    Number(remainingAmount) < Number(initialAmount);

  const paidRatio =
    alreadyStarted && Number(initialAmount) > 0
      ? Math.round(
          ((Number(initialAmount) - Number(remainingAmount)) /
            Number(initialAmount)) *
            100
        )
      : null;

  function applyEstimatedEnd() {
    if (!estimatedEndIso) return;
    setEndDateManual(false);
    form.setValue("endDate", estimatedEndIso, { shouldDirty: true });
  }

  return (
    <form
      className="space-y-3.5"
      onSubmit={form.handleSubmit((v) => {
        const rem =
          remainingLocked
            ? v.initialAmount || "0"
            : v.remainingAmount || v.initialAmount || "0";
        onSubmit({
          ...v,
          initialAmount: v.initialAmount || "0",
          remainingAmount: rem,
          bankName: v.bankName || null,
          interestRate: v.interestRate || undefined,
          monthlyPayment: v.monthlyPayment || undefined,
          notes: v.notes || null,
        });
      })}
      data-testid="liability-form"
    >
      {/* Intro courte */}
      <div className="flex gap-2 rounded-lg border border-teal-500/15 bg-teal-500/[0.04] px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-300" />
        <p>
          Les champs marqués essentiels suffisent pour démarrer. Une fois le
          jour de prélèvement défini, le{" "}
          <strong>capital restant dû</strong> diminue automatiquement chaque
          mois de la mensualité (sans double comptage).
        </p>
      </div>

      {/* 1. Identification */}
      <Section
        step={1}
        title="Identification"
        hint="Type, libellé et organisme prêteur."
      >
        <div className="space-y-3">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Type de passif
            </span>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Type de passif"
            >
              {LIABILITY_KINDS.map((k) => {
                const active = kind === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setKind(k.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                      active
                        ? "bg-teal-700 text-white dark:bg-teal-500 dark:text-teal-950"
                        : "bg-transparent text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800/60"
                    )}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Intitulé du crédit">
              <input
                className="input"
                {...form.register("name")}
                placeholder={kindMeta.namePh}
                data-testid="liability-name"
                autoComplete="off"
              />
              {form.formState.errors.name && (
                <span className="mt-0.5 block text-[10px] text-red-600">
                  {form.formState.errors.name.message as string}
                </span>
              )}
            </Field>
            <Field label="Banque / prêteur">
              <LenderCombobox
                value={bankName}
                onChange={(v) =>
                  form.setValue("bankName", v, { shouldDirty: true })
                }
              />
            </Field>
          </div>
        </div>
      </Section>

      {/* 2. Montants essentiels */}
      <Section
        step={2}
        title="Montants"
        hint="Montant emprunté et capital encore dû aujourd’hui."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Montant initial emprunté">
            <input
              className="input tabular-nums"
              inputMode="decimal"
              {...form.register("initialAmount")}
              placeholder="ex. 250000"
              data-testid="liability-initial"
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Capital d’origine du contrat
            </span>
          </Field>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 px-2.5 py-2 text-[11px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="mt-0.5 accent-teal-700"
                checked={remainingLocked}
                onChange={(e) => {
                  const locked = e.target.checked;
                  setRemainingLocked(locked);
                  if (locked && initialAmount) {
                    form.setValue("remainingAmount", initialAmount, {
                      shouldDirty: true,
                    });
                  }
                }}
                data-testid="liability-remaining-locked"
              />
              <span>
                <strong>Crédit non encore amorti</strong>
                <span className="block text-slate-400">
                  Capital restant = montant initial. Décochez si le crédit est
                  déjà en cours.
                </span>
              </span>
            </label>

            {!remainingLocked && (
              <Field
                label={
                  <span className="inline-flex items-center gap-1">
                    Capital restant dû
                    <FinanceTip term="Capital restant dû" />
                  </span>
                }
              >
                <input
                  className="input tabular-nums"
                  inputMode="decimal"
                  {...form.register("remainingAmount")}
                  placeholder={initialAmount || "ex. 180000"}
                  data-testid="liability-remaining"
                />
                {alreadyStarted && paidRatio != null && (
                  <span className="mt-1 block text-[10px] text-emerald-700 dark:text-emerald-400">
                    ≈ {paidRatio} % du capital initial déjà remboursé
                  </span>
                )}
              </Field>
            )}

            {remainingLocked && initialAmount && (
              <p className="text-[11px] text-slate-500">
                Capital suivi :{" "}
                <strong className="tabular-nums">
                  {formatCurrency(initialAmount, currency)}
                </strong>
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* 3. Conditions */}
      <Section
        step={3}
        title="Conditions de remboursement"
        hint="Mensualité et jour de prélèvement — base du suivi automatique."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                Mensualité
                <FinanceTip term="Mensualité" />
              </span>
            }
          >
            <input
              className="input tabular-nums"
              inputMode="decimal"
              {...form.register("monthlyPayment")}
              placeholder="ex. 1250"
              data-testid="liability-monthly"
            />
            <span className="mt-1 block text-[10px] text-slate-400">
              Montant prélevé chaque mois sur le capital restant
            </span>
          </Field>

          <Field label="Jour de prélèvement">
            <select
              className="input"
              value={
                paymentDay == null || !Number.isFinite(Number(paymentDay))
                  ? ""
                  : String(paymentDay)
              }
              onChange={(e) => {
                const v = e.target.value;
                form.setValue("paymentDay", v === "" ? null : Number(v), {
                  shouldDirty: true,
                });
              }}
              data-testid="liability-payment-day"
            >
              <option value="">Sans prélèvement auto</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Le {d} de chaque mois
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-slate-400">
              Recommandé pour activer le décrément automatique
            </span>
          </Field>
        </div>
      </Section>

      {/* 4. Calendrier */}
      <Section
        step={4}
        title="Calendrier"
        hint="Début du contrat et fin estimée (calculée si possible)."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField
            label="Date de début"
            hint="Premier mois où un prélèvement peut s’appliquer"
            data-testid="liability-start"
            {...form.register("startDate")}
          />
          <div>
            <DateField
              label="Date de fin estimée"
              optional
              hint={
                endDateManual
                  ? "Saisie manuelle — cliquez « Utiliser l’estimation » pour recalculer"
                  : estimatedEndIso
                    ? "Suggérée à partir du capital, de la mensualité et du taux"
                    : "Optionnel — se calcule si mensualité et capital sont renseignés"
              }
              data-testid="liability-end"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDateManual(true);
                form.setValue("endDate", e.target.value, { shouldDirty: true });
              }}
            />
            {estimatedEndIso && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-slate-400">
                  Estimation : {formatDate(estimatedEndIso)}
                  {estimatedMonths != null
                    ? ` · ${estimatedMonths} mois`
                    : ""}
                </span>
                {(endDateManual || endDate !== estimatedEndIso) && (
                  <button
                    type="button"
                    className="text-[10px] font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                    onClick={applyEstimatedEnd}
                  >
                    Utiliser l’estimation
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Live summary */}
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/70 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
          <p className="font-medium text-slate-700 dark:text-slate-200">
            Récapitulatif du suivi
          </p>
          <ul className="mt-1.5 space-y-1 text-slate-500 dark:text-slate-400">
            <li>
              {paymentDay
                ? `Prélèvement le ${paymentDay} de chaque mois`
                : "Pas de jour de prélèvement — décrément auto désactivé"}
              {startDate ? ` · dès le ${formatDate(startDate)}` : ""}
              {endDate ? ` · jusqu’au ${formatDate(endDate)}` : ""}.
            </li>
            {(remainingAmount || initialAmount) && (
              <li>
                Capital suivi :{" "}
                <strong className="tabular-nums text-slate-700 dark:text-slate-200">
                  {formatCurrency(
                    remainingAmount || initialAmount,
                    currency
                  )}
                </strong>
                {monthlyPayment
                  ? ` · mensualité ${formatCurrency(monthlyPayment, currency)}`
                  : ""}
              </li>
            )}
            {estimatedMonths != null && (
              <li>
                Durée résiduelle estimée :{" "}
                <strong>{estimatedMonths} mois</strong>
                {estimatedInterest != null &&
                Number(estimatedInterest) > 0 ? (
                  <>
                    {" "}
                    · intérêts restants approx.{" "}
                    {formatCurrency(estimatedInterest, currency)}
                  </>
                ) : null}
              </li>
            )}
            {estimatedMonths == null &&
              Number(principalForEstimate) > 0 &&
              Number(monthlyPayment) > 0 &&
              Number(interestRate) > 0 && (
                <li className="text-amber-700 dark:text-amber-300">
                  La mensualité ne couvre peut‑être pas les intérêts — durée non
                  estimable.
                </li>
              )}
          </ul>
        </div>
      </Section>

      {/* 5. Compléments repliables */}
      <div className="rounded-xl border border-[var(--border)]">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-[var(--muted)]/30"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          <span>
            Compléments
            <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">
              taux, devise, notes
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-slate-400 transition",
              showAdvanced && "rotate-180"
            )}
          />
        </button>
        {showAdvanced && (
          <div className="space-y-3 border-t border-[var(--border)] px-3.5 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Taux d’intérêt annuel (%)">
                <input
                  className="input tabular-nums"
                  inputMode="decimal"
                  {...form.register("interestRate")}
                  placeholder="ex. 3,45"
                />
                <span className="mt-1 block text-[10px] text-slate-400">
                  Améliore l’estimation de durée et d’intérêts restants
                </span>
              </Field>
              <Field label="Devise">
                <select className="input" {...form.register("currency")}>
                  {["EUR", "USD", "CHF", "GBP"].map((c) => (
                    <option key={c} value={c}>
                      {currencyLabel(c)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <input
                    className="input"
                    {...form.register("notes")}
                    placeholder="Réf. contrat, assurance emprunteur, taux variable…"
                  />
                </Field>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <FormActions className="!justify-between">
        <p className="mr-auto max-w-xs text-[10px] text-slate-400">
          {name.trim().length < 2
            ? "Indiquez un intitulé (2 caractères min.) pour valider."
            : "Vous pourrez ajuster le capital et les avenants depuis le tableau."}
        </p>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button
          type="submit"
          disabled={pending || name.trim().length < 2}
          data-testid="liability-submit"
        >
          {pending ? "…" : "Créer le crédit"}
        </Button>
      </FormActions>
    </form>
  );
}
