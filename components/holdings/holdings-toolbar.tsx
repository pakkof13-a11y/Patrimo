"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/column-picker";
import { TableFilters } from "@/components/ui/table-filters";
import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";
import { cn } from "@/app/lib/utils";
import { HOLDINGS_COLUMN_META } from "@/app/lib/display-preferences";
import {
  parseHoldingsGroupBy,
  type HoldingsGroupBy,
} from "@/app/lib/assets/categories";
import type { SavedHoldingsView } from "@/app/lib/ui-preferences";
import type { VisibilityState } from "@tanstack/react-table";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type HoldingsPageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const CTRL_LABEL =
  "flex min-w-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300";
const CTRL_SELECT = "input !w-auto min-w-0 !py-1.5 text-sm";

type ColumnPickerProps = {
  visibility: Record<string, boolean>;
  order: string[];
  onVisibilityChange: (id: string, visible: boolean) => void;
  onOrderChange: (order: string[]) => void;
  onReset: () => void;
};

export type HoldingsToolbarProps = {
  title: string;
  subtitle: string;
  sourceCount: number;
  filteredCount: number;
  loading?: boolean;
  /** Enveloppes sélectionnées (multi). Vide = aucune (liste vide). */
  envelopeFilters: AccountType[];
  onEnvelopeFiltersChange?: (v: AccountType[]) => void;
  groupBy: HoldingsGroupBy;
  onGroupByChange: (v: HoldingsGroupBy) => void;
  groupMode: boolean;
  categoryGroupCount: number;
  onExpandAllGroups?: () => void;
  onCollapseAllGroups?: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  accountFilter: string;
  onAccountFilterChange: (v: string) => void;
  /** Filtre plateforme actif (deep-link Mes plateformes) */
  platformFilterLabel?: string | null;
  onClearPlatformFilter?: () => void;
  pageSize: number;
  onPageSizeChange: (n: HoldingsPageSize) => void;
  savedViews: SavedHoldingsView[];
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedHoldingsView) => void;
  columns: ColumnPickerProps;
};

const ALL_ENVELOPES = Object.keys(ACCOUNT_TYPES) as AccountType[];

/**
 * Toolbar Positions — hiérarchie claire :
 * 1. Titre + Colonnes / aide
 * 2. Filtres primaires : recherche · enveloppe (multi-cases)
 * 3. Options d’affichage (repliables) : regroupement · vue · densité
 */
export function HoldingsToolbar({
  title,
  subtitle,
  sourceCount,
  filteredCount,
  loading,
  envelopeFilters,
  onEnvelopeFiltersChange,
  groupBy,
  onGroupByChange,
  groupMode,
  categoryGroupCount,
  onExpandAllGroups,
  onCollapseAllGroups,
  search,
  onSearchChange,
  accountFilter,
  onAccountFilterChange,
  platformFilterLabel,
  onClearPlatformFilter,
  pageSize,
  onPageSizeChange,
  savedViews,
  onSaveView,
  onApplyView,
  columns,
}: HoldingsToolbarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [prevGroupMode, setPrevGroupMode] = useState(groupMode);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const hasSource = sourceCount > 0;
  // Toujours afficher la zone filtres si le sélecteur d’enveloppes est dispo
  // (évite la disparition du bouton quand le filtre vide la liste)
  const showFilters =
    hasSource ||
    Boolean(search) ||
    Boolean(accountFilter) ||
    Boolean(platformFilterLabel) ||
    Boolean(onEnvelopeFiltersChange);

  const selectedCount = envelopeFilters.length;
  const allSelected = selectedCount === ALL_ENVELOPES.length;
  const envelopeLabel = allSelected
    ? "Toutes"
    : selectedCount === 0
      ? "Aucune"
      : selectedCount === 1
        ? ACCOUNT_TYPES[envelopeFilters[0]!]
        : `${selectedCount} enveloppes`;

  function toggleEnvelope(k: AccountType) {
    if (!onEnvelopeFiltersChange) return;
    if (envelopeFilters.includes(k)) {
      onEnvelopeFiltersChange(envelopeFilters.filter((x) => x !== k));
    } else {
      onEnvelopeFiltersChange([...envelopeFilters, k]);
    }
  }

  // Ouvrir les options si regroupement actif (contrôles groupe visibles)
  if (groupMode !== prevGroupMode) {
    setPrevGroupMode(groupMode);
    if (groupMode) setAdvancedOpen(true);
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-3 border-b border-[var(--border)] px-3 py-3.5 sm:gap-3.5 sm:px-4 sm:py-4"
      data-testid="holdings-toolbar"
    >
      {/* ── 1. Titre + affichage ── */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title break-words">{title}</h2>
            {!loading && (
              <span
                className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--muted-foreground)]"
                data-testid="holdings-count-badge"
              >
                {filteredCount === sourceCount
                  ? `${sourceCount} position${sourceCount !== 1 ? "s" : ""}`
                  : `${filteredCount} / ${sourceCount}`}
              </span>
            )}
            {groupMode && (
              <span className="rounded-full border border-teal-700/25 bg-teal-700/10 px-2 py-0.5 text-[10px] font-semibold text-teal-800 dark:text-teal-200">
                Regroupé
              </span>
            )}
          </div>
          <p className="module-intro text-meta">{subtitle}</p>
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center gap-1.5"
          data-testid="holdings-toolbar-group-c"
        >
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-slate-500"
              aria-expanded={tipsOpen}
              aria-controls="holdings-tips-panel"
              title="Astuces du tableau"
              data-testid="holdings-tips-toggle"
              onClick={() => setTipsOpen((v) => !v)}
            >
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="sr-only">Astuces</span>
            </Button>
            {tipsOpen && (
              <div
                id="holdings-tips-panel"
                role="region"
                aria-label="Astuces du tableau Positions"
                className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-[11px] leading-relaxed text-slate-600 shadow-lg dark:text-slate-300"
                data-testid="holdings-tips-panel"
              >
                <p className="mb-1.5 font-semibold text-slate-800 dark:text-slate-100">
                  Raccourcis utiles
                </p>
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                      →
                    </kbd>{" "}
                    historique rapide + actions
                  </li>
                  <li>Double-clic ligne → fiche complète</li>
                  <li>⋮⋮ en-tête → réordonner les colonnes</li>
                  <li>Bord droit en-tête → largeur (dbl-clic = auto)</li>
                </ul>
                <button
                  type="button"
                  className="mt-2 text-teal-700 underline dark:text-teal-300"
                  onClick={() => setTipsOpen(false)}
                >
                  Fermer
                </button>
              </div>
            )}
          </div>
          <ColumnPicker
            columns={HOLDINGS_COLUMN_META.map((c) => ({
              id: c.id,
              label: c.label,
              locked: c.group === "mandatory" || Boolean(c.locked),
              group: c.group,
            }))}
            visibility={columns.visibility}
            order={columns.order}
            onChange={columns.onVisibilityChange}
            onOrderChange={columns.onOrderChange}
            onReset={columns.onReset}
          />
        </div>
      </div>

      {/* ── 2. Filtres primaires ── */}
      {showFilters && (
        <div
          className={cn(
            "flex min-w-0 flex-col gap-2",
            "sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5"
          )}
          data-testid="holdings-toolbar-primary"
        >
          <TableFilters
            className="min-w-0 w-full sm:min-w-[14rem] sm:flex-1"
            search={search}
            onSearchChange={onSearchChange}
            showAccountFilter={false}
            searchFirst
            placeholder="Rechercher nom, ticker, ISIN…"
            rightSlot={
              onEnvelopeFiltersChange ? (
                <div
                  className={cn(CTRL_LABEL, "relative w-full sm:w-auto")}
                  data-testid="holdings-toolbar-group-a"
                >
                  <span className="shrink-0 font-medium text-[var(--muted-foreground)]">
                    Enveloppe
                  </span>
                  <button
                    type="button"
                    className={cn(
                      CTRL_SELECT,
                      "inline-flex w-full min-w-[10rem] items-center justify-between gap-2 sm:!w-auto"
                    )}
                    aria-expanded={envelopeOpen}
                    aria-haspopup="listbox"
                    data-testid="envelope-select"
                    aria-label="Filtrer par enveloppe"
                    onClick={() => setEnvelopeOpen((v) => !v)}
                  >
                    <span className="truncate">{envelopeLabel}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 opacity-60 transition",
                        envelopeOpen && "rotate-180"
                      )}
                      aria-hidden
                    />
                  </button>
                  {envelopeOpen && (
                    <div
                      className="absolute left-0 top-full z-40 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg"
                      role="listbox"
                      aria-multiselectable
                      data-testid="envelope-multiselect"
                    >
                      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                        {ALL_ENVELOPES.map((k) => {
                          const checked = envelopeFilters.includes(k);
                          return (
                            <li key={k}>
                              <label
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-[var(--muted)]/60",
                                  checked && "bg-teal-500/10"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-[var(--border)]"
                                  checked={checked}
                                  onChange={() => toggleEnvelope(k)}
                                  data-testid={`envelope-check-${k}`}
                                />
                                <span>{ACCOUNT_TYPES[k]}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-2 flex gap-1.5 border-t border-[var(--border)] pt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1 !text-[11px]"
                          data-testid="envelope-select-all"
                          onClick={() =>
                            onEnvelopeFiltersChange([...ALL_ENVELOPES])
                          }
                        >
                          Tout sélectionner
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1 !text-[11px]"
                          data-testid="envelope-select-none"
                          onClick={() => onEnvelopeFiltersChange([])}
                        >
                          Tout désélectionner
                        </Button>
                      </div>
                      <button
                        type="button"
                        className="mt-1.5 w-full rounded-md py-1 text-[11px] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50"
                        onClick={() => setEnvelopeOpen(false)}
                        data-testid="envelope-close"
                      >
                        Fermer
                      </button>
                    </div>
                  )}
                </div>
              ) : undefined
            }
          />
          {platformFilterLabel && onClearPlatformFilter && (
            <div
              className="flex min-w-0 items-center gap-1.5"
              data-testid="holdings-platform-filter"
            >
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-teal-700/30 bg-teal-700/10 px-2.5 py-1 text-[11px] font-medium text-teal-900 dark:text-teal-100">
                <span className="truncate" title={platformFilterLabel}>
                  Plateforme · {platformFilterLabel}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 hover:bg-teal-700/15"
                  onClick={onClearPlatformFilter}
                  aria-label="Retirer le filtre plateforme"
                  data-testid="holdings-clear-platform-filter"
                >
                  ×
                </button>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 3. Options d’affichage (avancées) ── */}
      {hasSource && (
        <div data-testid="holdings-toolbar-group-b">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40",
              advancedOpen
                ? "bg-[var(--muted)] text-slate-800 dark:text-slate-100"
                : "text-slate-500 hover:bg-[var(--muted)] hover:text-slate-800 dark:hover:text-slate-200"
            )}
            aria-expanded={advancedOpen}
            data-testid="holdings-advanced-toggle"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Affichage
            {groupMode && (
              <span className="text-[10px] font-normal text-teal-700 dark:text-teal-300">
                · regroupement
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 opacity-60 transition-transform",
                advancedOpen && "rotate-180"
              )}
              aria-hidden
            />
          </button>

          {advancedOpen && (
            <div
              className={cn(
                "mt-2 flex min-w-0 flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/15 p-2.5",
                "sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4 sm:gap-y-2"
              )}
              data-testid="holdings-advanced-panel"
            >
              <label className={CTRL_LABEL}>
                <span className="shrink-0 font-medium text-[var(--muted-foreground)]">
                  Regrouper
                </span>
                <select
                  className={cn(CTRL_SELECT, "sm:min-w-[11rem]")}
                  value={groupBy}
                  onChange={(e) =>
                    onGroupByChange(parseHoldingsGroupBy(e.target.value))
                  }
                  data-testid="holdings-group-by"
                  aria-label="Regrouper les positions"
                >
                  <option value="none">Aucun</option>
                  <option value="assetCategory">
                    Sous-catégorie d&apos;actif
                  </option>
                  <option value="blockchain">Blockchain (crypto)</option>
                </select>
              </label>

              {groupMode && categoryGroupCount > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[11px]"
                    onClick={onExpandAllGroups}
                    data-testid="holdings-expand-all-groups"
                  >
                    Tout déplier
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[11px]"
                    onClick={onCollapseAllGroups}
                    data-testid="holdings-collapse-all-groups"
                  >
                    Tout replier
                  </Button>
                </div>
              )}

              <label className={CTRL_LABEL}>
                <span className="shrink-0 font-medium text-[var(--muted-foreground)]">
                  Vue
                </span>
                <select
                  className={cn(CTRL_SELECT, "sm:min-w-[9rem]")}
                  defaultValue=""
                  aria-label="Vues enregistrées"
                  data-testid="holdings-saved-views"
                  onChange={(e) => {
                    const id = e.target.value;
                    e.target.value = "";
                    if (id === "__save__") {
                      const name = window.prompt("Nom de la vue :");
                      if (!name?.trim()) return;
                      onSaveView(name.trim());
                      return;
                    }
                    const view = savedViews.find((v) => v.id === id);
                    if (view) onApplyView(view);
                  }}
                >
                  <option value="">Choisir…</option>
                  <option value="__save__">
                    + Enregistrer la vue actuelle
                  </option>
                  {savedViews.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* Par page : masqué en mode regroupement (pagination inactive) */}
              {!groupMode ? (
                <label className={CTRL_LABEL}>
                  <span className="shrink-0 font-medium text-[var(--muted-foreground)]">
                    Par page
                  </span>
                  <select
                    className={cn(
                      CTRL_SELECT,
                      "font-semibold tabular-nums sm:!min-w-[4.25rem]"
                    )}
                    value={pageSize}
                    onChange={(e) =>
                      onPageSizeChange(
                        Number(e.target.value) as HoldingsPageSize
                      )
                    }
                    data-testid="holdings-page-size"
                    aria-label="Nombre de lignes par page"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p
                  className="text-meta max-w-xs sm:ml-auto"
                  data-testid="holdings-page-size-disabled"
                >
                  Pagination désactivée en mode regroupement
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type { VisibilityState };
