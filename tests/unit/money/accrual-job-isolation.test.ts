import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/app/lib/prisma-client/client";

/**
 * Un livret en échec ne doit pas priver les suivants de leurs intérêts.
 *
 * Le job parcourt les livrets d'un utilisateur, puis — en mode cron — tous les
 * utilisateurs. Aucune de ces deux boucles n'isolait ses échecs : la première
 * exception remontait, le job s'arrêtait là, et tout ce qui suivait dans la
 * liste n'était jamais traité. La réponse ne disait pas non plus jusqu'où le
 * job était allé.
 *
 * Conséquence concrète : une seule ligne en défaut — panne de base sur une
 * requête, donnée illisible — bloque à chaque passage tous les livrets et tous
 * les utilisateurs situés après elle dans l'ordre de lecture.
 *
 * Le cron intraday tenait déjà la bonne forme : il rattrape l'échec de la
 * collecte quotidienne et le rapporte dans ses `errors` au lieu d'abandonner.
 */

const findMany = vi.fn();
const findFirst = vi.fn();
const updateMany = vi.fn();

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    savingsAccount: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
    },
  };
  return {
    prisma: {
      savingsAccount: {
        findMany: (...a: unknown[]) => findMany(...a),
        findFirst: (...a: unknown[]) => findFirst(...a),
      },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/app/lib/cash/account-events", () => ({
  recordSavingsAccountInterest: async () => undefined,
  recordSavingsAccountBalanceChange: async () => undefined,
}));

import { applyDueInterestForUser } from "@/app/lib/money/savings-accrual";

const IL_Y_A_UN_AN = new Date("2025-03-02T00:00:00.000Z");
const MAINTENANT = new Date("2026-03-02T00:00:00.000Z");

/** Un livret à 3 %, une échéance annuelle due. */
function livret(id: string) {
  return {
    id,
    userId: "u1",
    balance: new Prisma.Decimal("10000"),
    apyPercent: new Prisma.Decimal("3"),
    rateType: "APY",
    payoutFrequency: "YEARLY",
    payoutDayOfWeek: null,
    payoutDayOfMonth: null,
    payoutMonth: null,
    lastPayoutAt: IL_Y_A_UN_AN,
    lastAccruedAt: IL_Y_A_UN_AN,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
  };
}

const PANNE = new Error("could not read savings row");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  findMany.mockReset().mockResolvedValue([livret("s1"), livret("s2"), livret("s3")]);
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  findFirst.mockReset().mockImplementation(async (args: { where: { id: string } }) => {
    // `s2` est illisible ; les deux autres répondent normalement.
    if (args.where.id === "s2") throw PANNE;
    return livret(args.where.id);
  });
});

describe("un livret en échec n'arrête pas le job", () => {
  it("les livrets suivants sont tout de même traités", async () => {
    const res = await applyDueInterestForUser("u1", MAINTENANT);

    /*
      Deux livrets crédités sur trois. Avant, l'exception de `s2` remontait et
      `s3` n'était jamais lu.
    */
    expect(res.periodsCredited).toBe(2);
  });

  it("l'échec est rapporté, pas avalé", async () => {
    const res = await applyDueInterestForUser("u1", MAINTENANT);

    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.savingsId).toBe("s2");
    expect(res.errors[0]!.message).toMatch(/could not read/);
  });

  it("le total d'intérêts ne compte que ce qui a réellement été crédité", async () => {
    const res = await applyDueInterestForUser("u1", MAINTENANT);
    // 3 % de 10 000 sur deux livrets.
    expect(Number(res.totalInterest)).toBeCloseTo(600, 6);
  });

  it("sans aucun échec, le résultat est inchangé", async () => {
    findFirst.mockImplementation(async (args: { where: { id: string } }) =>
      livret(args.where.id)
    );

    const res = await applyDueInterestForUser("u1", MAINTENANT);
    expect(res.accounts).toBe(3);
    expect(res.periodsCredited).toBe(3);
    expect(res.errors).toHaveLength(0);
  });

  it("tous les livrets en échec sont rapportés, aucun n'est perdu", async () => {
    findFirst.mockImplementation(async () => {
      throw PANNE;
    });

    const res = await applyDueInterestForUser("u1", MAINTENANT);
    expect(res.periodsCredited).toBe(0);
    expect(res.errors).toHaveLength(3);
  });
});
