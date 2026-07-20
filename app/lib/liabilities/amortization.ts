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

/** Progression de remboursement : 0–100 (% du capital initial déjà remboursé). */
export function repaymentProgressPct(
  initial: DecimalInput,
  remaining: DecimalInput
): number {
  const i = d(initial);
  if (i.lte(0)) return 0;
  const rem = d(remaining);
  if (rem.lte(0)) return 100;
  if (rem.gte(i)) return 0;
  const paid = i.minus(rem);
  return Math.min(100, Math.max(0, paid.div(i).times(100).toNumber()));
}

/**
 * Prochaine date d’échéance (jour de prélèvement) strictement après lastApplied
 * (ou ≥ start / aujourd’hui).
 */
export function nextPaymentDueDate(opts: {
  paymentDay: number | null | undefined;
  startDate: Date | null;
  endDate: Date | null;
  lastPaymentAppliedAt: Date | null;
  now?: Date;
}): Date | null {
  if (opts.paymentDay == null || opts.paymentDay < 1) return null;
  const paymentDay = Math.max(1, Math.min(31, Math.floor(opts.paymentDay)));
  const now = startOfUtcDay(opts.now ?? new Date());
  const start = opts.startDate ? startOfUtcDay(opts.startDate) : null;
  const end = opts.endDate ? startOfUtcDay(opts.endDate) : null;
  const lastApplied = opts.lastPaymentAppliedAt
    ? startOfUtcDay(opts.lastPaymentAppliedAt)
    : null;

  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  if (lastApplied) {
    // mois suivant le dernier prélèvement
    y = lastApplied.getUTCFullYear();
    m = lastApplied.getUTCMonth() + 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  } else if (start && start.getTime() > now.getTime()) {
    y = start.getUTCFullYear();
    m = start.getUTCMonth();
  }

  for (let i = 0; i < 600; i++) {
    const pd = paymentDateForMonth(y, m, paymentDay);
    const afterStart = !start || pd.getTime() >= start.getTime();
    const afterLast = !lastApplied || pd.getTime() > lastApplied.getTime();
    const notPast = pd.getTime() >= now.getTime() || (!lastApplied && afterStart);
    // prochaine = première date ≥ now (ou > lastApplied) dans le futur / aujourd’hui
    if (afterStart && afterLast && pd.getTime() >= now.getTime()) {
      if (end && pd.getTime() > end.getTime()) return null;
      return pd;
    }
    // si on scanne encore le passé sans lastApplied, avancer
    if (!notPast || !afterLast) {
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      continue;
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return null;
}

export type AmortizationRow = {
  /** 1-based installment index */
  index: number;
  dueDate: string | null;
  principalPaid: string;
  interest: string;
  insurance: string;
  payment: string;
  remainingAfter: string;
};

/**
 * Tableau d’amortissement prévisionnel (échéances mensuelles à taux fixe).
 * Assurance mensuelle optionnelle (sinon 0 — pas de champ Prisma dédié).
 */
export function buildAmortizationSchedule(opts: {
  principal: DecimalInput;
  annualPercent: DecimalInput;
  monthlyPayment: DecimalInput;
  startDate?: Date | null;
  paymentDay?: number | null;
  /** plafonne le tableau (défaut 480 = 40 ans) */
  maxMonths?: number;
  insuranceMonthly?: DecimalInput;
}): AmortizationRow[] {
  let bal = d(opts.principal);
  const M = d(opts.monthlyPayment);
  const r = monthlyRateFromAnnual(opts.annualPercent);
  const ins = d(opts.insuranceMonthly ?? 0);
  if (bal.lte(0) || M.lte(0)) return [];

  const max = opts.maxMonths ?? 480;
  const day =
    opts.paymentDay != null && opts.paymentDay >= 1
      ? Math.min(31, Math.floor(opts.paymentDay))
      : 1;
  const start = opts.startDate
    ? startOfUtcDay(opts.startDate)
    : startOfUtcDay(new Date());

  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const rows: AmortizationRow[] = [];

  for (let i = 0; i < max && bal.gt(0.00000001); i++) {
    const due = paymentDateForMonth(y, m, day);
    const interest = r > 0 ? bal.times(r) : d(0);
    // Mensualité hors assurance ; capital = M - intérêts (plafonné)
    let principalPart = M.minus(interest);
    if (principalPart.lt(0)) {
      // Mensualité ne couvre pas les intérêts — on arrête (scénario pathologique)
      rows.push({
        index: i + 1,
        dueDate: due.toISOString(),
        principalPaid: "0",
        interest: toFixed(interest, 8),
        insurance: toFixed(ins, 8),
        payment: toFixed(M.plus(ins), 8),
        remainingAfter: toFixed(bal, 8),
      });
      break;
    }
    if (principalPart.gt(bal)) principalPart = bal;
    const payCore = principalPart.plus(interest);
    bal = bal.minus(principalPart);
    if (bal.lt(0)) bal = d(0);

    rows.push({
      index: i + 1,
      dueDate: due.toISOString(),
      principalPaid: toFixed(principalPart, 8),
      interest: toFixed(interest, 8),
      insurance: toFixed(ins, 8),
      payment: toFixed(payCore.plus(ins), 8),
      remainingAfter: toFixed(bal, 8),
    });

    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return rows;
}

/** Index (0-based) de l’échéance courante / prochaine dans le tableau. */
export function currentScheduleIndex(
  schedule: AmortizationRow[],
  remainingCapital: DecimalInput,
  now: Date = new Date()
): number {
  if (schedule.length === 0) return -1;
  const nowT = startOfUtcDay(now).getTime();
  // 1) première échéance dont la date ≥ aujourd’hui
  for (let i = 0; i < schedule.length; i++) {
    const iso = schedule[i]!.dueDate;
    if (!iso) continue;
    if (startOfUtcDay(new Date(iso)).getTime() >= nowT) return i;
  }
  // 2) sinon la plus proche du capital restant actuel
  const rem = d(remainingCapital);
  let best = schedule.length - 1;
  let bestDelta = Infinity;
  for (let i = 0; i < schedule.length; i++) {
    const delta = d(schedule[i]!.remainingAfter).minus(rem).abs().toNumber();
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}
