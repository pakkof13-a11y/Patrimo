import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Tests unitaires du cache d’accès — le module prisma est mocké.
 */
const findUnique = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

import {
  invalidateUserAccessCache,
  loadUserAccess,
  gateAdmin,
  adminGateJson,
} from "@/app/lib/auth-helpers";

describe("loadUserAccess + cache", () => {
  beforeEach(async () => {
    await invalidateUserAccessCache();
    findUnique.mockReset();
  });

  it("retourne null si user absent (compte supprimé)", async () => {
    findUnique.mockResolvedValueOnce(null);
    const a = await loadUserAccess("u1", { bypassCache: true });
    expect(a).toBeNull();
  });

  it("normalise le rôle ADMIN depuis la base", async () => {
    findUnique.mockResolvedValueOnce({
      id: "u1",
      role: "ADMIN",
      username: "admin",
      email: "admin@test.local",
    });
    const a = await loadUserAccess("u1", { bypassCache: true });
    expect(a?.role).toBe("ADMIN");
  });

  it("sert le cache sans re-query dans la TTL", async () => {
    findUnique.mockResolvedValueOnce({
      id: "u1",
      role: "USER",
      username: "demo",
      email: "demo@test.local",
    });
    await loadUserAccess("u1", { bypassCache: true });
    await loadUserAccess("u1"); // cache hit
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("bypassCache force une relecture", async () => {
    findUnique
      .mockResolvedValueOnce({
        id: "u1",
        role: "ADMIN",
        username: "admin",
        email: "a@t.local",
      })
      .mockResolvedValueOnce({
        id: "u1",
        role: "USER",
        username: "admin",
        email: "a@t.local",
      });
    const a1 = await loadUserAccess("u1", { bypassCache: true });
    const a2 = await loadUserAccess("u1", { bypassCache: true });
    expect(a1?.role).toBe("ADMIN");
    expect(a2?.role).toBe("USER");
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("gateAdmin sans session", () => {
  beforeEach(async () => {
    await invalidateUserAccessCache();
  });

  it("renvoie 401 si non authentifié", async () => {
    const gate = await gateAdmin();
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.status).toBe(401);
      const res = adminGateJson(gate);
      expect(res.status).toBe(401);
    }
  });
});
