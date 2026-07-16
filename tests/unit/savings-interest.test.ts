import { describe, expect, it } from "vitest";
import {
  periodRate,
  periodInterest,
  duePayoutDates,
  creditDueInterest,
  matchesSchedule,
} from "../../app/lib/money/savings";

describe("periodRate APR / APY", () => {
  it("APR monthly is R/12", () => {
    const r = periodRate(0.12, 12, "APR");
    expect(r).toBeCloseTo(0.01, 8);
  });

  it("APY monthly compounds to annual APY", () => {
    const R = 0.05;
    const r = periodRate(R, 12, "APY");
    const compounded = Math.pow(1 + r, 12) - 1;
    expect(compounded).toBeCloseTo(R, 10);
  });

  it("APY daily compounds to annual APY", () => {
    const R = 0.03;
    const r = periodRate(R, 365, "APY");
    const compounded = Math.pow(1 + r, 365) - 1;
    expect(compounded).toBeCloseTo(R, 8);
  });
});

describe("periodInterest", () => {
  it("APR monthly on 12000 @ 12%", () => {
    // r = 0.01 → interest = 120
    const i = periodInterest(12000, 12, "MONTHLY", "APR");
    expect(Number(i.toString())).toBeCloseTo(120, 4);
  });
});

describe("duePayoutDates", () => {
  it("daily yields each day in range", () => {
    const start = new Date(2024, 0, 1);
    const end = new Date(2024, 0, 5);
    const dates = duePayoutDates(
      { rateType: "APY", payoutFrequency: "DAILY" },
      null,
      start,
      end
    );
    expect(dates.length).toBe(5);
  });

  it("weekly only matches weekday", () => {
    // 2024-01-01 is Monday
    const start = new Date(2024, 0, 1);
    const end = new Date(2024, 0, 14);
    const dates = duePayoutDates(
      { rateType: "APY", payoutFrequency: "WEEKLY", payoutDayOfWeek: 1 },
      null,
      start,
      end
    );
    expect(dates.length).toBe(2); // Jan 1 and Jan 8
    expect(dates[0].getDate()).toBe(1);
    expect(dates[1].getDate()).toBe(8);
  });

  it("matches monthly schedule with clamp", () => {
    const feb = new Date(2024, 1, 29); // leap year
    expect(
      matchesSchedule(feb, {
        rateType: "APR",
        payoutFrequency: "MONTHLY",
        payoutDayOfMonth: 31,
      })
    ).toBe(true);
  });
});

describe("creditDueInterest", () => {
  it("credits daily APR over 2 days", () => {
    const created = new Date(2024, 0, 1);
    const now = new Date(2024, 0, 2);
    const res = creditDueInterest({
      balance: 10000,
      annualPercent: 36.5, // 0.1% per day APR roughly (36.5/365=0.1)
      rateType: "APR",
      schedule: { rateType: "APR", payoutFrequency: "DAILY" },
      lastPayoutAt: null,
      createdAt: created,
      now,
    });
    expect(res.periodsCredited).toBe(2);
    // 10000 * 0.001 = 10 per day, sequential: 10000→10010→10020.01
    expect(Number(res.balance)).toBeGreaterThan(10020);
    expect(Number(res.totalInterest)).toBeGreaterThan(20);
  });
});
