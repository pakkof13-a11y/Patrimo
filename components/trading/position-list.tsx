"use client";

/**
 * Table des positions à levier.
 *
 * Six colonnes, celles de la première lecture : quel instrument, dans quel
 * sens, combien je gagne ou perds, à quelle exposition. Le reste — marge,
 * liquidation, funding, stop — vit dans le panneau.
 *
 * Le prix de marque porte un signal de fraîcheur : sans lui, un P&L calculé
 * sur une cotation jamais actualisée se lirait comme une observation de
 * marché.
 */

import { AlertTriangle } from "lucide-react";
import { formatCurrency, cn } from "@/app/lib/utils";
import { DataRow } from "@/components/ui/data-row";
import { exchangeLabel } from "@/app/lib/crypto/futures-constants";
import {
  MARK_FRESHNESS_LABEL,
  type PositionView,
} from "@/app/lib/trading/positions-view";

/**
 * Badge de sens.
 *
 * Le mot est toujours écrit : la couleur seule ne peut pas porter
 * l'information, et un short n'est ni un gain ni une perte — c'est une
 * direction.
 */
export function DirectionBadge({ direction }: { direction: "LONG" | "SHORT" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-2xs)] font-medium",
        direction === "LONG"
          ? "border-[var(--success)]/35 text-[var(--success)]"
          : "border-[var(--danger)]/35 text-[var(--danger)]"
      )}
      data-direction={direction}
    >
      {direction}
    </span>
  );
}

export function StatusDot({ view }: { view: PositionView }) {
  return (
    <span className="inline-flex items-center gap-[var(--space-2)] whitespace-nowrap text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: view.isOpen ? "var(--primary)" : "var(--foreground-faint)",
        }}
        aria-hidden
      />
      {view.isOpen ? "Ouverte" : "Clôturée"}
    </span>
  );
}

const pct = (v: number | null) =>
  v == null
    ? "—"
    : `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

const price = (v: number | null, currency: string) =>
  v == null ? "—" : formatCurrency(String(v), currency);

export function PositionList({
  views,
  selectedId,
  onSelect,
  baseCurrency,
}: {
  views: PositionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  baseCurrency: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="term-table" data-testid="trading-positions-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Sens</th>
            <th className="text-right">Taille</th>
            <th className="text-right">Entrée / Marque</th>
            <th className="text-right">P&amp;L</th>
            <th className="text-right">Exposition</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <DataRow
              key={v.id}
              selected={selectedId === v.id}
              onSelect={() => onSelect(v.id)}
              data-testid="trade-row"
              data-trade-row={v.id}
            >
              <td>
                <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                  <span className="truncate font-medium text-[var(--foreground)]">
                    {v.instrument}
                  </span>
                  {v.liquidationAlert ? (
                    <AlertTriangle
                      className="h-3 w-3 shrink-0 text-[var(--warning)]"
                      aria-label="Proche du prix de liquidation"
                    />
                  ) : null}
                </div>
                <span className="text-meta block">
                  {exchangeLabel(v.exchange)}
                  {v.leverage > 0 ? ` · ×${v.leverage}` : ""}
                </span>
              </td>
              <td>
                <DirectionBadge direction={v.direction} />
              </td>
              <td className="num text-right text-[var(--foreground-secondary)]">
                {v.size.toLocaleString("fr-FR", { maximumFractionDigits: 8 })}
                <span className="text-meta block">{v.row.baseCurrency}</span>
              </td>
              <td className="num text-right text-[var(--foreground-secondary)]">
                {price(v.entryPrice, baseCurrency)}
                {/*
                  Le prix de marque n'est jamais rafraîchi par un flux : la
                  colonne doit dire quand il a été observé, sinon un prix
                  ancien se lit comme une cotation du jour.
                */}
                <span
                  className={cn(
                    "text-meta block",
                    (v.markFreshness !== "MARKED" || v.markIsStale) &&
                      "text-[var(--foreground-faint)] italic"
                  )}
                  title={
                    v.markAgeDays != null
                      ? `Prix observé il y a ${v.markAgeDays} jour(s)`
                      : MARK_FRESHNESS_LABEL[v.markFreshness]
                  }
                  data-mark-freshness={v.markFreshness}
                  data-mark-stale={v.markIsStale ? "true" : "false"}
                >
                  {v.markFreshness === "MARKED"
                    ? price(v.markPrice, baseCurrency)
                    : MARK_FRESHNESS_LABEL[v.markFreshness]}
                  {v.markIsStale && v.markAgeDays != null ? (
                    <span className="ml-1">· {v.markAgeDays} j</span>
                  ) : null}
                </span>
              </td>
              <td className="text-right">
                <span
                  className={cn(
                    "num font-medium",
                    v.pnlEur > 0 && "val-positive",
                    v.pnlEur < 0 && "val-negative",
                    v.pnlEur === 0 && "text-[var(--foreground-faint)]"
                  )}
                >
                  {formatCurrency(String(v.pnlEur), baseCurrency)}
                </span>
                <span
                  className={cn(
                    "text-meta block",
                    v.pnlPct != null && v.pnlPct > 0 && "val-positive",
                    v.pnlPct != null && v.pnlPct < 0 && "val-negative"
                  )}
                >
                  {pct(v.pnlPct)}
                </span>
              </td>
              <td className="num text-right text-[var(--foreground-secondary)]">
                {formatCurrency(String(v.notionalEur), baseCurrency)}
                <span className="text-meta block">
                  marge {formatCurrency(String(v.marginEur), baseCurrency)}
                </span>
              </td>
              <td>
                <StatusDot view={v} />
              </td>
            </DataRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
