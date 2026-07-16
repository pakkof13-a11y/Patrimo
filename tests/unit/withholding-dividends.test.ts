import { describe, expect, it } from "vitest";
import {
  defaultWhtRateForCountry,
  resolveWhtRate,
  splitDividendEur,
  netFromGrossNative,
} from "@/app/lib/tax/withholding";
import {
  buildTotalReturnSeries,
  type LedgerTxLite,
  type PriceBar,
} from "@/app/lib/portfolio/total-return";
import { applyPerfMetricMode, groupDataByInterval } from "@/app/lib/portfolio/perf-aggregate";

describe("withholding tax helpers", () => {
  it("defaults by country", () => {
    expect(defaultWhtRateForCountry("US")).toBeCloseTo(0.15);
    expect(defaultWhtRateForCountry("DE")).toBeCloseTo(0.26375);
    expect(defaultWhtRateForCountry("FR")).toBe(0);
  });

  it("priority tx > asset > country", () => {
    expect(
      resolveWhtRate({
        countryCode: "US",
        assetWithholdingTaxRate: 0.1,
        txWithholdingTaxRate: 0.05,
      })
    ).toBeCloseTo(0.05);
    expect(
      resolveWhtRate({ countryCode: "US", assetWithholdingTaxRate: 0.1 })
    ).toBeCloseTo(0.1);
    expect(resolveWhtRate({ countryCode: "US" })).toBeCloseTo(0.15);
  });

  it("splits gross / WHT / net EUR", () => {
    const s = splitDividendEur({ grossEur: 100, feesEur: 2, whtRate: 0.15 });
    expect(s.withholdingEur).toBeCloseTo(15);
    expect(s.netEur).toBeCloseTo(83);
    expect(netFromGrossNative(100, 0.15, 2)).toBeCloseTo(83);
  });
});

describe("total-return uses net dividends", () => {
  function bar(date: string, close: number): PriceBar {
    return { date, label: date.slice(0, 10), close, price: close };
  }
  function buy(at: string): LedgerTxLite {
    return {
      type: "ACHAT",
      occurredAt: at,
      quantity: "10",
      unitPrice: "100",
      fees: "0",
      fxRateToEur: "1",
      grossAmountEur: "1000",
      feesEur: "0",
    };
  }
  function div(
    at: string,
    gross: number,
    wht: number,
    fees = 0
  ): LedgerTxLite {
    const net = gross - wht - fees;
    return {
      type: "DIVIDENDE",
      occurredAt: at,
      paymentDate: at,
      quantity: null,
      unitPrice: null,
      fees: String(fees),
      fxRateToEur: "1",
      grossAmountEur: String(gross),
      feesEur: String(fees),
      netCashImpactEur: String(net),
      withholdingTaxEur: String(wht),
      withholdingTaxRate: String(wht / gross),
    };
  }

  it("totalPnl uses net not gross dividends", () => {
    const bars = [
      bar("2024-01-01T12:00:00.000Z", 100),
      bar("2024-06-01T12:00:00.000Z", 100),
    ];
    const txs = [
      buy("2024-01-01T10:00:00.000Z"),
      div("2024-06-01T10:00:00.000Z", 100, 15, 2),
    ];
    const { series } = buildTotalReturnSeries(bars, txs);
    const last = series[series.length - 1]!;
    // position 1000 + net div 83 - cash 1000 = 83
    expect(last.dividendsGrossCumEur).toBeCloseTo(100);
    expect(last.dividendsNetCumEur).toBeCloseTo(83);
    expect(last.withholdingCumEur).toBeCloseTo(15);
    expect(last.totalPnlEur).toBeCloseTo(83, 0);
    expect(last.incomePnlEur).toBeCloseTo(83, 0);
  });

  it("dividends metric mode charts net cum", () => {
    const bars = [
      bar("2024-01-01T12:00:00.000Z", 100),
      bar("2024-06-01T12:00:00.000Z", 100),
    ];
    const txs = [
      buy("2024-01-01T10:00:00.000Z"),
      div("2024-06-01T10:00:00.000Z", 50, 0, 0),
    ];
    const { series } = buildTotalReturnSeries(bars, txs);
    const agg = groupDataByInterval(series, "day");
    const divMode = applyPerfMetricMode(agg, "dividends");
    const last = divMode[divMode.length - 1]!;
    expect(last.chartValueEur).toBeCloseTo(50);
  });

  it("accrues dividend at ex-date and pays at payment (no totalPnl hole)", () => {
    const bars = [
      bar("2024-01-01T12:00:00.000Z", 100),
      bar("2024-05-01T12:00:00.000Z", 100), // before ex
      bar("2024-05-10T12:00:00.000Z", 97), // ex-date: price drops ~div
      bar("2024-05-20T12:00:00.000Z", 97), // payment
    ];
    const txs: LedgerTxLite[] = [
      buy("2024-01-01T10:00:00.000Z"),
      {
        type: "DIVIDENDE",
        occurredAt: "2024-05-20T10:00:00.000Z",
        exDate: "2024-05-10T00:00:00.000Z",
        paymentDate: "2024-05-20T10:00:00.000Z",
        quantity: null,
        unitPrice: null,
        fees: "0",
        fxRateToEur: "1",
        grossAmountEur: "30",
        feesEur: "0",
        netCashImpactEur: "30",
        withholdingTaxEur: "0",
      },
    ];
    const { series } = buildTotalReturnSeries(bars, txs);
    const exBar = series.find((p) => p.date.startsWith("2024-05-10"))!;
    const payBar = series.find((p) => p.date.startsWith("2024-05-20"))!;

    // After price drop + accrual: receivable offsets MTM loss on total
    expect(exBar.dividendReceivableEur).toBeCloseTo(30, 0);
    expect(exBar.dividendsNetCumEur).toBeCloseTo(0, 0); // cash not yet
    // position 10*97=970 + receivable 30 - 1000 = 0
    expect(exBar.totalPnlEur).toBeCloseTo(0, 0);

    // After payment: cash, no receivable
    expect(payBar.dividendReceivableEur).toBeCloseTo(0, 0);
    expect(payBar.dividendsNetCumEur).toBeCloseTo(30, 0);
    expect(payBar.totalPnlEur).toBeCloseTo(0, 0);
  });
});

