import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aucun montant à parité n'atteint la persistance.
 *
 * Le fichier voisin prouve que la résolution du taux refuse désormais une
 * devise qu'aucune source ne fonde. Celui-ci prouve ce qu'il en advient sur les
 * deux chemins qui **écrivent** : la transaction et la cotation.
 *
 * L'audit avait établi ces deux chemins par lecture sans les reproduire ; c'est
 * fait ici.
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

/** Un achat sans taux fourni : le cas qui déclenche la résolution. */
const ACHAT = {
  userId: "u1",
  type: "ACHAT",
  platformId: "p1",
  assetId: "a1",
  quantity: "10",
  unitPrice: "100",
  fees: "0",
  occurredAt: "2026-02-02T00:00:00.000Z",
};

async function creer(input: Record<string, unknown>) {
  vi.resetModules();
  const { createTransaction } = await import("@/app/lib/transactions/service");
  return createTransaction(input as Parameters<typeof createTransaction>[0]);
}

describe("transaction en devise non fondée", () => {
  it("l'écriture est refusée", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    await expect(creer({ ...ACHAT, currency: "SEK" })).rejects.toMatchObject({
      code: "FX_RATE_UNKNOWN",
    });
  });

  it("aucun montant n'est persisté, ni à parité ni autrement", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    await expect(creer({ ...ACHAT, currency: "SEK" })).rejects.toThrow();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("une devise à repli déclaré reste acceptée", async () => {
    /*
      La frontière du chantier : USD dispose d'un repli assumé, la transaction
      doit donc être créée — à 1/1,08, jamais à 1.
    */
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    await creer({ ...ACHAT, currency: "USD" });

    expect(txCreate).toHaveBeenCalledTimes(1);
    const data = txCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Number(data.data.fxRateToEur)).toBeCloseTo(1 / 1.08, 8);
    expect(Number(data.data.fxRateToEur)).not.toBe(1);
  });

  it("un taux fourni reste prioritaire, même sur une devise non fondée", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    await creer({ ...ACHAT, currency: "SEK", fxRateToEur: "0.087" });

    expect(txCreate).toHaveBeenCalledTimes(1);
    const data = txCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Number(data.data.fxRateToEur)).toBeCloseTo(0.087, 10);
  });

  it("un taux réel disponible fait aboutir l'écriture", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ rates: { SEK: 11.5 } }), { status: 200 })
    );
    await creer({ ...ACHAT, currency: "SEK" });

    expect(txCreate).toHaveBeenCalledTimes(1);
    const data = txCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Number(data.data.fxRateToEur)).toBeCloseTo(1 / 11.5, 8);
  });
});

describe("cotation en devise non fondée", () => {
  /** L'actif tel que le lit le fournisseur manuel. */
  const actif = (currency: string) =>
    ({
      id: "a1",
      ticker: "X",
      name: "X",
      assetClass: "AUTRE",
      priceProvider: "MANUAL",
      manualPrice: "250",
      currency,
    }) as never;

  it("aucun prix en euros n'est produit : la cotation est en erreur", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    vi.resetModules();
    const { manualProvider } = await import("@/app/lib/market/providers/manual");

    const quote = await manualProvider.fetchPrice(actif("SEK"));

    /*
      Avant, ce chemin rendait `priceEur: "250"` avec `status: "OK"` — 250 SEK
      persistés comme 250 €. Le statut est désormais ERROR, et tous les
      consommateurs filtrent dessus avant d'écrire.
    */
    expect(quote.status).toBe("ERROR");
    expect(quote.error).toMatch(/SEK/);
  });

  it("une devise à repli déclaré reste cotée", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    vi.resetModules();
    const { manualProvider } = await import("@/app/lib/market/providers/manual");

    const quote = await manualProvider.fetchPrice(actif("USD"));
    expect(quote.status).toBe("OK");
    expect(Number(quote.priceEur)).toBeCloseTo(250 / 1.08, 6);
  });

  it("l'euro est coté sans conversion", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));
    vi.resetModules();
    const { manualProvider } = await import("@/app/lib/market/providers/manual");

    const quote = await manualProvider.fetchPrice(actif("EUR"));
    expect(quote.status).toBe("OK");
    expect(Number(quote.priceEur)).toBe(250);
  });
});
