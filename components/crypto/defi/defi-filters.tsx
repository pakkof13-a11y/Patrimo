"use client";

import { useId, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  ACCESS_MODE_OPTIONS,
  DEFI_POSITION_TYPE_OPTIONS,
  POSITION_STATUS_OPTIONS,
  accessModeLabel,
  defiPositionTypeLabel,
  positionStatusLabel,
} from "@/app/lib/crypto/defi-ui-rules";

export type DefiFiltersValue = {
  search: string;
  accessMode: string;
  chain: string;
  protocol: string;
  platformId: string;
  positionType: string;
  status: string;
  withDebt: boolean;
  withRewards: boolean;
  illiquidOnly: boolean;
  stale: boolean;
  showHidden: boolean;
  showIgnored: boolean;
  showInactive: boolean;
  ownerLabel: string;
  unknownValuation: boolean;
  unknownProtocol: boolean;
  onlyAnomalies: boolean;
};

export const EMPTY_DEFI_FILTERS: DefiFiltersValue = {
  search: "",
  accessMode: "",
  chain: "",
  protocol: "",
  platformId: "",
  positionType: "",
  status: "",
  withDebt: false,
  withRewards: false,
  illiquidOnly: false,
  stale: false,
  showHidden: false,
  showIgnored: false,
  showInactive: false,
  ownerLabel: "",
  unknownValuation: false,
  unknownProtocol: false,
  onlyAnomalies: false,
};

export function hasActiveDefiFilters(v: DefiFiltersValue): boolean {
  return Object.entries(v).some(([k, val]) =>
    typeof val === "boolean" ? val : val !== "" && k !== "search"
  ) || v.search.trim() !== "";
}

type ChipDef = { key: keyof DefiFiltersValue; label: string };

function activeChips(
  v: DefiFiltersValue,
  chains: string[],
  protocols: string[],
  platforms: Array<{ id: string; name: string }>
): ChipDef[] {
  const chips: ChipDef[] = [];
  if (v.search.trim()) chips.push({ key: "search", label: `« ${v.search.trim()} »` });
  if (v.accessMode) chips.push({ key: "accessMode", label: accessModeLabel(v.accessMode) });
  if (v.chain) chips.push({ key: "chain", label: v.chain });
  if (v.protocol) chips.push({ key: "protocol", label: v.protocol });
  if (v.platformId) {
    const p = platforms.find((pl) => pl.id === v.platformId);
    chips.push({ key: "platformId", label: p?.name ?? "Plateforme" });
  }
  if (v.positionType) chips.push({ key: "positionType", label: defiPositionTypeLabel(v.positionType) });
  if (v.status) chips.push({ key: "status", label: positionStatusLabel(v.status) });
  if (v.withDebt) chips.push({ key: "withDebt", label: "Avec dette" });
  if (v.withRewards) chips.push({ key: "withRewards", label: "Avec rewards" });
  if (v.illiquidOnly) chips.push({ key: "illiquidOnly", label: "Verrouillées / en retrait" });
  if (v.stale) chips.push({ key: "stale", label: "Valorisation périmée" });
  if (v.showHidden) chips.push({ key: "showHidden", label: "Masquées incluses" });
  if (v.showIgnored) chips.push({ key: "showIgnored", label: "Ignorées incluses" });
  if (v.showInactive) chips.push({ key: "showInactive", label: "Fermées / liquidées incluses" });
  if (v.ownerLabel.trim()) chips.push({ key: "ownerLabel", label: `Détenteur : ${v.ownerLabel}` });
  if (v.unknownValuation) chips.push({ key: "unknownValuation", label: "Valorisation inconnue" });
  if (v.unknownProtocol) chips.push({ key: "unknownProtocol", label: "Protocole non reconnu" });
  if (v.onlyAnomalies) chips.push({ key: "onlyAnomalies", label: "Anomalies uniquement" });
  void chains;
  void protocols;
  return chips;
}

/**
 * Barre de filtres DeFi — recherche + filtres combinés + chips actifs + reset.
 *
 * Repliée par défaut sur mobile (bouton « Filtres »), dépliée sur desktop :
 * la densité de filtres demandée par le cahier des charges (15 critères)
 * rendrait un mobile-first strict illisible si tout restait ouvert en
 * permanence.
 */
export function DefiFilters({
  value,
  onChange,
  chains,
  protocols,
  platforms,
}: {
  value: DefiFiltersValue;
  onChange: (v: DefiFiltersValue) => void;
  chains: string[];
  protocols: string[];
  platforms: Array<{ id: string; name: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const searchId = useId();

  const set = <K extends keyof DefiFiltersValue>(k: K, v: DefiFiltersValue[K]) =>
    onChange({ ...value, [k]: v });

  const chips = activeChips(value, chains, protocols, platforms);

  return (
    <div className="space-y-2" data-testid="defi-filters">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
            aria-hidden
          />
          <label htmlFor={searchId} className="sr-only">
            Rechercher une position DeFi
          </label>
          <input
            id={searchId}
            type="search"
            className="input w-full py-1.5 pl-9 text-sm"
            placeholder="Protocole, actif, chaîne…"
            value={value.search}
            onChange={(e) => set("search", e.target.value)}
            data-testid="defi-filter-search"
          />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          data-testid="defi-filters-toggle"
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
            onClick={() => onChange(EMPTY_DEFI_FILTERS)}
            className="text-meta underline decoration-dotted underline-offset-2 hover:text-[var(--foreground)]"
            data-testid="defi-filters-reset"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="defi-filter-chips">
          {chips.map((c) => (
            <button
              key={String(c.key)}
              type="button"
              onClick={() =>
                set(
                  c.key,
                  (typeof value[c.key] === "boolean" ? false : "") as DefiFiltersValue[typeof c.key]
                )
              }
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/30 px-2 py-0.5 text-[11px] font-medium hover:bg-[var(--muted)]/60"
              data-testid={`defi-filter-chip-${String(c.key)}`}
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
          data-testid="defi-filters-panel"
        >
          <label className="text-meta block">
            Mode d&apos;accès
            <select
              className="input mt-1 w-full"
              value={value.accessMode}
              onChange={(e) => set("accessMode", e.target.value)}
              data-testid="defi-filter-access-mode"
            >
              <option value="">Tous</option>
              {ACCESS_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-meta block">
            Chaîne
            <input
              className="input mt-1 w-full"
              list="defi-filter-chains-list"
              value={value.chain}
              onChange={(e) => set("chain", e.target.value)}
              placeholder="ethereum, solana…"
              data-testid="defi-filter-chain"
            />
            <datalist id="defi-filter-chains-list">
              {chains.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          <label className="text-meta block">
            Protocole
            <input
              className="input mt-1 w-full"
              list="defi-filter-protocols-list"
              value={value.protocol}
              onChange={(e) => set("protocol", e.target.value)}
              placeholder="Aave, Lido…"
              data-testid="defi-filter-protocol"
            />
            <datalist id="defi-filter-protocols-list">
              {protocols.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>

          <label className="text-meta block">
            Plateforme / wallet
            <select
              className="input mt-1 w-full"
              value={value.platformId}
              onChange={(e) => set("platformId", e.target.value)}
              data-testid="defi-filter-platform"
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
            Nature de position
            <select
              className="input mt-1 w-full"
              value={value.positionType}
              onChange={(e) => set("positionType", e.target.value)}
              data-testid="defi-filter-position-type"
            >
              <option value="">Toutes</option>
              {DEFI_POSITION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
              data-testid="defi-filter-status"
            >
              <option value="">Tous</option>
              {POSITION_STATUS_OPTIONS.map((o) => (
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
              data-testid="defi-filter-owner"
            />
          </label>

          <fieldset className="col-span-full grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            <legend className="sr-only">Filtres booléens</legend>
            <CheckFilter
              label="Avec dette"
              checked={value.withDebt}
              onChange={(v) => set("withDebt", v)}
              testId="defi-filter-with-debt"
            />
            <CheckFilter
              label="Avec rewards"
              checked={value.withRewards}
              onChange={(v) => set("withRewards", v)}
              testId="defi-filter-with-rewards"
            />
            <CheckFilter
              label="Verrouillées / en retrait"
              checked={value.illiquidOnly}
              onChange={(v) => set("illiquidOnly", v)}
              testId="defi-filter-illiquid"
            />
            <CheckFilter
              label="Valorisation périmée"
              checked={value.stale}
              onChange={(v) => set("stale", v)}
              testId="defi-filter-stale"
            />
            <CheckFilter
              label="Valorisation inconnue"
              checked={value.unknownValuation}
              onChange={(v) => set("unknownValuation", v)}
              testId="defi-filter-unknown-valuation"
            />
            <CheckFilter
              label="Protocole non reconnu"
              checked={value.unknownProtocol}
              onChange={(v) => set("unknownProtocol", v)}
              testId="defi-filter-unknown-protocol"
            />
            <CheckFilter
              label="Inclure masquées"
              checked={value.showHidden}
              onChange={(v) => set("showHidden", v)}
              testId="defi-filter-show-hidden"
            />
            <CheckFilter
              label="Inclure ignorées"
              checked={value.showIgnored}
              onChange={(v) => set("showIgnored", v)}
              testId="defi-filter-show-ignored"
            />
            <CheckFilter
              label="Inclure fermées / liquidées"
              checked={value.showInactive}
              onChange={(v) => set("showInactive", v)}
              testId="defi-filter-show-inactive"
            />
            <CheckFilter
              label="Anomalies uniquement"
              checked={value.onlyAnomalies}
              onChange={(v) => set("onlyAnomalies", v)}
              testId="defi-filter-anomalies"
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
 * Applique les filtres côté client sur la liste déjà chargée.
 *
 * `showHidden`/`showIgnored`/`showInactive` inversent une exclusion par
 * défaut : le tableau masque ces positions tant que l'utilisateur ne demande
 * pas explicitement à les voir, mais elles restent chargées (le bundle les
 * inclut toujours) pour ne pas multiplier les allers-retours réseau à chaque
 * bascule de filtre.
 */
export function matchesDefiFilters(
  p: {
    assetSymbol: string;
    protocol: string;
    underlyingProtocol: string | null;
    chain: string | null;
    platformId: string;
    accessMode: string;
    positionType: string;
    status: string;
    ownerLabel: string | null;
    isHidden: boolean;
    isIgnoredInPortfolio: boolean;
    valuation: { debtEur: string; rewardsEur: string; isStale: boolean; isValuable: boolean };
    conflict: { flagged: boolean };
    debt: { riskLevel: string | null } | null;
  },
  v: DefiFiltersValue,
  isUnknownProtocol: (protocol: string, underlyingProtocol: string | null) => boolean,
  isInactive: (status: string) => boolean,
  isIlliquid: (status: string) => boolean
): boolean {
  if (!v.showHidden && p.isHidden) return false;
  if (!v.showIgnored && p.isIgnoredInPortfolio) return false;
  if (!v.showInactive && isInactive(p.status)) return false;

  if (v.search.trim()) {
    const q = v.search.trim().toLowerCase();
    const haystack = [p.assetSymbol, p.protocol, p.chain, p.platformId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (v.accessMode && p.accessMode !== v.accessMode) return false;
  if (v.chain && (p.chain ?? "").toLowerCase() !== v.chain.toLowerCase()) return false;
  if (v.protocol && p.protocol.toLowerCase() !== v.protocol.toLowerCase()) return false;
  if (v.platformId && p.platformId !== v.platformId) return false;
  if (v.positionType && p.positionType !== v.positionType) return false;
  if (v.status && p.status !== v.status) return false;
  if (v.ownerLabel.trim() && (p.ownerLabel ?? "").toLowerCase() !== v.ownerLabel.trim().toLowerCase())
    return false;

  if (v.withDebt && Number(p.valuation.debtEur) <= 0) return false;
  if (v.withRewards && Number(p.valuation.rewardsEur) <= 0) return false;
  if (v.illiquidOnly && !isIlliquid(p.status)) return false;
  if (v.stale && !p.valuation.isStale) return false;
  if (v.unknownValuation && p.valuation.isValuable) return false;
  if (v.unknownProtocol && !isUnknownProtocol(p.protocol, p.underlyingProtocol)) return false;

  if (v.onlyAnomalies) {
    const anomaly =
      p.conflict.flagged ||
      !p.valuation.isValuable ||
      p.valuation.isStale ||
      p.debt?.riskLevel === "CRITICAL" ||
      p.debt?.riskLevel === "WARNING" ||
      isUnknownProtocol(p.protocol, p.underlyingProtocol);
    if (!anomaly) return false;
  }

  return true;
}
