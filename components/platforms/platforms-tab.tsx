"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { TableFilters, matchesSearchQuery } from "@/components/ui/table-filters";
import { PLATFORM_TYPES } from "@/app/lib/constants";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { PlatformRow } from "@/app/lib/types/ui";

function typeLabel(type: string) {
  return PLATFORM_TYPES[type as keyof typeof PLATFORM_TYPES] || type;
}

/** Libellé de la métrique cash selon le type de plateforme */
function cashMetricLabel(type: string): string {
  switch (type) {
    case "BANQUE":
      return "Liquidités";
    case "COURTIER":
    case "BROKER_CFD":
    case "ASSURANCE_VIE":
      return "Cash disponible";
    case "EXCHANGE_CRYPTO":
    case "BLOCKCHAIN":
      return "Solde cash";
    default:
      return "Cash / liquidités";
  }
}

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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    if (!menuOpenId) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpenId]);

  const typesPresent = useMemo(() => {
    const set = new Set(platforms.map((p) => p.type));
    return [...set].sort((a, b) => {
      const la = typeLabel(a);
      const lb = typeLabel(b);
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
        typeLabel(p.type),
        p.walletAddress,
        p.subtype,
      ])
    );
    return searched.sort((a, b) => {
      const ta = typeLabel(a.type);
      const tb = typeLabel(b.type);
      const c = ta.localeCompare(tb, "fr");
      if (c !== 0) return c;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
  }, [platforms, typeFilter, debouncedSearch]);

  function handleDelete(p: PlatformRow) {
    if (!onDelete) return;
    setMenuOpenId(null);
    const ok = window.confirm(
      `Supprimer la plateforme « ${p.name} » ?\nLes transactions liées peuvent être impactées. Cette action est irréversible.`
    );
    if (ok) onDelete(p);
  }

  return (
    <section className="space-y-4" data-testid="platforms-tab">
      <header className="flex flex-wrap items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="text-title">Plateformes</h2>
          <p className="text-meta mt-0.5">
            Courtiers, banques, exchanges et wallets · sources de vos positions
          </p>
        </div>
        {platforms.length > 0 && (
          <span className="text-meta tabular-nums">
            {sorted.length === platforms.length
              ? `${platforms.length} source${platforms.length !== 1 ? "s" : ""}`
              : `${sorted.length} / ${platforms.length}`}
          </span>
        )}
      </header>

      {/* Toolbar : recherche prioritaire · filtre · CTA */}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2.5",
          "sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
        )}
        data-testid="platforms-toolbar"
      >
        <div
          className={cn(
            "flex min-w-0 w-full flex-col gap-2",
            "sm:w-auto sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5"
          )}
        >
          <TableFilters
            className="min-w-0 w-full sm:min-w-[14rem] sm:max-w-md sm:flex-1"
            search={search}
            onSearchChange={setSearch}
            showAccountFilter={false}
            searchFirst
            placeholder="Rechercher une plateforme…"
          />
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="shrink-0 font-medium text-[var(--muted-foreground)]">
              Type
            </span>
            <select
              className="input !w-full min-w-0 !py-1.5 text-sm sm:!w-auto sm:min-w-[11rem]"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="platforms-type-filter"
              aria-label="Filtrer par type de plateforme"
            >
              <option value="ALL">Tous ({platforms.length})</option>
              {typesPresent.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)} (
                  {platforms.filter((p) => p.type === t).length})
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button
          size="sm"
          onClick={onAdd}
          className="w-full shrink-0 sm:w-auto"
          data-testid="platforms-add-button"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvelle plateforme
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {platforms.length === 0
              ? "Aucune plateforme pour l’instant"
              : "Aucun résultat pour ces filtres"}
          </p>
          <p className="text-meta mt-1.5 mx-auto max-w-sm">
            {platforms.length === 0
              ? "Ajoutez un courtier, une banque ou un exchange pour rattacher vos positions et cash."
              : "Modifiez la recherche ou le type, ou créez une nouvelle plateforme."}
          </p>
          {platforms.length === 0 && (
            <Button size="sm" className="mt-4" onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter une plateforme
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => (
            <article
              key={p.id}
              className={cn(
                "card group relative flex flex-col p-4 transition",
                "hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-xs)]"
              )}
              data-testid={`platform-${p.name}`}
            >
              <div className="flex items-start gap-3">
                <PlatformLogo src={p.logoUrl} name={p.name} size={36} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold tracking-tight text-[var(--foreground)]">
                    {p.name}
                  </h3>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
                      )}
                    >
                      {typeLabel(p.type)}
                    </span>
                    {p.subtype && (
                      <span className="inline-flex rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                        {p.subtype}
                      </span>
                    )}
                  </div>
                </div>

                {onDelete && (
                  <div className="relative shrink-0" ref={menuOpenId === p.id ? menuRef : undefined}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-[var(--muted-foreground)] opacity-70 transition group-hover:opacity-100"
                      title="Actions"
                      aria-label={`Actions pour ${p.name}`}
                      aria-expanded={menuOpenId === p.id}
                      data-testid={`platform-menu-${p.id}`}
                      onClick={() =>
                        setMenuOpenId((id) => (id === p.id ? null : p.id))
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                    {menuOpenId === p.id && (
                      <div
                        className="absolute right-0 top-full z-20 mt-1 min-w-[9rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                          data-testid={`delete-platform-${p.id}`}
                          disabled={deletePendingId === p.id}
                          onClick={() => handleDelete(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {p.walletAddress && (
                <p
                  className="mt-2 truncate font-mono text-[10px] text-[var(--muted-foreground)]"
                  title={p.walletAddress}
                >
                  {p.walletAddress}
                </p>
              )}

              <div className="mt-auto border-t border-[var(--border)] pt-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  {cashMetricLabel(p.type)}
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-teal-800 dark:text-teal-300">
                  {formatCurrency(p.cashBase || p.cashEur, baseCurrency)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
