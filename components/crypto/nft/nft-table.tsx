"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ImageOff } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import { d } from "@/app/lib/money/decimal";
import {
  getNftAcquisitionCostDisplay,
  getNftStatusBadges,
  getNftValuationDisplay,
  nftChainLabel,
  nftHoldingStatusLabel,
  nftValuationMethodLabel,
  NFT_STANDARDS,
  type ClientNftHolding,
} from "@/app/lib/crypto/nft-ui-rules";
import { NftBadgeList } from "./nft-badges";

type SortKey =
  | "name"
  | "collectionName"
  | "chainId"
  | "standard"
  | "quantity"
  | "status"
  | "retainedValueEur"
  | "collectionFloorPriceEur"
  | "acquisitionCostEur"
  | "retainedValueMethod"
  | "platformName"
  | "retainedValueUpdatedAt";

type SortState = { key: SortKey; dir: 1 | -1 } | null;

function sortValue(h: ClientNftHolding, key: SortKey): string | number {
  switch (key) {
    case "quantity":
      return Number(h.quantity);
    case "retainedValueEur":
      return h.isValuable ? Number(h.retainedValueEur) : -Infinity;
    case "collectionFloorPriceEur":
      return h.collectionFloorPriceEur ? Number(h.collectionFloorPriceEur) : -Infinity;
    case "acquisitionCostEur": {
      const disp = getNftAcquisitionCostDisplay(h);
      return disp != null ? Number(disp) : -Infinity;
    }
    case "retainedValueUpdatedAt":
      return h.retainedValueUpdatedAt ? new Date(h.retainedValueUpdatedAt).getTime() : -Infinity;
    default:
      return (h[key] ?? "").toString().toLowerCase();
  }
}

/**
 * Vue Tableau — dense mais lisible. `overflow-x-auto` plutôt qu'un second
 * layout de cartes sur mobile (même choix que `DefiTable`). Tri au clic sur
 * l'en-tête, colonnes les moins critiques masquées sous `sm`/`lg` plutôt que
 * supprimées.
 */
export function NftTable({
  holdings,
  onOpenDetail,
}: {
  holdings: ClientNftHolding[];
  onOpenDetail: (assetId: string) => void;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return holdings;
    const { key, dir } = sort;
    return [...holdings].sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [holdings, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 1 };
      if (prev.dir === 1) return { key, dir: -1 };
      return null;
    });
  }

  return (
    <div className="overflow-x-auto" data-testid="nft-table-wrap">
      <table className="w-full text-xs" data-testid="nft-table">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            <th className="py-1.5 pr-2">Média</th>
            <Th label="Nom" sortKey="name" sort={sort} onSort={toggleSort} />
            <Th label="Collection" sortKey="collectionName" sort={sort} onSort={toggleSort} />
            <Th
              label="Chaîne"
              sortKey="chainId"
              sort={sort}
              onSort={toggleSort}
              className="hidden lg:table-cell"
            />
            <Th
              label="Standard"
              sortKey="standard"
              sort={sort}
              onSort={toggleSort}
              className="hidden lg:table-cell"
            />
            <Th label="Qté" sortKey="quantity" sort={sort} onSort={toggleSort} align="right" />
            <Th label="Statut" sortKey="status" sort={sort} onSort={toggleSort} />
            <Th
              label="Valeur retenue"
              sortKey="retainedValueEur"
              sort={sort}
              onSort={toggleSort}
              align="right"
            />
            <Th
              label="Floor"
              sortKey="collectionFloorPriceEur"
              sort={sort}
              onSort={toggleSort}
              align="right"
              className="hidden sm:table-cell"
            />
            <Th
              label="Acquisition"
              sortKey="acquisitionCostEur"
              sort={sort}
              onSort={toggleSort}
              align="right"
              className="hidden sm:table-cell"
            />
            <th className="hidden py-1.5 pr-2 text-right sm:table-cell">Écart</th>
            <Th
              label="Méthode"
              sortKey="retainedValueMethod"
              sort={sort}
              onSort={toggleSort}
              className="hidden lg:table-cell"
            />
            <Th
              label="Wallet / plateforme"
              sortKey="platformName"
              sort={sort}
              onSort={toggleSort}
              className="hidden lg:table-cell"
            />
            <Th
              label="Dernière MàJ"
              sortKey="retainedValueUpdatedAt"
              sort={sort}
              onSort={toggleSort}
              className="hidden lg:table-cell"
            />
            <th className="py-1.5 pr-2">Flags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <NftTableRow key={h.assetId} h={h} onOpen={() => onOpenDetail(h.assetId)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  label,
  sortKey,
  sort,
  onSort,
  align,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: "right";
  className?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = active ? (sort!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={cn("py-1.5 pr-2", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-[var(--foreground)]",
          align === "right" && "flex-row-reverse",
          active && "text-[var(--foreground)]"
        )}
        data-testid={`nft-table-sort-${sortKey}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" aria-hidden />
      </button>
    </th>
  );
}

function NftTableRow({ h, onOpen }: { h: ClientNftHolding; onOpen: () => void }) {
  const badges = getNftStatusBadges(h);
  const valuation = getNftValuationDisplay(h);
  const acquisitionDisplay = getNftAcquisitionCostDisplay(h);
  const gainLoss =
    valuation.isValuable && acquisitionDisplay != null
      ? d(h.retainedValueEur).minus(d(acquisitionDisplay))
      : null;

  return (
    <tr
      className={cn(
        "cursor-pointer border-b border-[var(--border)]/50 transition hover:bg-[var(--muted)]/20 focus-within:bg-[var(--muted)]/20",
        h.isSpam && "opacity-60"
      )}
      data-testid="nft-row"
      data-asset-id={h.assetId}
    >
      <td className="py-1.5 pr-2">
        <div className="h-8 w-8 overflow-hidden rounded-[var(--radius-sm,4px)] bg-[var(--muted)]/40">
          {h.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={h.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageOff className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-60" aria-hidden />
            </div>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <button
          type="button"
          onClick={onOpen}
          className="max-w-[9rem] truncate text-left font-medium underline decoration-dotted decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--foreground)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] sm:max-w-none"
          data-testid="nft-row-open"
        >
          {h.name}
        </button>
      </td>
      <td className="max-w-[8rem] truncate py-1.5 pr-2 sm:max-w-none" title={h.collectionName ?? undefined}>
        {h.collectionName || "—"}
      </td>
      <td className="hidden py-1.5 pr-2 lg:table-cell">{nftChainLabel(h.chainId)}</td>
      <td className="hidden py-1.5 pr-2 lg:table-cell">
        {NFT_STANDARDS[h.standard as keyof typeof NFT_STANDARDS] ?? h.standard}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{h.quantity}</td>
      <td className="py-1.5 pr-2 whitespace-nowrap">{nftHoldingStatusLabel(h.status)}</td>
      <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
        {valuation.retainedDisplayText != null ? (
          formatCurrency(valuation.retainedDisplayText, "EUR")
        ) : (
          <span className="italic text-[var(--warning)]">Inconnue</span>
        )}
      </td>
      <td className="hidden py-1.5 pr-2 text-right tabular-nums sm:table-cell">
        {h.collectionFloorPriceEur ? formatCurrency(h.collectionFloorPriceEur, "EUR") : "—"}
      </td>
      <td className="hidden py-1.5 pr-2 text-right tabular-nums sm:table-cell">
        {acquisitionDisplay != null ? formatCurrency(acquisitionDisplay, "EUR") : "—"}
      </td>
      <td
        className={cn(
          "hidden py-1.5 pr-2 text-right tabular-nums sm:table-cell",
          gainLoss && (gainLoss.gte(0) ? "text-[var(--success)]" : "text-[var(--danger)]")
        )}
      >
        {gainLoss ? `${gainLoss.gte(0) ? "+" : ""}${formatCurrency(gainLoss.toFixed(2), "EUR")}` : "—"}
      </td>
      <td className="hidden py-1.5 pr-2 lg:table-cell">{nftValuationMethodLabel(h.retainedValueMethod)}</td>
      <td className="hidden max-w-[8rem] truncate py-1.5 pr-2 lg:table-cell">{h.platformName}</td>
      <td className="hidden py-1.5 pr-2 whitespace-nowrap lg:table-cell">
        {h.retainedValueUpdatedAt ? formatDate(h.retainedValueUpdatedAt) : "—"}
      </td>
      <td className="py-1.5 pr-2">
        <NftBadgeList badges={badges} />
      </td>
    </tr>
  );
}
