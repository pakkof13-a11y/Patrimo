import { describe, expect, it } from "vitest";
import {
  buildTotalReturnSeries,
  computePositionPnlSummary,
  type LedgerTxLite,
  type PriceBar,
} from "@/app/lib/portfolio/total-return";

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

describe("computePositionPnlSummary", () => {
  it("latent = (price - CUMP) * qty", () => {
    const s = computePositionPnlSummary(
      [buy("2024-01-01T00:00:00.000Z", 10, 100)],
      120
    );
    expect(s.cumpEur).toBeCloseTo(100, 5);
    expect(s.latentPnlEur).toBeCloseTo(200, 5);
    expect(s.latentPnlPct).toBeCloseTo(20, 5);
    expect(s.realizedPnlEur).toBe(0);
    expect(s.hasSells).toBe(false);
    // total = 10*120 - 1000 = 200
    expect(s.totalPnlEur).toBeCloseTo(200, 5);
  });

  it("realized = qty * (sellPrice - CUMP)", () => {
    const txs = [
      buy("2024-01-01T00:00:00.000Z", 10, 100),
      sell("2024-06-01T00:00:00.000Z", 4, 120),
    ];
    const s = computePositionPnlSummary(txs, 110);
    expect(s.realizedPnlEur).toBeCloseTo(80, 5);
    expect(s.hasSells).toBe(true);
    expect(s.qty).toBeCloseTo(6, 5);
    expect(s.cumpEur).toBeCloseTo(100, 5);
    expect(s.latentPnlEur).toBeCloseTo(60, 5);
  });
});

describe("buildTotalReturnSeries — day-1 cumulative (no static CUMP bias)", () => {
  it("first buy day: total & latent ≈ 0 when close equals buy price (midnight bar + afternoon buy)", () => {
    // Yahoo daily bars often dated 00:00 UTC; buy happens later same calendar day.
    // Old bug: eventT > barT → buy deferred → first chart day shows huge Δ.
    const priceBars = bars([
      ["2024-06-01T00:00:00.000Z", 100],
      ["2024-06-02T00:00:00.000Z", 150],
    ]);
    const txs = [buy("2024-06-01T14:30:00.000Z", 10, 100)];
    const { series } = buildTotalReturnSeries(priceBars, txs, {
      barInterval: "1d",
    });

    const d1 = series.find((p) => p.date.startsWith("2024-06-01"))!;
    expect(d1.qty).toBeCloseTo(10, 5);
    expect(d1.cumpEur).toBeCloseTo(100, 5);
    expect(d1.cashInvestedNet).toBeCloseTo(1000, 5);
    expect(d1.latentPnlEur).toBeCloseTo(0, 5);
    expect(d1.totalPnlEur).toBeCloseTo(0, 5);

    const d2 = series.find((p) => p.date.startsWith("2024-06-02"))!;
    expect(d2.totalPnlEur).toBeCloseTo(500, 5); // 10*(150-100)
  });

  it("first buy day with fees: total = latent = −fees when close = buy unit price", () => {
    const priceBars = bars([["2024-06-01T00:00:00.000Z", 100]]);
    const txs = [buy("2024-06-01T10:00:00.000Z", 10, 100, 15)];
    const { series } = buildTotalReturnSeries(priceBars, txs, {
      barInterval: "1d",
    });
    const d1 = series[0]!;
    expect(d1.cumpEur).toBeCloseTo(101.5, 5);
    expect(d1.latentPnlEur).toBeCloseTo(-15, 5);
    expect(d1.totalPnlEur).toBeCloseTo(-15, 5);
  });

  it("uses historical CUMP(t) not final CUMP — mid-series buy does not rewrite day 1", () => {
    const priceBars = bars([
      ["2024-01-01T12:00:00.000Z", 100],
      ["2024-06-01T12:00:00.000Z", 200],
    ]);
    const txs = [
      buy("2024-01-01T10:00:00.000Z", 10, 100),
      buy("2024-06-01T10:00:00.000Z", 10, 200),
    ];
    const { series } = buildTotalReturnSeries(priceBars, txs, {
      barInterval: "1d",
    });
    const j1 = series.find((p) => p.date.startsWith("2024-01-01"))!;
    // Day 1: only first lot — never final cump 150
    expect(j1.qty).toBeCloseTo(10, 5);
    expect(j1.cumpEur).toBeCloseTo(100, 5);
    expect(j1.totalPnlEur).toBeCloseTo(0, 5);
    expect(j1.cashInvestedNet).toBeCloseTo(1000, 5);

    const j2 = series.find((p) => p.date.startsWith("2024-06-01"))!;
    expect(j2.qty).toBeCloseTo(20, 5);
    expect(j2.cumpEur).toBeCloseTo(150, 5);
    // 20*200 - 3000 = 1000 (gain only on first lot)
    expect(j2.totalPnlEur).toBeCloseTo(1000, 5);
  });

  it("weekly bars: mid-week buy applies to that week bar (not next week)", () => {
    // Week of 2024-06-03 (Mon) — buy Wednesday, bar dated Monday 00:00
    const priceBars = bars([
      ["2024-06-03T00:00:00.000Z", 100], // Monday
      ["2024-06-10T00:00:00.000Z", 120], // next Monday
    ]);
    const txs = [buy("2024-06-05T14:00:00.000Z", 10, 100)]; // Wednesday
    const { series } = buildTotalReturnSeries(priceBars, txs, {
      barInterval: "1wk",
    });
    const w1 = series.find((p) => p.date.startsWith("2024-06-03"))!;
    expect(w1.qty).toBeCloseTo(10, 5);
    expect(w1.totalPnlEur).toBeCloseTo(0, 5);
    const w2 = series.find((p) => p.date.startsWith("2024-06-10"))!;
    expect(w2.totalPnlEur).toBeCloseTo(200, 5);
  });
});

describe("buildTotalReturnSeries — period vs compound", () => {
  it("price P&L uses qtyOpen so a mid-period buy does not inflate Δ", () => {
    // J1: buy 10@100, close 100 → period price 0 (no prev)
    // J2: close 97, no tx → pricePnl = 10*(97-100) = -30
    // J3: buy 10@97 at open of bar + close 97 → qtyOpen=10, Δprix=0 → period price 0
    const priceBars = bars([
      ["2024-01-01T12:00:00.000Z", 100],
      ["2024-01-02T12:00:00.000Z", 97],
      ["2024-01-03T12:00:00.000Z", 97],
    ]);
    const txs = [
      buy("2024-01-01T10:00:00.000Z", 10, 100),
      buy("2024-01-03T10:00:00.000Z", 10, 97),
    ];
    const { series } = buildTotalReturnSeries(priceBars, txs);

    const j2 = series.find((p) => p.date.startsWith("2024-01-02"))!;
    expect(j2.qtyOpen).toBeCloseTo(10, 5);
    expect(j2.pricePnlEur).toBeCloseTo(-30, 5);
    expect(j2.periodPnlEur).toBeCloseTo(-30, 5);

    const j3 = series.find((p) => p.date.startsWith("2024-01-03"))!;
    expect(j3.qtyOpen).toBeCloseTo(10, 5); // avant le renfort du jour
    expect(j3.pricePnlEur).toBeCloseTo(0, 5); // close inchangé
    expect(j3.periodPnlEur).toBeCloseTo(0, 5);
    expect(j3.qty).toBeCloseTo(20, 5); // après renfort

    // Ne pas confondre avec latente (stock) qui change avec le renfort
    // latente j3 = 20*(97-98.5) ≈ -30 ; le Δ période reste 0
    expect(j3.latentPnlEur).not.toBeCloseTo(j3.periodPnlEur, 0);
  });

  it("compound totalPnl tracks wealth vs cash invested", () => {
    const priceBars = bars([
      ["2024-01-01T12:00:00.000Z", 100],
      ["2024-02-01T12:00:00.000Z", 110],
      ["2024-06-01T12:00:00.000Z", 120],
      ["2024-07-01T12:00:00.000Z", 115],
    ]);
    const txs = [
      buy("2024-01-01T10:00:00.000Z", 10, 100),
      sell("2024-06-01T10:00:00.000Z", 4, 120),
    ];
    const { series, summary } = buildTotalReturnSeries(priceBars, txs);

    const p1 = series.find((p) => p.date.startsWith("2024-02-01"))!;
    // 10*110 - 1000 = 100
    expect(p1.totalPnlEur).toBeCloseTo(100, 0);
    expect(p1.periodPnlEur).toBeCloseTo(100, 0); // 10*(110-100)

    const p2 = series.find((p) => p.date.startsWith("2024-06-01"))!;
    // price on open 10: 10*(120-110)=100 + realized 4*(120-100)=80
    expect(p2.pricePnlEur).toBeCloseTo(100, 0);
    expect(p2.periodRealizedEur).toBeCloseTo(80, 0);
    expect(p2.periodPnlEur).toBeCloseTo(180, 0);
    // remaining 6 @ 120 = 720, cash in 1000, cash out 480, realized 80, div 0
    // total = 720 + 0 + 80 - max(0,1000-480) = 800 - 520 = 280
    expect(p2.totalPnlEur).toBeCloseTo(280, 0);

    expect(summary.realizedPnlEur).toBeCloseTo(80, 0);
  });

  it("sell day: period includes realized, not confused with latent jump", () => {
    const priceBars = bars([
      ["2024-01-01T12:00:00.000Z", 100],
      ["2024-01-02T12:00:00.000Z", 100],
    ]);
    const txs = [
      buy("2024-01-01T10:00:00.000Z", 10, 100),
      sell("2024-01-02T10:00:00.000Z", 4, 120),
    ];
    // Note: close still 100 on sell day — price pnl on qtyOpen 10: 0
    // realized 4*(120-100)=80
    const { series } = buildTotalReturnSeries(priceBars, txs);
    const d2 = series.find((p) => p.date.startsWith("2024-01-02"))!;
    expect(d2.pricePnlEur).toBeCloseTo(0, 5);
    expect(d2.periodRealizedEur).toBeCloseTo(80, 5);
    expect(d2.periodPnlEur).toBeCloseTo(80, 5);
  });
});
