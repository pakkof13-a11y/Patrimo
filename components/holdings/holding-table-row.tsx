"use client";

import { Fragment, useEffect, useState } from "react";
import { flexRender, type Row } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { HoldingRecentTxs } from "@/components/holdings/holding-recent-txs";
import { cn } from "@/app/lib/utils";
import { type Holding } from "@/app/lib/types/ui";
import { parseAssetCategory } from "@/app/lib/assets/categories";
import { columnMinWidth } from "@/app/lib/display-preferences";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

/** Fixed first column for expand/collapse (must be added to table total width). */
export const HOLDINGS_EXPAND_COL_PX = 44;

export type TriggerField = "stopLoss" | "tp1" | "tp2" | "tp3" | "tp4";

export function formatRelativeUpdate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d0 = new Date(iso);
    if (Number.isNaN(d0.getTime())) return "—";
    return formatDistanceToNow(d0, { addSuffix: true, locale: fr });
  } catch {
    return "—";
  }
}

export function TriggerLevelInput({
  assetId,
  field,
  value,
  onCommit,
}: {
  assetId: string;
  field: TriggerField;
  value: string | null | undefined;
  onCommit: (assetId: string, field: TriggerField, value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value, assetId, field]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className="input !w-full min-w-[4.5rem] !px-1.5 !py-1 text-right text-xs tabular-nums"
      placeholder="—"
      value={draft}
      title="Seuil en devise native · vide = désactivé · exécution auto au refresh des prix"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim().replace(",", ".");
        const prev = (value ?? "").trim();
        if (next === prev) return;
        if (next === "" || next === "—") {
          onCommit(assetId, field, null);
          return;
        }
        const n = Number(next);
        if (!Number.isFinite(n) || n < 0) {
          setDraft(value ?? "");
          return;
        }
        onCommit(assetId, field, next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export type HoldingRowRenderOpts = {
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
  visibleColCount: number;
  onRowDoubleClick: (id: string) => void;
  onOpenTransactionForAsset?: (type: string, holding: Holding) => void;
  onEditCategory: (holding: Holding) => void;
};

/**
 * Ligne position + panneau d’historique expand.
 * Isolé du monolithe HoldingsSection (colonnes / toolbar / pagination).
 */
export function renderHoldingRow(row: Row<Holding>, opts: HoldingRowRenderOpts) {
  const assetId = row.original.assetId;
  const holding = row.original;
  const expanded = opts.expandedIds.has(assetId);
  return (
    <Fragment key={row.id}>
      <tr
        className="holdings-row border-t border-[var(--border)]"
        title="Double-clic = fiche détail · flèche = historique rapide"
        onDoubleClick={() => opts.onRowDoubleClick(assetId)}
        data-expanded={expanded ? "true" : "false"}
        data-category={parseAssetCategory(holding.category)}
      >
        <td
          className="holdings-expand-col px-0 py-2 align-middle text-center"
          style={{
            width: HOLDINGS_EXPAND_COL_PX,
            minWidth: HOLDINGS_EXPAND_COL_PX,
            maxWidth: HOLDINGS_EXPAND_COL_PX,
          }}
        >
          <button
            type="button"
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded border border-[var(--border)] bg-[var(--card)] p-0 text-[var(--foreground)] shadow-sm transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]",
              expanded &&
                "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
            )}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? "Masquer l'historique rapide"
                : "Afficher l'historique rapide"
            }
            data-testid={`holding-expand-${assetId}`}
            onClick={(e) => {
              e.stopPropagation();
              opts.toggleExpanded(assetId);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ChevronRight
              className={cn(
                "h-[10px] w-[10px] shrink-0 transition-transform duration-150",
                expanded && "rotate-90"
              )}
              strokeWidth={2.5}
              aria-hidden
            />
          </button>
        </td>
        {row.getVisibleCells().map((cell) => {
          const size = cell.column.getSize();
          const floor = columnMinWidth(cell.column.id);
          return (
            <td
              key={cell.id}
              data-column-id={cell.column.id}
              className="col-cell-sized px-3 py-3 align-top sm:px-4"
              style={{
                width: size,
                minWidth: floor,
              }}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          );
        })}
      </tr>
      {expanded && (
        <tr
          className="border-t border-[var(--border)] bg-[var(--muted)]/35"
          data-testid={`holding-expand-panel-${assetId}`}
        >
          <td colSpan={opts.visibleColCount} className="px-3 py-2 sm:px-4">
            <div className="ml-1 border-l-2 border-[var(--primary)]/35 pl-3 sm:ml-2">
              <HoldingRecentTxs
                assetId={assetId}
                enabled={expanded}
                onOpenTransaction={
                  opts.onOpenTransactionForAsset
                    ? (type) =>
                        opts.onOpenTransactionForAsset!(
                          type || "ACHAT",
                          holding
                        )
                    : undefined
                }
                onEditCategory={() => opts.onEditCategory(holding)}
                onOpenDetail={() => opts.onRowDoubleClick(assetId)}
              />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
