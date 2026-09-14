import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/banks` et `GET /api/savings` — la devise de restitution.
 *
 * Les deux n'acceptaient aucun `base` : elles rendaient des `balanceBase` en
 * euros que l'écran étiquetait ensuite avec la devise de l'en-tête. D39 avait
 * corrigé le seul bandeau de synthèse, d'où deux chiffres contradictoires l'un
 * au-dessus de l'autre.
 */

const listBankAccounts = vi.fn();
const listSavingsAccounts = vi.fn();

vi.mock("@/app/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

vi.mock("@/app/lib/cash/pockets", () => ({
  listBankAccounts: (...a: unknown[]) => listBankAccounts(...a),
  listSavingsAccounts: (...a: unknown[]) => listSavingsAccounts(...a),
}));

vi.mock("@/app/lib/money/savings-accrual", () => ({
  applyDueInterestForUser: async () => ({
    accounts: 0,
    periodsCredited: 0,
    totalInterest: "0",
    errors: [],
  }),
}));

const { GET: banksGet } = await import("@/app/api/banks/route");
const { GET: savingsGet } = await import("@/app/api/savings/route");
const { FxRateUnknownError } = await import("@/app/lib/market/fx");

const appels = [
  {
    nom: "/api/banks",
    get: (q = "") => banksGet(new Request(`http://localhost/api/banks${q}`)),
    mock: listBankAccounts,
  },
  {
    nom: "/api/savings",
    get: (q = "") => savingsGet(new Request(`http://localhost/api/savings${q}`)),
    mock: listSavingsAccounts,
  },
] as const;

beforeEach(() => {
  listBankAccounts.mockReset().mockResolvedValue([]);
  listSavingsAccounts.mockReset().mockResolvedValue([]);
});

describe.each(appels)("$nom", ({ get, mock }) => {
  it("convertit dans la devise demandée", async () => {
    expect((await get("?base=USD")).status).toBe(200);
    expect(mock).toHaveBeenCalledWith("u1", "USD");
  });

  it("sans paramètre, l'euro", async () => {
    await get();
    expect(mock).toHaveBeenCalledWith("u1", "EUR");
  });

  it("normalise la casse", async () => {
    await get("?base=chf");
    expect(mock).toHaveBeenCalledWith("u1", "CHF");
  });

  it("une devise inconnue répond 400, pas 500", async () => {
    const res = await get("?base=ZZZ");
    expect(res.status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });

  it("le message d'erreur énumère les devises acceptées, séparées", async () => {
    const res = await get("?base=ZZZ");
    const body = (await res.json()) as { error: string };
    // Le séparateur `", "` avait sauté d'un `join()` en D39.
    expect(body.error).toContain("EUR, USD");
  });

  /*
    Une ligne déjà en base qu'on ne sait pas convertir n'est pas une faute de
    l'appelant : la devise demandée vient d'être validée. 503, et on la nomme.
  */
  it("une devise de compte sans taux répond 503 en la nommant", async () => {
    mock.mockRejectedValue(new FxRateUnknownError("SEK"));
    const res = await get();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("SEK");
  });
});
