import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeFakeUserStore,
  p2003,
  seedUserGraph,
} from "../portfolio/fake-user-store";

/**
 * JOU-04 — DELETE /api/admin/users?id=X ne doit plus rendre un 500 Prisma
 * dès que le compte a écrit une ligne de journal.
 *
 * Avant : `prisma.user.delete` seul. `Transaction` n'a AUCUNE FK vers `User`
 * (elle ne cascade donc jamais) et ses FK `platformId` / `assetId` sont en
 * `onDelete: Restrict` → la cascade `User → Platform` / `User → Asset` lève
 * P2003, non capturée → 500, rien de supprimé.
 *
 * Après : la route appelle `resetUserData(userId)` (déjà dans le bon ordre
 * vis-à-vis des Restrict, filtré par `userId` partout) AVANT `user.delete`.
 *
 * Magasin Prisma en mémoire (`fake-user-store.ts`) qui reproduit ces FK et
 * la cascade DB depuis `User` ; `gateAdmin` mocké en admin `u-admin`. Aucune
 * base réelle n'est touchée.
 */

let store: ReturnType<typeof makeFakeUserStore>;

type Gate =
  | { ok: true; user: { id: string; role: string; username: string } }
  | { ok: false; status: 401 | 403; error: string };

const { gateAdminMock, invalidateMock } = vi.hoisted(() => ({
  gateAdminMock: vi.fn<() => Promise<Gate>>(),
  invalidateMock: vi.fn<(userId?: string) => Promise<void>>(async () => undefined),
}));

vi.mock("@/app/lib/prisma", () => ({
  get prisma() {
    return store.client;
  },
}));

vi.mock("@/app/lib/auth-helpers", async () => {
  const { NextResponse } = await import("next/server");
  return {
    gateAdmin: () => gateAdminMock(),
    adminGateJson: (gate: { status: number; error: string }) =>
      NextResponse.json({ error: gate.error }, { status: gate.status }),
    invalidateUserAccessCache: (userId?: string) => invalidateMock(userId),
  };
});

import { DELETE } from "@/app/api/admin/users/route";

const ADMIN = "u-admin";
const VICTIM = "u-victim";
const OTHER = "u-other";

function requete(id: string | null) {
  const url = id === null
    ? "http://localhost/api/admin/users"
    : `http://localhost/api/admin/users?id=${encodeURIComponent(id)}`;
  return new Request(url, { method: "DELETE" });
}

function snapshotOf(userId: string): Record<string, number> {
  return Object.fromEntries(store.models().map((m) => [m, store.countFor(m, userId)]));
}

beforeEach(() => {
  store = makeFakeUserStore();
  store.seed("user", { id: ADMIN, userId: ADMIN, username: "admin", role: "ADMIN" });
  seedUserGraph(store, VICTIM);
  seedUserGraph(store, OTHER);
  gateAdminMock.mockReset().mockResolvedValue({
    ok: true,
    user: { id: ADMIN, role: "ADMIN", username: "admin" },
  });
  invalidateMock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("JOU-04 — suppression admin d'un compte ayant un journal", () => {
  it("garde du simulateur : user.delete seul (ancien code) lève P2003 dès qu'une Transaction existe", () => {
    expect(store.countFor("transaction", VICTIM)).toBeGreaterThanOrEqual(1);
    expect(() => store.deleteUser(VICTIM)).toThrow(
      expect.objectContaining({ code: "P2003" })
    );
    // Rien n'a bougé : Postgres refuse tout le DELETE.
    expect(store.table("user").some((u) => u.id === VICTIM)).toBe(true);
  });

  it("≥1 Transaction, Asset, Platform, SecuritiesAccount → 200, toutes les données du compte disparaissent", async () => {
    expect(store.countFor("transaction", VICTIM)).toBe(1);
    expect(store.countFor("asset", VICTIM)).toBe(1);
    expect(store.countFor("platform", VICTIM)).toBe(1);
    expect(store.countFor("securitiesAccount", VICTIM)).toBe(1);

    const res = await DELETE(requete(VICTIM));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    const leftovers = store.models().filter((m) => store.countFor(m, VICTIM) > 0);
    expect(leftovers).toEqual([]);
    expect(store.table("user").some((u) => u.id === VICTIM)).toBe(false);
    expect(invalidateMock).toHaveBeenCalledWith(VICTIM);
  });

  it("isolation : les données d'un AUTRE utilisateur ne sont pas touchées", async () => {
    const before = snapshotOf(OTHER);
    expect(Object.values(before).every((n) => n === 1)).toBe(true);

    const res = await DELETE(requete(VICTIM));
    expect(res.status).toBe(200);

    // `toMatchObject` : les tables que `resetUserData` a fait apparaître à
    // vide dans le magasin (modèles non seedés ici) ne comptent pas — seuls
    // les comptages seedés avant doivent être inchangés.
    expect(snapshotOf(OTHER)).toMatchObject(before);
    expect(store.table("user").some((u) => u.id === OTHER)).toBe(true);
    // Chaque deleteMany émis était filtré sur l'utilisateur supprimé.
    const unfiltered = store.calls.filter(
      (c) => c.op === "deleteMany" && JSON.stringify(c.where).includes(VICTIM) === false
    );
    expect(unfiltered).toEqual([]);
  });

  it("id inconnu → 404, aucune suppression émise", async () => {
    const before = snapshotOf(OTHER);
    const res = await DELETE(requete("u-inconnu"));
    expect(res.status).toBe(404);
    expect(store.calls.filter((c) => c.op !== "findUnique")).toEqual([]);
    expect(snapshotOf(OTHER)).toEqual(before);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("propre compte → 400 ; id absent → 400", async () => {
    expect((await DELETE(requete(ADMIN))).status).toBe(400);
    expect((await DELETE(requete(null))).status).toBe(400);
    expect(store.table("user").some((u) => u.id === ADMIN)).toBe(true);
  });

  it("non admin → statut de la garde, rien n'est supprimé", async () => {
    gateAdminMock.mockResolvedValue({ ok: false, status: 403, error: "Accès réservé à l'administrateur" });
    const res = await DELETE(requete(VICTIM));
    expect(res.status).toBe(403);
    expect(store.calls).toEqual([]);
    expect(store.countFor("transaction", VICTIM)).toBe(1);
  });

  it("une FK Restrict résiduelle → 409 métier lisible, jamais le texte Prisma", async () => {
    store.failNext("user.delete", p2003("Residual_userId_fkey"));
    const res = await DELETE(requete(VICTIM));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Suppression refusée/);
    expect(body.error).not.toMatch(/fkey|Foreign key|P2003/);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("panne pendant le wipe → 500 générique, rollback intégral, l'autre utilisateur intact", async () => {
    const beforeVictim = snapshotOf(VICTIM);
    const beforeOther = snapshotOf(OTHER);
    store.failNext("platform.deleteMany", new Error("connection reset"));

    const res = await DELETE(requete(VICTIM));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/connection reset/);

    // Tout ou rien : la transaction de `resetUserData` a été rollbackée.
    expect(snapshotOf(VICTIM)).toEqual(beforeVictim);
    expect(snapshotOf(OTHER)).toEqual(beforeOther);
    expect(store.table("user").some((u) => u.id === VICTIM)).toBe(true);
  });
});
