import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Taux courant : un dollar ne vaut jamais un euro par défaut.
 *
 * Pour une devise étrangère sans taux fourni, `resolveFx` demandait le taux
 * courant et, en cas d'échec, rendait `{ ...input, currency }` — donc sans
 * `fxRateToEur`. La construction des données retombait alors sur le
 * `Decimal @default(1)` du modèle : la transaction était enregistrée à parité,
 * comme un fait, pour la seule raison que le fournisseur n'avait pas répondu.
 *
 * A1 a traité le taux historique. Ce fichier traite le taux du jour, avec la
 * même doctrine — inconnu n'est ni zéro, ni un — et vérifie surtout la
 * frontière : le repli statique décidé en B1 reste une réponse valide pour le
 * taux courant, et ne doit pas être emporté par la correction.
 */

const txCreate = vi.fn();

vi.mock("@/app/lib/prisma", () => {
  const client = {
    platform: { findFirst: vi.fn().mockResolvedValue({ id: "p1", userId: "u1" }) },
    asset: { findFirst: vi.fn().mockResolvedValue({ id: "a1", userId: "u1" }) },
    transaction: {
      create: (...a: unknown[]) => txCreate(...a),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: async (fn: (t: unknown) => unknown) =>
      typeof fn === "function" ? fn(client) : undefined,
  };
  return { prisma: client };
});

/** Réponse Frankfurter. */
function reponse(usd: number) {
  return new Response(JSON.stringify({ rates: { USD: usd } }), { status: 200 });
}

/** Un achat en dollars, sans taux fourni — le cas qui déclenche la résolution. */
const ACHAT_USD = {
  userId: "u1",
  type: "ACHAT",
  platformId: "p1",
  assetId: "a1",
  quantity: "10",
  unitPrice: "100",
  fees: "0",
  currency: "USD",
  occurredAt: "2026-02-02T00:00:00.000Z",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  txCreate.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("@/app/lib/market/fx");
});

async function creer(input: Record<string, unknown>) {
  vi.resetModules();
  const { createTransaction } = await import("@/app/lib/transactions/service");
  return createTransaction(input as Parameters<typeof createTransaction>[0]);
}

/** Le taux réellement écrit sur la transaction. */
function tauxEcrit(): number {
  const data = txCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
  return Number(data.data.fxRateToEur);
}

describe("euro", () => {
  it("sans taux fourni : taux 1, aucun appel fournisseur", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));
    await creer({ ...ACHAT_USD, currency: "EUR" });
    expect(tauxEcrit()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("avec un taux explicite : l'euro reste à 1, sans appel", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));
    await creer({ ...ACHAT_USD, currency: "EUR", fxRateToEur: "0.9" });
    expect(tauxEcrit()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("taux explicitement fourni", () => {
  it("est prioritaire et n'interroge aucun fournisseur", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));
    await creer({ ...ACHAT_USD, fxRateToEur: "0.82" });
    expect(tauxEcrit()).toBeCloseTo(0.82, 10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vaut aussi pour une vente", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));
    await creer({ ...ACHAT_USD, type: "VENTE", fxRateToEur: "0.82" });
    expect(tauxEcrit()).toBeCloseTo(0.82, 10);
  });
});

describe("devise étrangère sans taux fourni", () => {
  it("fournisseur disponible : son taux est utilisé et persisté", async () => {
    fetchMock.mockResolvedValue(reponse(1.25));
    await creer(ACHAT_USD);
    expect(tauxEcrit()).toBeCloseTo(1 / 1.25, 8);
  });

  it("vente en devise : même résolution", async () => {
    fetchMock.mockResolvedValue(reponse(1.25));
    await creer({ ...ACHAT_USD, type: "VENTE" });
    expect(tauxEcrit()).toBeCloseTo(1 / 1.25, 8);
  });

  it("fournisseur indisponible : le repli déclaré de B1 s'applique, la transaction existe", async () => {
    /*
      Le cas essentiel. B1 a délibérément conservé une table déclarée pour le
      taux **courant** : 1 EUR = 1,08 USD. C'est une approximation du jour,
      assumée et documentée, pas une valeur inventée pour une date passée.
      Cette correction ne doit pas l'emporter.
    */
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    await creer(ACHAT_USD);

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(tauxEcrit()).toBeCloseTo(1 / 1.08, 8);
    // Et surtout : pas 1.
    expect(tauxEcrit()).not.toBe(1);
  });
});

describe("quand aucun taux courant ne peut être obtenu", () => {
  /*
    Depuis B1, `fxRateToEur` ne lève pratiquement plus : une panne réseau la
    fait retomber sur la table déclarée. Pour éprouver le refus lui-même, c'est
    donc cette fonction qu'on rend incapable de répondre — la situation que la
    branche de secours prétendait couvrir.
  */
  async function creerSansTauxCourant(input: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("@/app/lib/market/fx", async (importOriginal) => {
      const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
      return {
        ...reel,
        fxRateToEur: async () => {
          throw new Error("FX indisponible");
        },
      };
    });
    const { createTransaction } = await import("@/app/lib/transactions/service");
    return createTransaction(input as Parameters<typeof createTransaction>[0]);
  }

  it("l'écriture est refusée", async () => {
    await expect(creerSansTauxCourant(ACHAT_USD)).rejects.toMatchObject({
      code: "FX_RATE_UNKNOWN",
    });
  });

  it("le taux 1 du modèle n'est jamais utilisé comme secours", async () => {
    await expect(creerSansTauxCourant(ACHAT_USD)).rejects.toThrow();
    // Rien n'est écrit : ni 1, ni aucune autre valeur de substitution.
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("le message nomme la devise et la nature du manque", async () => {
    await expect(creerSansTauxCourant(ACHAT_USD)).rejects.toThrow(
      /USD.*indisponible/
    );
  });

  it("un taux fourni reste accepté même sans fournisseur", async () => {
    await creerSansTauxCourant({ ...ACHAT_USD, fxRateToEur: "0.82" });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(tauxEcrit()).toBeCloseTo(0.82, 10);
  });

  it("une transaction en euros passe toujours", async () => {
    await creerSansTauxCourant({ ...ACHAT_USD, currency: "EUR" });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(tauxEcrit()).toBe(1);
  });
});

describe("non-régression A1 — le taux historique reste distinct", () => {
  it("un revenu en devise passe toujours par les archives, pas par le taux du jour", async () => {
    /*
      Archives muettes, taux du jour parfaitement disponible à 1,25 : le revenu
      doit être refusé, et non converti au cours d'aujourd'hui. La frontière
      posée en A1 est intacte.
    */
    fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === "string" && /frankfurter\.app\/\d{4}-/.test(url)) {
        throw new Error("archives indisponibles");
      }
      return reponse(1.25);
    });

    await expect(
      creer({
        ...ACHAT_USD,
        type: "DIVIDENDE",
        quantity: undefined,
        unitPrice: undefined,
        cashAmount: "1000",
        occurredAt: "2021-06-15T00:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "FX_RATE_UNKNOWN" });
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("un revenu en euros reste inchangé", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));
    await creer({
      ...ACHAT_USD,
      type: "COUPON",
      currency: "EUR",
      quantity: undefined,
      unitPrice: undefined,
      cashAmount: "500",
      fxRateToEur: "1",
    });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(tauxEcrit()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
