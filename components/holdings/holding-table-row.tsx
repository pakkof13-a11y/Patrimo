"use client";

import { Fragment, useState } from "react";
import { flexRender, type Row } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { type Holding } from "@/app/lib/types/ui";
import { parseAssetCategory } from "@/app/lib/assets/categories";
import { columnAlign, columnMinWidth } from "@/app/lib/display-preferences";
import {
  computeTriggerLevelStatus,
  triggerKindOf,
} from "@/app/lib/portfolio/trigger-levels";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

/** Fixed first column for expand/collapse (must be added to table total width). */
export const HOLDINGS_EXPAND_COL_PX = 44;
/** Fixed column for the row selection checkbox (must be added to table total width). */
export const HOLDINGS_SELECT_COL_PX = 36;

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
  currentPrice,
  onCommit,
}: {
  assetId: string;
  field: TriggerField;
  value: string | null | undefined;
  /** Cours actuel en devise native — pour la distance % et l'alerte de franchissement. */
  currentPrice?: string | null;
  onCommit: (assetId: string, field: TriggerField, value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const resetKey = `${assetId}:${field}:${value ?? ""}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setDraft(value ?? "");
  }

  const status =
    value && currentPrice
      ? computeTriggerLevelStatus(
          Number(currentPrice),
          Number(value),
          triggerKindOf(field)
        )
      : null;

  return (
    <div className="flex flex-col items-end gap-0.5">
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
      {status && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums",
            status.triggered
              ? "text-[var(--danger)]"
              : "text-[var(--muted-foreground)]"
          )}
          title={
            status.triggered
              ? field === "stopLoss"
                ? "Cours passé sous le Stop Loss"
                : "Cours ayant atteint ce Take Profit"
              : "Distance au cours actuel"
          }
          data-testid={`trigger-status-${field}`}
        >
          {status.triggered && <AlertTriangle className="h-2.5 w-2.5" aria-hidden />}
          {status.distancePct > 0 ? "+" : ""}
          {status.distancePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
          %
        </span>
      )}
    </div>
  );
}

export type HoldingRowRenderOpts = {
  /** Affiche l'actif dans la colonne de détail. */
  onOpenAsset: (id: string) => void;
  /** Actif actuellement affiché dans cette colonne, s'il y en a un. */
  selectedAssetId?: string | null;
};

/**
 * Ligne position + panneau d’historique expand.
 * Isolé du monolithe HoldingsSection (colonnes / toolbar / pagination).
 */
export function renderHoldingRow(row: Row<Holding>, opts: HoldingRowRenderOpts) {
  const assetId = row.original.assetId;
  const holding = row.original;
  const selected = opts.selectedAssetId === assetId;
  return (
    <Fragment key={row.id}>
      {/*
        Un clic ouvre la fiche.

        La ligne portait auparavant deux commandes en tête — une case à cocher
        et un chevron d'historique — et n'ouvrait la fiche qu'au double-clic,
        geste que rien n'annonçait. Les deux colonnes ont disparu au profit du
        panneau de détail, qui dit tout ce qu'elles disaient et davantage.

        `<tr onClick>` plutôt qu'un bouton par cellule : la cible cliquable est
        la ligne entière, et les contrôles qu'elle contient encore (l'enveloppe)
        arrêtent la propagation pour rester utilisables.
      */}
      <tr
        className="holdings-row holdings-row--clickable"
        title={`Ouvrir la fiche de ${holding.name}`}
        role="button"
        tabIndex={0}
        onClick={() => opts.onOpenAsset(assetId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            opts.onOpenAsset(assetId);
          }
        }}
        data-category={parseAssetCategory(holding.category)}
        data-stale={holding.priceStatus === "STALE" ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        aria-current={selected ? "true" : undefined}
      >
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
                // Déclaré par colonne plutôt que répété dans chaque cellule :
                // l'en-tête et le corps lisent la même source et ne peuvent
                // plus diverger.
                textAlign: columnAlign(cell.column.id),
              }}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          );
        })}
      </tr>
    </Fragment>
  );
}
