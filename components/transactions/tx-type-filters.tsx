"use client";

import { cn } from "@/app/lib/utils";

export type TxTypeFilterId = "all" | "buy" | "sell" | "dividend" | "fees";

export const TX_TYPE_FILTERS: Array<{
  id: TxTypeFilterId;
  label: string;
  /** Transaction.type values matched */
  types: string[] | null;
  emptyHint: string;
  activeClass: string;
  idleClass: string;
}> = [
  {
    id: "all",
    label: "Tout",
    types: null,
    emptyHint: "Aucune transaction",
    activeClass:
      "bg-slate-800 text-white ring-1 ring-slate-600 dark:bg-slate-200 dark:text-slate-900",
    idleClass:
      "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
  },
  {
    id: "buy",
    label: "Achats",
    types: ["ACHAT"],
    emptyHint: "Aucun achat enregistré",
    activeClass:
      "bg-emerald-600 text-white ring-1 ring-emerald-500/50 dark:bg-emerald-500 dark:text-emerald-950",
    idleClass:
      "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950",
  },
  {
    id: "sell",
    label: "Ventes",
    types: ["VENTE"],
    emptyHint: "Aucune vente enregistrée",
    activeClass:
      "bg-sky-600 text-white ring-1 ring-sky-500/50 dark:bg-sky-500 dark:text-sky-950",
    idleClass:
      "bg-sky-50 text-sky-800 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-950",
  },
  {
    id: "dividend",
    label: "Dividendes",
    types: ["DIVIDENDE", "COUPON", "LOYER", "INTERET"],
    emptyHint: "Aucun dividende / revenu enregistré",
    activeClass:
      "bg-amber-500 text-amber-950 ring-1 ring-amber-400/60 dark:bg-amber-400 dark:text-amber-950",
    idleClass:
      "bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70",
  },
  {
    id: "fees",
    label: "Frais",
    types: ["FRAIS"],
    emptyHint: "Aucun frais enregistré",
    activeClass:
      "bg-rose-600 text-white ring-1 ring-rose-500/50 dark:bg-rose-500 dark:text-rose-950",
    idleClass:
      "bg-rose-50 text-rose-800 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/70",
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

export function TxTypeFilters({
  value,
  onChange,
  className,
  counts,
}: {
  value: TxTypeFilterId;
  onChange: (id: TxTypeFilterId) => void;
  className?: string;
  /** Optional counts per filter id for badges */
  counts?: Partial<Record<TxTypeFilterId, number>>;
}) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="tablist"
      aria-label="Filtrer par type de transaction"
      data-testid="tx-type-filters"
    >
      {TX_TYPE_FILTERS.map((f) => {
        const active = value === f.id;
        const count = counts?.[f.id];
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`tx-filter-${f.id}`}
            onClick={() => onChange(f.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
              active ? f.activeClass : f.idleClass
            )}
          >
            {f.label}
            {typeof count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums",
                  active
                    ? "bg-black/15 dark:bg-white/25"
                    : "bg-black/5 dark:bg-white/10"
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
