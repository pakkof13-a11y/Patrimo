import { describe, expect, it } from "vitest";
import {
  buildTotalReturnSeries,
  type LedgerTxLite,
  type PriceBar,
} from "@/app/lib/portfolio/total-return";
import {
  clipSeriesFromFirstBuy,
  isPerfPeriodEnabled,
} from "@/app/lib/portfolio/perf-aggregate";
import { checkSeriesLedgerParity } from "@/app/lib/portfolio/pnl-parity";
import type { PriceHistoryRange } from "@/app/lib/market/price-history-types";

function bar(date: string, close: number, label = date): PriceBar {
  return { date, label, close };
}

function buyTx(partial: Partial<LedgerTxLite> = {}): LedgerTxLite {
  return {
    type: "ACHAT",
    occurredAt: "2024-01-01T10:00:00.000Z",
    quantity: "10",
    unitPrice: "100",
    fees: "0",
    fxRateToEur: "1",
    grossAmountEur: "1000",
    feesEur: "0",
    ...partial,
  };
}

function sellTx(partial: Partial<LedgerTxLite> = {}): LedgerTxLite {
  return {
    type: "VENTE",
    occurredAt: "2024-01-05T10:00:00.000Z",
    quantity: "5",
    unitPrice: "110",
    fees: "0",
    fxRateToEur: "1",
    grossAmountEur: "550",
    feesEur: "0",
    ...partial,
  };
}

function dividendTx(partial: Partial<LedgerTxLite> = {}): LedgerTxLite {
  return {
    type: "DIVIDENDE",
    occurredAt: "2024-01-06T10:00:00.000Z",
    quantity: null,
    unitPrice: null,
    fees: "0",
    fxRateToEur: "1",
    grossAmountEur: "50",
    feesEur: "0",
    netCashImpactEur: "42.5",
    withholdingTaxEur: "7.5",
    ...partial,
  };
}

/** 10 barres quotidiennes consécutives, J1..J10. */
function tenDailyBars(closes: number[]): PriceBar[] {
  return closes.map((close, i) =>
    bar(`2024-01-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`, close)
  );
}

describe("buildTotalReturnSeries — position simple", () => {
  it("qty et totalPnlEur cohérents sur 10 barres, un seul achat", () => {
    const closes = [100, 101, 99, 103, 105, 104, 108, 110, 107, 112];
    const bars = tenDailyBars(closes);
    const txs: LedgerTxLite[] = [
      buyTx({
        occurredAt: "2024-01-01T08:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        grossAmountEur: "1000",
      }),
    ];

    const { series, summary } = buildTotalReturnSeries(bars, txs, {
      barInterval: "1d",
    });

    expect(series).toHaveLength(10);
    for (const p of series) {
      expect(p.qty).toBeCloseTo(10, 5);
    }

    const last = series[series.length - 1]!;
    // totalPnlEur = qty * (closeN - prixAchat) car pas de dividende / vente
    expect(last.totalPnlEur).toBeCloseTo(10 * (112 - 100), 5);
    expect(summary.totalPnlEur).toBeCloseTo(10 * (112 - 100), 5);

    const parity = checkSeriesLedgerParity(bars, txs, { barInterval: "1d" });
    expect(parity.ok).toBe(true);
    expect(parity.deltas).toEqual([]);
  });
});

describe("buildTotalReturnSeries — accrual dividende", () => {
  it("dividendReceivableEur > 0 à l'ex-date, = 0 au paiement, cumul net > 0 ensuite", () => {
    const bars: PriceBar[] = [
      bar("2024-01-01T12:00:00.000Z", 100), // achat
      bar("2024-01-02T12:00:00.000Z", 100),
      bar("2024-01-03T12:00:00.000Z", 100),
      bar("2024-01-04T12:00:00.000Z", 100),
      bar("2024-01-05T12:00:00.000Z", 100), // ex-date (J+5 depuis J1... on aligne exDate ici)
      bar("2024-01-06T12:00:00.000Z", 100),
      bar("2024-01-07T12:00:00.000Z", 100),
      bar("2024-01-08T12:00:00.000Z", 100),
      bar("2024-01-09T12:00:00.000Z", 100),
      bar("2024-01-10T12:00:00.000Z", 100), // payment date (J+10)
    ];

    const txs: LedgerTxLite[] = [
      buyTx({
        occurredAt: "2024-01-01T08:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        grossAmountEur: "1000",
      }),
      dividendTx({
        occurredAt: "2024-01-05T00:00:00.000Z",
        exDate: "2024-01-05T00:00:00.000Z",
        paymentDate: "2024-01-10T00:00:00.000Z",
        grossAmountEur: "50",
        netCashImpactEur: "42.5",
        withholdingTaxEur: "7.5",
      }),
    ];

    const { series } = buildTotalReturnSeries(bars, txs, { barInterval: "1d" });

    const exDayPoint = series.find((p) => p.date.startsWith("2024-01-05"))!;
    expect(exDayPoint.dividendReceivableEur).toBeGreaterThan(0);
    expect(exDayPoint.dividendReceivableEur).toBeCloseTo(42.5, 5);
    // pas encore encaissé net cash cumulé
    expect(exDayPoint.dividendsNetCumEur).toBeCloseTo(0, 5);

    const payDayPoint = series.find((p) => p.date.startsWith("2024-01-10"))!;
    expect(payDayPoint.dividendReceivableEur).toBeCloseTo(0, 5);
    expect(payDayPoint.dividendsNetCumEur).toBeGreaterThan(0);
    expect(payDayPoint.dividendsNetCumEur).toBeCloseTo(42.5, 5);
  });
});

describe("clipSeriesFromFirstBuy", () => {
  it("retire les barres antérieures au premier achat, le premier point retourné = jour de l'achat", () => {
    // 5 barres avant l'achat (pas de position), puis achat au 6e jour.
    const bars: PriceBar[] = [
      bar("2024-01-01T12:00:00.000Z", 90),
      bar("2024-01-02T12:00:00.000Z", 91),
      bar("2024-01-03T12:00:00.000Z", 92),
      bar("2024-01-04T12:00:00.000Z", 93),
      bar("2024-01-05T12:00:00.000Z", 94),
      bar("2024-01-06T12:00:00.000Z", 95), // achat ce jour
      bar("2024-01-07T12:00:00.000Z", 96),
    ];
    const firstBuyAt = "2024-01-06T08:00:00.000Z";
    const txs: LedgerTxLite[] = [
      buyTx({
        occurredAt: firstBuyAt,
        quantity: "10",
        unitPrice: "95",
        grossAmountEur: "950",
      }),
    ];

    const { series } = buildTotalReturnSeries(bars, txs, { barInterval: "1d" });
    const clipped = clipSeriesFromFirstBuy(series, firstBuyAt);

    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped[0]!.date.startsWith("2024-01-06")).toBe(true);
    expect(clipped).toHaveLength(2); // J6 + J7
  });
});

describe("isPerfPeriodEnabled — table-driven", () => {
  const RANGES: PriceHistoryRange[] = [
    "7d",
    "1m",
    "3m",
    "ytd",
    "1y",
    "5y",
    "all",
  ];

  it("position d'1 jour : seuls 7d et all sont actifs", () => {
    const now = new Date("2024-01-02T12:00:00.000Z");
    const firstBuyAt = "2024-01-01T10:00:00.000Z";
    const expected: Record<PriceHistoryRange, boolean> = {
      "7d": true,
      "1m": false,
      "3m": false,
      ytd: false, // achat déjà dans l'année en cours
      "1y": false,
      "5y": false,
      all: true,
    };
    for (const range of RANGES) {
      expect(isPerfPeriodEnabled(range, firstBuyAt, now)).toBe(
        expected[range]
      );
    }
  });

  it("position de 29 jours : 1m pas encore actif (seuil 30j)", () => {
    const now = new Date("2024-01-30T12:00:00.000Z");
    const firstBuyAt = "2024-01-01T12:00:00.000Z";
    const expected: Record<PriceHistoryRange, boolean> = {
      "7d": true,
      "1m": false,
      "3m": false,
      ytd: false,
      "1y": false,
      "5y": false,
      all: true,
    };
    for (const range of RANGES) {
      expect(isPerfPeriodEnabled(range, firstBuyAt, now)).toBe(
        expected[range]
      );
    }
  });

  it("YTD en janvier : actif seulement si le premier achat précède le 1er janvier courant", () => {
    const now = new Date("2024-01-15T12:00:00.000Z");

    // Achat l'année précédente → YTD actif
    expect(
      isPerfPeriodEnabled("ytd", "2023-12-20T10:00:00.000Z", now)
    ).toBe(true);

    // Achat cette année (après le 1er janvier) → YTD inactif
    expect(
      isPerfPeriodEnabled("ytd", "2024-01-10T10:00:00.000Z", now)
    ).toBe(false);
  });

  it("7d désactivé si barCount < 2", () => {
    const now = new Date("2024-01-10T12:00:00.000Z");
    const firstBuyAt = "2024-01-01T10:00:00.000Z";
    expect(isPerfPeriodEnabled("7d", firstBuyAt, now, 1)).toBe(false);
    expect(isPerfPeriodEnabled("7d", firstBuyAt, now, 2)).toBe(true);
    expect(isPerfPeriodEnabled("7d", firstBuyAt, now, undefined)).toBe(true);
  });

  it("all et 7d restent actifs même sans premier achat connu", () => {
    expect(isPerfPeriodEnabled("all", null)).toBe(true);
    expect(isPerfPeriodEnabled("7d", null)).toBe(true);
    expect(isPerfPeriodEnabled("1m", null)).toBe(false);
    expect(isPerfPeriodEnabled("ytd", null)).toBe(false);
  });
});

describe("checkSeriesLedgerParity", () => {
  it("position simple (achat seul) → parity ok, deltas vides", () => {
    const bars: PriceBar[] = [
      bar("2024-01-01T12:00:00.000Z", 100),
      bar("2024-01-02T12:00:00.000Z", 105),
      bar("2024-01-03T12:00:00.000Z", 110),
    ];
    const txs: LedgerTxLite[] = [
      buyTx({
        occurredAt: "2024-01-01T08:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        grossAmountEur: "1000",
      }),
    ];

    const parity = checkSeriesLedgerParity(bars, txs, { barInterval: "1d" });
    expect(parity.ok).toBe(true);
    expect(parity.deltas).toEqual([]);
    expect(parity.maxAbsDiff).toBeLessThanOrEqual(parity.tolerance);
  });

  it("vente partielle → parity ok (CUMP, réalisé, qty convergent)", () => {
    const bars: PriceBar[] = [
      bar("2024-01-01T12:00:00.000Z", 100),
      bar("2024-01-05T12:00:00.000Z", 110),
      bar("2024-01-10T12:00:00.000Z", 108),
    ];
    const txs: LedgerTxLite[] = [
      buyTx({
        occurredAt: "2024-01-01T08:00:00.000Z",
        quantity: "10",
        unitPrice: "100",
        grossAmountEur: "1000",
      }),
      sellTx({
        occurredAt: "2024-01-05T08:00:00.000Z",
        quantity: "5",
        unitPrice: "110",
        grossAmountEur: "550",
      }),
    ];

    const parity = checkSeriesLedgerParity(bars, txs, { barInterval: "1d" });
    expect(parity.ok).toBe(true);
    expect(parity.deltas).toEqual([]);
  });
});
