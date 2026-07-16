import { d, toFixed, type DecimalInput } from "./decimal";

export type RateType = "APR" | "APY";
export type PayoutFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export const PERIODS_PER_YEAR: Record<PayoutFrequency, number> = {
  DAILY: 365,
  WEEKLY: 52,
  MONTHLY: 12,
  YEARLY: 1,
};

export const WEEKDAY_LABELS_FR = [
  "", // 1-indexed ISO
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
] as const;

export const MONTH_LABELS_FR = [
  "",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
] as const;

/**
 * Periodic rate from annual rate R (as decimal, e.g. 0.05 for 5%) and n periods/year.
 * APR: R/n
 * APY: (1+R)^(1/n) - 1
 */
export function periodRate(
  annualRateDecimal: number,
  periodsPerYear: number,
  rateType: RateType
): number {
  if (annualRateDecimal <= 0 || periodsPerYear <= 0) return 0;
  if (rateType === "APR") {
    return annualRateDecimal / periodsPerYear;
  }
  // APY
  return Math.pow(1 + annualRateDecimal, 1 / periodsPerYear) - 1;
}

/** Interest for one period: balance × r_period */
export function periodInterest(
  balance: DecimalInput,
  annualPercent: DecimalInput,
  frequency: PayoutFrequency,
  rateType: RateType
) {
  const bal = d(balance);
  const R = d(annualPercent).div(100).toNumber();
  const n = PERIODS_PER_YEAR[frequency] || 365;
  const r = periodRate(R, n, rateType);
  if (bal.lte(0) || r <= 0) return d(0);
  return bal.times(r);
}

/** @deprecated use periodInterest with DAILY + APY — kept for compatibility */
export function dailyInterest(balance: DecimalInput, apyPercent: DecimalInput) {
  return periodInterest(balance, apyPercent, "DAILY", "APY");
}

export type SavingsSchedule = {
  rateType: RateType;
  payoutFrequency: PayoutFrequency;
  /** ISO 1=Mon … 7=Sun */
  payoutDayOfWeek?: number | null;
  payoutDayOfMonth?: number | null;
  payoutMonth?: number | null;
};

function startOfLocalDay(d0: Date): Date {
  return new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
}

function addDays(d0: Date, days: number): Date {
  const x = new Date(d0);
  x.setDate(x.getDate() + days);
  return startOfLocalDay(x);
}

/** ISO weekday 1=Mon … 7=Sun */
function isoWeekday(d0: Date): number {
  const js = d0.getDay(); // 0=Sun
  return js === 0 ? 7 : js;
}

function clampDayOfMonth(year: number, month: number, day: number): number {
  // month 0-indexed for Date
  const last = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

/**
 * List payout dates in (lastPayout, now] according to schedule.
 * lastPayout exclusive — next due after lastPayout.
 */
export function duePayoutDates(
  schedule: SavingsSchedule,
  lastPayoutAt: Date | null | undefined,
  createdAt: Date,
  now: Date = new Date()
): Date[] {
  const end = startOfLocalDay(now);
  const start = startOfLocalDay(lastPayoutAt || createdAt);
  // First eligible day is the day AFTER last payout (or created day if never paid — include created if matches rule and lastPayout null)
  let cursor = lastPayoutAt ? addDays(start, 1) : start;
  if (cursor > end) return [];

  const dates: Date[] = [];
  const maxIterations = 4000; // safety ~11 years daily
  let i = 0;

  while (cursor <= end && i < maxIterations) {
    i++;
    if (matchesSchedule(cursor, schedule)) {
      dates.push(new Date(cursor));
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function matchesSchedule(day: Date, schedule: SavingsSchedule): boolean {
  const freq = schedule.payoutFrequency || "DAILY";
  if (freq === "DAILY") return true;

  if (freq === "WEEKLY") {
    const target = schedule.payoutDayOfWeek ?? 1;
    return isoWeekday(day) === target;
  }

  if (freq === "MONTHLY") {
    const target = schedule.payoutDayOfMonth ?? 1;
    const clamped = clampDayOfMonth(day.getFullYear(), day.getMonth(), target);
    return day.getDate() === clamped;
  }

  if (freq === "YEARLY") {
    const month = (schedule.payoutMonth ?? 12) - 1; // 0-indexed
    const targetDay = schedule.payoutDayOfMonth ?? 31;
    if (day.getMonth() !== month) return false;
    const clamped = clampDayOfMonth(day.getFullYear(), month, targetDay);
    return day.getDate() === clamped;
  }

  return false;
}

/**
 * Apply sequential period credits for all due payout dates.
 * Returns new balance and lastPayoutAt.
 */
export function creditDueInterest(params: {
  balance: DecimalInput;
  annualPercent: DecimalInput;
  rateType: RateType;
  schedule: SavingsSchedule;
  lastPayoutAt: Date | null | undefined;
  createdAt: Date;
  now?: Date;
}): {
  balance: string;
  lastPayoutAt: Date | null;
  periodsCredited: number;
  totalInterest: string;
  periodInterest: string;
} {
  const now = params.now ?? new Date();
  const dates = duePayoutDates(
    params.schedule,
    params.lastPayoutAt,
    params.createdAt,
    now
  );

  let bal = d(params.balance);
  let total = d(0);
  let last = params.lastPayoutAt ? new Date(params.lastPayoutAt) : null;
  const onePeriod = periodInterest(
    bal,
    params.annualPercent,
    params.schedule.payoutFrequency,
    params.rateType
  );

  for (const pd of dates) {
    const interest = periodInterest(
      bal,
      params.annualPercent,
      params.schedule.payoutFrequency,
      params.rateType
    );
    if (interest.gt(0)) {
      bal = bal.plus(interest);
      total = total.plus(interest);
    }
    last = pd;
  }

  return {
    balance: toFixed(bal, 8),
    lastPayoutAt: last,
    periodsCredited: dates.length,
    totalInterest: toFixed(total, 8),
    periodInterest: toFixed(onePeriod, 8),
  };
}

/**
 * Display: booked balance + pro-rata accrual since last payout (for UI only).
 * For DAILY schedule with credits applied, pro-rata is ~0.
 */
export function savingsDisplayBalance(
  principal: DecimalInput,
  annualPercent: DecimalInput,
  lastAccruedAt: Date,
  now: Date = new Date(),
  rateType: RateType = "APY",
  frequency: PayoutFrequency = "DAILY"
): { displayBalance: string; daysElapsed: number; dailyInterest: string; periodInterest: string } {
  const bal = d(principal);
  const R = d(annualPercent).div(100).toNumber();
  const ms = Math.max(0, now.getTime() - lastAccruedAt.getTime());
  const daysElapsed = Math.floor(ms / (24 * 60 * 60 * 1000));

  // Pro-rata linear accrual for display between payouts
  let display = bal;
  if (bal.gt(0) && R > 0 && daysElapsed > 0) {
    if (rateType === "APY") {
      const factor = Math.pow(1 + R, daysElapsed / 365);
      display = bal.times(factor);
    } else {
      // APR simple
      display = bal.plus(bal.times(R).times(daysElapsed / 365));
    }
  }

  const pInt = periodInterest(bal, annualPercent, frequency, rateType);

  return {
    displayBalance: toFixed(display, 8),
    daysElapsed,
    dailyInterest: toFixed(periodInterest(display, annualPercent, "DAILY", rateType), 8),
    periodInterest: toFixed(pInt, 8),
  };
}

/** Only count cash if strictly > 0 (no phantom valuation) */
export function positiveCashOnly(amount: DecimalInput): boolean {
  return d(amount).gt(0);
}

export function describePayoutRule(schedule: SavingsSchedule): string {
  switch (schedule.payoutFrequency) {
    case "DAILY":
      return "Chaque jour";
    case "WEEKLY": {
      const d = schedule.payoutDayOfWeek ?? 1;
      return `Chaque ${WEEKDAY_LABELS_FR[d] || "Lundi"}`;
    }
    case "MONTHLY":
      return `Le ${schedule.payoutDayOfMonth ?? 1} de chaque mois`;
    case "YEARLY": {
      const m = schedule.payoutMonth ?? 12;
      const day = schedule.payoutDayOfMonth ?? 31;
      return `Le ${day} ${MONTH_LABELS_FR[m] || ""}`.trim();
    }
    default:
      return schedule.payoutFrequency;
  }
}
