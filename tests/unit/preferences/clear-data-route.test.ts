import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PLA-02 : `DELETE /api/preferences/clear-data` ne lisait jamais le corps de
 * la requête (`void req;`) — la confirmation "tapez SUPPRIMER" n'existait que
 * côté client. N'importe quelle requête DELETE authentifiée (session cookie
 * déjà vérifiée par `requireUserId`) effaçait tout le patrimoine, sans corps,
 * sans confirmation d'aucune sorte.
 *
 * Ces tests vérifient que la route exige désormais `{ confirm: "SUPPRIMER" }`
 * dans le corps JSON, et surtout que `resetUserData` n'est *jamais* appelée
 * quand cette confirmation est absente, incorrecte, ou que le corps est un
 * JSON invalide.
 */

const resetUserData = vi.fn();

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));
vi.mock("@/app/lib/portfolio/clear-user-data", () => ({
  resetUserData: (...a: unknown[]) => resetUserData(...a),
}));

const { DELETE } = await import("@/app/api/preferences/clear-data/route");

function req(body?: unknown, opts: { rawBody?: string } = {}) {
  return new Request("http://localhost/api/preferences/clear-data", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body:
      "rawBody" in opts && opts.rawBody !== undefined
        ? opts.rawBody
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetUserData.mockReset();
  resetUserData.mockResolvedValue({
    transactionsDeleted: 0,
    assetsDeleted: 0,
    platformsDeleted: 0,
  });
});

describe("DELETE /api/preferences/clear-data — confirmation serveur", () => {
  it("sans corps → 400, resetUserData jamais appelée", async () => {
    const res = await DELETE(req(undefined));
    expect(res.status).toBe(400);
    expect(resetUserData).not.toHaveBeenCalled();
  });

  it("JSON invalide → 400, resetUserData jamais appelée", async () => {
    const res = await DELETE(req(undefined, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(resetUserData).not.toHaveBeenCalled();
  });

  it("mot de confirmation incorrect → 400, resetUserData jamais appelée", async () => {
    const res = await DELETE(req({ confirm: "oui" }));
    expect(res.status).toBe(400);
    expect(resetUserData).not.toHaveBeenCalled();
  });

  it("confirm absent du corps JSON → 400, resetUserData jamais appelée", async () => {
    const res = await DELETE(req({ foo: "bar" }));
    expect(res.status).toBe(400);
    expect(resetUserData).not.toHaveBeenCalled();
  });

  it("mot correct (insensible à la casse/espaces) → 200, resetUserData appelée une fois", async () => {
    const res = await DELETE(req({ confirm: "  supprimer  " }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(resetUserData).toHaveBeenCalledTimes(1);
    expect(resetUserData).toHaveBeenCalledWith("u1");
  });
});
