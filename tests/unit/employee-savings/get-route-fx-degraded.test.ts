import { describe, expect, it, vi } from "vitest";

/**
 * ES-02 — une ligne héritée en devise inconnue (écrite avant la liste blanche
 * de `employeeSavingsLineSchema.currency`) faisait lever `FxRateUnknownError`
 * dans `mapLine`, et `GET /api/employee-savings` répondait 500 pour TOUTES les
 * lignes de l'utilisateur. Même repli que `app/api/banks/route.ts` GET :
 * 503 nommé, pas un 500 muet qui casse tout le module.
 */

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

const listEmployeeSavings = vi.fn();
vi.mock("@/app/lib/employee-savings/service", () => ({
  listEmployeeSavings: (...a: unknown[]) => listEmployeeSavings(...a),
  createEmployeeSavingsLine: vi.fn(),
  updateEmployeeSavingsLine: vi.fn(),
  deleteEmployeeSavingsLine: vi.fn(),
}));

const { GET } = await import("@/app/api/employee-savings/route");
const { FxRateUnknownError } = await import("@/app/lib/market/fx");

describe("GET /api/employee-savings", () => {
  it("une devise inconnue sur une ligne existante répond 503 en la nommant, pas 500", async () => {
    listEmployeeSavings.mockRejectedValue(new FxRateUnknownError("SEK"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("SEK");
  });

  it("répond normalement quand tout se convertit", async () => {
    listEmployeeSavings.mockResolvedValue({ lines: [], summary: {} });
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
