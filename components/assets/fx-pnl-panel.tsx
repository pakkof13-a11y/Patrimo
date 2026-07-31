"use client";

import { EstimatedBadge, FinanceTip } from "@/components/ui/finance-tooltip";
import {
  decomposeUnrealizedPnl,
  type BuyLotLite,
} from "@/app/lib/portfolio/fx-pnl";
import { formatCurrency, getChangeColor, cn } from "@/app/lib/utils";

/** Jambes du journal nécessaires à la décomposition prix / change. */
type LedgerLeg = {
  type: string;
  quantity: string | null;
  unitPrice: string | null;
  fxRateToEur: string;
};

/**
 * Décomposition de la plus ou moins-value latente entre effet prix et effet
 * change. Extrait de la fiche actif pour être partagé avec l'espace de travail
 * du portefeuille : deux copies auraient fini par diverger sur la seule chose
 * qui compte ici, la façon de répartir le P&L.
 */
export function FxPnlPanel({
  currency,
  qty,
  avgCostEur,
  priceNative,
  priceEur,
  transactions,
}: {
  currency: string;
  qty: number;
  avgCostEur: number;
  marketValueEur: number;
  priceNative: number;
  priceEur: number;
  transactions: LedgerLeg[];
}) {
  const costBasisEur = qty * avgCostEur;
  const buyLots: BuyLotLite[] = [];
  for (const t of transactions) {
    if (t.type !== "ACHAT") continue;
    const q = Number(t.quantity ?? 0);
    const up = Number(t.unitPrice ?? 0);
    const fx = Number(t.fxRateToEur ?? 1) || 1;
    if (q > 0 && up >= 0 && fx > 0) {
      buyLots.push({
        quantity: q,
        unitPriceNative: up,
        fxRateToEur: fx,
      });
    }
  }

  const d = decomposeUnrealizedPnl({
    currency,
    qty,
    costBasisEur,
    priceNowNative: priceNative,
    priceNowEur: priceEur,
    buyLots,
  });

  if (Math.abs(d.totalUnrealizedEur) < 1e-9 && d.isEur) return null;

  const showFxSplit = !d.isEur && Math.abs(d.fxPnlEur) >= 1e-6;

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2"
      data-testid="fx-pnl-panel"
    >
      <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold tracking-tight text-[var(--foreground)]">
        Plus ou moins-value latente
        <FinanceTip term="P&L prix vs change" />
        {d.estimated && (
          <EstimatedBadge
            testId="fx-pnl-estimated-badge"
            message="Décomposition estimée — FX d'achat non disponible pour toutes les jambes"
          />
        )}
      </div>
      {showFxSplit ? (
        <div className="grid grid-cols-3 gap-2 text-center sm:text-left">
          <div>
            <div className="text-meta">Total</div>
            <div
              className={cn(
                "text-sm font-bold tabular-nums",
                getChangeColor(d.totalUnrealizedEur)
              )}
            >
              {formatCurrency(d.totalUnrealizedEur, "EUR")}
            </div>
          </div>
          <div>
            <div className="text-meta">Effet prix</div>
            <div
              className={cn(
                "text-sm font-semibold tabular-nums",
                getChangeColor(d.pricePnlEur)
              )}
            >
              {formatCurrency(d.pricePnlEur, "EUR")}
            </div>
          </div>
          <div>
            <div className="text-meta">Effet change</div>
            <div
              className={cn(
                "text-sm font-semibold tabular-nums",
                getChangeColor(d.fxPnlEur)
              )}
            >
              {formatCurrency(d.fxPnlEur, "EUR")}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <div
            className={cn(
              "text-base font-bold tabular-nums",
              getChangeColor(d.totalUnrealizedEur)
            )}
          >
            {formatCurrency(d.totalUnrealizedEur, "EUR")}
          </div>
          {!d.isEur && (
            <span className="text-meta">
              dont prix {formatCurrency(d.pricePnlEur, "EUR")}
            </span>
          )}
        </div>
      )}
      {d.note && (
        <p className="text-meta mt-1.5 leading-snug">{d.note}</p>
      )}
    </div>
  );
}
