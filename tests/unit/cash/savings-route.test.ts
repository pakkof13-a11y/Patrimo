import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST` / `PUT` / `DELETE /api/savings` — Prisma et l'accrual mockés.
 *
 * Le livret a un voisin que rien d'autre n'a : les intérêts se créditent au
 * milieu de la requête. C'est ce qui rendait l'écart faux à chaque saisie de
 * solde, et c'est ce que ces contrôles épinglent en premier.
 */

const updateMany = vi.fn();
const deleteMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const eventCreate = vi.fn();
const eventCount = vi.fn();
const applyDueInterestForUser = vi.fn();
const findOrCreatePlatform = vi.fn();

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    savingsAccount: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      create: (...a: unknown[]) => create(...a),
    },
    savingsAccountEvent: {
      create: (...a: unknown[]) => eventCreate(...a),
      count: (...a: unknown[]) => eventCount(...a),
    },
  };
  return {
    prisma: {
      savingsAccount: {
        findFirst: (...a: unknown[]) => findFirst(...a),
        updateMany: (...a: unknown[]) => updateMany(...a),
        deleteMany: (...a: unknown[]) => deleteMany(...a),
        create: (...a: unknown[]) => create(...a),
      },
      savingsAccountEvent: {
        create: (...a: unknown[]) => eventCreate(...a),
        count: (...a: unknown[]) => eventCount(...a),
      },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

vi.mock("@/app/lib/money/savings-accrual", () => ({
  applyDueInterestForUser: (...a: unknown[]) => applyDueInterestForUser(...a),
}));

vi.mock("@/app/lib/platforms/upsert", () => ({
  findOrCreatePlatform: (...a: unknown[]) => findOrCreatePlatform(...a),
}));

const { POST, PUT, DELETE } = await import("@/app/api/savings/route");
const { Prisma } = await import("@/app/lib/prisma-client/client");

function ligne(
  solde: string,
  over: Partial<{ currency: string; updatedAt: Date; ceilingAmount: unknown }> = {}
) {
  return {
    id: "s1",
    userId: "u1",
    name: "Livret A",
    bankName: null,
    productType: "LIVRET_A",
    ceilingAmount: over.ceilingAmount ?? null,
    balance: new Prisma.Decimal(solde),
    apyPercent: new Prisma.Decimal("3"),
    currency: over.currency ?? "EUR",
    isPro: false,
    ownershipPct: null,
    notes: null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: over.updatedAt ?? new Date("2026-08-20T10:00:00Z"),
  };
}

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/savings", {
      method: "PUT",
      body: JSON.stringify(body),
    })
  );

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/savings", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  create.mockReset().mockResolvedValue(ligne("0"));
  eventCreate.mockReset().mockResolvedValue({ id: "evt" });
  eventCount.mockReset().mockResolvedValue(1);
  findFirst.mockReset().mockResolvedValue(ligne("10000"));
  applyDueInterestForUser
    .mockReset()
    .mockResolvedValue({ accounts: 1, periodsCredited: 0, totalInterest: "0", errors: [] });
  findOrCreatePlatform.mockReset().mockResolvedValue({ id: "pf" });
});

/* ── ① la mesure du chantier ────────────────────────────────────────── */

describe("l'écart part du solde d'après les intérêts", () => {
  /*
    Livret à 10 000 €, 100 € d'intérêts dus, saisie à 10 500 €.

    L'accrual crédite d'abord : la ligne passe à 10 100 et un `INTEREST` de
    100 est inscrit. L'ancienne route lisait pourtant son état de départ tout
    en haut, avant l'accrual, et journalisait « dépôt de 500 depuis 10 000 ».

    Le compartiment de trésorerie écarte les `INTEREST` des flux : la valeur
    montait de 500, les flux disaient 500, la performance tombait donc à zéro
    là où il y avait 100 € d'intérêts. Systématique, pas une course.
  */
  it("un dépôt de 400, pas de 500, quand 100 € d'intérêts viennent d'être crédités", async () => {
    // Premier appel : l'ancre, lue avant l'accrual. Ensuite : la ligne créditée.
    findFirst
      .mockResolvedValueOnce(ligne("10000"))
      .mockResolvedValue(ligne("10100"));
    applyDueInterestForUser.mockResolvedValue({
      accounts: 1,
      periodsCredited: 1,
      totalInterest: "100",
      errors: [],
    });

    const res = await put({ id: "s1", balance: "10500" });
    expect(res.status).toBe(200);

    const evt = eventCreate.mock.calls[0]![0] as {
      data: { type: string; amount: unknown; balanceAfter: unknown };
    };
    expect(evt.data.type).toBe("DEPOSIT");
    expect(String(evt.data.amount)).toBe("400");
    expect(String(evt.data.balanceAfter)).toBe("10500");
  });

  it("les intérêts sont crédités avant que l'état de départ ne soit relu", async () => {
    await put({ id: "s1", balance: "10500" });
    expect(
      applyDueInterestForUser.mock.invocationCallOrder[0]!
    ).toBeLessThan(updateMany.mock.invocationCallOrder[0]!);
  });
});

/* ── ② le verrou ────────────────────────────────────────────────────── */

describe("l'écriture est verrouillée sur l'état qui a servi au calcul", () => {
  it("le solde relu est épinglé dans la condition d'écriture", async () => {
    findFirst
      .mockResolvedValueOnce(ligne("10000"))
      .mockResolvedValue(ligne("10100"));
    await put({ id: "s1", balance: "10500" });
    const where = (updateMany.mock.calls[0]![0] as { where: Record<string, unknown> })
      .where;
    expect(String(where.balance)).toBe("10100");
    expect(where.userId).toBe("u1");
  });

  it("une ligne modifiée entre-temps répond 409, sans écrire d'événement", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await put({ id: "s1", balance: "10500" });
    expect(res.status).toBe(409);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("un livret inexistant répond 404, pas 409", async () => {
    findFirst.mockResolvedValue(null);
    const res = await put({ id: "s1", balance: "10500" });
    expect(res.status).toBe(404);
  });
});

/* ── ③⑥ devise et ouverture ─────────────────────────────────────────── */

describe("le changement de devise ne perd plus le passé du livret", () => {
  it("une bascule de devise seule ouvre l'histoire au solde d'avant", async () => {
    const connuLe = new Date("2026-08-20T10:00:00.000Z");
    eventCount.mockResolvedValue(0);
    findFirst.mockResolvedValue(
      ligne("10000", { currency: "EUR", updatedAt: connuLe })
    );

    const res = await put({ id: "s1", currency: "USD" });
    expect(res.status).toBe(200);
    expect(eventCreate).toHaveBeenCalledTimes(2);

    const ouverture = eventCreate.mock.calls[0]![0] as {
      data: { type: string; occurredAt: Date; amount: unknown; currency: string };
    };
    expect(ouverture.data.type).toBe("OPENING");
    expect(ouverture.data.occurredAt).toEqual(connuLe);
    expect(String(ouverture.data.amount)).toBe("10000");
    expect(ouverture.data.currency).toBe("EUR");

    const bascule = eventCreate.mock.calls[1]![0] as {
      data: { type: string; amount: unknown; currency: string };
    };
    expect(bascule.data.type).toBe("REDENOMINATION");
    // Rien n'entre ni ne sort : le nominal est conservé, pas converti.
    expect(String(bascule.data.amount)).toBe("0");
    expect(bascule.data.currency).toBe("USD");
  });

  /*
    L'ancre et le décompte viennent d'avant l'accrual : sinon un `INTEREST`
    fraîchement écrit ferait croire que le livret a déjà une histoire, et
    l'ouverture ne serait jamais posée.
  */
  it("un INTEREST écrit par l'accrual n'empêche pas l'ouverture", async () => {
    const connuLe = new Date("2026-08-20T10:00:00.000Z");
    eventCount.mockResolvedValue(0);
    findFirst
      .mockResolvedValueOnce(ligne("10000", { updatedAt: connuLe }))
      .mockResolvedValue(ligne("10100", { updatedAt: new Date() }));
    applyDueInterestForUser.mockResolvedValue({
      accounts: 1,
      periodsCredited: 1,
      totalInterest: "100",
      errors: [],
    });

    await put({ id: "s1", balance: "10500" });

    const ouverture = eventCreate.mock.calls[0]![0] as {
      data: { type: string; occurredAt: Date; amount: unknown };
    };
    expect(ouverture.data.type).toBe("OPENING");
    // Le solde et la date d'avant l'accrual, pas ceux d'après.
    expect(String(ouverture.data.amount)).toBe("10000");
    expect(ouverture.data.occurredAt).toEqual(connuLe);
  });

  it("un changement de nom seul n'écrit aucun événement sur un livret journalisé", async () => {
    eventCount.mockResolvedValue(1);
    await put({ id: "s1", name: "Livret bleu" });
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

/* ── ⑧ + json + plateforme ──────────────────────────────────────────── */

describe("ce que la route dit et ce qu'elle ne fait plus en douce", () => {
  it("un corps illisible répond 400", async () => {
    const res = await PUT(
      new Request("http://localhost/api/savings", {
        method: "PUT",
        body: "{oups",
      })
    );
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("les livrets que l'accrual n'a pas pu créditer sortent dans la réponse", async () => {
    applyDueInterestForUser.mockResolvedValue({
      accounts: 2,
      periodsCredited: 0,
      totalInterest: "0",
      errors: [{ savingsId: "s9", message: "taux illisible" }],
    });
    const res = await put({ id: "s1", balance: "10500" });
    const body = (await res.json()) as { interestErrors?: unknown[] };
    expect(body.interestErrors).toHaveLength(1);
  });

  /*
    L'appel vivait dans la construction de `data`, donc avant la transaction :
    un PUT qui finissait en 404 laissait quand même une plateforme derrière lui.
  */
  it("aucune plateforme n'est créée quand le PUT échoue", async () => {
    findFirst.mockResolvedValue(null);
    const res = await put({ id: "s1", bankName: "Fortuneo" });
    expect(res.status).toBe(404);
    expect(findOrCreatePlatform).not.toHaveBeenCalled();
  });

  it("la plateforme est créée quand le PUT aboutit", async () => {
    await put({ id: "s1", bankName: "Fortuneo" });
    expect(findOrCreatePlatform).toHaveBeenCalledTimes(1);
  });
});

/* ── ⑤ le plafond ───────────────────────────────────────────────────── */

describe("le plafond d'un produit réglementé", () => {
  const ceilingCree = () =>
    (create.mock.calls[0]![0] as { data: { ceilingAmount: unknown } }).data
      .ceilingAmount;

  it("un plafond vide n'écrase pas la suggestion réglementaire", async () => {
    // `decimalString` accepte la chaîne vide, et `??` ne la rattrapait pas :
    // le Livret A partait sans plafond, et `""` filait vers une colonne Decimal.
    await post({ name: "Livret A", productType: "LIVRET_A", ceilingAmount: "" });
    expect(ceilingCree()).toBe("22950");
  });

  it("un plafond absent retombe aussi sur la suggestion", async () => {
    await post({ name: "Livret A", productType: "LIVRET_A" });
    expect(ceilingCree()).toBe("22950");
  });

  it("un plafond saisi est respecté", async () => {
    await post({ name: "Livret A", productType: "LIVRET_A", ceilingAmount: "15000" });
    expect(ceilingCree()).toBe("15000");
  });

  it("un produit sans plafond réglementaire reste sans plafond", async () => {
    await post({ name: "Compte", productType: "AUTRE" });
    expect(ceilingCree()).toBeNull();
  });
});

/* ── ④ la suppression ───────────────────────────────────────────────── */

describe("la suppression n'annonce que ce qu'elle a fait", () => {
  const suppression = (id: string) =>
    DELETE(
      new Request(`http://localhost/api/savings?id=${id}`, { method: "DELETE" })
    );

  it("supprime et répond 200", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    expect((await suppression("s1")).status).toBe(200);
  });

  it("ne prétend pas avoir supprimé ce qui n'existe pas", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    expect((await suppression("inconnu")).status).toBe(404);
  });
});
