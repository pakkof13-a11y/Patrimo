import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Échéancier de coupons : ce que le service doit garantir.
 *
 * Le point qui distingue un coupon d'un loyer : « non versé » doit trancher
 * l'échéance sans rien écrire au journal. La reproposer indéfiniment ferait
 * croire à un revenu en attente qui n'existe pas.
 */

const supportFindMany = vi.fn();
const supportFindFirst = vi.fn();
const supportUpdate = vi.fn();
const txFindFirst = vi.fn();
const createTx = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    lifeInsuranceSupport: {
      findMany: (...a: unknown[]) => supportFindMany(...a),
      findFirst: (...a: unknown[]) => supportFindFirst(...a),
      update: (...a: unknown[]) => supportUpdate(...a),
    },
    transaction: { findFirst: (...a: unknown[]) => txFindFirst(...a) },
  },
}));

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: (...a: unknown[]) => createTx(...a),
}));

import {
  COUPON_NOTE_PREFIX,
  couponNote,
  listPendingCoupons,
  settleCoupons,
} from "@/app/lib/life-insurance/coupon-schedule";

const USER = "u1";
const NOW = new Date("2025-06-30T12:00:00.000Z");
const dec = (v: string) => ({ toString: () => v });

function support(over: Record<string, unknown> = {}) {
  return {
    assetId: "asset-1",
    lifeInsuranceId: "contract-1",
    kind: "STRUCTURED",
    couponRatePct: dec("8"),
    nominalEur: dec("10000"),
    couponFrequency: "QUARTERLY",
    couponBarrierPct: dec("70"),
    couponMemory: false,
    underlying: "Euro Stoxx 50",
    strikeDate: new Date("2024-03-20T12:00:00.000Z"),
    maturityDate: new Date("2031-03-20T12:00:00.000Z"),
    lastCouponAppliedAt: null,
    asset: { name: "Athena Autocall", platformId: "plat-1", currency: "EUR" },
    ...over,
  };
}

beforeEach(() => {
  supportFindMany.mockReset().mockResolvedValue([]);
  supportFindFirst.mockReset();
  supportUpdate.mockReset().mockResolvedValue({});
  txFindFirst.mockReset().mockResolvedValue(null);
  createTx.mockReset().mockResolvedValue({ id: "tx-1" });
});

describe("couponNote", () => {
  it("porte l'identifiant du support — sinon deux structurés se confondent", () => {
    const a = couponNote("asset-1", new Date("2024-06-20T12:00:00Z"));
    const b = couponNote("asset-2", new Date("2024-06-20T12:00:00Z"));
    expect(a).not.toBe(b);
    expect(a).toContain(COUPON_NOTE_PREFIX);
    expect(a).toContain("asset-1");
    expect(a).toContain("2024-06-20");
  });
});

describe("listPendingCoupons", () => {
  it("propose le coupon périodique, pas le taux annuel entier", async () => {
    supportFindMany.mockResolvedValue([support()]);
    const pending = await listPendingCoupons(USER, { now: NOW });
    // 10 000 € à 8 % annuel, trimestriel → 200 € par constatation.
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((p) => p.amountEur === "200.00")).toBe(true);
  });

  it("classe les échéances par date", async () => {
    supportFindMany.mockResolvedValue([support()]);
    const dates = (await listPendingCoupons(USER, { now: NOW })).map(
      (p) => p.observedOn
    );
    expect([...dates].sort()).toEqual(dates);
  });

  it("expose barrière, mémoire et sous-jacent pour éclairer la décision", async () => {
    supportFindMany.mockResolvedValue([support({ couponMemory: true })]);
    const [first] = await listPendingCoupons(USER, { now: NOW });
    expect(first!.couponBarrierPct).toBe("70");
    expect(first!.couponMemory).toBe(true);
    expect(first!.underlying).toBe("Euro Stoxx 50");
  });

  it("ignore un structuré sans taux de coupon", async () => {
    // Un structuré purement participatif ne verse pas de coupon.
    supportFindMany.mockResolvedValue([support({ couponRatePct: null })]);
    expect(await listPendingCoupons(USER, { now: NOW })).toEqual([]);
  });

  it("ignore un structuré sans nominal", async () => {
    supportFindMany.mockResolvedValue([support({ nominalEur: null })]);
    expect(await listPendingCoupons(USER, { now: NOW })).toEqual([]);
  });

  it("verse une seule fois au terme pour un produit capitalisant", async () => {
    supportFindMany.mockResolvedValue([
      support({
        couponFrequency: "MATURITY",
        maturityDate: new Date("2025-03-20T12:00:00.000Z"),
      }),
    ]);
    const pending = await listPendingCoupons(USER, { now: NOW });
    expect(pending).toHaveLength(1);
    // Coupon annuel entier, pas une fraction de période.
    expect(pending[0]!.amountEur).toBe("800.00");
  });

  it("n'interroge que les structurés de l'utilisateur", async () => {
    await listPendingCoupons(USER, { now: NOW });
    const where = supportFindMany.mock.calls[0]![0].where;
    expect(where.kind).toBe("STRUCTURED");
    expect(where.asset.is.userId).toBe(USER);
  });
});

describe("settleCoupons", () => {
  const decision = {
    assetId: "asset-1",
    observedOn: "2024-06-20T12:00:00.000Z",
    paid: true,
  };

  it("écrit un COUPON rattaché au support et avance le curseur", async () => {
    supportFindFirst.mockResolvedValue(support());

    const res = await settleCoupons(USER, [decision]);

    expect(res).toEqual({
      created: 1,
      skipped: 0,
      alreadySettled: 0,
      errors: [],
    });
    const arg = createTx.mock.calls[0]![0];
    expect(arg.type).toBe("COUPON");
    expect(arg.assetId).toBe("asset-1");
    expect(arg.cashAmount).toBe("200.00");
    expect(arg.notes).toContain(COUPON_NOTE_PREFIX);
    expect(supportUpdate.mock.calls[0]![0].data).toHaveProperty(
      "lastCouponAppliedAt"
    );
  });

  it("« non versé » avance le curseur SANS rien écrire au journal", async () => {
    // Le cœur de la différence avec un loyer : la barrière n'a pas été
    // franchie, le coupon est perdu, et l'échéance doit cesser d'être proposée
    // sans qu'un revenu soit inventé.
    supportFindFirst.mockResolvedValue(support());

    const res = await settleCoupons(USER, [{ ...decision, paid: false }]);

    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
    expect(createTx).not.toHaveBeenCalled();
    expect(supportUpdate).toHaveBeenCalled();
  });

  it("accepte un montant supérieur au théorique (coupon à mémoire)", async () => {
    supportFindFirst.mockResolvedValue(support({ couponMemory: true }));

    await settleCoupons(USER, [{ ...decision, amountEur: "600" }]);

    expect(createTx.mock.calls[0]![0].cashAmount).toBe("600.00");
  });

  it("accepte la virgule décimale dans le montant saisi", async () => {
    supportFindFirst.mockResolvedValue(support());
    await settleCoupons(USER, [{ ...decision, amountEur: "123,45" }]);
    expect(createTx.mock.calls[0]![0].cashAmount).toBe("123.45");
  });

  it("ignore une échéance déjà écrite plutôt que de la dupliquer", async () => {
    supportFindFirst.mockResolvedValue(support());
    txFindFirst.mockResolvedValue({ id: "tx-existant" });

    const res = await settleCoupons(USER, [decision]);

    expect(res.alreadySettled).toBe(1);
    expect(createTx).not.toHaveBeenCalled();
    expect(supportUpdate).not.toHaveBeenCalled();
  });

  it("ignore une échéance déjà tranchée « non versée »", async () => {
    // Aucune transaction ne l'atteste : c'est le curseur qui fait foi, sinon
    // une échéance refusée reviendrait à chaque passage.
    supportFindFirst.mockResolvedValue(
      support({ lastCouponAppliedAt: new Date("2024-06-20T12:00:00.000Z") })
    );

    const res = await settleCoupons(USER, [decision]);

    expect(res.alreadySettled).toBe(1);
    expect(createTx).not.toHaveBeenCalled();
  });

  it("ne fait pas reculer le curseur", async () => {
    // Trancher une échéance ancienne après une récente ne doit pas rouvrir
    // celles réglées entre les deux.
    supportFindFirst.mockResolvedValue(
      support({ lastCouponAppliedAt: new Date("2025-03-20T12:00:00.000Z") })
    );

    const res = await settleCoupons(USER, [decision]);

    expect(res.alreadySettled).toBe(1);
    expect(supportUpdate).not.toHaveBeenCalled();
  });

  it("refuse un support qui n'appartient pas à l'utilisateur", async () => {
    supportFindFirst.mockResolvedValue(null);

    const res = await settleCoupons(USER, [decision]);

    expect(res.errors[0]).toContain("introuvable");
    expect(createTx).not.toHaveBeenCalled();
  });

  it("rejette une date de constatation illisible", async () => {
    supportFindFirst.mockResolvedValue(support());
    const res = await settleCoupons(USER, [
      { ...decision, observedOn: "pas-une-date" },
    ]);
    expect(res.errors[0]).toContain("invalide");
    expect(createTx).not.toHaveBeenCalled();
  });

  it("n'avance pas le curseur quand l'écriture échoue", async () => {
    supportFindFirst.mockResolvedValue(support());
    createTx.mockRejectedValue(new Error("rejet ledger"));

    const res = await settleCoupons(USER, [decision]);

    expect(res.created).toBe(0);
    expect(res.errors[0]).toContain("rejet ledger");
    expect(supportUpdate).not.toHaveBeenCalled();
  });

  it("poursuit après un échec isolé", async () => {
    supportFindFirst.mockResolvedValue(support());
    createTx
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ id: "tx-2" });

    const res = await settleCoupons(USER, [
      decision,
      { ...decision, observedOn: "2024-09-20T12:00:00.000Z" },
    ]);

    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
  });
});
