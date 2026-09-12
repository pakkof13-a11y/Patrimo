import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un taux qu'on ne sait pas lire n'est pas 0 %.
 *
 * `changeInterestRate` lisait son montant par `String(opts.interestRate || "0")
 * .replace(",", ".")`, et la route le lui passait par
 * `String(body.interestRate ?? body.rate ?? "")`. Un corps sans taux — champ
 * vide du formulaire, clé mal orthographiée — enregistrait donc un avenant
 * `RATE_CHANGE` à 0 %, écrasait le taux réel du crédit en base et reprojetait
 * sa date de fin sur un prêt devenu gratuit. Aucune erreur, aucune trace.
 *
 * La validation zod de la route refuse désormais l'entrée : 400, et rien
 * d'écrit. Même règle pour la mensualité et pour le montant d'un
 * remboursement anticipé partiel.
 */

const updateMany = vi.fn();
const findFirst = vi.fn();
const eventCreate = vi.fn();

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    liability: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findFirstOrThrow: (...a: unknown[]) => findFirst(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    liabilityEvent: { create: (...a: unknown[]) => eventCreate(...a) },
  };
  return {
    prisma: {
      liability: {
        findFirst: (...a: unknown[]) => findFirst(...a),
        updateMany: (...a: unknown[]) => updateMany(...a),
        findMany: async () => [],
      },
      liabilityEvent: { create: (...a: unknown[]) => eventCreate(...a) },
      asset: { findFirst: async () => null },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

const { POST } = await import("@/app/api/liabilities/route");
const { Prisma } = await import("@/app/lib/prisma-client/client");

const requete = (body: unknown) =>
  new Request("http://localhost/api/liabilities", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue({
    id: "l1",
    userId: "u1",
    currency: "EUR",
    remainingAmount: new Prisma.Decimal("200000"),
    monthlyPayment: new Prisma.Decimal("1000"),
    interestRate: new Prisma.Decimal("3.4"),
    endDate: null,
    startDate: null,
    paymentDay: null,
    lastPaymentAppliedAt: null,
  });
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  eventCreate.mockReset().mockResolvedValue({});
});

describe("avenant de taux", () => {
  it("refuse un taux vide en 400, sans rien écrire", async () => {
    const res = await POST(
      requete({ action: "rate_change", liabilityId: "l1", interestRate: "" })
    );
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("refuse un taux absent en 400", async () => {
    const res = await POST(requete({ action: "rate_change", liabilityId: "l1" }));
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuse un taux illisible en 400", async () => {
    const res = await POST(
      requete({ action: "rate_change", liabilityId: "l1", interestRate: "abc" })
    );
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("accepte un taux valide et l'écrit", async () => {
    const res = await POST(
      requete({ action: "rate_change", liabilityId: "l1", interestRate: "2,75" })
    );
    expect(res.status).toBe(200);
    // La virgule décimale est lue par `parseNumber`, comme à l'import.
    expect(String(updateMany.mock.calls[0]![0].data.interestRate)).toBe("2.75");
  });

  it("accepte un taux nul explicitement saisi", async () => {
    const res = await POST(
      requete({ action: "rate_change", liabilityId: "l1", interestRate: "0" })
    );
    expect(res.status).toBe(200);
    expect(String(updateMany.mock.calls[0]![0].data.interestRate)).toBe("0");
  });
});

describe("avenant de mensualité", () => {
  it("refuse une mensualité vide en 400", async () => {
    const res = await POST(
      requete({ action: "payment_change", liabilityId: "l1", monthlyPayment: "" })
    );
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("lit « 1 234,56 » sans le transformer en NaN", async () => {
    const res = await POST(
      requete({
        action: "payment_change",
        liabilityId: "l1",
        monthlyPayment: "1234,56",
      })
    );
    expect(res.status).toBe(200);
    expect(String(updateMany.mock.calls[0]![0].data.monthlyPayment)).toBe("1234.56");
  });
});

describe("remboursement anticipé", () => {
  it("refuse un partiel sans montant en 400", async () => {
    const res = await POST(
      requete({ action: "early_repayment", liabilityId: "l1", kind: "PARTIAL" })
    );
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("accepte un solde total, qui n'a pas de montant à saisir", async () => {
    const res = await POST(
      requete({ action: "early_repayment", liabilityId: "l1", kind: "TOTAL" })
    );
    expect(res.status).toBe(200);
  });
});
