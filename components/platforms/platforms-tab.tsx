"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { TableFilters, matchesSearchQuery } from "@/components/ui/table-filters";
import { PLATFORM_TYPES } from "@/app/lib/constants";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { PlatformRow } from "@/app/lib/types/ui";

export function PlatformsTab({
  platforms,
  baseCurrency,
  onAdd,
  onDelete,
  deletePendingId,
}: {
  platforms: PlatformRow[];
  baseCurrency: string;
  onAdd: () => void;
  onDelete?: (platform: PlatformRow) => void;
  deletePendingId?: string | null;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const typesPresent = useMemo(() => {
    const set = new Set(platforms.map((p) => p.type));
    return [...set].sort((a, b) => {
      const la = PLATFORM_TYPES[a as keyof typeof PLATFORM_TYPES] || a;
      const lb = PLATFORM_TYPES[b as keyof typeof PLATFORM_TYPES] || b;
      return la.localeCompare(lb, "fr");
    });
  }, [platforms]);

  const sorted = useMemo(() => {
    const list =
      typeFilter === "ALL"
        ? [...platforms]
        : platforms.filter((p) => p.type === typeFilter);
    const searched = list.filter((p) =>
      matchesSearchQuery(debouncedSearch, [
        p.name,
        p.type,
        PLATFORM_TYPES[p.type as keyof typeof PLATFORM_TYPES],
        p.walletAddress,
      ])
    );
    return searched.sort((a, b) => {
      const ta = PLATFORM_TYPES[a.type as keyof typeof PLATFORM_TYPES] || a.type;
      const tb = PLATFORM_TYPES[b.type as keyof typeof PLATFORM_TYPES] || b.type;
      const c = ta.localeCompare(tb, "fr");
      if (c !== 0) return c;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
  }, [platforms, typeFilter, debouncedSearch]);

  function handleDelete(p: PlatformRow) {
    if (!onDelete) return;
    const ok = window.confirm(
      `Êtes-vous sûr de vouloir supprimer ${p.name} ? Cette action est irréversible`
    );
    if (ok) onDelete(p);
  }

  const typeLabel = (type: string) =>
    PLATFORM_TYPES[type as keyof typeof PLATFORM_TYPES] || type;

  return (
    <section className="space-y-4">
      <div
        className={cn(
          "flex min-w-0 w-full flex-col gap-3",
          "sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
        )}
      >
        <div
          className={cn(
            "flex min-w-0 w-full flex-col gap-2",
            "sm:w-auto sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
          )}
        >
          <TableFilters
            className="min-w-0 w-full sm:w-auto sm:flex-1"
            search={search}
            onSearchChange={setSearch}
            showAccountFilter={false}
            placeholder="Nom de plateforme…"
          />
          <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-zinc-500 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:whitespace-nowrap">
            <span className="shrink-0 font-medium">Type</span>
            <select
              className="input !w-full min-w-0 !py-1.5 text-sm sm:!w-auto sm:min-w-[10rem]"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="platforms-type-filter"
            >
              <option value="ALL">Tous les types ({platforms.length})</option>
              {typesPresent.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)} (
                  {platforms.filter((p) => p.type === t).length})
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button size="sm" onClick={onAdd} className="w-full shrink-0 sm:w-auto">
          <Plus className="h-3.5 w-3.5" /> Plateforme
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center text-sm text-zinc-500">
          Aucune plateforme
          {typeFilter !== "ALL" ? " pour ce filtre" : ""} — ajoutez-en via le bouton
          ci-dessus (les presets ne s&apos;ajoutent pas tout seuls).
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => (
            <div key={p.id} className="card p-4" data-testid={`platform-${p.name}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <PlatformLogo src={p.logoUrl} name={p.name} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
                        )}
                      >
                        {typeLabel(p.type)}
                      </span>
                      {p.subtype && (
                        <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {p.subtype}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {onDelete && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
                    title={`Supprimer ${p.name}`}
                    data-testid={`delete-platform-${p.id}`}
                    disabled={deletePendingId === p.id}
                    onClick={() => handleDelete(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </Button>
                )}
              </div>
              {p.walletAddress && (
                <div
                  className="mt-2 truncate text-[10px] text-slate-400"
                  title={p.walletAddress}
                >
                  {p.walletAddress}
                </div>
              )}
              <div className="mt-3 text-xs text-slate-500">
                Solde banque (apports − retraits)
              </div>
              <div className="kpi-value text-xl font-semibold text-teal-700 dark:text-teal-300">
                {formatCurrency(p.cashBase || p.cashEur, baseCurrency)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
