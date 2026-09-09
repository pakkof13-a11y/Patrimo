import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/savings/accrue` en mode cron.
 *
 * Les échecs par utilisateur étaient déjà rapportés dans le corps — mais avec
 * un 200. Un ordonnanceur ou une sonde qui juge sur le code voyait donc un job
 * perpétuellement vert pendant qu'aucun intérêt n'était crédité.
 */

const userFindMany = vi.fn();
const applyDueInterestForUser = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: { user: { findMany: (...a: unknown[]) => userFindMany(...a) } },
}));

vi.mock("@/app/lib/money/savings-accrual", () => ({
  applyDueInterestForUser: (...a: unknown[]) => applyDueInterestForUser(...a),
}));

// La créance de cron est vérifiée ailleurs (temps constant) : ici on se place
// après, du côté du travail réellement fait.
vi.mock("@/app/lib/env/runtime", () => ({ timingSafeEqualSecret: () => true }));
vi.mock("@/app/lib/auth/cron-credential", () => ({
  readCronCredential: () => "peu importe",
}));
vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => null }));

const { POST } = await import("@/app/api/savings/accrue/route");

const rien = { accounts: 0, periodsCredited: 0, totalInterest: "0", errors: [] };
const enPanne = (id: string) => ({
  ...rien,
  errors: [{ savingsId: id, message: "taux illisible" }],
});

const appel = () =>
  POST(new Request("http://localhost/api/savings/accrue", { method: "POST" }));

beforeEach(() => {
  userFindMany.mockReset().mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
  applyDueInterestForUser.mockReset().mockResolvedValue(rien);
});

describe("le statut du job dit ce que son corps disait déjà", () => {
  it("tout est passé : 200", async () => {
    expect((await appel()).status).toBe(200);
  });

  it("une partie a échoué : 207, et le corps nomme les livrets", async () => {
    applyDueInterestForUser
      .mockResolvedValueOnce(rien)
      .mockResolvedValueOnce(enPanne("s9"));
    const res = await appel();
    expect(res.status).toBe(207);
    const body = (await res.json()) as { errors: unknown[] };
    expect(body.errors).toHaveLength(1);
  });

  /*
    Tout a échoué : le job n'a rien crédité, et un 200 le rendait invisible à
    toute surveillance qui ne lit pas le corps.
  */
  it("tous les utilisateurs ont échoué : 500", async () => {
    applyDueInterestForUser.mockResolvedValue(enPanne("s9"));
    expect((await appel()).status).toBe(500);
  });

  it("une exception par utilisateur compte comme un échec, sans arrêter le job", async () => {
    applyDueInterestForUser
      .mockRejectedValueOnce(new Error("base indisponible"))
      .mockResolvedValueOnce(rien);
    const res = await appel();
    expect(res.status).toBe(207);
    // Le second utilisateur a bien été traité malgré l'exception du premier.
    expect(applyDueInterestForUser).toHaveBeenCalledTimes(2);
  });

  /*
    Aucun utilisateur : rien à créditer n'est pas un échec. `errors.length >=
    users.length` serait vrai par vacuité — le premier test l'écarte.
  */
  it("aucun utilisateur : 200, pas 500", async () => {
    userFindMany.mockResolvedValue([]);
    expect((await appel()).status).toBe(200);
  });
});
