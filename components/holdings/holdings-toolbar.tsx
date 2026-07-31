"use client";

import { useState } from "react";
import {
  ChevronDown,
  HelpCircle,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/column-picker";
import {
  FilterChip,
  type FilterChipOption,
} from "@/components/ui/filter-chip";
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
import type { PnlFilter } from "@/app/lib/portfolio/pnl-filter";
import {
  HOLDINGS_VIEW_MODES,
  type HoldingsViewMode,
} from "@/app/lib/portfolio/holdings-view-mode";

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
  /**
   * Niveau de détail courant, ou `null` quand les colonnes ont été composées
   * à la main et ne correspondent à aucun des trois modes.
   */
  viewMode: HoldingsViewMode | null;
  onViewModeChange: (mode: HoldingsViewMode) => void;
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
  /** Filtre rapide P&L latent : tout / gagnants / perdants */
  pnlFilter: PnlFilter;
  onPnlFilterChange: (v: PnlFilter) => void;
  /** Puce Type d'actif */
  assetClassOptions: FilterChipOption[];
  assetClassFilters: string[];
  onAssetClassFiltersChange: (v: string[]) => void;
  /** Puce Devise */
  currencyOptions: FilterChipOption[];
  currencyFilters: string[];
  onCurrencyFiltersChange: (v: string[]) => void;
  /** Puce Plateforme — mono-valeur (redécoupe les positions multi-dépositaires) */
  platformOptions: FilterChipOption[];
  platformFilterId: string;
  onPlatformFilterChange: (id: string | null) => void;
  /** Libellé résolu du filtre plateforme (deep-link Mes plateformes) */
  platformFilterLabel?: string | null;
  /** Au moins un filtre restreint l'affichage → bouton de réinitialisation */
  hasActiveFilters: boolean;
  onResetFilters: () => void;
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
  viewMode,
  onViewModeChange,
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
  onAccountFilterChange: _onAccountFilterChange,
  pnlFilter,
  onPnlFilterChange,
  assetClassOptions,
  assetClassFilters,
  onAssetClassFiltersChange,
  currencyOptions,
  currencyFilters,
  onCurrencyFiltersChange,
  platformOptions,
  platformFilterId,
  onPlatformFilterChange,
  platformFilterLabel,
  hasActiveFilters,
  onResetFilters,
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
  const hasSource = sourceCount > 0;
  // Toujours afficher la zone filtres si le sélecteur d’enveloppes est dispo
  // (évite la disparition du bouton quand le filtre vide la liste)
  const showFilters =
    hasSource ||
    Boolean(search) ||
    Boolean(accountFilter) ||
    Boolean(platformFilterLabel) ||
    Boolean(onEnvelopeFiltersChange);

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
          {/* Niveau de détail — devant le sélecteur de colonnes, qui reste
              l'outil de réglage fin une fois le niveau choisi. Aucun onglet
              n'est actif si les colonnes ont été composées à la main. */}
          <div
            className="term-seg"
            role="group"
            aria-label="Niveau de détail du tableau"
            data-testid="holdings-view-mode"
            data-custom={viewMode === null ? "true" : "false"}
          >
            {HOLDINGS_VIEW_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className="term-seg-item"
                data-active={viewMode === m.id ? "true" : "false"}
                aria-pressed={viewMode === m.id}
                title={m.hint}
                data-testid={`holdings-view-mode-${m.id}`}
                onClick={() => onViewModeChange(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
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

      {/* ── 2. Recherche + puces de filtre ── */}
      {showFilters && (
        <div
          className={cn(
            "flex min-w-0 flex-col gap-2",
            "sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5"
          )}
          data-testid="holdings-toolbar-primary"
        >
          <TableFilters
            className="min-w-0 w-full sm:min-w-[16rem] sm:max-w-[24rem] sm:flex-1"
            search={search}
            onSearchChange={onSearchChange}
            showAccountFilter={false}
            searchFirst
            placeholder="Rechercher nom, ticker, ISIN…"
          />

          <div
            className="flex min-w-0 flex-wrap items-center gap-[var(--space-2)]"
            data-testid="holdings-filter-chips"
          >
            {onEnvelopeFiltersChange && (
              <FilterChip
                label="Enveloppe"
                testId="envelope-select"
                pluralNoun="enveloppes"
                /* Ici le vide veut dire « aucune position », pas « toutes » :
                   d'où les deux raccourcis nommés en pied de menu. */
                emptyMeans="none"
                allLabel="Toutes"
                options={ALL_ENVELOPES.map((k) => ({
                  value: k,
                  label: ACCOUNT_TYPES[k],
                }))}
                selected={envelopeFilters}
                onChange={(next) =>
                  onEnvelopeFiltersChange(next as AccountType[])
                }
                shortcuts={[
                  {
                    label: "Toutes",
                    next: [...ALL_ENVELOPES],
                    testId: "envelope-select-all",
                  },
                  {
                    label: "Aucune",
                    next: [],
                    testId: "envelope-select-none",
                  },
                ]}
              />
            )}

            <FilterChip
              label="Type"
              testId="asset-class-filter"
              pluralNoun="types"
              options={assetClassOptions}
              selected={assetClassFilters}
              onChange={onAssetClassFiltersChange}
            />

            <FilterChip
              label="Plateforme"
              testId="platform-filter"
              pluralNoun="plateformes"
              allLabel="Toutes"
              singleSelect
              options={
                /* Le libellé résolu depuis l'URL prévaut : un lien profond peut
                   viser une plateforme absente des positions filtrées, et la
                   puce doit tout de même savoir quoi afficher. */
                platformFilterId &&
                platformFilterLabel &&
                !platformOptions.some((o) => o.value === platformFilterId)
                  ? [
                      ...platformOptions,
                      { value: platformFilterId, label: platformFilterLabel },
                    ]
                  : platformOptions
              }
              selected={platformFilterId ? [platformFilterId] : []}
              onChange={(next) => onPlatformFilterChange(next[0] ?? null)}
            />

            <FilterChip
              label="Devise"
              testId="currency-filter"
              pluralNoun="devises"
              allLabel="Toutes"
              options={currencyOptions}
              selected={currencyFilters}
              onChange={onCurrencyFiltersChange}
            />

            {/* P&L : trois états exclusifs, donc un segmenté et non une puce —
                cocher « gagnants » et « perdants » ensemble ne voudrait rien
                dire de plus que ne rien cocher. */}
            <span className="term-chip-label shrink-0">P&amp;L</span>
            <div
              className="term-seg"
              role="group"
              aria-label="Filtrer par P&L latent"
              data-testid="holdings-pnl-filter"
            >
              {(
                [
                  { key: "all", label: "Tous" },
                  { key: "gain", label: "Gagnants" },
                  { key: "loss", label: "Perdants" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className="term-seg-item"
                  data-active={pnlFilter === opt.key ? "true" : "false"}
                  aria-pressed={pnlFilter === opt.key}
                  data-testid={`pnl-filter-${opt.key}`}
                  onClick={() => onPnlFilterChange(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="term-chip"
                data-testid="holdings-reset-filters"
                onClick={onResetFilters}
              >
                <RotateCcw className="h-3 w-3 shrink-0" aria-hidden />
                Réinitialiser
              </button>
            )}
          </div>
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
