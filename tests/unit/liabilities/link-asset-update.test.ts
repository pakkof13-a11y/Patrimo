import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rattacher ou détacher le bien financé par un crédit.
 *
 * La route d'édition construisait `data.asset = { connect } / { disconnect }`
 * puis appelait `updateMany`. Prisma refuse toute écriture de relation dans un
 * `updateMany` : la requête échouait donc systématiquement, et aucune des
 * autres modifications de la même édition n'était écrite.
 *
 * L'appartenance du bien était bien vérifiée avant — ce n'est pas un défaut
 * d'isolation, mais une écriture impossible.
 */

const liabilityFindFirst = vi.fn();
const liabilityUpdateMany = vi.fn();
const assetFindFirst = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    liability: {
      findFirst: (...a: unknown[]) => liabilityFindFirst(...a),
      updateMany: (...a: unknown[]) => liabilityUpdateMany(...a),
    },
    asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) },
  },
}));

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

import { PUT } from "@/app/api/liabilities/route";

function requete(body: unknown) {
  return new Request("http://localhost/api/liabilities", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Le `data` que la route a réellement transmis à Prisma. */
function donnees(): Record<string, unknown> {
  const call = liabilityUpdateMany.mock.calls[0]![0] as {
    data: Record<string, unknown>;
  };
  return call.data;
}

beforeEach(() => {
  liabilityFindFirst
    .mockReset()
    .mockResolvedValue({ id: "l1", userId: "u1", name: "Prêt" });
  liabilityUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  assetFindFirst.mockReset().mockResolvedValue({ id: "a1" });
});

describe("rattachement du bien financé", () => {
  it("écrit la clé étrangère, jamais une relation imbriquée", async () => {
    const res = await PUT(requete({ id: "l1", assetId: "a1" }));
    expect(res.status).toBe(200);

    const data = donnees();
    expect(data.assetId).toBe("a1");
    /*
      Le point exact du défaut : `asset` sous forme de relation faisait rejeter
      la requête entière par Prisma.
    */
    expect(data).not.toHaveProperty("asset");
  });

  it("le détachement passe par null, pas par disconnect", async () => {
    const res = await PUT(requete({ id: "l1", assetId: "" }));
    expect(res.status).toBe(200);

    const data = donnees();
    expect(data.assetId).toBeNull();
    expect(data).not.toHaveProperty("asset");
  });

  it("aucun champ relationnel n'est transmis à updateMany", async () => {
    await PUT(
      requete({ id: "l1", assetId: "a1", name: "Prêt immobilier", notes: "x" })
    );
    const data = donnees();
    // Les autres champs de la même édition sont bien écrits : ils étaient
    // emportés par l'échec.
    expect(data.name).toBe("Prêt immobilier");
    for (const cle of ["asset", "user", "events"]) {
      expect(data).not.toHaveProperty(cle);
    }
  });

  it("ne touche pas au bien quand le champ est absent de la requête", async () => {
    await PUT(requete({ id: "l1", name: "Renommé" }));
    const data = donnees();
    expect(data).not.toHaveProperty("assetId");
    expect(assetFindFirst).not.toHaveBeenCalled();
  });
});

describe("l'isolation reste vérifiée avant tout rattachement", () => {
  it("un bien qui n'appartient pas à l'utilisateur est refusé", async () => {
    assetFindFirst.mockResolvedValue(null);
    const res = await PUT(requete({ id: "l1", assetId: "bien-d-autrui" }));
    expect(res.status).toBe(400);
    expect(liabilityUpdateMany).not.toHaveBeenCalled();
  });

  it("le bien est cherché dans le périmètre de l'utilisateur", async () => {
    await PUT(requete({ id: "l1", assetId: "a1" }));
    const where = (assetFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> })
      .where;
    expect(where.id).toBe("a1");
    expect(where.userId).toBe("u1");
  });

  it("l'écriture reste bornée à l'utilisateur", async () => {
    await PUT(requete({ id: "l1", assetId: "a1" }));
    const where = (liabilityUpdateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where.id).toBe("l1");
    expect(where.userId).toBe("u1");
  });
});
