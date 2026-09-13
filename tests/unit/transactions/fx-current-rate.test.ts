import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Écriture en devise sans taux fourni : celui de la date de l'opération.
 *
 * Deux corrections successives vivent dans ce fichier.
 *
 * La première : pour une devise étrangère sans taux fourni, `resolveFx` rendait
 * `{ ...input, currency }` en cas d'échec — donc sans `fxRateToEur`. La
 * construction des données retombait sur le `Decimal @default(1)` du modèle :
 * la transaction était enregistrée à parité, comme un fait, pour la seule
 * raison que le fournisseur n'avait pas répondu. Inconnu n'est ni zéro, ni un.
 *
 * La seconde (JOU-02) : le taux demandé était celui **du jour**, y compris pour
 * une opération datée de plusieurs années. Un ACHAT de 10 000 USD de 2021
 * valorisé au cours de 2026 — l'écart valant la dérive entre les deux dates,
 * sans borne, et persisté comme un montant constaté. `resolveFx` résout
 * désormais le taux de `occurredAt` pour TOUS les types, pas seulement les
 * revenus. Le repli statique de B1 reste une réponse valide là où il décrit le
 * jour présent (valorisation, conversion d'affichage) ; il ne décide plus du
 * montant en euros d'une écriture datée, et ces tests le vérifient.
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

/** Vrai pour l'endpoint daté de Frankfurter (`/2026-02-02?...`). */
function estArchive(url: unknown): boolean {
  return typeof url === "string" && /frankfurter\.app\/\d{4}-\d{2}-\d{2}/.test(url);
}

/**
 * Fournisseur qui répond différemment selon la question posée.
 *
 * C'est le seul montage qui distingue les deux taux : un test où la même valeur
 * sert de réponse aux deux endpoints passerait quelle que soit la date retenue.
 */
function fournisseur({ archive, jour }: { archive: number | null; jour: number | null }) {
  return async (url: unknown) => {
    if (estArchive(url)) {
      if (archive == null) throw new Error("archives indisponibles");
      return reponse(archive);
    }
    if (jour == null) throw new Error("FX HTTP 503");
    return reponse(jour);
  };
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
  it("le taux retenu est celui de la date de l'opération, pas celui du jour", async () => {
    fetchMock.mockImplementation(fournisseur({ archive: 1.25, jour: 1.1 }));
    await creer(ACHAT_USD);

    expect(tauxEcrit()).toBeCloseTo(1 / 1.25, 8);
    // Le cours du jour était disponible, et n'a pas servi.
    expect(tauxEcrit()).not.toBeCloseTo(1 / 1.1, 4);
  });

  it("la date interrogée est bien celle de la transaction", async () => {
    fetchMock.mockImplementation(fournisseur({ archive: 1.25, jour: 1.1 }));
    await creer(ACHAT_USD);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/2026-02-02"))).toBe(true);
  });

  it("vente en devise : même résolution", async () => {
    fetchMock.mockImplementation(fournisseur({ archive: 1.25, jour: 1.1 }));
    await creer({ ...ACHAT_USD, type: "VENTE" });
    expect(tauxEcrit()).toBeCloseTo(1 / 1.25, 8);
  });

  it("un apport en devise suit la même règle", async () => {
    fetchMock.mockImplementation(fournisseur({ archive: 1.25, jour: 1.1 }));
    await creer({
      ...ACHAT_USD,
      type: "APPORT",
      assetId: undefined,
      quantity: undefined,
      unitPrice: undefined,
      cashAmount: "1000",
    });
    expect(tauxEcrit()).toBeCloseTo(1 / 1.25, 8);
  });
});

describe("quand aucun taux n'est démontré pour cette date", () => {
  /*
    Le cas qui change de réponse avec JOU-02.

    B1 a délibérément conservé une table déclarée — 1 EUR = 1,08 USD — pour le
    taux **courant** : une approximation du jour, assumée, qui garde tout son
    sens pour valoriser ou convertir un affichage. Elle servait aussi de repli
    à l'écriture, et c'est ce qui tombe ici : appliquée à une opération datée,
    elle produit un `grossAmountEur` que rien ne distingue plus d'un montant
    constaté. Archives muettes, cours du jour parfaitement disponible : on
    refuse, et le repli statique n'est pas consulté.
  */
  it("l'écriture est refusée, même quand le cours du jour est disponible", async () => {
    fetchMock.mockImplementation(fournisseur({ archive: null, jour: 1.08 }));
    await expect(creer(ACHAT_USD)).rejects.toMatchObject({
      code: "FX_RATE_UNKNOWN",
    });
  });

  it("ni le taux du jour, ni le repli statique, ni le 1 du modèle ne sont écrits", async () => {
    fetchMock.mockImplementation(fournisseur({ archive: null, jour: 1.08 }));
    await expect(creer(ACHAT_USD)).rejects.toThrow();
    // Rien n'est écrit : aucune valeur de substitution, quelle qu'elle soit.
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("fournisseur entièrement muet : refus identique", async () => {
    fetchMock.mockRejectedValue(new Error("réseau"));
    await expect(creer(ACHAT_USD)).rejects.toMatchObject({
      code: "FX_RATE_UNKNOWN",
    });
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("le message nomme la devise et la date manquante", async () => {
    fetchMock.mockRejectedValue(new Error("réseau"));
    await expect(creer(ACHAT_USD)).rejects.toThrow(/USD.*2026-02-02/);
  });

  it("un taux fourni reste accepté même sans fournisseur", async () => {
    fetchMock.mockRejectedValue(new Error("réseau"));
    await creer({ ...ACHAT_USD, fxRateToEur: "0.82" });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(tauxEcrit()).toBeCloseTo(0.82, 10);
  });

  it("une transaction en euros passe toujours", async () => {
    fetchMock.mockRejectedValue(new Error("réseau"));
    await creer({ ...ACHAT_USD, currency: "EUR" });
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
