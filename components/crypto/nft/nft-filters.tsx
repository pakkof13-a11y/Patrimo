"use client";

import { useId, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  NFT_CATEGORY_OPTIONS,
  NFT_HOLDING_STATUS_OPTIONS,
  NFT_STANDARD_OPTIONS,
  NFT_VALUATION_METHOD_OPTIONS,
  isInactiveHoldingStatus,
  nftCategoryLabel,
  nftChainLabel,
  nftHoldingStatusLabel,
  nftValuationMethodLabel,
  type ClientNftHolding,
} from "@/app/lib/crypto/nft-ui-rules";

export type NftFiltersValue = {
  search: string;
  chain: string;
  standard: string;
  collectionId: string;
  platformId: string;
  status: string;
  category: string;
  valuationMethod: string;
  ownerLabel: string;
  showHidden: boolean;
  showIgnored: boolean;
  showInactive: boolean;
  withMedia: boolean;
  withFloor: boolean;
  stale: boolean;
  unknownValuation: boolean;
  manualAppraisalOnly: boolean;
  spamOrSuspectOnly: boolean;
  onlyAnomalies: boolean;
};

export const EMPTY_NFT_FILTERS: NftFiltersValue = {
  search: "",
  chain: "",
  standard: "",
  collectionId: "",
  platformId: "",
  status: "",
  category: "",
  valuationMethod: "",
  ownerLabel: "",
  showHidden: false,
  showIgnored: false,
  showInactive: false,
  withMedia: false,
  withFloor: false,
  stale: false,
  unknownValuation: false,
  manualAppraisalOnly: false,
  spamOrSuspectOnly: false,
  onlyAnomalies: false,
};

type ChipDef = { key: keyof NftFiltersValue; label: string };

function activeChips(
  v: NftFiltersValue,
  platforms: Array<{ id: string; name: string }>,
  collections: Array<{ id: string; label: string }>
): ChipDef[] {
  const chips: ChipDef[] = [];
  if (v.search.trim()) chips.push({ key: "search", label: `« ${v.search.trim()} »` });
  if (v.chain) chips.push({ key: "chain", label: nftChainLabel(v.chain) });
  if (v.standard) chips.push({ key: "standard", label: v.standard });
  if (v.collectionId) {
    const c = collections.find((x) => x.id === v.collectionId);
    chips.push({ key: "collectionId", label: c?.label ?? "Collection" });
  }
  if (v.platformId) {
    const p = platforms.find((pl) => pl.id === v.platformId);
    chips.push({ key: "platformId", label: p?.name ?? "Wallet / plateforme" });
  }
  if (v.status) chips.push({ key: "status", label: nftHoldingStatusLabel(v.status) });
  if (v.category) chips.push({ key: "category", label: nftCategoryLabel(v.category) });
  if (v.valuationMethod)
    chips.push({ key: "valuationMethod", label: nftValuationMethodLabel(v.valuationMethod) });
  if (v.ownerLabel.trim()) chips.push({ key: "ownerLabel", label: `Détenteur : ${v.ownerLabel}` });
  if (v.showHidden) chips.push({ key: "showHidden", label: "Masqués inclus" });
  if (v.showIgnored) chips.push({ key: "showIgnored", label: "Ignorés inclus" });
  if (v.showInactive) chips.push({ key: "showInactive", label: "Sortis inclus" });
  if (v.withMedia) chips.push({ key: "withMedia", label: "Avec média" });
  if (v.withFloor) chips.push({ key: "withFloor", label: "Valorisés par floor" });
  if (v.stale) chips.push({ key: "stale", label: "Valorisation périmée" });
  if (v.unknownValuation) chips.push({ key: "unknownValuation", label: "Valeur inconnue" });
  if (v.manualAppraisalOnly) chips.push({ key: "manualAppraisalOnly", label: "Expertise manuelle" });
  if (v.spamOrSuspectOnly) chips.push({ key: "spamOrSuspectOnly", label: "Spam / suspect" });
  if (v.onlyAnomalies) chips.push({ key: "onlyAnomalies", label: "Anomalies uniquement" });
  return chips;
}

export function hasActiveNftFilters(v: NftFiltersValue): boolean {
  return activeChips(v, [], []).length > 0;
}

/**
 * Barre de filtres NFT — recherche + filtres combinés + chips actifs + reset.
 * Repliée par défaut sur mobile, même pattern que `DefiFilters` (densité de
 * critères trop élevée pour rester ouverte en permanence sur petit écran).
 */
export function NftFilters({
  value,
  onChange,
  chains,
  platforms,
  collections,
}: {
  value: NftFiltersValue;
  onChange: (v: NftFiltersValue) => void;
  chains: string[];
  platforms: Array<{ id: string; name: string }>;
  collections: Array<{ id: string; label: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const searchId = useId();

  const set = <K extends keyof NftFiltersValue>(k: K, v: NftFiltersValue[K]) =>
    onChange({ ...value, [k]: v });

  const chips = activeChips(value, platforms, collections);

  return (
    <div className="space-y-2" data-testid="nft-filters">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
            aria-hidden
          />
          <label htmlFor={searchId} className="sr-only">
            Rechercher un NFT
          </label>
          <input
            id={searchId}
            type="search"
            className="input w-full py-1.5 pl-9 text-sm"
            placeholder="Nom, collection, chaîne…"
            value={value.search}
            onChange={(e) => set("search", e.target.value)}
            data-testid="nft-filter-search"
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          data-testid="nft-filters-toggle"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs font-medium transition",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            expanded
              ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
              : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
        >
          <Filter className="h-3.5 w-3.5" aria-hidden />
          Filtres
          {chips.length > 0 && (
            <span className="rounded-full bg-[var(--primary)]/20 px-1.5 text-[10px] font-semibold">
              {chips.length}
            </span>
          )}
        </button>

        {chips.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_NFT_FILTERS)}
            className="text-meta underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
            data-testid="nft-filters-reset"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="nft-filter-chips">
          {chips.map((c) => (
            <button
              key={String(c.key)}
              type="button"
              onClick={() =>
                set(c.key, (typeof value[c.key] === "boolean" ? false : "") as NftFiltersValue[typeof c.key])
              }
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/30 px-2 py-0.5 text-[11px] font-medium hover:bg-[var(--muted)]/60"
              data-testid={`nft-filter-chip-${String(c.key)}`}
            >
              {c.label}
              <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
        </div>
      )}

      {expanded && (
        <div
          className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/10 p-3 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="nft-filters-panel"
        >
          <label className="text-meta block">
            Chaîne
            <input
              className="input mt-1 w-full"
              list="nft-filter-chains-list"
              value={value.chain}
              onChange={(e) => set("chain", e.target.value)}
              placeholder="ethereum, solana…"
              data-testid="nft-filter-chain"
            />
            <datalist id="nft-filter-chains-list">
              {chains.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="text-meta block">
            Standard
            <select
              className="input mt-1 w-full"
              value={value.standard}
              onChange={(e) => set("standard", e.target.value)}
              data-testid="nft-filter-standard"
            >
              <option value="">Tous</option>
              {NFT_STANDARD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-meta block">
            Collection
            <select
              className="input mt-1 w-full"
              value={value.collectionId}
              onChange={(e) => set("collectionId", e.target.value)}
              data-testid="nft-filter-collection"
            >
              <option value="">Toutes</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-meta block">
            Wallet / plateforme
            <select
              className="input mt-1 w-full"
              value={value.platformId}
              onChange={(e) => set("platformId", e.target.value)}
              data-testid="nft-filter-platform"
            >
              <option value="">Toutes</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-meta block">
            Statut
            <select
              className="input mt-1 w-full"
              value={value.status}
              onChange={(e) => set("status", e.target.value)}
              data-testid="nft-filter-status"
            >
              <option value="">Tous</option>
              {NFT_HOLDING_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-meta block">
            Catégorie
            <select
              className="input mt-1 w-full"
              value={value.category}
              onChange={(e) => set("category", e.target.value)}
              data-testid="nft-filter-category"
            >
              <option value="">Toutes</option>
              {NFT_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-meta block">
            Méthode de valorisation
            <select
              className="input mt-1 w-full"
              value={value.valuationMethod}
              onChange={(e) => set("valuationMethod", e.target.value)}
              data-testid="nft-filter-valuation-method"
            >
              <option value="">Toutes</option>
              {NFT_VALUATION_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-meta block">
            Détenteur
            <input
              className="input mt-1 w-full"
              value={value.ownerLabel}
              onChange={(e) => set("ownerLabel", e.target.value)}
              placeholder="SCI, holding…"
              data-testid="nft-filter-owner"
            />
          </label>

          <fieldset className="col-span-full grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            <legend className="sr-only">Filtres booléens</legend>
            <CheckFilter
              label="Avec média"
              checked={value.withMedia}
              onChange={(v) => set("withMedia", v)}
              testId="nft-filter-with-media"
            />
            <CheckFilter
              label="Valorisés par floor"
              checked={value.withFloor}
              onChange={(v) => set("withFloor", v)}
              testId="nft-filter-with-floor"
            />
            <CheckFilter
              label="Valorisation périmée"
              checked={value.stale}
              onChange={(v) => set("stale", v)}
              testId="nft-filter-stale"
            />
            <CheckFilter
              label="Valeur inconnue"
              checked={value.unknownValuation}
              onChange={(v) => set("unknownValuation", v)}
              testId="nft-filter-unknown-valuation"
            />
            <CheckFilter
              label="Expertise manuelle uniquement"
              checked={value.manualAppraisalOnly}
              onChange={(v) => set("manualAppraisalOnly", v)}
              testId="nft-filter-manual-appraisal"
            />
            <CheckFilter
              label="Spam / suspect uniquement"
              checked={value.spamOrSuspectOnly}
              onChange={(v) => set("spamOrSuspectOnly", v)}
              testId="nft-filter-spam"
            />
            <CheckFilter
              label="Inclure masqués"
              checked={value.showHidden}
              onChange={(v) => set("showHidden", v)}
              testId="nft-filter-show-hidden"
            />
            <CheckFilter
              label="Inclure ignorés"
              checked={value.showIgnored}
              onChange={(v) => set("showIgnored", v)}
              testId="nft-filter-show-ignored"
            />
            <CheckFilter
              label="Inclure sortis (vendu/brûlé/transféré)"
              checked={value.showInactive}
              onChange={(v) => set("showInactive", v)}
              testId="nft-filter-show-inactive"
            />
            <CheckFilter
              label="Anomalies uniquement"
              checked={value.onlyAnomalies}
              onChange={(v) => set("onlyAnomalies", v)}
              testId="nft-filter-anomalies"
            />
          </fieldset>
        </div>
      )}
    </div>
  );
}

function CheckFilter({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      {label}
    </label>
  );
}

/**
 * Applique les filtres côté client sur le bundle déjà chargé — même choix
 * que `matchesDefiFilters` : un seul appel réseau (`includeInactive=true`),
 * toutes les bascules ensuite gratuites (pas de flash de chargement à
 * chaque case cochée).
 */
export function matchesNftFilters(h: ClientNftHolding, v: NftFiltersValue): boolean {
  if (!v.showHidden && h.isHidden) return false;
  if (!v.showIgnored && h.isIgnoredInPortfolio) return false;
  if (!v.showInactive && isInactiveHoldingStatus(h.status)) return false;

  if (v.search.trim()) {
    const q = v.search.trim().toLowerCase();
    const haystack = [h.name, h.collectionName, h.chainId, h.platformName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (v.chain && h.chainId.toLowerCase() !== v.chain.toLowerCase()) return false;
  if (v.standard && h.standard !== v.standard) return false;
  if (v.collectionId && h.collectionId !== v.collectionId) return false;
  if (v.platformId && h.platformId !== v.platformId) return false;
  if (v.status && h.status !== v.status) return false;
  if (v.category && h.category !== v.category) return false;
  if (v.valuationMethod && h.retainedValueMethod !== v.valuationMethod) return false;
  if (v.ownerLabel.trim() && (h.ownerLabel ?? "").toLowerCase() !== v.ownerLabel.trim().toLowerCase())
    return false;

  if (v.withMedia && !h.imageUrl) return false;
  if (v.withFloor && h.retainedValueMethod !== "FLOOR_PRICE") return false;
  if (v.stale && !h.isStale) return false;
  if (v.unknownValuation && h.isValuable) return false;
  if (v.manualAppraisalOnly && h.retainedValueMethod !== "APPRAISAL") return false;
  if (v.spamOrSuspectOnly && !h.isSpam && !h.isScamSuspected) return false;

  if (v.onlyAnomalies) {
    const anomaly =
      h.conflictFlag ||
      h.isDuplicate ||
      !h.isValuable ||
      h.isStale ||
      h.isSpam ||
      h.isScamSuspected ||
      h.metadataQuality === "BROKEN";
    if (!anomaly) return false;
  }

  return true;
}
