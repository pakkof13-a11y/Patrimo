import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET` / `POST /api/term-deposits` et `PATCH` / `DELETE` sur un dépôt.
 *
 * Les quatre handlers portaient les défauts que D39 et D40 ont fermés sur
 * leurs voisins : devise de restitution non validée, corps illisible en 500,
 * suppression sans effet annoncée réussie. Plus deux qui leur sont propres —
 * un taux vide qui lève une `DecimalError`, et un PATCH qui n'assure jamais la
 * plateforme homonyme.
 */

const findFirst = vi.fn();
const create = vi.fn();
const updateMany = vi.fn();
const deleteMany = vi.fn();
const listTermDeposits = vi.fn();
const findOrCreatePlatform = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    termDeposit: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

vi.mock("@/app/lib/cash/term-deposits-list", () => ({
  listTermDeposits: (...a: unknown[]) => listTermDeposits(...a),
}));

vi.mock("@/app/lib/platforms/upsert", () => ({
  findOrCreatePlatform: (...a: unknown[]) => findOrCreatePlatform(...a),
}));

const { GET, POST } = await import("@/app/api/term-deposits/route");
const { PATCH, DELETE } = await import("@/app/api/term-deposits/[id]/route");
const { FxRateUnknownError } = await import("@/app/lib/market/fx");

const ctx = { params: Promise.resolve({ id: "t1" }) };

const depot = {
  id: "t1",
  userId: "u1",
  bankName: "BoursoBank",
  principal: { toString: () => "100000" },
  ratePercent: { toString: () => "3" },
  currency: "EUR",
  openedAt: new Date("2025-01-01T00:00:00Z"),
  maturityDate: new Date("2026-01-01T00:00:00Z"),
  earlyWithdrawalPenaltyPct: null,
  isPro: false,
  ownershipPct: null,
  notes: null,
};

const corpsValide = {
  principal: "100000",
  ratePercent: "3",
  openedAt: "2025-01-01",
  maturityDate: "2026-01-01",
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/term-deposits", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/term-deposits/t1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    ctx
  );

const get = (query = "") =>
  GET(new Request(`http://localhost/api/term-deposits${query}`));

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(depot);
  create.mockReset().mockResolvedValue(depot);
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  listTermDeposits.mockReset().mockResolvedValue([]);
  findOrCreatePlatform.mockReset().mockResolvedValue({ id: "pf" });
});

/* ── ③ la devise de restitution ─────────────────────────────────────── */

describe("la devise de restitution est validée, pas seulement lue", () => {
  it("une devise connue passe", async () => {
    expect((await get("?base=USD")).status).toBe(200);
    expect(listTermDeposits).toHaveBeenCalledWith("u1", "USD");
  });

  it("une devise inconnue répond 400, pas 500", async () => {
    const res = await get("?base=ZZZ");
    expect(res.status).toBe(400);
    expect(listTermDeposits).not.toHaveBeenCalled();
  });

  it("sans paramètre, l'euro", async () => {
    await get();
    expect(listTermDeposits).toHaveBeenCalledWith("u1", "EUR");
  });

  /*
    La devise d'un dépôt déjà en base ne peut plus être exotique — le schéma
    s'y oppose — mais rien n'efface celles d'avant, et un 500 nu laissait
    l'onglet mort sans un mot.
  */
  it("une devise de dépôt sans taux répond 503 en la nommant", async () => {
    listTermDeposits.mockRejectedValue(new FxRateUnknownError("SEK"));
    const res = await get();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("SEK");
  });
});

/* ── ④ le taux ──────────────────────────────────────────────────────── */

describe("un montant qui n'en est pas un se refuse en 400", () => {
  it("un taux vide répond 400 et n'écrit rien", async () => {
    const res = await post({ ...corpsValide, ratePercent: "" });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("un taux hors d'échelle répond 400", async () => {
    expect((await post({ ...corpsValide, ratePercent: "325" })).status).toBe(400);
  });

  it("une pénalité vide n'empêche pas la création — c'est un champ optionnel", async () => {
    const res = await post({
      ...corpsValide,
      earlyWithdrawalPenaltyPct: "",
    });
    expect(res.status).toBe(201);
    const data = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.earlyWithdrawalPenaltyPct).toBeNull();
  });

  it("le même garde s'applique au PATCH", async () => {
    const res = await patch({ ratePercent: "" });
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

/* ── devise à l'écriture ────────────────────────────────────────────── */

describe("la devise écrite est une de celles que l'application sait convertir", () => {
  it("un trigramme inconnu est refusé à la création", async () => {
    const res = await post({ ...corpsValide, currency: "ZZZ" });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("un trigramme inconnu est refusé à la modification", async () => {
    expect((await patch({ currency: "ZZZ" })).status).toBe(400);
  });

  it("la casse ne change rien : la devise est normalisée", async () => {
    await post({ ...corpsValide, currency: "usd" });
    const data = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.currency).toBe("USD");
  });
});

/* ── ⑥ le corps ─────────────────────────────────────────────────────── */

describe("un corps illisible est une requête invalide, pas une panne", () => {
  it("POST répond 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/term-deposits", {
        method: "POST",
        body: "{oups",
      })
    );
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("PATCH répond 400", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/term-deposits/t1", {
        method: "PATCH",
        body: "{oups",
      }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

/* ── ⑦ la plateforme ────────────────────────────────────────────────── */

describe("la plateforme homonyme suit le changement de banque", () => {
  it("le PATCH l'assure quand la banque change", async () => {
    await patch({ bankName: "Fortuneo" });
    expect(findOrCreatePlatform).toHaveBeenCalledTimes(1);
  });

  /*
    Après le succès, jamais avant : une requête qui échoue ne laisse pas de
    plateforme derrière elle (D39, D40).
  */
  it("aucune plateforme quand le dépôt est introuvable", async () => {
    findFirst.mockResolvedValue(null);
    const res = await patch({ bankName: "Fortuneo" });
    expect(res.status).toBe(404);
    expect(findOrCreatePlatform).not.toHaveBeenCalled();
  });

  it("aucune plateforme quand un autre champ rend la requête invalide", async () => {
    const res = await patch({ bankName: "Fortuneo", ratePercent: "" });
    expect(res.status).toBe(400);
    expect(findOrCreatePlatform).not.toHaveBeenCalled();
  });
});

/* ── ⑤ la suppression ───────────────────────────────────────────────── */

describe("la suppression n'annonce que ce qu'elle a fait", () => {
  const suppression = () =>
    DELETE(
      new Request("http://localhost/api/term-deposits/t1", { method: "DELETE" }),
      ctx
    );

  it("supprime et répond 200", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    expect((await suppression()).status).toBe(200);
  });

  it("ne prétend pas avoir supprimé ce qui n'existe pas", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    expect((await suppression()).status).toBe(404);
  });
});
