import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "../prisma";
import { owned } from "../db/tenant-scope";
import { d } from "./decimal";
import { recordSavingsAccountInterest } from "../cash/account-events";
import {
  creditDueInterest,
  type PayoutFrequency,
  type RateType,
  savingsDisplayBalance,
  describePayoutRule,
} from "./savings";

function asRateType(v: string | null | undefined): RateType {
  return v === "APR" ? "APR" : "APY";
}

function asFrequency(v: string | null | undefined): PayoutFrequency {
  if (v === "WEEKLY" || v === "MONTHLY" || v === "YEARLY" || v === "DAILY") return v;
  return "DAILY";
}

/**
 * Credit all due interest periods onto the livret balance (idempotent).
 * Requires userId so a bare savingsId can never mutate another tenant's account.
 */
export async function applyDueInterestForSavings(
  userId: string,
  savingsId: string,
  now: Date = new Date()
) {
  const row = await prisma.savingsAccount.findFirst({
    where: owned(savingsId, userId),
  });
  if (!row) return null;

  const rateType = asRateType(row.rateType);
  const frequency = asFrequency(row.payoutFrequency);
  const schedule = {
    rateType,
    payoutFrequency: frequency,
    payoutDayOfWeek: row.payoutDayOfWeek,
    payoutDayOfMonth: row.payoutDayOfMonth,
    payoutMonth: row.payoutMonth,
  };

  const result = creditDueInterest({
    balance: row.balance.toString(),
    annualPercent: row.apyPercent.toString(),
    rateType,
    schedule,
    lastPayoutAt: row.lastPayoutAt,
    createdAt: row.createdAt,
    now,
  });

  if (result.periodsCredited === 0) {
    return { account: row, periodsCredited: 0, totalInterest: "0" };
  }

  const updated = await prisma.$transaction(async (tx) => {
    /*
      Écriture conditionnée à l'état qui a servi au calcul.

      Le filtre ne portait que sur l'identité de la ligne. Entre la lecture et
      cette écriture, la ligne pouvait avoir changé, et l'accrual réécrivait
      quand même un solde calculé à partir d'une valeur périmée. Un utilisateur
      saisissant 12 000 € pendant qu'un accrual parti de 10 000 € calculait
      10 100 € voyait sa saisie remplacée par 10 100 € — sans erreur, sans
      trace.

      Exiger `balance` et `lastPayoutAt` tels qu'ils ont été lus transforme
      l'écriture en compare-and-set : le SGBD évalue le filtre et applique la
      donnée en une seule instruction, donc rien ne peut s'intercaler entre les
      deux. Si la ligne a bougé, aucune ligne ne correspond, et l'accrual
      renonce plutôt que d'écraser.

      Les deux champs, et pas seulement `lastPayoutAt` : une saisie de solde
      repositionne bien ce dernier (`app/api/savings/route.ts`), mais se fier à
      ce seul détour rendrait le garde-fou dépendant d'un choix distant. Le
      solde est ce sur quoi le calcul s'appuie ; c'est lui qu'on exige.
    */
    const write = await tx.savingsAccount.updateMany({
      where: {
        ...owned(savingsId, userId),
        balance: row.balance,
        lastPayoutAt: row.lastPayoutAt,
      },
      data: {
        balance: new Prisma.Decimal(result.balance),
        lastPayoutAt: result.lastPayoutAt,
        lastAccruedAt: result.lastPayoutAt || row.lastAccruedAt,
      },
    });
    /*
      Zéro ligne : la course est perdue. On ne crédite rien et on n'inscrit
      aucun événement — c'est ce qui empêche aussi deux accruals concurrents
      d'inscrire deux INTEREST pour le même intervalle, `lastPayoutAt` ayant
      avancé sous le premier.
    */
    if (write.count === 0) return null;
    await recordSavingsAccountInterest(
      tx,
      savingsId,
      result.totalInterest,
      result.balance,
      result.periodsCredited,
      result.lastPayoutAt ?? now
    );
    return tx.savingsAccount.findFirst({ where: owned(savingsId, userId) });
  });
  if (!updated) return null;

  return {
    account: updated,
    periodsCredited: result.periodsCredited,
    totalInterest: result.totalInterest,
  };
}

/** Apply due interest for every livret of a user */
export async function applyDueInterestForUser(userId: string, now: Date = new Date()) {
  const rows = await prisma.savingsAccount.findMany({ where: { userId } });
  let periods = 0;
  // Cumul en Decimal : sommer des intérêts en float dérive dès quelques
  // livrets (0.1 + 0.2 ≠ 0.3) sur un montant restitué tel quel par l'API.
  let totalInterest = d(0);
  for (const r of rows) {
    const res = await applyDueInterestForSavings(userId, r.id, now);
    if (res) {
      periods += res.periodsCredited;
      totalInterest = totalInterest.plus(d(res.totalInterest || 0));
    }
  }
  return {
    accounts: rows.length,
    periodsCredited: periods,
    totalInterest: totalInterest.toString(),
  };
}

export function mapSavingsRowForApi(
  s: {
    id: string;
    name: string;
    bankName?: string | null;
    balance: { toString(): string };
    apyPercent: { toString(): string };
    rateType?: string | null;
    payoutFrequency?: string | null;
    payoutDayOfWeek?: number | null;
    payoutDayOfMonth?: number | null;
    payoutMonth?: number | null;
    lastPayoutAt?: Date | null;
    lastAccruedAt: Date;
    currency: string;
    notes?: string | null;
    createdAt: Date;
    productType?: string | null;
    ceilingAmount?: { toString(): string } | null;
    isPro?: boolean;
    ownershipPct?: { toString(): string } | null;
  },
  now: Date = new Date()
) {
  const rateType = asRateType(s.rateType);
  const frequency = asFrequency(s.payoutFrequency);
  const schedule = {
    rateType,
    payoutFrequency: frequency,
    payoutDayOfWeek: s.payoutDayOfWeek,
    payoutDayOfMonth: s.payoutDayOfMonth,
    payoutMonth: s.payoutMonth,
  };

  // Accrual clock: last payout or lastAccruedAt
  const clock = s.lastPayoutAt || s.lastAccruedAt;
  const display = savingsDisplayBalance(
    s.balance.toString(),
    s.apyPercent.toString(),
    clock,
    now,
    rateType,
    frequency
  );

  return {
    id: s.id,
    name: s.name,
    bankName: s.bankName ?? null,
    balance: s.balance.toString(),
    displayBalance: display.displayBalance,
    apyPercent: s.apyPercent.toString(),
    rateType,
    payoutFrequency: frequency,
    payoutDayOfWeek: s.payoutDayOfWeek ?? null,
    payoutDayOfMonth: s.payoutDayOfMonth ?? null,
    payoutMonth: s.payoutMonth ?? null,
    payoutRuleLabel: describePayoutRule(schedule),
    daysElapsed: display.daysElapsed,
    dailyInterest: display.dailyInterest,
    periodInterest: display.periodInterest,
    currency: s.currency,
    notes: s.notes ?? null,
    lastAccruedAt: s.lastAccruedAt.toISOString(),
    lastPayoutAt: s.lastPayoutAt?.toISOString() ?? null,
    productType: s.productType ?? "AUTRE",
    ceilingAmount: s.ceilingAmount?.toString() ?? null,
    isPro: s.isPro ?? false,
    ownershipPct: s.ownershipPct?.toString() ?? null,
  };
}
