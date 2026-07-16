/**
 * Parité P&L : ledger snapshot vs dernier point de série temporelle.
 *
 * Les deux chemins doivent converger sur le même état de position à t=now
 * (qty, CUMP, latente, réalisé, total économique) lorsque le prix MTM
 * et le ledger sont identiques.
 */

import {
  buildTotalReturnSeries,
  computePositionPnlSummary,
  type BuildTotalReturnOptions,
  type LedgerTxLite,
  type PositionPnlSummary,
  type PriceBar,
  type TotalReturnPoint,
} from "./total-return";

export type PnlParityField =
  | "qty"
  | "cumpEur"
  | "latentPnlEur"
  | "realizedPnlEur"
  | "totalPnlEur"
  | "costBasisEur";

export type PnlParityDelta = {
  field: PnlParityField;
  series: number;
  ledger: number;
  absDiff: number;
};

export type PnlParityResult = {
  ok: boolean;
  tolerance: number;
  deltas: PnlParityDelta[];
  /** max |diff| observé */
  maxAbsDiff: number;
  seriesPoint: Pick<
    TotalReturnPoint,
    | "qty"
    | "cumpEur"
    | "latentPnlEur"
    | "realizedPnlCumEur"
    | "totalPnlEur"
    | "costBasisEur"
    | "close"
  > | null;
  ledger: PositionPnlSummary;
  seriesSummary: PositionPnlSummary;
};

const DEFAULT_TOL = 0.02; // 2 centimes

function absDiff(a: number, b: number): number {
  return Math.abs((Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0));
}

/**
 * Compare un point de série (ou le summary issu du même build) au
 * snapshot ledger `computePositionPnlSummary`.
 */
export function comparePnlParity(
  seriesLike: {
    qty: number;
    cumpEur: number;
    latentPnlEur: number;
    realizedPnlEur: number;
    totalPnlEur: number;
    costBasisEur: number;
  },
  ledger: PositionPnlSummary,
  tolerance = DEFAULT_TOL
): Omit<PnlParityResult, "seriesPoint" | "seriesSummary"> & {
  ok: boolean;
} {
  const pairs: Array<[PnlParityField, number, number]> = [
    ["qty", seriesLike.qty, ledger.qty],
    ["cumpEur", seriesLike.cumpEur, ledger.cumpEur],
    ["latentPnlEur", seriesLike.latentPnlEur, ledger.latentPnlEur],
    ["realizedPnlEur", seriesLike.realizedPnlEur, ledger.realizedPnlEur],
    ["totalPnlEur", seriesLike.totalPnlEur, ledger.totalPnlEur],
    ["costBasisEur", seriesLike.costBasisEur, ledger.costBasisEur],
  ];

  const deltas: PnlParityDelta[] = [];
  let maxAbsDiff = 0;
  for (const [field, series, led] of pairs) {
    const d = absDiff(series, led);
    maxAbsDiff = Math.max(maxAbsDiff, d);
    if (d > tolerance) {
      deltas.push({ field, series, ledger: led, absDiff: d });
    }
  }

  return {
    ok: deltas.length === 0,
    tolerance,
    deltas,
    maxAbsDiff,
    ledger,
  };
}

/**
 * Pipeline complet : rejoue la série + le ledger au même prix de clôture
 * (dernier close, ou `currentPriceEur` pour le ledger si fourni — parité
 * stricte utilise le même prix des deux côtés).
 */
export function checkSeriesLedgerParity(
  priceBars: PriceBar[],
  transactions: LedgerTxLite[],
  options?: BuildTotalReturnOptions & {
    /** Prix MTM pour le ledger ; défaut = dernier close de la série */
    currentPriceEur?: number;
    tolerance?: number;
  }
): PnlParityResult {
  const { series, summary } = buildTotalReturnSeries(
    priceBars,
    transactions,
    options
  );
  const last = series[series.length - 1] ?? null;
  const price =
    options?.currentPriceEur != null &&
    Number.isFinite(options.currentPriceEur) &&
    options.currentPriceEur > 0
      ? options.currentPriceEur
      : (last?.close ?? summary.currentPriceEur);

  const ledger = computePositionPnlSummary(transactions, price);

  // Parité summary (build) ↔ ledger au même prix de série
  const ledgerAtSeriesClose = computePositionPnlSummary(
    transactions,
    last?.close ?? price
  );

  const seriesLike = last
    ? {
        qty: last.qty,
        cumpEur: last.cumpEur,
        latentPnlEur: last.latentPnlEur,
        realizedPnlEur: last.realizedPnlCumEur,
        totalPnlEur: last.totalPnlEur,
        costBasisEur: last.costBasisEur,
      }
    : {
        qty: summary.qty,
        cumpEur: summary.cumpEur,
        latentPnlEur: summary.latentPnlEur,
        realizedPnlEur: summary.realizedPnlEur,
        totalPnlEur: summary.totalPnlEur,
        costBasisEur: summary.costBasisEur,
      };

  const cmp = comparePnlParity(
    seriesLike,
    ledgerAtSeriesClose,
    options?.tolerance ?? DEFAULT_TOL
  );

  return {
    ...cmp,
    seriesPoint: last
      ? {
          qty: last.qty,
          cumpEur: last.cumpEur,
          latentPnlEur: last.latentPnlEur,
          realizedPnlCumEur: last.realizedPnlCumEur,
          totalPnlEur: last.totalPnlEur,
          costBasisEur: last.costBasisEur,
          close: last.close,
        }
      : null,
    seriesSummary: summary,
    // ledger exposé = snapshot au prix demandé (KPI UI)
    ledger,
  };
}
