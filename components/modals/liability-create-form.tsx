"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import {
  FormWizard,
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
  type WizardStep,
} from "@/components/ui/form-wizard";
import { liabilitySchema, type LiabilityForm } from "@/app/lib/schemas";
import { LIABILITY_LENDER_OPTIONS } from "@/app/lib/constants";
import { currencyLabel } from "@/app/lib/money/currencies";
import {
  estimateRemainingInterest,
  estimateRemainingMonths,
  projectEndDate,
} from "@/app/lib/liabilities/amortization";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";

const DRAFT_KEY = "patrimo.draft.liability.v1";

const WIZARD_STEPS: WizardStep[] = [
  {
    id: "general",
    label: "Informations générales",
    description: "Type, intitulé et prêteur",
  },
  {
    id: "finance",
    label: "Conditions financières",
    description: "Capital, mensualité, taux et devise",
  },
  {
    id: "schedule",
    label: "Échéancier",
    description: "Jour de prélèvement et calendrier",
  },
  {
    id: "recap",
    label: "Récapitulatif",
    description: "Vérification avant création",
  },
];

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
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<LiabilityKind>("MORTGAGE");
  /** true = capital restant = montant initial (crédit neuf) */
  const [remainingLocked, setRemainingLocked] = useState(true);
  const [endDateManual, setEndDateManual] = useState(false);

  const form = useForm<LiabilityForm>({
    resolver: zodResolver(liabilitySchema) as never,
    defaultValues: emptyDefaults(),
    mode: "onBlur",
  });

  // Restaurer brouillon
  useEffect(() => {
    const draft = loadWizardDraft<{
      values?: LiabilityForm;
      kind?: LiabilityKind;
      remainingLocked?: boolean;
      step?: number;
    }>(DRAFT_KEY);
    if (!draft?.values) return;
    form.reset({ ...emptyDefaults(), ...draft.values });
    if (draft.kind) setKind(draft.kind);
    if (typeof draft.remainingLocked === "boolean")
      setRemainingLocked(draft.remainingLocked);
    if (typeof draft.step === "number")
      setStep(Math.min(WIZARD_STEPS.length - 1, Math.max(0, draft.step)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

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

  async function validateStep(index: number): Promise<boolean> {
    if (index === 0) {
      const ok = await form.trigger("name");
      if (!ok || name.trim().length < 2) {
        toast.error("Indiquez un intitulé de crédit (2 caractères min.)");
        return false;
      }
      return true;
    }
    if (index === 1) {
      const ok = await form.trigger(["initialAmount", "remainingAmount"]);
      const init = Number(String(initialAmount).replace(",", "."));
      if (!ok || !(init > 0)) {
        toast.error("Montant initial emprunté requis");
        return false;
      }
      return true;
    }
    // schedule + recap : pas de blocage dur
    return true;
  }

  function saveDraft() {
    saveWizardDraft(DRAFT_KEY, {
      values: form.getValues(),
      kind,
      remainingLocked,
      step,
    });
    toast.success("Brouillon enregistré sur cet appareil");
  }

  function submitFinal() {
    void form.handleSubmit((v) => {
      const rem = remainingLocked
        ? v.initialAmount || "0"
        : v.remainingAmount || v.initialAmount || "0";
      clearWizardDraft(DRAFT_KEY);
      onSubmit({
        ...v,
        initialAmount: v.initialAmount || "0",
        remainingAmount: rem,
        bankName: v.bankName || null,
        interestRate: v.interestRate || undefined,
        monthlyPayment: v.monthlyPayment || undefined,
        notes: v.notes || null,
      });
    })();
  }

  return (
    <div data-testid="liability-form">
      <div className="mb-3 flex gap-2 rounded-lg border border-teal-500/15 bg-teal-500/[0.04] px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-300" />
        <p>
          Assistant en {WIZARD_STEPS.length} étapes. Une fois le jour de
          prélèvement défini, le <strong>capital restant dû</strong> diminue
          automatiquement chaque mois.
        </p>
      </div>

      <FormWizard
        steps={WIZARD_STEPS}
        current={step}
        onStepChange={setStep}
        onValidateStep={validateStep}
        onSaveDraft={saveDraft}
        onCancel={onCancel}
        onSubmit={submitFinal}
        submitLabel="Créer le crédit"
        submitDisabled={name.trim().length < 2}
        submitPending={pending}
        testId="liability-wizard"
      >
        {step === 0 && (
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
              <Field label="Intitulé du crédit" htmlFor="liability-name">
                <input
                  id="liability-name"
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
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Montant initial emprunté">
                <input
                  className="input tabular-nums"
                  inputMode="decimal"
                  {...form.register("initialAmount")}
                  placeholder="ex. 250000"
                  data-testid="liability-initial"
                />
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
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 px-2.5 py-2 text-[11px]">
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
                  Capital restant = montant initial
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
                  data-testid="liability-remaining"
                />
                {alreadyStarted && paidRatio != null && (
                  <span className="mt-1 block text-[10px] text-emerald-700 dark:text-emerald-400">
                    ≈ {paidRatio} % déjà remboursé
                  </span>
                )}
              </Field>
            )}
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
              </Field>
              <Field label="Taux d’intérêt annuel (%)">
                <input
                  className="input tabular-nums"
                  inputMode="decimal"
                  {...form.register("interestRate")}
                  placeholder="ex. 3,45"
                />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
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
              </Field>
              <DateField
                label="Date de début"
                data-testid="liability-start"
                {...form.register("startDate")}
              />
              <div className="sm:col-span-2">
                <DateField
                  label="Date de fin estimée"
                  optional
                  data-testid="liability-end"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => {
                    setEndDateManual(true);
                    form.setValue("endDate", e.target.value, {
                      shouldDirty: true,
                    });
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
                    <button
                      type="button"
                      className="text-[10px] font-medium text-teal-700 underline dark:text-teal-300"
                      onClick={applyEstimatedEnd}
                    >
                      Utiliser l’estimation
                    </button>
                  </div>
                )}
              </div>
            </div>
            <Field label="Notes">
              <input
                className="input"
                {...form.register("notes")}
                placeholder="Réf. contrat, assurance emprunteur…"
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3" data-testid="liability-recap">
            <p className="text-[12px] font-medium text-[var(--foreground)]">
              Vérifiez avant de créer le crédit
            </p>
            <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
              {(
                [
                  ["Type", kindMeta.label],
                  ["Intitulé", name || "—"],
                  ["Prêteur", bankName || "—"],
                  [
                    "Capital initial",
                    initialAmount
                      ? formatCurrency(initialAmount, currency)
                      : "—",
                  ],
                  [
                    "Capital restant",
                    formatCurrency(
                      remainingAmount || initialAmount || "0",
                      currency
                    ),
                  ],
                  [
                    "Mensualité",
                    monthlyPayment
                      ? formatCurrency(monthlyPayment, currency)
                      : "—",
                  ],
                  [
                    "Taux",
                    interestRate ? `${interestRate} %` : "—",
                  ],
                  [
                    "Prélèvement",
                    paymentDay ? `Le ${paymentDay}` : "Manuel",
                  ],
                  [
                    "Début",
                    startDate ? formatDate(startDate) : "—",
                  ],
                  ["Fin estimée", endDate ? formatDate(endDate) : "—"],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-2.5 py-2"
                >
                  <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    {k}
                  </dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {estimatedMonths != null && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Durée résiduelle estimée : <strong>{estimatedMonths} mois</strong>
                {estimatedInterest != null && Number(estimatedInterest) > 0
                  ? ` · intérêts approx. ${formatCurrency(estimatedInterest, currency)}`
                  : ""}
              </p>
            )}
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Cliquez une étape dans la barre pour corriger. Puis confirmez.
            </p>
          </div>
        )}
      </FormWizard>
    </div>
  );
}
