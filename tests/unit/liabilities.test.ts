import { describe, expect, it } from "vitest";
import {
  applyEarlyRepayment,
  applyMonthlyDebit,
  buildAmortizationSchedule,
  currentScheduleIndex,
  duePaymentDates,
  estimateRemainingMonths,
  nextPaymentDueDate,
  paymentDateForMonth,
  repaymentProgressPct,
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

  it("builds amortization schedule and progress", () => {
    const schedule = buildAmortizationSchedule({
      principal: "120000",
      annualPercent: "3.5",
      monthlyPayment: "1000",
      startDate: new Date(Date.UTC(2026, 0, 1)),
      paymentDay: 5,
      maxMonths: 360,
    });
    expect(schedule.length).toBeGreaterThan(10);
    expect(Number(schedule[0]!.interest)).toBeGreaterThan(0);
    expect(Number(schedule[0]!.principalPaid)).toBeGreaterThan(0);
    // capital diminue
    expect(Number(schedule[5]!.remainingAfter)).toBeLessThan(
      Number(schedule[0]!.remainingAfter)
    );
    expect(repaymentProgressPct("100", "40")).toBe(60);
    expect(repaymentProgressPct("100", "0")).toBe(100);

    const idx = currentScheduleIndex(schedule, schedule[3]!.remainingAfter);
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("adds monthly insurance on top of principal + interest without touching capital amortization", () => {
    const withoutInsurance = buildAmortizationSchedule({
      principal: "120000",
      annualPercent: "3.5",
      monthlyPayment: "1000",
      startDate: new Date(Date.UTC(2026, 0, 1)),
      paymentDay: 5,
      maxMonths: 360,
    });
    const withInsurance = buildAmortizationSchedule({
      principal: "120000",
      annualPercent: "3.5",
      monthlyPayment: "1000",
      startDate: new Date(Date.UTC(2026, 0, 1)),
      paymentDay: 5,
      maxMonths: 360,
      insuranceMonthly: "25",
    });
    // Assurance affichée chaque mois, mais sans effet sur le capital restant
    // (l'amortissement reste calculé hors assurance).
    expect(withInsurance[0]!.insurance).toBe("25.00000000");
    expect(withInsurance[0]!.principalPaid).toBe(withoutInsurance[0]!.principalPaid);
    expect(withInsurance[0]!.remainingAfter).toBe(withoutInsurance[0]!.remainingAfter);
    // La mensualité affichée inclut l'assurance en plus.
    expect(Number(withInsurance[0]!.payment)).toBeCloseTo(
      Number(withoutInsurance[0]!.payment) + 25,
      6
    );
    // Défaut (absent) : colonne assurance à 0, comportement inchangé.
    expect(withoutInsurance[0]!.insurance).toBe("0.00000000");
  });

  it("computes next payment due date after last applied", () => {
    const next = nextPaymentDueDate({
      paymentDay: 10,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: null,
      lastPaymentAppliedAt: new Date(Date.UTC(2026, 2, 10)),
      now: new Date(Date.UTC(2026, 2, 15)),
    });
    expect(next?.toISOString().slice(0, 10)).toBe("2026-04-10");
  });
});
