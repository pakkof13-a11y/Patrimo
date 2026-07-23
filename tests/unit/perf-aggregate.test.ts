import { describe, expect, it } from "vitest";
import {
  groupDataByInterval,
  resolvePerfAggregateInterval,
  buildAggregatedPerfSeries,
  applyPerfMetricMode,
  getFirstBuyAt,
  getPositionAgeDays,
  isPerfPeriodEnabled,
  clipSeriesFromFirstBuy,
} from "@/app/lib/portfolio/perf-aggregate";
import type { TotalReturnPoint } from "@/app/lib/portfolio/total-return";

function pt(
  date: string,
  opts: {
    periodPnlEur?: number;
    totalPnlEur?: number;
    pricePnlEur?: number;
    periodRealizedEur?: number;
    incomePnlEur?: number;
    latentPnlEur?: number;
    qty?: number;
    events?: TotalReturnPoint["events"];
  } = {}
): TotalReturnPoint {
  const period = opts.periodPnlEur ?? 0;
  const total = opts.totalPnlEur ?? period;
  const latent = opts.latentPnlEur ?? total;
  return {
    date,
    label: date.slice(0, 10),
    close: 100,
    qty: opts.qty ?? 1,
    qtyOpen: opts.qty ?? 1,
    cumpEur: 90,
    costBasisEur: 90,
    positionValue: 100,
    cashInvestedNet: 90,
    dividendsCum: 0,
    dividendsGrossCumEur: 0,
    dividendsNetCumEur: 0,
    withholdingCumEur: 0,
    dividendReceivableEur: 0,
    latentPnlEur: latent,
    latentPnlPct: 0,
    realizedPnlCumEur: 0,
    pricePnlEur: opts.pricePnlEur ?? period,
    periodRealizedEur: opts.periodRealizedEur ?? 0,
    incomePnlEur: opts.incomePnlEur ?? 0,
    incomeGrossEur: opts.incomePnlEur ?? 0,
    periodPnlEur: period,
    totalPnlEur: total,
    totalPnlPct: 0,
    totalReturnEur: total,
    totalReturnPct: 0,
    events: opts.events ?? [],
  };
}

describe("resolvePerfAggregateInterval", () => {
  it("maps fixed ranges", () => {
    expect(resolvePerfAggregateInterval("7d", [])).toBe("day");
    expect(resolvePerfAggregateInterval("1m", [])).toBe("day");
    expect(resolvePerfAggregateInterval("3m", [])).toBe("week");
    expect(resolvePerfAggregateInterval("1y", [])).toBe("week");
    expect(resolvePerfAggregateInterval("5y", [])).toBe("month");
  });

  it("adapts YTD/all to history span", () => {
    const short = [
      pt("2026-01-01T12:00:00.000Z"),
      pt("2026-02-15T12:00:00.000Z"),
    ];
    expect(resolvePerfAggregateInterval("ytd", short)).toBe("day");

    const mid = [
      pt("2024-01-01T12:00:00.000Z"),
      pt("2025-06-01T12:00:00.000Z"),
    ];
    expect(resolvePerfAggregateInterval("all", mid)).toBe("week");

    const long = [
      pt("2020-01-01T12:00:00.000Z"),
      pt("2026-01-01T12:00:00.000Z"),
    ];
    expect(resolvePerfAggregateInterval("all", long)).toBe("month");
  });
});

describe("groupDataByInterval — sum flux vs last stock", () => {
  it("sums periodPnl and keeps last totalPnl for a week bucket", () => {
    // Mon–Wed same ISO week
    const data = [
      pt("2026-06-15T12:00:00.000Z", { periodPnlEur: 10, totalPnlEur: 10 }),
      pt("2026-06-16T12:00:00.000Z", { periodPnlEur: -3, totalPnlEur: 7 }),
      pt("2026-06-17T12:00:00.000Z", { periodPnlEur: 5, totalPnlEur: 12 }),
    ];
    const out = groupDataByInterval(data, "week");
    expect(out.length).toBeGreaterThanOrEqual(1);
    const w = out[0]!;
    expect(w.periodPnlEur).toBeCloseTo(12, 5); // 10-3+5
    expect(w.totalPnlEur).toBeCloseTo(12, 5); // last
    expect(w.periodLabel.toLowerCase()).toContain("semaine");
  });

  it("sums daily buckets independently", () => {
    const data = [
      pt("2026-06-12T08:00:00.000Z", { periodPnlEur: 10, totalPnlEur: 10 }),
      pt("2026-06-12T16:00:00.000Z", { periodPnlEur: 5, totalPnlEur: 15 }),
      pt("2026-06-13T12:00:00.000Z", { periodPnlEur: 12, totalPnlEur: 27 }),
    ];
    const out = groupDataByInterval(data, "day");
    expect(out).toHaveLength(2);
    expect(out[0]!.periodPnlEur).toBeCloseTo(15, 5);
    expect(out[0]!.totalPnlEur).toBeCloseTo(15, 5);
    expect(out[1]!.periodPnlEur).toBeCloseTo(12, 5);
  });
});

describe("applyPerfMetricMode", () => {
  it("switches chartValue between period and cumul", () => {
    const base = groupDataByInterval(
      [
        pt("2026-06-10T12:00:00.000Z", {
          periodPnlEur: -5,
          totalPnlEur: 100,
        }),
      ],
      "day"
    );
    const period = applyPerfMetricMode(base, "period");
    expect(period[0]!.chartValueEur).toBeCloseTo(-5, 5);
    expect(period[0]!.pos).toBe(0);
    expect(period[0]!.neg).toBeCloseTo(-5, 5);

    const cumul = applyPerfMetricMode(base, "cumul");
    expect(cumul[0]!.chartValueEur).toBeCloseTo(100, 5);
    expect(cumul[0]!.pos).toBeCloseTo(100, 5);
  });
});

describe("buildAggregatedPerfSeries", () => {
  it("returns day aggregation for 7d in period mode", () => {
    const data = [
      pt("2026-06-10T12:00:00.000Z", { periodPnlEur: 1, totalPnlEur: 1 }),
      pt("2026-06-11T12:00:00.000Z", { periodPnlEur: 2, totalPnlEur: 3 }),
    ];
    const { intervalType, points } = buildAggregatedPerfSeries(
      data,
      "7d",
      "period"
    );
    expect(intervalType).toBe("day");
    expect(points).toHaveLength(2);
    expect(points[0]!.chartValueEur).toBe(1);
    expect(points[1]!.chartValueEur).toBe(2);
  });
});

describe("first buy & period gates", () => {
  it("finds earliest ACHAT", () => {
    expect(
      getFirstBuyAt([
        { type: "DIVIDENDE", occurredAt: "2025-01-01T00:00:00.000Z" },
        { type: "ACHAT", occurredAt: "2025-06-01T10:00:00.000Z" },
        { type: "ACHAT", occurredAt: "2025-03-15T10:00:00.000Z" },
        { type: "VENTE", occurredAt: "2025-02-01T00:00:00.000Z" },
      ])
    ).toBe("2025-03-15T10:00:00.000Z");
    expect(getFirstBuyAt([])).toBeNull();
  });

  it("clips series before first buy", () => {
    const series = [
      pt("2025-03-10T12:00:00.000Z", { qty: 0 }),
      pt("2025-03-15T12:00:00.000Z", {
        qty: 1,
        events: [
          {
            kind: "BUY",
            date: "2025-03-15T10:00:00.000Z",
            barDate: "2025-03-15T12:00:00.000Z",
            label: "A",
            amountEur: 1,
          },
        ],
      }),
      pt("2025-03-16T12:00:00.000Z", { qty: 1 }),
    ];
    // first point qty 0
    series[0]!.qty = 0;
    series[0]!.qtyOpen = 0;
    const clipped = clipSeriesFromFirstBuy(series, "2025-03-15T10:00:00.000Z");
    expect(clipped[0]!.date).toBe("2025-03-15T12:00:00.000Z");
    expect(clipped).toHaveLength(2);
    expect(clipSeriesFromFirstBuy(series, null)).toEqual([]);
  });

  it("clips on calendar day: midnight bar kept when buy is afternoon same day", () => {
    // Bar 00:00 UTC < buy 14:30 UTC same day — strict timestamp clip used to skip day 1
    const series = [
      pt("2025-03-14T00:00:00.000Z", { qty: 0 }),
      pt("2025-03-15T00:00:00.000Z", {
        qty: 10,
        totalPnlEur: 0,
        events: [
          {
            kind: "BUY",
            date: "2025-03-15T14:30:00.000Z",
            barDate: "2025-03-15T00:00:00.000Z",
            label: "Achat",
            amountEur: 1000,
          },
        ],
      }),
      pt("2025-03-16T00:00:00.000Z", { qty: 10, totalPnlEur: 50 }),
    ];
    const clipped = clipSeriesFromFirstBuy(
      series,
      "2025-03-15T14:30:00.000Z"
    );
    expect(clipped[0]!.date).toBe("2025-03-15T00:00:00.000Z");
    expect(clipped[0]!.totalPnlEur).toBe(0);
    expect(clipped).toHaveLength(2);
  });

  it("enables periods by age", () => {
    const now = new Date("2026-07-16T12:00:00.000Z");
    const buy45 = "2026-06-01T12:00:00.000Z";
    expect(isPerfPeriodEnabled("7d", buy45, now)).toBe(true);
    expect(isPerfPeriodEnabled("all", buy45, now)).toBe(true);
    expect(isPerfPeriodEnabled("1m", buy45, now)).toBe(true);
    expect(isPerfPeriodEnabled("3m", buy45, now)).toBe(false);
    expect(isPerfPeriodEnabled("1y", buy45, now)).toBe(false);
    expect(isPerfPeriodEnabled("5y", buy45, now)).toBe(false);
    expect(isPerfPeriodEnabled("ytd", buy45, now)).toBe(false);
    expect(isPerfPeriodEnabled("ytd", "2025-12-01T00:00:00.000Z", now)).toBe(
      true
    );

    const age = getPositionAgeDays("2025-07-16T12:00:00.000Z", now);
    expect(age).toBeGreaterThanOrEqual(364);
    expect(isPerfPeriodEnabled("1y", "2025-07-16T12:00:00.000Z", now)).toBe(
      age >= 365
    );
  });

  it("respects barCount for 7d period", () => {
    const now = new Date("2026-07-16T12:00:00.000Z");
    const buy45 = "2026-06-01T12:00:00.000Z";
    // 7d without barCount: always true
    expect(isPerfPeriodEnabled("7d", buy45, now)).toBe(true);
    // 7d with barCount undefined: always true
    expect(isPerfPeriodEnabled("7d", buy45, now, undefined)).toBe(true);
    // 7d with barCount < 2: false
    expect(isPerfPeriodEnabled("7d", buy45, now, 0)).toBe(false);
    expect(isPerfPeriodEnabled("7d", buy45, now, 1)).toBe(false);
    // 7d with barCount >= 2: true
    expect(isPerfPeriodEnabled("7d", buy45, now, 2)).toBe(true);
    expect(isPerfPeriodEnabled("7d", buy45, now, 5)).toBe(true);
    // all period: always true regardless of barCount
    expect(isPerfPeriodEnabled("all", buy45, now, 0)).toBe(true);
    expect(isPerfPeriodEnabled("all", buy45, now, 1)).toBe(true);
  });
});
