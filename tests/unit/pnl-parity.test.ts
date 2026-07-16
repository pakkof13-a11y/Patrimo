import { describe, expect, it } from "vitest";
import {
  checkSeriesLedgerParity,
  comparePnlParity,
} from "@/app/lib/portfolio/pnl-parity";
import type { LedgerTxLite, PriceBar } from "@/app/lib/portfolio/total-return";

function buy(
  at: string,
  qty: number,
  unit: number,
  fees = 0
): LedgerTxLite {
  return {
    type: "ACHAT",
    occurredAt: at,
    quantity: String(qty),
    unitPrice: String(unit),
    fees: String(fees),
    fxRateToEur: "1",
    grossAmountEur: String(qty * unit),
    feesEur: String(fees),
  };
}

function sell(at: string, qty: number, unit: number): LedgerTxLite {
  return {
    type: "VENTE",
    occurredAt: at,
    quantity: String(qty),
    unitPrice: String(unit),
    fees: "0",
    fxRateToEur: "1",
    grossAmountEur: String(qty * unit),
    feesEur: "0",
  };
}

function bars(prices: Array<[string, number]>): PriceBar[] {
  return prices.map(([date, close]) => ({
    date,
    label: date.slice(0, 10),
    close,
    price: close,
  }));
}

describe("pnl parity series ↔ ledger", () => {
  it("last series point matches ledger at same close", () => {
    const priceBars = bars([
      ["2024-01-01T12:00:00.000Z", 100],
      ["2024-06-01T12:00:00.000Z", 120],
      ["2024-12-01T12:00:00.000Z", 110],
    ]);
    const txs = [
      buy("2024-01-01T10:00:00.000Z", 10, 100),
      sell("2024-06-01T10:00:00.000Z", 4, 120),
    ];
    const result = checkSeriesLedgerParity(priceBars, txs, {
      barInterval: "1d",
    });
    expect(result.ok).toBe(true);
    expect(result.deltas).toEqual([]);
    expect(result.seriesPoint?.qty).toBeCloseTo(6, 5);
    expect(result.seriesPoint?.realizedPnlCumEur).toBeCloseTo(80, 5);
  });

  it("day-1 zero still parité-coherent", () => {
    const priceBars = bars([["2024-06-01T00:00:00.000Z", 100]]);
    const txs = [buy("2024-06-01T14:30:00.000Z", 10, 100, 5)];
    const result = checkSeriesLedgerParity(priceBars, txs, {
      barInterval: "1d",
    });
    expect(result.ok).toBe(true);
    expect(result.seriesPoint?.totalPnlEur).toBeCloseTo(-5, 5);
    expect(result.seriesPoint?.latentPnlEur).toBeCloseTo(-5, 5);
  });

  it("comparePnlParity flags mismatches", () => {
    const cmp = comparePnlParity(
      {
        qty: 10,
        cumpEur: 100,
        latentPnlEur: 200,
        realizedPnlEur: 0,
        totalPnlEur: 200,
        costBasisEur: 1000,
      },
      {
        qty: 10,
        cumpEur: 100,
        costBasisEur: 1000,
        currentPriceEur: 120,
        latentPnlEur: 50, // wrong
        latentPnlPct: 5,
        realizedPnlEur: 0,
        hasSells: false,
        totalPnlEur: 200,
      },
      0.02
    );
    expect(cmp.ok).toBe(false);
    expect(cmp.deltas.some((d) => d.field === "latentPnlEur")).toBe(true);
  });

  it("multi-buy sequential cump matches ledger", () => {
    const priceBars = bars([
      ["2024-01-01T12:00:00.000Z", 100],
      ["2024-06-01T12:00:00.000Z", 200],
    ]);
    const txs = [
      buy("2024-01-01T10:00:00.000Z", 10, 100),
      buy("2024-06-01T10:00:00.000Z", 10, 200),
    ];
    const result = checkSeriesLedgerParity(priceBars, txs, {
      barInterval: "1d",
    });
    expect(result.ok).toBe(true);
    expect(result.seriesPoint?.cumpEur).toBeCloseTo(150, 5);
    expect(result.seriesPoint?.qty).toBeCloseTo(20, 5);
  });
});
