"use client";

import { cn } from "@/app/lib/utils";

/**
 * Filtres rapides par famille de type (taxonomie métier).
 * Les ids stables servent aux tests et au state local.
 */
export type TxTypeFilterId =
  | "all"
  | "buy"
  | "sell"
  | "dividend"
  | "fees"
  | "cash"
  | "transfer"
  | "split";

export const TX_TYPE_FILTERS: Array<{
  id: TxTypeFilterId;
  label: string;
  /** Transaction.type values matched ; null = tout */
  types: string[] | null;
  emptyHint: string;
  /** Accent discret (selected) — pas une navigation concurrente */
  accent: string;
}> = [
  {
    id: "all",
    label: "Tout",
    types: null,
    emptyHint: "Aucune transaction",
    accent: "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900",
  },
  {
    id: "buy",
    label: "Achats",
    types: ["ACHAT"],
    emptyHint: "Aucun achat enregistré",
    accent: "bg-emerald-700 text-white dark:bg-emerald-500 dark:text-emerald-950",
  },
  {
    id: "sell",
    label: "Ventes",
    types: ["VENTE"],
    emptyHint: "Aucune vente enregistrée",
    accent: "bg-sky-700 text-white dark:bg-sky-400 dark:text-sky-950",
  },
  {
    id: "dividend",
    label: "Revenus",
    types: ["DIVIDENDE", "COUPON", "LOYER", "INTERET"],
    emptyHint: "Aucun revenu (dividende, coupon, loyer, intérêts)",
    accent: "bg-amber-600 text-white dark:bg-amber-400 dark:text-amber-950",
  },
  {
    id: "fees",
    label: "Frais",
    types: ["FRAIS"],
    emptyHint: "Aucun frais enregistré",
    accent: "bg-rose-700 text-white dark:bg-rose-500 dark:text-rose-950",
  },
  {
    id: "cash",
    label: "Cash",
    types: ["APPORT", "RETRAIT"],
    emptyHint: "Aucun apport ni retrait",
    accent: "bg-violet-700 text-white dark:bg-violet-400 dark:text-violet-950",
  },
  {
    id: "transfer",
    label: "Transferts",
    types: ["TRANSFERT_CASH", "TRANSFERT_TITRE"],
    emptyHint: "Aucun transfert enregistré",
    accent: "bg-indigo-700 text-white dark:bg-indigo-400 dark:text-indigo-950",
  },
  {
    id: "split",
    label: "Splits",
    types: ["SPLIT"],
    emptyHint: "Aucun split enregistré",
    accent: "bg-teal-700 text-white dark:bg-teal-400 dark:text-teal-950",
  },
];

export function matchesTxTypeFilter(
  txType: string,
  filterId: TxTypeFilterId
): boolean {
  const f = TX_TYPE_FILTERS.find((x) => x.id === filterId);
  if (!f || !f.types) return true;
  return f.types.includes(txType);
}

export function txTypeFilterEmptyHint(filterId: TxTypeFilterId): string {
  return (
    TX_TYPE_FILTERS.find((x) => x.id === filterId)?.emptyHint ??
    "Aucune transaction"
  );
}

/** Classes de pastille pour le type dans le tableau (dense, scannable). */
export function txTypeChipClass(txType: string): string {
  switch (txType) {
    case "ACHAT":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800/60";
    case "VENTE":
      return "bg-sky-50 text-sky-800 ring-sky-200/80 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-800/60";
    case "DIVIDENDE":
    case "COUPON":
    case "LOYER":
    case "INTERET":
      return "bg-amber-50 text-amber-900 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/50";
    case "FRAIS":
      return "bg-rose-50 text-rose-800 ring-rose-200/80 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800/50";
    case "APPORT":
    case "RETRAIT":
      return "bg-violet-50 text-violet-800 ring-violet-200/80 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800/50";
    case "TRANSFERT_CASH":
    case "TRANSFERT_TITRE":
      return "bg-indigo-50 text-indigo-800 ring-indigo-200/80 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800/50";
    case "SPLIT":
      return "bg-teal-50 text-teal-800 ring-teal-200/80 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-800/50";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700";
  }
}

export function TxTypeFilters({
  value,
  onChange,
  className,
  counts,
  /** Compact = pas de libellé « Type » (modales étroites) */
  compact = false,
}: {
  value: TxTypeFilterId;
  onChange: (id: TxTypeFilterId) => void;
  className?: string;
  counts?: Partial<Record<TxTypeFilterId, number>>;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5",
        className
      )}
      role="group"
      aria-label="Filtrer par type de transaction"
      data-testid="tx-type-filters"
    >
      {!compact && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Type
        </span>
      )}
      {TX_TYPE_FILTERS.map((f) => {
        const active = value === f.id;
        const count = counts?.[f.id];
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={active}
            data-testid={`tx-filter-${f.id}`}
            onClick={() => onChange(f.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              active
                ? f.accent
                : "bg-transparent text-slate-600 ring-1 ring-inset ring-slate-200/90 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
            )}
          >
            {f.label}
            {typeof count === "number" && (
              <span
                className={cn(
                  "tabular-nums text-[10px]",
                  active ? "opacity-80" : "text-slate-400 dark:text-slate-500"
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
