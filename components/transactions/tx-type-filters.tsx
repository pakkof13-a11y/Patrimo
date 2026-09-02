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
  | "reward"
  | "airdrop"
  | "dividend"
  | "fees"
  | "cash"
  | "transfer"
  | "split"
  | "works";

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
    accent: "bg-stone-700 text-white dark:bg-stone-400 dark:text-stone-950",
  },
  {
    id: "reward",
    label: "Rewards",
    // Distinct de "airdrop" (voir plus bas) : un airdrop ne doit être compté
    // que dans un seul badge, pas les deux à la fois.
    types: ["REWARD"],
    emptyHint: "Aucun staking / reward enregistré",
    accent: "bg-fuchsia-700 text-white dark:bg-fuchsia-400 dark:text-fuchsia-950",
  },
  {
    id: "airdrop",
    label: "Airdrops",
    types: ["AIRDROP"],
    emptyHint: "Aucun airdrop enregistré",
    accent:
      "bg-purple-700 text-white dark:bg-purple-400 dark:text-purple-950",
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
  {
    id: "works",
    label: "Travaux",
    types: ["TRAVAUX"],
    emptyHint: "Aucuns travaux / charges enregistrés",
    accent: "bg-orange-700 text-white dark:bg-orange-400 dark:text-orange-950",
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
      return "bg-stone-50 text-stone-800 ring-stone-200/80 dark:bg-stone-950/50 dark:text-stone-200 dark:ring-stone-800/60";
    case "REWARD":
      return "bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-200/80 dark:bg-fuchsia-950/40 dark:text-fuchsia-200 dark:ring-fuchsia-800/50";
    case "AIRDROP":
      return "bg-purple-50 text-purple-900 ring-purple-200/80 dark:bg-purple-950/40 dark:text-purple-200 dark:ring-purple-800/50";
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
      className={cn("flex min-w-0 flex-wrap items-center gap-[var(--space-2)]", className)}
      role="group"
      aria-label="Filtrer par type de transaction"
      data-testid="tx-type-filters"
    >
      {!compact && <span className="text-label shrink-0">Type</span>}

      {/*
        Barre segmentée dorée, comme partout ailleurs dans Aurea.

        Chaque groupe portait auparavant sa propre teinte à l'état actif : dix
        couleurs pour dix filtres, qui entraient en concurrence avec le seul
        code couleur qui compte dans ce module — vert pour ce qui entre, rouge
        pour ce qui sort. Le compteur reste, lui : c'est l'information utile
        avant même de cliquer.
      */}
      <div className="term-seg flex-wrap">
        {TX_TYPE_FILTERS.map((f) => {
          const active = value === f.id;
          const count = counts?.[f.id];
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              data-active={active}
              data-testid={`tx-filter-${f.id}`}
              onClick={() => onChange(f.id)}
              className="term-seg-item inline-flex items-center gap-[var(--space-2)]"
            >
              {f.label}
              {typeof count === "number" && (
                <span
                  className={cn(
                    "num text-[length:var(--text-2xs)]",
                    active
                      ? "opacity-80"
                      : "text-[var(--foreground-faint)]"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
