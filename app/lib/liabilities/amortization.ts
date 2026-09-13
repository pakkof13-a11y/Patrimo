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
 * Borne de projection effective d'une dette — la date après laquelle une
 * échéance compte encore.
 *
 * `lastPaymentAppliedAt` dit jusqu'où les échéances ont déjà été inscrites.
 * PAS-01 le pose à la création et à toute resaisie du capital restant dû, mais
 * seulement en avant : les dettes antérieures l'ont encore à `null`. Or `null`
 * ne veut pas dire « rien n'a jamais été payé » — il veut dire « on ne sait
 * pas », et `duePaymentDates`, faute de borne, repart de `startDate`.
 *
 * PAS-02 a coupé ce rattrapage sur le chemin d'écriture
 * (`sealPaymentBaseline`). Les lecteurs, eux, continuaient de passer la ligne
 * brute : ils rejouaient à l'affichage toutes les mensualités depuis l'origine
 * du prêt, sur un solde stocké déjà à jour — 41 779 € de moins sur le crédit
 * immobilier du compte de démonstration, et un crédit conso affiché soldé.
 *
 * La seule chose que la base sache vraiment, c'est que `remainingAmount` était
 * vrai au dernier moment où la ligne a été écrite : `updatedAt`. C'est la borne
 * de repli, et elle ne reconstitue aucun historique — aucune échéance passée
 * n'est matérialisée, ni même projetée.
 *
 * Pure, et sans requête : `updatedAt` est une colonne de la ligne déjà chargée,
 * donc aucun lecteur de liste n'y gagne un N+1. Le chemin d'écriture affine
 * cette borne avec le dernier `MONTHLY_DEBIT` inscrit
 * (`paymentBaselineFor`, qui délègue ici) : il peut se permettre la requête, et
 * la borne qu'il scelle est ≥ celle-ci, jamais en dessous.
 */
export function effectivePaymentBaseline(
  liability: { lastPaymentAppliedAt: Date | null; updatedAt: Date },
  lastMonthlyDebitAt: Date | null = null
): Date {
  if (liability.lastPaymentAppliedAt) return liability.lastPaymentAppliedAt;
  const fromRow = startOfUtcDay(liability.updatedAt);
  if (!lastMonthlyDebitAt) return fromRow;
  const fromEvent = startOfUtcDay(lastMonthlyDebitAt);
  return fromEvent.getTime() > fromRow.getTime() ? fromEvent : fromRow;
}

/**
 * List payment dates strictly after `afterExclusive` (or on/after start if null)
 * and on/before `now`, for the given payment day.
 *
 * Primitive bas niveau : elle prend la borne telle qu'on la lui donne, et `null`
 * y vaut toujours « repartir de `startDate` » — le module Loyers
 * (`real-estate/rent-schedule`) en dépend. Un lecteur qui part d'une ligne
 * `Liability` ne l'appelle donc pas directement : il passe par
 * `remainingAmountAt` / `projectDuePaymentsForLiability`, qui résolvent la borne
 * avec `effectivePaymentBaseline`.
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
 * Taux mensuel en Decimal (pas `monthlyRateFromAnnual`, qui rend un `number` —
 * cohérence Decimal.js pour un calcul qui écrit en base). Null/0/négatif → 0,
 * ce qui préserve le comportement linéaire historique quand aucun taux n'est
 * saisi.
 */
function monthlyRateDecimal(annualPercent: DecimalInput | null | undefined) {
  if (annualPercent == null) return d(0);
  const annual = d(annualPercent);
  if (annual.lte(0)) return d(0);
  return annual.div(100).div(12);
}

/**
 * Apply one monthly debit — annuité standard (intérêts d'abord), même formule
 * que `buildAmortizationSchedule`/`estimateRemainingInterest`/
 * `principalPaidOfInstallment` : interest = capital restant × taux mensuel,
 * principal = mensualité − intérêts (plafonné au capital restant). Sans taux
 * (null/0), l'intérêt est nul et la mensualité entière va au capital —
 * comportement linéaire inchangé.
 *
 * `debited` (le montant réellement prélevé) vaut la mensualité pleine, sauf à
 * la dernière échéance : elle ne prélève que ce qu'il faut pour solder
 * (capital restant + intérêts du mois), jamais la mensualité entière si elle
 * excède la dette — même convention que `estimateRemainingInterest`.
 *
 * Si la mensualité ne couvre pas les intérêts, rien n'est prélevé (`debited`
 * = "0") : même garde que `buildAmortizationSchedule`, pour que l'appelant
 * (`projectDuePayments`) s'arrête au lieu de faire croître la dette en boucle.
 */
export function applyMonthlyDebit(
  remaining: DecimalInput,
  monthlyPayment: DecimalInput,
  annualPercent?: DecimalInput | null
): { remaining: string; debited: string } {
  const bal = d(remaining);
  const pay = d(monthlyPayment);
  if (bal.lte(0) || pay.lte(0)) {
    return { remaining: toFixed(bal.gt(0) ? bal : d(0), 8), debited: "0" };
  }
  const r = monthlyRateDecimal(annualPercent);
  const interest = r.gt(0) ? bal.times(r) : d(0);
  let principal = pay.minus(interest);
  if (principal.lte(0)) {
    return { remaining: toFixed(bal, 8), debited: "0" };
  }
  let debited = pay;
  if (principal.gte(bal)) {
    principal = bal;
    debited = bal.plus(interest);
  }
  const next = bal.minus(principal);
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

export type EarlyRepaymentSimulation = {
  newRemaining: string;
  monthsBefore: number | null;
  monthsAfter: number | null;
  interestBefore: string;
  interestAfter: string;
  interestSaved: string;
  isFullRepayment: boolean;
};

/**
 * Simulation pure (aucune écriture) : effet d’un remboursement anticipé de
 * `extraAmount` sur la durée et les intérêts restants, à mensualité et taux
 * inchangés. Réutilise applyEarlyRepayment / estimateRemainingMonths /
 * estimateRemainingInterest — pas de recalcul de maths ici.
 */
export function simulateEarlyRepayment(opts: {
  remaining: DecimalInput;
  monthlyPayment: DecimalInput;
  annualPercent?: DecimalInput;
  extraAmount: DecimalInput;
}): EarlyRepaymentSimulation {
  const remaining = d(opts.remaining);
  const monthlyPayment = opts.monthlyPayment;
  const annualPercent = opts.annualPercent ?? 0;
  const extra = d(opts.extraAmount);

  const monthsBefore = estimateRemainingMonths(remaining, monthlyPayment, annualPercent);
  const interestBefore = estimateRemainingInterest(remaining, monthlyPayment, annualPercent);

  if (remaining.lte(0) || extra.lte(0)) {
    return {
      newRemaining: toFixed(remaining.gt(0) ? remaining : d(0), 8),
      monthsBefore,
      monthsAfter: monthsBefore,
      interestBefore,
      interestAfter: interestBefore,
      interestSaved: "0",
      isFullRepayment: remaining.lte(0),
    };
  }

  const isFullRepayment = extra.gte(remaining);
  const { remaining: newRemaining } = applyEarlyRepayment(remaining, extra, isFullRepayment);

  const monthsAfter = isFullRepayment
    ? 0
    : estimateRemainingMonths(newRemaining, monthlyPayment, annualPercent);
  const interestAfter = isFullRepayment
    ? "0"
    : estimateRemainingInterest(newRemaining, monthlyPayment, annualPercent);

  const saved = d(interestBefore).minus(d(interestAfter));
  const interestSaved = toFixed(saved.gt(0) ? saved : d(0), 8);

  return {
    newRemaining,
    monthsBefore,
    monthsAfter,
    interestBefore,
    interestAfter,
    interestSaved,
    isFullRepayment,
  };
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

/** Une échéance due, telle qu'elle sera matérialisée si on l'écrit. */
export type DuePayment = {
  eventDate: Date;
  /** Montant réellement prélevé — plafonné au capital restant. */
  debited: string;
  /** Capital dû après ce prélèvement. */
  remainingAfter: string;
};

export type DuePaymentProjection = {
  /** Capital restant dû à la date de référence, échéances dues comprises. */
  remaining: string;
  /** Dernière échéance retenue — devient `lastPaymentAppliedAt` si matérialisée. */
  lastAppliedAt: Date | null;
  /** Les échéances dues, dans l'ordre. Vide si rien n'est dû. */
  payments: DuePayment[];
};

/**
 * Capital restant dû **à une date donnée**, sans rien écrire.
 *
 * Une mensualité n'attend pas qu'on la regarde pour être prélevée : entre deux
 * visites, la dette baisse. Deux façons de le rendre : recalculer la valeur au
 * moment de l'afficher, ou l'écrire en base quand on la découvre.
 *
 * Le dépôt faisait les deux — mais pas au même endroit. Le module Crédits
 * écrivait (`applyDuePaymentsForUser`), le tableau de bord lisait le solde
 * stocké. Le patrimoine net dépendait donc de l'écran ouvert en dernier :
 * 64 020 € d'écart sur le compte de démonstration, et une assiette IFI qui
 * bougeait de 57 820 € pour la même raison.
 *
 * Cette fonction est le versant « calcul » de cette séparation, sur le modèle
 * de `savingsDisplayBalance()` pour les livrets. Elle ne touche ni la base ni
 * ses arguments. `applyDuePaymentsForLiability` s'en sert pour décider quoi
 * écrire, de sorte que les deux chemins ne peuvent pas diverger : la règle
 * d'amortissement n'existe qu'ici.
 */
export function projectDuePayments(input: {
  remainingAmount: DecimalInput;
  monthlyPayment: DecimalInput | null;
  paymentDay: number | null;
  startDate: Date | null;
  endDate: Date | null;
  lastPaymentAppliedAt: Date | null;
  interestRate: DecimalInput | null;
  now?: Date;
}): DuePaymentProjection {
  const remaining0 = toFixed(d(input.remainingAmount), 8);
  const idle: DuePaymentProjection = {
    remaining: remaining0,
    lastAppliedAt: input.lastPaymentAppliedAt,
    payments: [],
  };

  // Mêmes gardes que la matérialisation, dans le même ordre : une dette sans
  // échéancier, sans mensualité ou déjà soldée ne bouge pas.
  if (!input.paymentDay || input.monthlyPayment == null) return idle;
  const payment = d(input.monthlyPayment).toString();
  if (d(payment).lte(0)) return idle;
  if (d(remaining0).lte(0)) return idle;

  const dates = duePaymentDates({
    paymentDay: input.paymentDay,
    startDate: input.startDate,
    endDate: input.endDate,
    lastPaymentAppliedAt: input.lastPaymentAppliedAt,
    now: input.now,
  });
  if (dates.length === 0) return idle;

  let remaining = remaining0;
  let lastAppliedAt = input.lastPaymentAppliedAt;
  const payments: DuePayment[] = [];

  for (const eventDate of dates) {
    if (d(remaining).lte(0)) break;
    const { remaining: next, debited } = applyMonthlyDebit(
      remaining,
      payment,
      input.interestRate
    );
    if (d(debited).lte(0)) break;
    remaining = next;
    lastAppliedAt = eventDate;
    payments.push({ eventDate, debited, remainingAfter: remaining });
  }

  return { remaining, lastAppliedAt, payments };
}

/** Les seuls champs d'une dette dont dépend son amortissement. */
export type AmortizableLiability = {
  remainingAmount: DecimalInput;
  monthlyPayment: DecimalInput | null;
  paymentDay: number | null;
  startDate: Date | null;
  endDate: Date | null;
  lastPaymentAppliedAt: Date | null;
  /**
   * Requis, et non optionnel : c'est la borne de repli des dettes qui n'ont pas
   * encore de `lastPaymentAppliedAt` (voir `effectivePaymentBaseline`). Le
   * rendre facultatif rejouerait silencieusement l'amortissement depuis
   * l'origine du prêt chez le lecteur qui l'oublie — le défaut corrigé. Toute
   * ligne `Liability` le porte ; les `select` explicites doivent l'inclure.
   */
  updatedAt: Date;
  interestRate: DecimalInput | null;
};

/**
 * Projection des échéances dues d'une **ligne** de dette.
 *
 * Versant lecture de `projectDuePayments` : elle résout d'abord la borne de la
 * ligne, là où `projectDuePayments` reçoit la borne déjà arrêtée par son
 * appelant (le chemin d'écriture, après `sealPaymentBaseline`). Les deux
 * chemins partagent donc la même règle d'amortissement *et* la même règle de
 * borne, sans qu'aucun lecteur ait à les rappeler.
 */
export function projectDuePaymentsForLiability(
  liability: AmortizableLiability,
  now?: Date
): DuePaymentProjection {
  return projectDuePayments({
    remainingAmount: liability.remainingAmount,
    monthlyPayment: liability.monthlyPayment,
    paymentDay: liability.paymentDay,
    startDate: liability.startDate,
    endDate: liability.endDate,
    lastPaymentAppliedAt: effectivePaymentBaseline(liability),
    interestRate: liability.interestRate,
    now,
  });
}

/**
 * Capital restant dû d'une dette à la date de référence.
 *
 * Raccourci de lecture sur `projectDuePaymentsForLiability` pour les appelants
 * qui ne veulent que le montant. C'est la valeur que tout écran doit afficher :
 * elle ne dépend ni de l'ordre de navigation, ni de la dernière
 * matérialisation.
 */
export function remainingAmountAt(
  liability: AmortizableLiability,
  now?: Date
): string {
  return projectDuePaymentsForLiability(liability, now).remaining;
}
