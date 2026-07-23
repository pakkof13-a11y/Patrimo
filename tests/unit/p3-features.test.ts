import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import { applySplit, applyBuy, avgCost } from "@/app/lib/accounting/cump";
import { replayTransactions } from "@/app/lib/accounting/ledger";
import type { LedgerTx } from "@/app/lib/accounting/types";
import {
  buildBenchmarkSeries,
  listBenchmarkOptions,
} from "@/app/lib/portfolio/benchmark";
import {
  decomposeUnrealizedPnl,
  weightedBuyFx,
} from "@/app/lib/portfolio/fx-pnl";
import {
  buildCumpAtSellLookup,
  buildFiscalYearReport,
} from "@/app/lib/tax/fiscal-year";
import {
  buildTotalReturnSeries,
  type LedgerTxLite,
  type PriceBar,
} from "@/app/lib/portfolio/total-return";

function tx(
  partial: Partial<LedgerTx> & Pick<LedgerTx, "id" | "type" | "platformId">
): LedgerTx {
  return {
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    occurredAt: new Date("2024-01-01T00:00:00Z"),
    ...partial,
  };
}

describe("SPLIT corporate action", () => {
  it("double la quantité et divise le CUMP, coût total inchangé", () => {
    let pos = applyBuy({ quantity: d(0), costBasisEur: d(0) }, 10, 100, 0);
    expect(avgCost(pos).toFixed(0)).toBe("100");
    pos = applySplit(pos, 2);
    expect(pos.quantity.toFixed(0)).toBe("20");
    expect(pos.costBasisEur.toFixed(0)).toBe("1000");
    expect(avgCost(pos).toFixed(0)).toBe("50");
  });

  it("replay ledger SPLIT", () => {
    const state = replayTransactions([
      tx({
        id: "1",
        type: "ACHAT",
        platformId: "p",
        assetId: "a",
        quantity: d(10),
        unitPrice: d(100),
      }),
      tx({
        id: "2",
        type: "SPLIT",
        platformId: "p",
        assetId: "a",
        quantity: d(2),
        occurredAt: new Date("2024-06-01T00:00:00Z"),
      }),
    ]);
    const pos = [...state.positions.values()][0]!;
    expect(pos.quantity.toFixed(0)).toBe("20");
    expect(pos.costBasisEur.toFixed(0)).toBe("1000");
  });

  it("total-return series applies split", () => {
    const bars: PriceBar[] = [
      { date: "2024-01-01T12:00:00.000Z", label: "j1", close: 100 },
      { date: "2024-06-01T12:00:00.000Z", label: "j2", close: 55 },
    ];
    const txs: LedgerTxLite[] = [
      {
        type: "ACHAT",
        occurredAt: "2024-01-01T10:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        fees: "0",
        fxRateToEur: "1",
        grossAmountEur: "1000",
        feesEur: "0",
      },
      {
        type: "SPLIT",
        occurredAt: "2024-06-01T10:00:00.000Z",
        quantity: "2",
        unitPrice: "0",
        fees: "0",
        fxRateToEur: "1",
        grossAmountEur: "0",
        feesEur: "0",
      },
    ];
    const { series } = buildTotalReturnSeries(bars, txs, { barInterval: "1d" });
    const j2 = series.find((p) => p.date.startsWith("2024-06-01"))!;
    expect(j2.qty).toBeCloseTo(20, 5);
    expect(j2.cumpEur).toBeCloseTo(50, 5);
    // 20*55 - 1000 = 100
    expect(j2.totalPnlEur).toBeCloseTo(100, 0);
  });
});

describe("FX PnL decomposition", () => {
  it("EUR → tout en prix", () => {
    const d0 = decomposeUnrealizedPnl({
      currency: "EUR",
      qty: 10,
      costBasisEur: 1000,
      priceNowNative: 120,
      priceNowEur: 120,
    });
    expect(d0.isEur).toBe(true);
    expect(d0.pricePnlEur).toBeCloseTo(200, 5);
    expect(d0.fxPnlEur).toBe(0);
  });

  it("USD with buy lots splits price vs fx", () => {
    // Bought 10 @ 100 USD, fx 0.90 → cost 900 EUR
    // Now 120 USD, fx 0.95 → MV 1140 EUR, total +240
    // price = 10*(120-100)*0.95 = 190
    // fx = 10*100*(0.95-0.90) = 50
    const d0 = decomposeUnrealizedPnl({
      currency: "USD",
      qty: 10,
      costBasisEur: 900,
      priceNowNative: 120,
      priceNowEur: 114,
      buyLots: [{ quantity: 10, unitPriceNative: 100, fxRateToEur: 0.9 }],
    });
    expect(d0.estimated).toBe(false);
    expect(d0.pricePnlEur + d0.fxPnlEur).toBeCloseTo(d0.totalUnrealizedEur, 5);
    expect(d0.pricePnlEur).toBeGreaterThan(0);
    expect(d0.fxPnlEur).toBeGreaterThan(0);
  });

  it("USD without buy lots falls back to estimated=true (drives the UI warning badge)", () => {
    const d0 = decomposeUnrealizedPnl({
      currency: "USD",
      qty: 10,
      costBasisEur: 900,
      priceNowNative: 120,
      priceNowEur: 114,
      // pas de buyLots → FX d'achat inconnu
    });
    expect(d0.estimated).toBe(true);
    expect(d0.isEur).toBe(false);
    expect(d0.fxBuy).toBeNull();
    expect(d0.fxPnlEur).toBe(0);
    expect(d0.pricePnlEur).toBeCloseTo(d0.totalUnrealizedEur, 5);
    expect(d0.note).toContain("FX d'achat inconnu");
  });

  it("weightedBuyFx", () => {
    const w = weightedBuyFx([
      { quantity: 10, unitPriceNative: 100, fxRateToEur: 0.9 },
      { quantity: 10, unitPriceNative: 100, fxRateToEur: 1.1 },
    ]);
    expect(w!.fxBuy).toBeCloseTo(1.0, 5);
  });
});

describe("benchmark price series", () => {
  it("day1 ≈ 0 then tracks price move on initial capital", () => {
    const series = [
      {
        date: "2024-01-01",
        label: "j1",
        close: 100,
        qty: 10,
        cashInvestedNet: 1000,
        costBasisEur: 1000,
      },
      {
        date: "2024-02-01",
        label: "j2",
        close: 110,
        qty: 10,
        cashInvestedNet: 1000,
        costBasisEur: 1000,
      },
    ] as unknown as import("@/app/lib/portfolio/total-return").TotalReturnPoint[];

    const b = buildBenchmarkSeries(series, "price");
    expect(b[0]!.benchmarkEur).toBeCloseTo(0, 5);
    expect(b[1]!.benchmarkEur).toBeCloseTo(100, 5); // 1000 * 10%
  });

  it("index mode uses external closes", () => {
    const series = [
      {
        date: "2024-01-01T12:00:00.000Z",
        label: "j1",
        close: 100,
        qty: 10,
        cashInvestedNet: 1000,
        costBasisEur: 1000,
      },
      {
        date: "2024-02-01T12:00:00.000Z",
        label: "j2",
        close: 100,
        qty: 10,
        cashInvestedNet: 1000,
        costBasisEur: 1000,
      },
    ] as unknown as import("@/app/lib/portfolio/total-return").TotalReturnPoint[];

    const b = buildBenchmarkSeries(series, "index", [
      { date: "2024-01-01T00:00:00.000Z", close: 7000 },
      { date: "2024-02-01T00:00:00.000Z", close: 7700 },
    ]);
    expect(b[0]!.benchmarkEur).toBeCloseTo(0, 5);
    expect(b[1]!.benchmarkEur).toBeCloseTo(100, 5); // +10% on 1000
  });
});

describe("benchmark DCA base (renforts progressifs)", () => {
  it("price mode integrates every contribution, not just the first", () => {
    // 1000 € @100, puis renfort 4000 € @100, puis le cours monte à 110.
    const series = [
      {
        date: "2024-01-01",
        label: "j1",
        close: 100,
        qty: 10,
        cashInvestedNet: 1000,
        costBasisEur: 1000,
      },
      {
        date: "2024-01-15",
        label: "j2",
        close: 100,
        qty: 50,
        cashInvestedNet: 5000,
        costBasisEur: 5000,
      },
      {
        date: "2024-02-01",
        label: "j3",
        close: 110,
        qty: 50,
        cashInvestedNet: 5000,
        costBasisEur: 5000,
      },
    ] as unknown as import("@/app/lib/portfolio/total-return").TotalReturnPoint[];

    const b = buildBenchmarkSeries(series, "price");
    expect(b[0]!.benchmarkEur).toBeCloseTo(0, 5);
    expect(b[1]!.benchmarkEur).toBeCloseTo(0, 5);
    // 50 unités × 110 − 5000 = 500 (l'ancienne base figée à 1000 donnait 100)
    expect(b[2]!.benchmarkEur).toBeCloseTo(500, 5);
  });

  it("accepts a rich BenchmarkConfig for an arbitrary index (S&P 500)", () => {
    const series = [
      {
        date: "2024-01-01T12:00:00.000Z",
        label: "j1",
        close: 100,
        qty: 10,
        cashInvestedNet: 1000,
        costBasisEur: 1000,
      },
      {
        date: "2024-02-01T12:00:00.000Z",
        label: "j2",
        close: 100,
        qty: 10,
        cashInvestedNet: 1000,
        costBasisEur: 1000,
      },
    ] as unknown as import("@/app/lib/portfolio/total-return").TotalReturnPoint[];

    const b = buildBenchmarkSeries(series, {
      kind: "index",
      symbol: "^GSPC",
      label: "S&P 500",
      closes: [
        { date: "2024-01-01T00:00:00.000Z", close: 4000 },
        { date: "2024-02-01T00:00:00.000Z", close: 4400 },
      ],
    });
    expect(b[0]!.benchmarkEur).toBeCloseTo(0, 5);
    expect(b[1]!.benchmarkEur).toBeCloseTo(100, 5); // +10 % sur 1000
  });

  it("listBenchmarkOptions exposes base modes + every catalogued index", () => {
    const ids = listBenchmarkOptions().map((o) => o.id);
    expect(ids).toContain("none");
    expect(ids).toContain("price");
    expect(ids).toContain("sp500"); // ^GSPC
    expect(ids).toContain("msciworld");
    expect(
      listBenchmarkOptions().filter((o) => o.kind === "index").length
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("fiscal year", () => {
  it("aggregates sells and dividends by envelope", () => {
    const txs = [
      {
        id: "b1",
        type: "ACHAT",
        occurredAt: "2025-01-10T10:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        fxRateToEur: "1",
        grossAmountEur: "1000",
        feesEur: "0",
        fees: "0",
        assetId: "a1",
        accountType: "CTO",
      },
      {
        id: "s1",
        type: "VENTE",
        occurredAt: "2025-06-15T10:00:00.000Z",
        quantity: "4",
        unitPrice: "120",
        fxRateToEur: "1",
        grossAmountEur: "480",
        feesEur: "0",
        fees: "0",
        assetId: "a1",
        accountType: "CTO",
      },
      {
        id: "d1",
        type: "DIVIDENDE",
        occurredAt: "2025-03-01T10:00:00.000Z",
        paymentDate: "2025-03-15T10:00:00.000Z",
        grossAmountEur: "50",
        feesEur: "0",
        netCashImpactEur: "42.5",
        withholdingTaxEur: "7.5",
        assetId: "a1",
        accountType: "CTO",
      },
    ];
    const cumpAtSell = buildCumpAtSellLookup(txs);
    const report = buildFiscalYearReport(2025, txs, { cumpAtSell });
    expect(report.year).toBe(2025);
    const cto = report.byEnvelope.find((b) => b.accountType === "CTO")!;
    expect(cto.realizedPnlEur).toBeCloseTo(80, 5); // 4*(120-100)
    expect(cto.dividendsNetEur).toBeCloseTo(42.5, 5);
    expect(report.totals.estimatedPfuEur).toBeCloseTo((80 + 42.5) * 0.3, 5);
  });
});
