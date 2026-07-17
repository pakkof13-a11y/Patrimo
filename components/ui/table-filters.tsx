"use client";

import { Search, X } from "lucide-react";
import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";
import { cn } from "@/app/lib/utils";

export type TableFiltersValue = {
  search: string;
  accountType: string;
};

/**
 * Filtres de table génériques : enveloppe fiscale + recherche.
 * L’ordre par défaut est filtre → recherche (journal métier).
 * `searchFirst` inverse pour les pages type Positions.
 */
export function TableFilters({
  search,
  onSearchChange,
  accountType,
  onAccountTypeChange,
  placeholder = "Nom, ticker, ISIN…",
  showAccountFilter = true,
  searchFirst = false,
  accountOptions,
  /** Libellé du filtre ACCOUNT_TYPES (CTO, PEA…) — métier = « Enveloppe » */
  accountFilterLabel = "Enveloppe",
  className,
  rightSlot,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  accountType?: string;
  onAccountTypeChange?: (v: string) => void;
  placeholder?: string;
  showAccountFilter?: boolean;
  /** true = recherche avant le filtre enveloppe (page Positions) */
  searchFirst?: boolean;
  /** Override default ACCOUNT_TYPES keys */
  accountOptions?: { value: string; label: string }[];
  accountFilterLabel?: string;
  className?: string;
  rightSlot?: React.ReactNode;
}) {
  const options =
    accountOptions ??
    (Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => ({
      value: k,
      label: ACCOUNT_TYPES[k],
    }));

  const accountSelect =
    showAccountFilter && onAccountTypeChange ? (
      <label className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
        <span className="shrink-0 font-medium text-[var(--muted-foreground)]">
          {accountFilterLabel}
        </span>
        <select
          className="input !w-full min-w-0 max-w-full !py-1.5 text-sm sm:!w-auto sm:min-w-[10rem]"
          value={accountType ?? ""}
          onChange={(e) => onAccountTypeChange(e.target.value)}
          data-testid="table-account-filter"
          aria-label={`Filtrer par ${accountFilterLabel.toLowerCase()}`}
          title={`${accountFilterLabel} fiscale / de détention (CTO, PEA…)`}
        >
          <option value="">Toutes</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  const searchField = (
    <div className="relative min-w-0 w-full sm:min-w-[12rem] sm:max-w-md sm:flex-1">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={placeholder}
        className="input !w-full min-w-0 !py-1.5 !pl-9 !pr-9 text-sm"
        data-testid="table-search"
        aria-label="Rechercher"
      />
      {search && (
        <button
          type="button"
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          onClick={() => onSearchChange("")}
          aria-label="Effacer la recherche"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "flex min-w-0 w-full flex-col gap-2",
        "sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5",
        className
      )}
      data-testid="table-filters"
    >
      {searchFirst ? (
        <>
          {searchField}
          {accountSelect}
        </>
      ) : (
        <>
          {accountSelect}
          {searchField}
        </>
      )}
      {rightSlot}
    </div>
  );
}

/** Match free-text against name / ticker / ISIN (and extra haystack fields). */
export function matchesSearchQuery(
  query: string,
  fields: Array<string | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f && String(f).toLowerCase().includes(q));
}
