import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `PUT` / `DELETE /api/banks` — Prisma mocké.
 *
 * Ce que ces contrôles couvrent et que rien ne couvrait : l'état de départ lu
 * dans la transaction, le verrou qui empêche de l'écraser, l'ouverture posée
 * quand la ligne est écrite sans avoir d'histoire, et les deux réponses qui
 * mentaient — un corps illisible en 500, une suppression sans effet en 200.
 */

const updateMany = vi.fn();
const deleteMany = vi.fn();
const findFirst = vi.fn();
const eventCreate = vi.fn();
const eventCount = vi.fn();

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    bankAccount: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    bankAccountEvent: {
      create: (...a: unknown[]) => eventCreate(...a),
      count: (...a: unknown[]) => eventCount(...a),
    },
  };
  return {
    prisma: {
      bankAccount: {
        findFirst: (...a: unknown[]) => findFirst(...a),
        updateMany: (...a: unknown[]) => updateMany(...a),
        deleteMany: (...a: unknown[]) => deleteMany(...a),
      },
      bankAccountEvent: {
        create: (...a: unknown[]) => eventCreate(...a),
        count: (...a: unknown[]) => eventCount(...a),
      },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

// La plateforme homonyme n'est pas le sujet, et son échec est déjà avalé.
vi.mock("@/app/lib/platforms/upsert", () => ({
  findOrCreatePlatform: async () => ({ id: "pf" }),
}));

const { PUT, DELETE } = await import("@/app/api/banks/route");
const { Prisma } = await import("@/app/lib/prisma-client/client");

/** La ligne telle que la transaction la relit. */
function ligne(
  solde: string,
  over: Partial<{ currency: string; updatedAt: Date; createdAt: Date }> = {}
) {
  return {
    id: "b1",
    userId: "u1",
    bankName: "BoursoBank",
    balance: new Prisma.Decimal(solde),
    currency: over.currency ?? "EUR",
    isPro: false,
    ownershipPct: null,
    notes: null,
    createdAt: over.createdAt ?? new Date("2020-01-01T00:00:00Z"),
    updatedAt: over.updatedAt ?? new Date("2026-08-20T10:00:00Z"),
  };
}

const requete = (body: unknown) =>
  new Request("http://localhost/api/banks", {
    method: "PUT",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  eventCreate.mockReset().mockResolvedValue({ id: "evt" });
  // Un historique existe par défaut : la plupart des cas ne sont pas des
  // ouvertures. Les contrôles d'ouverture le mettent à 0 explicitement.
  eventCount.mockReset().mockResolvedValue(1);
  findFirst.mockReset().mockResolvedValue(ligne("1000"));
});

/* ── ⑩ ─────────────────────────────────────────────────────────────── */

describe("un corps illisible est une requête invalide, pas une panne", () => {
  it("PUT sans corps JSON répond 400", async () => {
    const res = await PUT(
      new Request("http://localhost/api/banks", { method: "PUT", body: "{oups" })
    );
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

/* ── ④ ─────────────────────────────────────────────────────────────── */

describe("l'état de départ est lu dans la transaction, et verrouillé", () => {
  it("l'écart part de la ligne relue, pas d'une lecture d'avant", async () => {
    findFirst.mockResolvedValue(ligne("1000"));
    await PUT(requete({ id: "b1", balance: "1200" }));

    const evt = eventCreate.mock.calls[0]![0] as {
      data: { amount: unknown; balanceAfter: unknown };
    };
    expect(String(evt.data.amount)).toBe("200");
    expect(String(evt.data.balanceAfter)).toBe("1200");
  });

  /*
    Le verrou optimiste : le solde lu est épinglé dans le `where`. Deux PUT
    concurrents partant de 1 000 ne peuvent plus écrire chacun son écart depuis
    un état que l'autre a déjà remplacé.
  */
  it("le solde lu est épinglé dans la condition d'écriture", async () => {
    await PUT(requete({ id: "b1", balance: "1200" }));
    const where = (updateMany.mock.calls[0]![0] as { where: Record<string, unknown> })
      .where;
    expect(String(where.balance)).toBe("1000");
    expect(where.userId).toBe("u1");
  });

  it("une ligne modifiée entre-temps répond 409, et n'écrit aucun événement", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await PUT(requete({ id: "b1", balance: "1200" }));
    expect(res.status).toBe(409);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("un compte inexistant répond 404, pas 409", async () => {
    findFirst.mockResolvedValue(null);
    const res = await PUT(requete({ id: "b1", balance: "1200" }));
    expect(res.status).toBe(404);
  });
});

/* ── ⑤ ─────────────────────────────────────────────────────────────── */

describe("le changement de devise ne perd plus le passé du compte", () => {
  /*
    La mesure du chantier. Compte à 5 200 €, aucun événement — l'état d'un
    compte antérieur au journal ; le jeu de démonstration, lui, écrit bien une
    ouverture —, `updatedAt` au 20 août. On bascule en USD, sans toucher au
    solde.

    Sans ouverture, l'`updateMany` ramenait `updatedAt` à aujourd'hui et
    `buildCashSleeve`, faute d'événement, faisait démarrer le compte du jour :
    tout son passé disparaissait de la courbe.
  */
  it("une bascule de devise seule ouvre l'histoire au solde d'avant", async () => {
    const connuLe = new Date("2026-08-20T10:00:00.000Z");
    eventCount.mockResolvedValue(0);
    findFirst.mockResolvedValue(
      ligne("5200", { currency: "EUR", updatedAt: connuLe })
    );

    const res = await PUT(requete({ id: "b1", currency: "USD" }));
    expect(res.status).toBe(200);

    // Deux faits : l'ouverture d'hier, la redénomination d'aujourd'hui.
    expect(eventCreate).toHaveBeenCalledTimes(2);

    const ouverture = eventCreate.mock.calls[0]![0] as {
      data: {
        type: string;
        occurredAt: Date;
        amount: unknown;
        balanceAfter: unknown;
        currency: string;
      };
    };
    expect(ouverture.data.type).toBe("OPENING");
    expect(ouverture.data.occurredAt).toEqual(connuLe);
    expect(String(ouverture.data.amount)).toBe("5200");
    // Dans la devise d'alors : le chargeur convertit chaque fait avec la sienne.
    expect(ouverture.data.currency).toBe("EUR");

    const bascule = eventCreate.mock.calls[1]![0] as {
      data: { type: string; amount: unknown; balanceAfter: unknown; currency: string };
    };
    expect(bascule.data.type).toBe("REDENOMINATION");
    // Rien n'entre ni ne sort : l'utilisateur n'a ni versé ni retiré.
    expect(String(bascule.data.amount)).toBe("0");
    expect(String(bascule.data.balanceAfter)).toBe("5200");
    expect(bascule.data.currency).toBe("USD");
  });

  it("n'ouvre rien quand le compte a déjà des événements", async () => {
    eventCount.mockResolvedValue(1);
    findFirst.mockResolvedValue(ligne("5200", { currency: "EUR" }));

    await PUT(requete({ id: "b1", currency: "USD" }));

    expect(eventCreate).toHaveBeenCalledTimes(1);
    const seul = eventCreate.mock.calls[0]![0] as { data: { type: string } };
    expect(seul.data.type).toBe("REDENOMINATION");
  });

  it("un changement de nom seul n'écrit aucun événement", async () => {
    eventCount.mockResolvedValue(1);
    await PUT(requete({ id: "b1", bankName: "Fortuneo" }));
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("le changement de solde est libellé dans la devise que le compte porte", async () => {
    eventCount.mockResolvedValue(1);
    findFirst.mockResolvedValue(ligne("1000", { currency: "USD" }));
    await PUT(requete({ id: "b1", balance: "1200" }));
    const evt = eventCreate.mock.calls[0]![0] as { data: { currency: string } };
    expect(evt.data.currency).toBe("USD");
  });
});

/* ── ⑨ ─────────────────────────────────────────────────────────────── */

describe("la suppression n'annonce que ce qu'elle a fait", () => {
  const suppression = (id: string) =>
    DELETE(
      new Request(`http://localhost/api/banks?id=${id}`, { method: "DELETE" })
    );

  it("supprime et répond 200", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    expect((await suppression("b1")).status).toBe(200);
  });

  /*
    Le compte du `deleteMany` était jeté : supprimer l'identifiant d'un autre
    utilisateur — ou un identifiant inexistant — répondait « c'est fait », et
    l'écran rafraîchissait en le croyant.
  */
  it("ne prétend pas avoir supprimé ce qui n'existe pas", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    expect((await suppression("inconnu")).status).toBe(404);
  });
});
