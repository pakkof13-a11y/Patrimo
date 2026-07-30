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
  /** Identités NFT, collections et curseurs de sync — ne cascadent pas depuis `Asset`. */
  nftIdentitiesDeleted: number;
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

    // Identités NFT et références DeFi : elles ne pendent pas d'`Asset` mais
    // de `User`, donc la suppression des actifs ci-dessus ne les emporte pas.
    // Sans ce nettoyage, une réinitialisation « complète » laisse derrière
    // elle des `NftAsset` orphelins qui conservent nom, médias, événements,
    // valorisations et surtout classification spam — et qu'un réajout du même
    // NFT (même `uniqueKey`) réutiliserait silencieusement.
    // Ordre imposé : `NftItemDetail.nftAsset` est en `Restrict`, donc les
    // détentions doivent avoir disparu (cascade depuis `Asset`) avant ici.
    let nftIdentities = 0;
    try {
      const nftAssets = await tx.nftAsset.deleteMany({ where: { userId } });
      const nftCollections = await tx.nftCollection.deleteMany({ where: { userId } });
      const nftCursors = await tx.nftSyncCursor.deleteMany({ where: { userId } });
      const defiRefs = await tx.defiProtocolRef.deleteMany({ where: { userId } });
      const defiStrategies = await tx.defiStrategy.deleteMany({ where: { userId } });
      const defiCursors = await tx.defiSyncCursor.deleteMany({ where: { userId } });
      nftIdentities =
        nftAssets.count +
        nftCollections.count +
        nftCursors.count +
        defiRefs.count +
        defiStrategies.count +
        defiCursors.count;
    } catch {
      /* models may be missing in older DBs */
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
      nftIdentitiesDeleted: nftIdentities,
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
