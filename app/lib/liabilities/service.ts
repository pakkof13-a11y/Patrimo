import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "../prisma";
import { owned } from "../db/tenant-scope";
import { d, toFixed } from "../money/decimal";
import { toEurAmount } from "../market/fx";
import {
  applyEarlyRepayment,
  applyMonthlyDebit,
  duePaymentDates,
  estimateRemainingInterest,
  estimateRemainingMonths,
  projectEndDate,
  startOfUtcDay,
} from "./amortization";

export const LIABILITY_EVENT_TYPES = {
  MONTHLY_DEBIT: "MONTHLY_DEBIT",
  EARLY_REPAYMENT_PARTIAL: "EARLY_REPAYMENT_PARTIAL",
  EARLY_REPAYMENT_TOTAL: "EARLY_REPAYMENT_TOTAL",
  PAYMENT_CHANGE: "PAYMENT_CHANGE",
  RATE_CHANGE: "RATE_CHANGE",
} as const;

export type LiabilityEventType =
  (typeof LIABILITY_EVENT_TYPES)[keyof typeof LIABILITY_EVENT_TYPES];

/**
 * Apply all due monthly debits for one liability (idempotent via lastPaymentAppliedAt).
 * Requires userId — never loads/writes a liability by bare id alone.
 * Returns updated remaining if any debit ran.
 */
export async function applyDuePaymentsForLiability(
  userId: string,
  liabilityId: string,
  now: Date = new Date()
) {
  const liability = await prisma.liability.findFirst({
    where: owned(liabilityId, userId),
  });
  if (!liability) return null;
  if (!liability.paymentDay || !liability.monthlyPayment) return liability;

  const payment = liability.monthlyPayment.toString();
  if (d(payment).lte(0)) return liability;
  if (d(liability.remainingAmount.toString()).lte(0)) return liability;

  const dates = duePaymentDates({
    paymentDay: liability.paymentDay,
    startDate: liability.startDate,
    endDate: liability.endDate,
    lastPaymentAppliedAt: liability.lastPaymentAppliedAt,
    now,
  });
  if (dates.length === 0) return liability;

  let remaining = liability.remainingAmount.toString();
  let lastApplied: Date | null = liability.lastPaymentAppliedAt;
  const events: Array<{
    type: string;
    amount: string;
    remainingAfter: string;
    eventDate: Date;
    notes: string;
  }> = [];

  for (const pd of dates) {
    if (d(remaining).lte(0)) break;
    const { remaining: next, debited } = applyMonthlyDebit(remaining, payment);
    if (d(debited).lte(0)) break;
    remaining = next;
    lastApplied = pd;
    events.push({
      type: LIABILITY_EVENT_TYPES.MONTHLY_DEBIT,
      amount: debited,
      remainingAfter: remaining,
      eventDate: pd,
      notes: `Prélèvement mensuel (jour ${liability.paymentDay})`,
    });
  }

  if (events.length === 0) return liability;

  return prisma.$transaction(async (tx) => {
    for (const e of events) {
      await tx.liabilityEvent.create({
        data: {
          liabilityId,
          type: e.type,
          amount: new Prisma.Decimal(e.amount),
          remainingAfter: new Prisma.Decimal(e.remainingAfter),
          eventDate: e.eventDate,
          notes: e.notes,
        },
      });
    }

    // Re-project end date if monthly payment still active
    let endDate = liability.endDate;
    if (d(remaining).gt(0) && d(payment).gt(0)) {
      const projected = projectEndDate(
        remaining,
        payment,
        liability.interestRate?.toString() || "0",
        now
      );
      if (projected) endDate = projected;
    } else if (d(remaining).lte(0)) {
      endDate = lastApplied || now;
    }

    const write = await tx.liability.updateMany({
      where: owned(liabilityId, userId),
      data: {
        remainingAmount: new Prisma.Decimal(remaining),
        lastPaymentAppliedAt: lastApplied,
        endDate,
      },
    });
    if (write.count === 0) return null;

    return tx.liability.findFirst({ where: owned(liabilityId, userId) });
  });
}

/** Apply due payments for all user liabilities (called on list). */
export async function applyDuePaymentsForUser(userId: string, now: Date = new Date()) {
  const rows = await prisma.liability.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const r of rows) {
    await applyDuePaymentsForLiability(userId, r.id, now);
  }
}

export async function listLiabilities(userId: string) {
  await applyDuePaymentsForUser(userId);

  const liabilities = await prisma.liability.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: {
      events: {
        orderBy: { eventDate: "desc" },
        take: 50,
      },
    },
  });

  let totalEur = d(0);
  const enriched = [];
  for (const l of liabilities) {
    const eur = await toEurAmount(l.remainingAmount.toString(), l.currency);
    totalEur = totalEur.plus(d(eur));
    const monthly = l.monthlyPayment?.toString() || "0";
    const rate = l.interestRate?.toString() || "0";
    const remaining = l.remainingAmount.toString();
    const monthsLeft = estimateRemainingMonths(remaining, monthly, rate);
    const interestLeft = estimateRemainingInterest(remaining, monthly, rate);

    enriched.push({
      id: l.id,
      name: l.name,
      initialAmount: l.initialAmount.toString(),
      remainingAmount: remaining,
      currency: l.currency,
      interestRate: l.interestRate?.toString() ?? null,
      monthlyPayment: l.monthlyPayment?.toString() ?? null,
      startDate: l.startDate?.toISOString() ?? null,
      endDate: l.endDate?.toISOString() ?? null,
      paymentDay: l.paymentDay,
      lastPaymentAppliedAt: l.lastPaymentAppliedAt?.toISOString() ?? null,
      bankName: l.bankName,
      notes: l.notes,
      remainingEur: eur,
      monthsRemaining: monthsLeft,
      estimatedInterestRemaining: interestLeft,
      events: l.events.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount?.toString() ?? null,
        remainingAfter: e.remainingAfter?.toString() ?? null,
        eventDate: e.eventDate.toISOString(),
        notes: e.notes,
      })),
    });
  }

  return {
    liabilities: enriched,
    totalRemainingEur: toFixed(totalEur, 8),
  };
}

export async function recordEarlyRepayment(opts: {
  userId: string;
  liabilityId: string;
  kind: "PARTIAL" | "TOTAL";
  amount?: string;
  eventDate?: string;
  notes?: string;
}) {
  const liability = await prisma.liability.findFirst({
    where: owned(opts.liabilityId, opts.userId),
  });
  if (!liability) throw new Error("Passif introuvable");

  const total = opts.kind === "TOTAL";
  const amount = total
    ? liability.remainingAmount.toString()
    : String(opts.amount || "0").replace(",", ".");
  if (!total && d(amount).lte(0)) throw new Error("Montant de remboursement invalide");

  const { remaining, debited } = applyEarlyRepayment(
    liability.remainingAmount.toString(),
    amount,
    total
  );
  const eventDate = opts.eventDate
    ? startOfUtcDay(new Date(opts.eventDate))
    : startOfUtcDay(new Date());

  const type =
    total || d(remaining).lte(0)
      ? LIABILITY_EVENT_TYPES.EARLY_REPAYMENT_TOTAL
      : LIABILITY_EVENT_TYPES.EARLY_REPAYMENT_PARTIAL;

  let endDate = liability.endDate;
  if (d(remaining).lte(0)) {
    endDate = eventDate;
  } else if (liability.monthlyPayment) {
    const projected = projectEndDate(
      remaining,
      liability.monthlyPayment.toString(),
      liability.interestRate?.toString() || "0",
      eventDate
    );
    if (projected) endDate = projected;
  }

  return prisma.$transaction(async (tx) => {
    await tx.liabilityEvent.create({
      data: {
        liabilityId: liability.id,
        type,
        amount: new Prisma.Decimal(debited),
        remainingAfter: new Prisma.Decimal(remaining),
        eventDate,
        notes:
          opts.notes ||
          (type === LIABILITY_EVENT_TYPES.EARLY_REPAYMENT_TOTAL
            ? "Remboursement anticipé total"
            : "Remboursement anticipé partiel"),
      },
    });
    const write = await tx.liability.updateMany({
      where: owned(liability.id, opts.userId),
      data: {
        remainingAmount: new Prisma.Decimal(remaining),
        endDate,
      },
    });
    if (write.count === 0) throw new Error("Passif introuvable");
    return tx.liability.findFirstOrThrow({ where: owned(liability.id, opts.userId) });
  });
}

export async function changeMonthlyPayment(opts: {
  userId: string;
  liabilityId: string;
  monthlyPayment: string;
  eventDate?: string;
  notes?: string;
}) {
  const liability = await prisma.liability.findFirst({
    where: owned(opts.liabilityId, opts.userId),
  });
  if (!liability) throw new Error("Passif introuvable");

  const newPayment = String(opts.monthlyPayment || "0").replace(",", ".");
  if (d(newPayment).lte(0)) throw new Error("Nouvelle mensualité invalide");

  const eventDate = opts.eventDate
    ? startOfUtcDay(new Date(opts.eventDate))
    : startOfUtcDay(new Date());

  const remaining = liability.remainingAmount.toString();
  const projected = projectEndDate(
    remaining,
    newPayment,
    liability.interestRate?.toString() || "0",
    eventDate
  );

  return prisma.$transaction(async (tx) => {
    await tx.liabilityEvent.create({
      data: {
        liabilityId: liability.id,
        type: LIABILITY_EVENT_TYPES.PAYMENT_CHANGE,
        amount: new Prisma.Decimal(newPayment),
        remainingAfter: new Prisma.Decimal(remaining),
        eventDate,
        notes:
          opts.notes ||
          `Avenant mensualité → ${newPayment} ${liability.currency}` +
            (projected
              ? ` · fin estimée ${projected.toISOString().slice(0, 10)}`
              : ""),
      },
    });
    const write = await tx.liability.updateMany({
      where: owned(liability.id, opts.userId),
      data: {
        monthlyPayment: new Prisma.Decimal(newPayment),
        endDate: projected,
      },
    });
    if (write.count === 0) throw new Error("Passif introuvable");
    return tx.liability.findFirstOrThrow({ where: owned(liability.id, opts.userId) });
  });
}

/**
 * Edit interest rate on the fly — logs RATE_CHANGE and re-projects end date.
 */
export async function changeInterestRate(opts: {
  userId: string;
  liabilityId: string;
  interestRate: string;
  eventDate?: string;
  notes?: string;
}) {
  const liability = await prisma.liability.findFirst({
    where: owned(opts.liabilityId, opts.userId),
  });
  if (!liability) throw new Error("Passif introuvable");

  const newRate = String(opts.interestRate || "0").replace(",", ".");
  if (d(newRate).lt(0)) throw new Error("Taux d'intérêt invalide");

  const eventDate = opts.eventDate
    ? startOfUtcDay(new Date(opts.eventDate))
    : startOfUtcDay(new Date());

  const remaining = liability.remainingAmount.toString();
  const monthly = liability.monthlyPayment?.toString() || "0";
  const projected =
    d(monthly).gt(0) && d(remaining).gt(0)
      ? projectEndDate(remaining, monthly, newRate, eventDate)
      : liability.endDate;

  const prev = liability.interestRate?.toString() ?? "0";

  return prisma.$transaction(async (tx) => {
    await tx.liabilityEvent.create({
      data: {
        liabilityId: liability.id,
        type: LIABILITY_EVENT_TYPES.RATE_CHANGE,
        amount: new Prisma.Decimal(newRate),
        remainingAfter: new Prisma.Decimal(remaining),
        eventDate,
        notes:
          opts.notes ||
          `Avenant taux ${prev}% → ${newRate}%` +
            (projected instanceof Date
              ? ` · fin estimée ${projected.toISOString().slice(0, 10)}`
              : ""),
      },
    });
    const write = await tx.liability.updateMany({
      where: owned(liability.id, opts.userId),
      data: {
        interestRate: new Prisma.Decimal(newRate),
        endDate: projected,
      },
    });
    if (write.count === 0) throw new Error("Passif introuvable");
    return tx.liability.findFirstOrThrow({ where: owned(liability.id, opts.userId) });
  });
}
