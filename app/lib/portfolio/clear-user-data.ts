import { prisma } from "@/app/lib/prisma";

export type ResetUserDataResult = {
  transactionsDeleted: number;
  assetsDeleted: number;
  platformsDeleted: number;
  liabilitiesDeleted: number;
  bankAccountsDeleted: number;
  savingsAccountsDeleted: number;
  lifeInsurancesDeleted: number;
  envelopeCashDeleted: number;
  employeeSavingsDeleted: number;
  alternativesDeleted: number;
  snapshotsDeleted: number;
};

/**
 * Full reset of one user's portfolio data — back to empty (like first launch).
 * Deletes: transactions, assets (+ quotes/history), platforms, liabilities,
 * banks, savings, life insurance, envelope cash, employee savings,
 * alternatives, portfolio snapshots.
 *
 * Keeps: User account (login / baseCurrency).
 */
export async function resetUserData(userId: string): Promise<ResetUserDataResult> {
  const { invalidateLedgerCache } = await import("./ledger-cache");
  invalidateLedgerCache(userId);

  return prisma.$transaction(async (tx) => {
    const txDel = await tx.transaction.deleteMany({ where: { userId } });
    // PriceQuote / PriceHistory cascade with Asset
    const assetDel = await tx.asset.deleteMany({ where: { userId } });

    await tx.liabilityEvent
      .deleteMany({ where: { liability: { userId } } })
      .catch(() => ({ count: 0 }));
    const liab = await tx.liability.deleteMany({ where: { userId } });

    await tx.lifeInsuranceProduct
      .deleteMany({ where: { lifeInsurance: { userId } } })
      .catch(() => ({ count: 0 }));
    const av = await tx.lifeInsurance.deleteMany({ where: { userId } });

    const banks = await tx.bankAccount.deleteMany({ where: { userId } });
    const savings = await tx.savingsAccount.deleteMany({ where: { userId } });
    const env = await tx.envelopeCash.deleteMany({ where: { userId } });

    let es = 0;
    let alt = 0;
    try {
      es = (await tx.employeeSavingsLine.deleteMany({ where: { userId } })).count;
    } catch {
      /* model may be missing in older DBs */
    }
    try {
      const m = await tx.preciousMetalPosition.deleteMany({ where: { userId } });
      const pe = await tx.privateEquityPosition.deleteMany({ where: { userId } });
      const cl = await tx.crowdlendingPosition.deleteMany({ where: { userId } });
      const t = await tx.tangibleAsset.deleteMany({ where: { userId } });
      alt = m.count + pe.count + cl.count + t.count;
    } catch {
      /* models may be missing */
    }

    let snaps = 0;
    try {
      snaps = (await tx.portfolioSnapshot.deleteMany({ where: { userId } })).count;
    } catch {
      /* ignore */
    }

    // Platforms after assets/transactions
    const platforms = await tx.platform.deleteMany({ where: { userId } });

    return {
      transactionsDeleted: txDel.count,
      assetsDeleted: assetDel.count,
      platformsDeleted: platforms.count,
      liabilitiesDeleted: liab.count,
      bankAccountsDeleted: banks.count,
      savingsAccountsDeleted: savings.count,
      lifeInsurancesDeleted: av.count,
      envelopeCashDeleted: env.count,
      employeeSavingsDeleted: es,
      alternativesDeleted: alt,
      snapshotsDeleted: snaps,
    };
  });
}

/**
 * @deprecated Prefer resetUserData — full wipe including platforms.
 * Kept for callers that still import the old name.
 */
export async function clearUserTransactionsAndPositions(userId: string) {
  const r = await resetUserData(userId);
  return {
    transactionsDeleted: r.transactionsDeleted,
    assetsDeleted: r.assetsDeleted,
    envelopeCashZeroed: r.envelopeCashDeleted,
    bankBalancesZeroed: r.bankAccountsDeleted,
    savingsBalancesZeroed: r.savingsAccountsDeleted,
    lifeInsuranceCashZeroed: r.lifeInsurancesDeleted,
    employeeSavingsDeleted: r.employeeSavingsDeleted,
    alternativesDeleted: r.alternativesDeleted,
  };
}
