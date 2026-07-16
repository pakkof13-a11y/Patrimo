import { d, toFixed, type DecimalInput } from "../money/decimal";

/**
 * Monthly interest rate from annual percent (e.g. 3.5 => 0.035/12).
 */
export function monthlyRateFromAnnual(annualPercent: DecimalInput): number {
  const annual = d(annualPercent).div(100).toNumber();
  if (!Number.isFinite(annual) || annual <= 0) return 0;
  return annual / 12;
}

/**
 * Estimate remaining months for a fixed payment loan.
 * n = log(M / (M - P*r)) / log(1+r)  when r > 0 and M > P*r
 * n = ceil(P/M) when r = 0
 */
export function estimateRemainingMonths(
  principal: DecimalInput,
  monthlyPayment: DecimalInput,
  annualPercent: DecimalInput = 0
): number | null {
  const P = d(principal).toNumber();
  const M = d(monthlyPayment).toNumber();
  if (!(P > 0) || !(M > 0)) return null;

  const r = monthlyRateFromAnnual(annualPercent);
  if (r <= 0) {
    return Math.ceil(P / M);
  }
  if (M <= P * r) {
    // Payment does not cover interest — infinite horizon
    return null;
  }
  const n = Math.log(M / (M - P * r)) / Math.log(1 + r);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n);
}

/**
 * Remaining interest over the residual schedule (approximation).
 * Sum of interest portions for n months with fixed payment M.
 */
export function estimateRemainingInterest(
  principal: DecimalInput,
  monthlyPayment: DecimalInput,
  annualPercent: DecimalInput = 0
): string {
  let bal = d(principal);
  const M = d(monthlyPayment);
  const r = monthlyRateFromAnnual(annualPercent);
  if (bal.lte(0) || M.lte(0)) return "0";

  const months = estimateRemainingMonths(principal, monthlyPayment, annualPercent);
  if (months == null) {
    // Cap simulation to 600 months
    let interest = d(0);
    for (let i = 0; i < 600 && bal.gt(0); i++) {
      const iPart = bal.times(r);
      interest = interest.plus(iPart);
      const principalPart = M.minus(iPart);
      if (principalPart.lte(0)) break;
      bal = bal.minus(principalPart);
      if (bal.lt(0)) bal = d(0);
    }
    return toFixed(interest, 8);
  }

  let interest = d(0);
  for (let i = 0; i < months && bal.gt(0); i++) {
    const iPart = r > 0 ? bal.times(r) : d(0);
    interest = interest.plus(iPart);
    const due = bal.plus(iPart);
    const pay = M.lt(due) ? M : due;
    const principalPart = pay.minus(iPart);
    bal = bal.minus(principalPart.gt(0) ? principalPart : 0);
    if (bal.lt(0)) bal = d(0);
  }
  return toFixed(interest, 8);
}

/** Add calendar months to a date (day clamped to month length). */
export function addMonthsClamped(date: Date, months: number): Date {
  const d0 = new Date(date.getTime());
  const day = d0.getUTCDate();
  d0.setUTCDate(1);
  d0.setUTCMonth(d0.getUTCMonth() + months);
  const last = daysInUtcMonth(d0.getUTCFullYear(), d0.getUTCMonth());
  d0.setUTCDate(Math.min(day, last));
  return d0;
}

export function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Concrete payment date for a given year/month and preferred day (1–31).
 * Uses UTC calendar to stay stable across timezones for stored dates.
 */
export function paymentDateForMonth(year: number, monthIndex: number, paymentDay: number): Date {
  const last = daysInUtcMonth(year, monthIndex);
  const day = Math.max(1, Math.min(paymentDay, last));
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
}

/** Strip time — compare calendar days in UTC. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
}

export function dateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/**
 * List payment dates strictly after `afterExclusive` (or on/after start if null)
 * and on/before `now`, for the given payment day.
 */
export function duePaymentDates(opts: {
  paymentDay: number;
  startDate: Date | null;
  endDate: Date | null;
  lastPaymentAppliedAt: Date | null;
  now?: Date;
}): Date[] {
  const now = startOfUtcDay(opts.now ?? new Date());
  const paymentDay = Math.max(1, Math.min(31, Math.floor(opts.paymentDay)));
  const start = opts.startDate ? startOfUtcDay(opts.startDate) : null;
  const end = opts.endDate ? startOfUtcDay(opts.endDate) : null;
  const lastApplied = opts.lastPaymentAppliedAt
    ? startOfUtcDay(opts.lastPaymentAppliedAt)
    : null;

  // Begin scanning from the month of start (or last applied) — up to 600 months
  let y: number;
  let m: number;
  if (lastApplied) {
    y = lastApplied.getUTCFullYear();
    m = lastApplied.getUTCMonth();
  } else if (start) {
    y = start.getUTCFullYear();
    m = start.getUTCMonth();
  } else {
    // No start — only apply current month if payment day already passed
    y = now.getUTCFullYear();
    m = now.getUTCMonth();
  }

  const results: Date[] = [];
  for (let i = 0; i < 600; i++) {
    const pd = paymentDateForMonth(y, m, paymentDay);
    if (pd.getTime() > now.getTime()) break;
    if (end && pd.getTime() > end.getTime()) break;

    const afterStart = !start || pd.getTime() >= start.getTime();
    const afterLast = !lastApplied || pd.getTime() > lastApplied.getTime();
    if (afterStart && afterLast) {
      results.push(pd);
    }

    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return results;
}

/**
 * Apply one monthly debit on remaining capital.
 * Interest is not added to principal (capital-only reduction by full installment),
 * matching a simple "prélèvement de la mensualité sur le capital restant dû" model.
 * Cap at remaining so overpayment zeros the debt.
 */
export function applyMonthlyDebit(
  remaining: DecimalInput,
  monthlyPayment: DecimalInput
): { remaining: string; debited: string } {
  const bal = d(remaining);
  const pay = d(monthlyPayment);
  if (bal.lte(0) || pay.lte(0)) {
    return { remaining: toFixed(bal.gt(0) ? bal : d(0), 8), debited: "0" };
  }
  const debited = bal.lt(pay) ? bal : pay;
  const next = bal.minus(debited);
  return {
    remaining: toFixed(next.gt(0) ? next : d(0), 8),
    debited: toFixed(debited, 8),
  };
}

export function applyEarlyRepayment(
  remaining: DecimalInput,
  amount: DecimalInput,
  total: boolean
): { remaining: string; debited: string } {
  const bal = d(remaining);
  if (total || d(amount).gte(bal)) {
    return { remaining: "0", debited: toFixed(bal.gt(0) ? bal : d(0), 8) };
  }
  const pay = d(amount);
  if (pay.lte(0)) {
    return { remaining: toFixed(bal, 8), debited: "0" };
  }
  const next = bal.minus(pay);
  return {
    remaining: toFixed(next.gt(0) ? next : d(0), 8),
    debited: toFixed(pay, 8),
  };
}

/** Project end date from remaining + new monthly payment. */
export function projectEndDate(
  remaining: DecimalInput,
  monthlyPayment: DecimalInput,
  annualPercent: DecimalInput,
  from: Date = new Date()
): Date | null {
  const months = estimateRemainingMonths(remaining, monthlyPayment, annualPercent);
  if (months == null) return null;
  return addMonthsClamped(from, months);
}
