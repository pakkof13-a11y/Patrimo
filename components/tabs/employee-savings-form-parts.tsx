"use client";

/**
 * Sous-composants formulaire ES — extraits du tab pour réduire le monolithe.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { ModuleGuidedEmpty } from "@/components/ui/module-shell";
import { cn } from "@/app/lib/utils";
import {
  COMMON_MANAGERS,
  PLAN_TYPE_LABELS,
  PLAN_TYPE_SHORT,
  type EmployeeSavingsLineDto,
  type EmployeeSavingsPlanType,
} from "@/app/lib/employee-savings/types";
import { PEE_LOCK_YEARS } from "@/app/lib/employee-savings/logic";

export type EsFormState = {
  planType: string;
  manager: string;
  fundName: string;
  isin: string;
  units: string;
  nav: string;
  currency: string;
  sourceType: string;
  contributionDate: string;
  unlockDate: string;
  unlockMode: string;
  notes: string;
};

export const emptyEsForm = (): EsFormState => ({
  planType: "PEE",
  manager: "Amundi",
  fundName: "",
  isin: "",
  units: "",
  nav: "",
  currency: "EUR",
  sourceType: "VOLUNTARY",
  contributionDate: "",
  unlockDate: "",
  unlockMode: "DATE",
  notes: "",
});

export function lineToEsForm(l: EmployeeSavingsLineDto): EsFormState {
  return {
    planType: l.planType,
    manager: l.manager,
    fundName: l.fundName,
    isin: l.isin || "",
    units: l.units,
    nav: l.nav,
    currency: l.currency,
    sourceType: l.sourceType,
    contributionDate: l.contributionDate || "",
    unlockDate: l.unlockDate || "",
    unlockMode: l.unlockMode,
    notes: l.notes || "",
  };
}

export function planShort(planType: string): string {
  const k = planType.toUpperCase() as EmployeeSavingsPlanType;
  return PLAN_TYPE_SHORT[k] || planType;
}

export function planFull(planType: string): string {
  const k = planType.toUpperCase() as EmployeeSavingsPlanType;
  return PLAN_TYPE_LABELS[k] || planType;
}

export function EsFormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)]/50 p-3">
      <header className="space-y-0.5">
        <h4 className="text-label">{title}</h4>
        {hint ? (
          <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">
            {hint}
          </p>
        ) : null}
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

export function EsFieldLabel({
  children,
  tip,
}: {
  children: React.ReactNode;
  tip?: string;
}) {
  return (
    <span className="mb-1 flex items-center gap-1 text-xs font-medium text-[var(--foreground)]/85">
      {children}
      {tip ? <FinanceTip term={tip} /> : null}
    </span>
  );
}

export function ManagerCombobox({
  value,
  otherValue,
  onChange,
  onOtherChange,
}: {
  value: string;
  otherValue: string;
  onChange: (v: string) => void;
  onOtherChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const display =
    value === "Autre"
      ? otherValue.trim() || "Autre (saisie libre)"
      : value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...COMMON_MANAGERS];
    return COMMON_MANAGERS.filter((m) => m.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-testid="es-manager-combobox">
      <button
        type="button"
        className="input mt-1 flex w-full items-center justify-between gap-2 text-left text-sm"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 truncate">{display}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
            <Search
              className="h-3.5 w-3.5 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
              placeholder="Rechercher un gestionnaire…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="es-manager-search"
            />
          </div>
          <ul
            className="max-h-48 overflow-y-auto py-1"
            role="listbox"
            aria-label="Gestionnaires"
          >
            {filtered.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === m}
                  className={cn(
                    "flex w-full px-3 py-1.5 text-left text-sm transition hover:bg-[var(--muted)]",
                    value === m &&
                      "bg-[var(--primary-soft)] font-medium text-[var(--primary)]"
                  )}
                  onClick={() => {
                    onChange(m);
                    if (m !== "Autre") onOtherChange("");
                    setOpen(false);
                  }}
                >
                  {m}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                Aucun résultat — choisissez « Autre » pour une saisie libre.
              </li>
            )}
          </ul>
        </div>
      )}
      {value === "Autre" && (
        <input
          className="input mt-2"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Nom exact du gestionnaire"
          data-testid="es-manager-other"
        />
      )}
    </div>
  );
}

export function EsChartEmptyState({
  title,
  description,
  onAdd,
}: {
  title: string;
  description: string;
  onAdd: () => void;
}) {
  return (
    <ModuleGuidedEmpty
      compact
      title={title}
      description={description}
      primaryLabel="Ajouter une position"
      onPrimary={onAdd}
      className="min-h-[12rem] py-6"
    />
  );
}

export function UnlockHint({
  planType,
  unlockMode,
}: {
  planType: string;
  unlockMode: string;
}) {
  const plan = planType.toUpperCase();
  if (unlockMode === "RETIREMENT") {
    return (
      <p className="mt-1 text-[11px] leading-snug text-amber-800/90 dark:text-amber-200/90">
        Horizon <strong>retraite</strong>
        {plan === "PER" || plan === "PERCO"
          ? " — défaut pour PER / PERCO."
          : "."}{" "}
        La ligne reste bloquée jusqu’à la retraite (sauf cas anticipés saisis
        en mode « Date fixe »).
      </p>
    );
  }
  if (plan === "PEE") {
    return (
      <p className="mt-1 text-[11px] leading-snug text-[var(--muted-foreground)]">
        Mode <strong>date fixe</strong> : indiquez une date de déblocage, ou
        laissez vide avec une date de versement pour calculer automatiquement{" "}
        <strong>+{PEE_LOCK_YEARS} ans</strong> (règle PEE).
      </p>
    );
  }
  return (
    <p className="mt-1 text-[11px] leading-snug text-[var(--muted-foreground)]">
      Mode <strong>date fixe</strong> : utile pour un déblocage anticipé ou une
      date contractuelle connue. Sans date, la ligne reste marquée bloquée.
    </p>
  );
}
