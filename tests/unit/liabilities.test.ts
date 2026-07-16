import { describe, expect, it } from "vitest";
import {
  applyEarlyRepayment,
  applyMonthlyDebit,
  duePaymentDates,
  estimateRemainingMonths,
  paymentDateForMonth,
} from "@/app/lib/liabilities/amortization";

describe("liability amortization", () => {
  it("applies monthly debit capped at remaining", () => {
    expect(applyMonthlyDebit("1000", "250")).toEqual({
      remaining: "750.00000000",
      debited: "250.00000000",
    });
    expect(applyMonthlyDebit("100", "250").remaining).toBe("0.00000000");
  });

  it("handles partial and total early repayment", () => {
    expect(applyEarlyRepayment("10000", "2000", false).remaining).toBe("8000.00000000");
    expect(applyEarlyRepayment("10000", "1", true).remaining).toBe("0");
  });

  it("estimates remaining months with and without interest", () => {
    expect(estimateRemainingMonths("12000", "1000", "0")).toBe(12);
    const withRate = estimateRemainingMonths("100000", "1000", "3.5");
    expect(withRate).not.toBeNull();
    expect(withRate!).toBeGreaterThan(100);
  });

  it("clamps payment day in short months", () => {
    const feb = paymentDateForMonth(2026, 1, 31);
    expect(feb.getUTCDate()).toBe(28);
  });

  it("lists due payment dates after last applied", () => {
    const dates = duePaymentDates({
      paymentDay: 5,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: null,
      lastPaymentAppliedAt: new Date(Date.UTC(2026, 0, 5)),
      now: new Date(Date.UTC(2026, 2, 10)),
    });
    // Feb 5 and Mar 5
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-02-05",
      "2026-03-05",
    ]);
  });
});
