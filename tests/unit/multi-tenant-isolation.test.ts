import { describe, expect, it, beforeEach, vi } from "vitest";
import { owned } from "@/app/lib/db/tenant-scope";

/**
 * Multi-tenant isolation — prisma mocked to assert every write scopes by userId.
 */

const savingsFindFirst = vi.fn();
const savingsUpdateMany = vi.fn();
const savingsFindMany = vi.fn();

const liabilityFindFirst = vi.fn();
const liabilityUpdateMany = vi.fn();
const liabilityFindMany = vi.fn();
const liabilityEventCreate = vi.fn();
const txLiabilityUpdateMany = vi.fn();
const txLiabilityFindFirst = vi.fn();
const txLiabilityEventCreate = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    savingsAccount: {
      findFirst: (...a: unknown[]) => savingsFindFirst(...a),
      updateMany: (...a: unknown[]) => savingsUpdateMany(...a),
      findMany: (...a: unknown[]) => savingsFindMany(...a),
    },
    liability: {
      findFirst: (...a: unknown[]) => liabilityFindFirst(...a),
      findMany: (...a: unknown[]) => liabilityFindMany(...a),
      updateMany: (...a: unknown[]) => liabilityUpdateMany(...a),
    },
    liabilityEvent: {
      create: (...a: unknown[]) => liabilityEventCreate(...a),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        liabilityEvent: {
          create: (...a: unknown[]) => txLiabilityEventCreate(...a),
        },
        liability: {
          updateMany: (...a: unknown[]) => txLiabilityUpdateMany(...a),
          findFirst: (...a: unknown[]) => txLiabilityFindFirst(...a),
        },
      };
      return fn(tx);
    },
  },
}));

// creditDueInterest is pure math — keep real implementation
vi.mock("@/app/lib/money/savings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/money/savings")>();
  return actual;
});

import { applyDueInterestForSavings } from "@/app/lib/money/savings-accrual";
import { applyDuePaymentsForLiability } from "@/app/lib/liabilities/service";

describe("owned() helper", () => {
  it("builds { id, userId } composite filter", () => {
    expect(owned("row-1", "user-A")).toEqual({ id: "row-1", userId: "user-A" });
  });
});

describe("applyDueInterestForSavings multi-tenant", () => {
  beforeEach(() => {
    savingsFindFirst.mockReset();
    savingsUpdateMany.mockReset();
  });

  it("refuses foreign savingsId (no row for that userId)", async () => {
    savingsFindFirst.mockResolvedValueOnce(null);
    const res = await applyDueInterestForSavings("attacker", "victim-savings-id");
    expect(res).toBeNull();
    expect(savingsFindFirst).toHaveBeenCalledWith({
      where: { id: "victim-savings-id", userId: "attacker" },
    });
    expect(savingsUpdateMany).not.toHaveBeenCalled();
  });

  it("scopes updateMany with both id and userId when interest is due", async () => {
    const lastPayout = new Date("2024-01-01T00:00:00.000Z");
    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    const now = new Date("2024-01-03T12:00:00.000Z");

    savingsFindFirst
      .mockResolvedValueOnce({
        id: "sav-1",
        userId: "owner",
        balance: { toString: () => "1000" },
        apyPercent: { toString: () => "3.65" },
        rateType: "APR",
        payoutFrequency: "DAILY",
        payoutDayOfWeek: null,
        payoutDayOfMonth: null,
        payoutMonth: null,
        lastPayoutAt: lastPayout,
        lastAccruedAt: lastPayout,
        createdAt,
        currency: "EUR",
        name: "Livret",
        notes: null,
      })
      .mockResolvedValueOnce({
        id: "sav-1",
        userId: "owner",
        balance: { toString: () => "1000.2" },
        apyPercent: { toString: () => "3.65" },
        rateType: "APR",
        payoutFrequency: "DAILY",
        lastPayoutAt: now,
        lastAccruedAt: now,
        createdAt,
        currency: "EUR",
        name: "Livret",
        notes: null,
      });

    savingsUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await applyDueInterestForSavings("owner", "sav-1", now);
    expect(res).not.toBeNull();
    expect(res!.periodsCredited).toBeGreaterThan(0);
    expect(savingsUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sav-1", userId: "owner" },
      })
    );
  });
});

describe("applyDuePaymentsForLiability multi-tenant", () => {
  beforeEach(() => {
    liabilityFindFirst.mockReset();
    liabilityUpdateMany.mockReset();
    txLiabilityUpdateMany.mockReset();
    txLiabilityFindFirst.mockReset();
    txLiabilityEventCreate.mockReset();
  });

  it("refuses foreign liabilityId without writing", async () => {
    liabilityFindFirst.mockResolvedValueOnce(null);
    const res = await applyDuePaymentsForLiability("attacker", "victim-liability");
    expect(res).toBeNull();
    expect(liabilityFindFirst).toHaveBeenCalledWith({
      where: { id: "victim-liability", userId: "attacker" },
    });
    expect(txLiabilityUpdateMany).not.toHaveBeenCalled();
    expect(txLiabilityEventCreate).not.toHaveBeenCalled();
  });
});
