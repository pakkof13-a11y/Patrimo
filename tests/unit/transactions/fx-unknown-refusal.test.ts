import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un taux historique inconnu n'écrit pas de transaction.
 *
 * Le test précédent (`market/fx-historical-rate`) prouve que la source ne rend
 * plus de taux inventé. Celui-ci prouve ce qu'il en advient à l'écriture : rien
 * n'est persisté, et surtout aucun montant en euros n'est calculé comme s'il
 * était certain.
 *
 * `Transaction.fxRateToEur` est un `Decimal @default(1)` non nullable et
 * `grossAmountEur` est requis : le modèle ne sait pas représenter « taux
 * inconnu ». Refuser l'écriture est donc la seule issue qui ne mente pas — un
 * champ laissé vide vaudrait 1, c'est-à-dire un dollar pour un euro.
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
      // Empreinte du journal, lue avant rejeu (portfolio/service.ts).
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

const estArchive = (url: unknown) =>
  typeof url === "string" && /frankfurter\.app\/\d{4}-\d{2}-\d{2}/.test(url);

/** Un dividende en dollars, daté de 2021 — le scénario exact de l'audit. */
const DIVIDENDE_USD = {
  userId: "u1",
  type: "DIVIDENDE",
  platformId: "p1",
  assetId: "a1",
  cashAmount: "1000",
  fees: "0",
  currency: "USD",
  occurredAt: "2021-06-15T00:00:00.000Z",
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
});

async function creer(input: Record<string, unknown>) {
  vi.resetModules();
  const { createTransaction } = await import("@/app/lib/transactions/service");
  return createTransaction(
    input as Parameters<typeof createTransaction>[0]
  );
}

describe("taux historique indisponible", () => {
  it("refuse l'écriture au lieu d'enregistrer un taux du jour", async () => {
    /*
      Preuve causale du défaut trouvé par l'audit : les archives sont muettes,
      le taux courant répond parfaitement (1 EUR = 1,05 USD). C'est ce 1,05 qui
      était enregistré comme s'il datait de juin 2021.
    */
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estArchive(url)) throw new Error("FX HTTP 503");
      return reponse(1.05);
    });

    await expect(creer(DIVIDENDE_USD)).rejects.toMatchObject({
      code: "FX_RATE_UNKNOWN",
    });
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("aucun montant en euros n'est calculé ni persisté", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estArchive(url)) throw new Error("FX HTTP 503");
      return reponse(1.05);
    });

    await expect(creer(DIVIDENDE_USD)).rejects.toThrow();
    /*
      La vérification qui compte : ni le taux courant (1/1,05 ≈ 0,952), ni la
      table statique (1/1,08 ≈ 0,926), ni le 1 par défaut du schéma n'ont pu
      atteindre la base — puisque rien n'a été écrit.
    */
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("le message nomme la devise et la date, pas une panne générique", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estArchive(url)) throw new Error("FX HTTP 503");
      return reponse(1.05);
    });

    await expect(creer(DIVIDENDE_USD)).rejects.toThrow(/USD.*2021-06-15/);
  });

  it("vaut pour les quatre types de revenus", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estArchive(url)) throw new Error("FX HTTP 503");
      return reponse(1.05);
    });

    for (const type of ["DIVIDENDE", "COUPON", "LOYER", "INTERET"]) {
      await expect(creer({ ...DIVIDENDE_USD, type })).rejects.toMatchObject({
        code: "FX_RATE_UNKNOWN",
      });
    }
    expect(txCreate).not.toHaveBeenCalled();
  });
});

describe("ce qui reste inchangé", () => {
  it("un taux saisi par l'utilisateur est prioritaire et n'appelle aucun fournisseur", async () => {
    fetchMock.mockRejectedValue(new Error("le fournisseur ne doit pas être appelé"));

    await creer({ ...DIVIDENDE_USD, fxRateToEur: "0.82" });

    expect(txCreate).toHaveBeenCalledTimes(1);
    const data = txCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Number(data.data.fxRateToEur)).toBeCloseTo(0.82, 10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un taux historique disponible est utilisé et persisté", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estArchive(url) ? reponse(1.21) : reponse(1.05)
    );

    await creer(DIVIDENDE_USD);

    expect(txCreate).toHaveBeenCalledTimes(1);
    const data = txCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    // 1/1,21 — celui de juin 2021, et non 1/1,05 qui est celui du jour.
    expect(Number(data.data.fxRateToEur)).toBeCloseTo(1 / 1.21, 8);
  });

  it("un revenu en euros n'interroge aucun fournisseur d'archives", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));

    await creer({ ...DIVIDENDE_USD, currency: "EUR" });

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
