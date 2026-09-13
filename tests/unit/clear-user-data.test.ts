import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AUTH-01 / PLA-01 / PRI-01 / AUTH-02 (audit-w1) : `resetUserData` prétendait
 * tout effacer, mais
 *  (a) `platform.deleteMany` heurtait `SecuritiesAccount.platformId`
 *      (onDelete: Restrict, prisma/schema.prisma) dès qu'un utilisateur
 *      détenait un compte-titres → P2003 → rollback intégral → wipe
 *      totalement inopérant (500) ;
 *  (b) `TermDeposit`, `PreciousMetalSale`, `DefiMarketRef` et
 *      `SecuritiesAccount` (+ ses `SecuritiesAccountContribution` enfants,
 *      Cascade) n'étaient jamais ciblés → wipe "réussi" (200) mais données
 *      financières résiduelles.
 *
 * Prisma est mocké (comme `multi-tenant-isolation.test.ts`) avec un magasin
 * en mémoire qui reproduit la contrainte FK `Restrict` réelle : si
 * `platform.deleteMany` s'exécute alors qu'un `SecuritiesAccount` du même
 * utilisateur référence encore une de ses plateformes, on lève une erreur
 * `P2003` — exactement ce que fait Postgres, et exactement ce que l'ancien
 * code (sans la suppression des comptes-titres avant les plateformes)
 * aurait déclenché ici.
 */

type Row = Record<string, unknown> & { id: string; userId: string };

let db: {
  securitiesAccount: (Row & { platformId: string })[];
  platform: Row[];
  termDeposit: Row[];
  preciousMetalSale: Row[];
  defiMarketRef: Row[];
};
let callOrder: string[];

function resetDb() {
  db = {
    securitiesAccount: [
      { id: "sa-1", userId: "user-1", platformId: "plat-1" },
    ],
    platform: [{ id: "plat-1", userId: "user-1" }],
    termDeposit: [{ id: "td-1", userId: "user-1" }],
    preciousMetalSale: [{ id: "pms-1", userId: "user-1" }],
    defiMarketRef: [{ id: "dmr-1", userId: "user-1" }],
  };
  callOrder = [];
}
resetDb();

/** Stub générique pour les modèles non concernés par ce lot : aucune ligne
 * de fixture, donc `{ count: 0 }` est toujours la bonne réponse ici. */
function stubDeleteMany(model: string) {
  return vi.fn(async () => {
    callOrder.push(`${model}.deleteMany`);
    return { count: 0 };
  });
}

const securitiesAccountDeleteMany = vi.fn(async ({ where }: { where: { userId: string } }) => {
  callOrder.push("securitiesAccount.deleteMany");
  const before = db.securitiesAccount.length;
  db.securitiesAccount = db.securitiesAccount.filter((r) => r.userId !== where.userId);
  return { count: before - db.securitiesAccount.length };
});

const termDepositDeleteMany = vi.fn(async ({ where }: { where: { userId: string } }) => {
  callOrder.push("termDeposit.deleteMany");
  const before = db.termDeposit.length;
  db.termDeposit = db.termDeposit.filter((r) => r.userId !== where.userId);
  return { count: before - db.termDeposit.length };
});

const preciousMetalSaleDeleteMany = vi.fn(async ({ where }: { where: { userId: string } }) => {
  callOrder.push("preciousMetalSale.deleteMany");
  const before = db.preciousMetalSale.length;
  db.preciousMetalSale = db.preciousMetalSale.filter((r) => r.userId !== where.userId);
  return { count: before - db.preciousMetalSale.length };
});

const defiMarketRefDeleteMany = vi.fn(async ({ where }: { where: { userId: string } }) => {
  callOrder.push("defiMarketRef.deleteMany");
  const before = db.defiMarketRef.length;
  db.defiMarketRef = db.defiMarketRef.filter((r) => r.userId !== where.userId);
  return { count: before - db.defiMarketRef.length };
});

/**
 * Reproduit la FK `Restrict` réelle de `SecuritiesAccount.platformId` vers
 * `Platform` : refuse la suppression tant qu'un compte-titres du même
 * utilisateur pointe encore vers une de ses plateformes, avec le même code
 * d'erreur Prisma (`P2003`) qu'un vrai Postgres.
 */
const platformDeleteMany = vi.fn(async ({ where }: { where: { userId: string } }) => {
  callOrder.push("platform.deleteMany");
  const stillReferenced = db.securitiesAccount.some((sa) =>
    db.platform.some((p) => p.userId === where.userId && p.id === sa.platformId)
  );
  if (stillReferenced) {
    const err = new Error(
      "Foreign key constraint failed on the field: `SecuritiesAccount_platformId_fkey (index)`"
    ) as Error & { code?: string };
    err.code = "P2003";
    throw err;
  }
  const before = db.platform.length;
  db.platform = db.platform.filter((p) => p.userId !== where.userId);
  return { count: before - db.platform.length };
});

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        transaction: { deleteMany: stubDeleteMany("transaction") },
        asset: { deleteMany: stubDeleteMany("asset") },
        liabilityEvent: { deleteMany: stubDeleteMany("liabilityEvent") },
        liability: { deleteMany: stubDeleteMany("liability") },
        lifeInsuranceProduct: { deleteMany: stubDeleteMany("lifeInsuranceProduct") },
        lifeInsurance: { deleteMany: stubDeleteMany("lifeInsurance") },
        bankAccount: { deleteMany: stubDeleteMany("bankAccount") },
        savingsAccount: { deleteMany: stubDeleteMany("savingsAccount") },
        envelopeCash: { deleteMany: stubDeleteMany("envelopeCash") },
        employeeSavingsLine: { deleteMany: stubDeleteMany("employeeSavingsLine") },
        preciousMetalPosition: { deleteMany: stubDeleteMany("preciousMetalPosition") },
        privateEquityPosition: { deleteMany: stubDeleteMany("privateEquityPosition") },
        crowdlendingPosition: { deleteMany: stubDeleteMany("crowdlendingPosition") },
        tangibleAsset: { deleteMany: stubDeleteMany("tangibleAsset") },
        portfolioSnapshot: { deleteMany: stubDeleteMany("portfolioSnapshot") },
        nftAsset: { deleteMany: stubDeleteMany("nftAsset") },
        nftCollection: { deleteMany: stubDeleteMany("nftCollection") },
        nftSyncCursor: { deleteMany: stubDeleteMany("nftSyncCursor") },
        defiProtocolRef: { deleteMany: stubDeleteMany("defiProtocolRef") },
        defiStrategy: { deleteMany: stubDeleteMany("defiStrategy") },
        defiSyncCursor: { deleteMany: stubDeleteMany("defiSyncCursor") },
        tradingPosition: { deleteMany: stubDeleteMany("tradingPosition") },
        tradingAccount: { deleteMany: stubDeleteMany("tradingAccount") },
        termDeposit: { deleteMany: termDepositDeleteMany },
        preciousMetalSale: { deleteMany: preciousMetalSaleDeleteMany },
        defiMarketRef: { deleteMany: defiMarketRefDeleteMany },
        securitiesAccount: { deleteMany: securitiesAccountDeleteMany },
        platform: { deleteMany: platformDeleteMany },
      };
      return fn(tx);
    },
  },
}));

vi.mock("@/app/lib/portfolio/ledger-cache", () => ({
  invalidateLedgerCache: vi.fn(),
}));

import {
  clearUserTransactionsAndPositions,
  resetUserData,
} from "../../app/lib/portfolio/clear-user-data";

describe("resetUserData", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is a function", () => {
    expect(typeof resetUserData).toBe("function");
    expect(typeof clearUserTransactionsAndPositions).toBe("function");
  });

  it("returns zeroed counts for a user with no rows anywhere", async () => {
    const r = await resetUserData("nonexistent-user-id-xyz");
    expect(r.transactionsDeleted).toBe(0);
    expect(r.assetsDeleted).toBe(0);
    expect(r.platformsDeleted).toBe(0);
    expect(typeof r.employeeSavingsDeleted).toBe("number");
    expect(typeof r.alternativesDeleted).toBe("number");
  });

  it("(AUTH-01/PLA-01/PRI-01) wipes a user holding a SecuritiesAccount without P2003", async () => {
    // Avant fix : `platform.deleteMany` s'exécutait sans que le compte-titres
    // ait été supprimé, la contrainte Restrict levait P2003, la transaction
    // Prisma faisait un rollback complet et l'appelant recevait une 500.
    await expect(resetUserData("user-1")).resolves.toBeDefined();
  });

  it("(AUTH-01/PLA-01/PRI-01) deletes the SecuritiesAccount strictly before the Platform", async () => {
    await resetUserData("user-1");
    const saIndex = callOrder.indexOf("securitiesAccount.deleteMany");
    const platformIndex = callOrder.indexOf("platform.deleteMany");
    expect(saIndex).toBeGreaterThanOrEqual(0);
    expect(platformIndex).toBeGreaterThan(saIndex);
  });

  it("(AUTH-02) zeroes out TermDeposit/PreciousMetalSale/DefiMarketRef/SecuritiesAccount after wipe", async () => {
    expect(db.termDeposit).toHaveLength(1);
    expect(db.preciousMetalSale).toHaveLength(1);
    expect(db.defiMarketRef).toHaveLength(1);
    expect(db.securitiesAccount).toHaveLength(1);

    const r = await resetUserData("user-1");

    expect(db.termDeposit.filter((row) => row.userId === "user-1")).toHaveLength(0);
    expect(db.preciousMetalSale.filter((row) => row.userId === "user-1")).toHaveLength(0);
    expect(db.defiMarketRef.filter((row) => row.userId === "user-1")).toHaveLength(0);
    expect(db.securitiesAccount.filter((row) => row.userId === "user-1")).toHaveLength(0);
    expect(db.platform.filter((row) => row.userId === "user-1")).toHaveLength(0);

    expect(r.termDepositsDeleted).toBe(1);
    expect(r.preciousMetalSalesDeleted).toBe(1);
    expect(r.defiMarketRefsDeleted).toBe(1);
    expect(r.securitiesAccountsDeleted).toBe(1);
    expect(r.platformsDeleted).toBe(1);
  });

  it("regression guard: the FK-Restrict simulation itself throws P2003 if Platform is deleted first", async () => {
    // Ne teste pas `resetUserData` : prouve que le mock ci-dessus reproduit
    // fidèlement la contrainte réelle, donc que le test précédent aurait
    // échoué sous l'ancien ordre (plateformes avant comptes-titres).
    await expect(platformDeleteMany({ where: { userId: "user-1" } })).rejects.toMatchObject({
      code: "P2003",
    });
  });
});
