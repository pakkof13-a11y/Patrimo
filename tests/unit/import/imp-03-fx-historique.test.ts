import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDraftRow } from "@/app/lib/import/map-rows";

type AnyFn = (...args: unknown[]) => unknown;
type MockFn = ReturnType<typeof vi.fn<AnyFn>>;

const txCreateArgs: Array<Record<string, unknown>> = [];
const txCreateMock: MockFn = vi.fn(async (input: unknown) => {
  txCreateArgs.push(input as Record<string, unknown>);
  return { id: "tx-" + txCreateArgs.length };
});
let assetFindFirstMock: MockFn;
let platformFindFirstMock: MockFn;
let assetCountMock: MockFn;

vi.mock("@/app/lib/prisma", () => {
  const client: Record<string, unknown> = {
    platform: {
      findFirst: (...a: unknown[]) => platformFindFirstMock(...a),
    },
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirstMock(...a),
      count: (...a: unknown[]) => assetCountMock(...a),
    },
    transaction: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    // IMP-11/IMP-04 : `commit.ts` enveloppe désormais résolution d'Asset +
    // création de Transaction (par ligne) dans une transaction interactive.
    // Ce faux client n'isole rien (pas de vraie base) : il rejoue simplement
    // le callback avec lui-même comme `tx`, ce qui suffit puisque les autres
    // méthodes mockées ci-dessus sont les mêmes quel que soit le client reçu.
    $transaction: (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});

vi.mock("@/app/lib/portfolio/service", () => ({
  loadLedgerForUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/app/lib/portfolio/ledger-cache", () => ({
  invalidateLedgerCache: vi.fn(),
}));

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: (...a: unknown[]) => txCreateMock(...a),
  createOwnershipCache: () => ({}),
}));

function rangeResponse(byDay: Record<string, number>, currency = "USD") {
  const rates: Record<string, Record<string, number>> = {};
  for (const day of Object.keys(byDay)) {
    rates[day] = { [currency]: byDay[day]! };
  }
  return new Response(JSON.stringify({ rates }), { status: 200 });
}

const estPlage = (url: unknown) =>
  typeof url === "string" && /frankfurter\.app\/\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}/.test(url);
const estLatest = (url: unknown) =>
  typeof url === "string" && url.includes("/latest");

let fetchMock: ReturnType<typeof vi.fn>;

function row(overrides: Partial<ImportDraftRow>): ImportDraftRow {
  return {
    line: 1,
    selected: true,
    status: "ok",
    errors: [],
    warnings: [],
    type: "ACHAT",
    occurredAt: "2021-06-15T00:00:00.000Z",
    ticker: "AAPL",
    name: "Apple",
    quantity: "10",
    unitPrice: "100",
    fees: "0",
    currency: "USD",
    cashAmount: null,
    notes: null,
    platformName: null,
    assetClass: "ACTIONS",
    raw: {},
    ...overrides,
  } as ImportDraftRow;
}

async function commit(rows: ImportDraftRow[]) {
  vi.resetModules();
  const mod = await import("@/app/lib/import/commit");
  return mod.commitImportRows({
    userId: "u1",
    platformId: "p1",
    rows,
    skipDuplicates: false,
  });
}
beforeEach(() => {
  txCreateArgs.length = 0;
  txCreateMock.mockClear();
  platformFindFirstMock = vi.fn().mockResolvedValue({ id: "p1", userId: "u1", name: "Test" });
  assetFindFirstMock = vi.fn().mockResolvedValue({ id: "a1" });
  assetCountMock = vi.fn().mockResolvedValue(0);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("taux historique applique par ligne", () => {
  it("un achat USD de 2021 est converti au taux de sa date", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estPlage(url)) return rangeResponse({ "2021-06-15": 1.2125 });
      if (estLatest(url)) return rangeResponse({ "2099-01-01": 999 });
      throw new Error("URL inattendue: " + String(url));
    });

    const result = await commit([row({})]);

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(1);
    expect(txCreateArgs).toHaveLength(1);
    const input = txCreateArgs[0] as { fxRateToEur: string };
    expect(Number(input.fxRateToEur)).toBeCloseTo(1 / 1.2125, 9);
    expect(fetchMock.mock.calls.some((c) => estLatest(c[0]))).toBe(false);
  });

  it("un samedi retombe sur le vendredi precedent", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estPlage(url) ? rangeResponse({ "2021-06-18": 1.19 }) : rangeResponse({})
    );

    const result = await commit([
      row({ occurredAt: "2021-06-19T00:00:00.000Z" }),
    ]);

    expect(result.created).toBe(1);
    const input = txCreateArgs[0] as { fxRateToEur: string };
    expect(Number(input.fxRateToEur)).toBeCloseTo(1 / 1.19, 9);
  });

  it("un trou de plus de 7 jours rejette la ligne", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estPlage(url) ? rangeResponse({ "2021-05-01": 1.2 }) : rangeResponse({})
    );

    const result = await commit([row({ occurredAt: "2021-06-15T00:00:00.000Z" })]);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/USD/);
    expect(result.errors[0]!.message).toMatch(/2021-06-15/);
    expect(txCreateMock).not.toHaveBeenCalled();
  });

  it("devise inconnue (404): message dedie, aucune creation", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estPlage(url) ? new Response("nope", { status: 404 }) : rangeResponse({})
    );

    const result = await commit([row({ currency: "XXX" })]);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/aucune série/i);
    expect(txCreateMock).not.toHaveBeenCalled();
  });

  it("fournisseur en panne (503): message dedie, FALLBACK jamais atteint", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estPlage(url) ? new Response("down", { status: 503 }) : rangeResponse({})
    );

    const result = await commit([row({})]);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/injoignable/i);
    expect(txCreateMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some((c) => estLatest(c[0]))).toBe(false);
  });

  it("lignes en EUR: aucun appel fetch pour la resolution FX", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("aucun appel attendu");
    });

    const result = await commit([row({ currency: "EUR" })]);

    expect(result.created).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("plusieurs dizaines de lignes USD sur des dates variees: un seul appel Frankfurter", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estPlage(url)
        ? rangeResponse({
            "2021-06-15": 1.2125,
            "2021-07-01": 1.18,
            "2021-08-16": 1.17,
          })
        : rangeResponse({})
    );

    const rows: ImportDraftRow[] = [
      row({ line: 1, occurredAt: "2021-06-15T00:00:00.000Z", quantity: "1" }),
      row({ line: 2, occurredAt: "2021-07-01T00:00:00.000Z", quantity: "2" }),
      row({ line: 3, occurredAt: "2021-08-16T00:00:00.000Z", quantity: "3" }),
    ];
    for (let i = 4; i <= 40; i++) {
      rows.push(
        row({
          line: i,
          occurredAt: "2021-07-01T00:00:00.000Z",
          quantity: String(i),
        })
      );
    }

    const result = await commit(rows);

    expect(result.created).toBe(rows.length);
    expect(fetchMock.mock.calls.filter((c) => estPlage(c[0]))).toHaveLength(1);
  });

  /*
    Un lot avec plusieurs devises étrangères : chaque devise doit résoudre sa
    propre série (un appel Frankfurter par devise, jamais par ligne), sans que
    la résolution de l'une n'affecte celle de l'autre. Trou non couvert avant
    ce test : IMP-03 n'était exercé qu'avec un seul lot mono-devise (USD).
  */
  it("un lot en USD et en GBP resout deux series independantes", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === "string" && url.includes("USD")) {
        return rangeResponse({ "2021-06-15": 1.2125 });
      }
      if (typeof url === "string" && url.includes("GBP")) {
        return rangeResponse({ "2021-06-15": 0.86 }, "GBP");
      }
      throw new Error("URL inattendue: " + String(url));
    });

    const result = await commit([
      row({ line: 1, currency: "USD" }),
      row({ line: 2, currency: "GBP" }),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(2);
    expect(txCreateArgs).toHaveLength(2);
    const usdRate = Number((txCreateArgs[0] as { fxRateToEur: string }).fxRateToEur);
    const gbpRate = Number((txCreateArgs[1] as { fxRateToEur: string }).fxRateToEur);
    expect(usdRate).toBeCloseTo(1 / 1.2125, 9);
    expect(gbpRate).toBeCloseTo(1 / 0.86, 9);
    // Un appel de plage par devise, pas un troisième mêlant les deux.
    expect(fetchMock.mock.calls.filter((c) => estPlage(c[0]))).toHaveLength(2);
  });

  /*
    Dans le même lot, une devise dont la série est introuvable ne doit pas
    faire échouer les lignes d'une autre devise correctement résolue : le
    rejet est ligne par ligne (en pratique devise par devise), jamais du lot
    entier.
  */
  it("une devise sans serie rejette ses lignes sans bloquer l'autre devise du lot", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (typeof url === "string" && url.includes("USD")) {
        return rangeResponse({ "2021-06-15": 1.2125 });
      }
      if (typeof url === "string" && url.includes("XXX")) {
        return new Response("nope", { status: 404 });
      }
      throw new Error("URL inattendue: " + String(url));
    });

    const result = await commit([
      row({ line: 1, currency: "USD" }),
      row({ line: 2, currency: "XXX" }),
    ]);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(txCreateArgs).toHaveLength(1);
    const input = txCreateArgs[0] as { fxRateToEur: string };
    expect(Number(input.fxRateToEur)).toBeCloseTo(1 / 1.2125, 9);
  });

  it("une ligne DIVIDENDE en devise etrangere: resultat identique a avant ce correctif", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estPlage(url) ? rangeResponse({ "2021-06-15": 1.2125 }) : rangeResponse({})
    );

    const result = await commit([
      row({ type: "DIVIDENDE", cashAmount: "50", quantity: null, unitPrice: null }),
    ]);

    expect(result.created).toBe(1);
    const input = txCreateArgs[0] as { fxRateToEur: string; type: string };
    expect(input.type).toBe("DIVIDENDE");
    expect(Number(input.fxRateToEur)).toBeCloseTo(1 / 1.2125, 9);
  });
});

/**
 * USDT/USDC : plus un "USD" silencieux (map-rows.ts ne les tronque plus,
 * commit.ts leur donne la série USD par une conversion dédiée) — la ligne
 * conserve son vrai libellé de devise, le taux vient de la même série
 * Frankfurter que l'USD réel, un seul appel pour les deux.
 */
describe("USDT/USDC ne deviennent pas un USD silencieux", () => {
  it("un achat en USDT conserve sa devise et se convertit via la serie USD", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estPlage(url) ? rangeResponse({ "2021-06-15": 1.2125 }) : rangeResponse({})
    );

    const result = await commit([row({ currency: "USDT" })]);

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(1);
    const input = txCreateArgs[0] as { fxRateToEur: string; currency: string };
    expect(input.currency).toBe("USDT");
    expect(Number(input.fxRateToEur)).toBeCloseTo(1 / 1.2125, 9);
  });

  it("USDT et USD dans le meme lot partagent un seul appel Frankfurter", async () => {
    // Quantités distinctes : `economicKey` (dedupe.ts) tronque aussi la devise
    // à 3 lettres pour l'empreinte stricte — trois lignes par ailleurs
    // identiques ne se distingueraient plus par leur seule devise. Effet
    // préexistant du dédoublonnage (indépendant de ce correctif), pas ce que
    // ce test vérifie ; les quantités le contournent proprement.
    let plageAppels = 0;
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estPlage(url)) {
        plageAppels += 1;
        return rangeResponse({ "2021-06-15": 1.2125 });
      }
      return rangeResponse({});
    });

    const result = await commit([
      row({ line: 1, currency: "USDT", quantity: "10" }),
      row({ line: 2, currency: "USDC", quantity: "11" }),
      row({ line: 3, currency: "USD", quantity: "12" }),
    ]);

    expect(result.created).toBe(3);
    expect(plageAppels).toBe(1);
    for (const input of txCreateArgs as Array<{ fxRateToEur: string }>) {
      expect(Number(input.fxRateToEur)).toBeCloseTo(1 / 1.2125, 9);
    }
  });

  it("USDC sans serie USD disponible rejette la ligne, ne bascule pas sur EUR", async () => {
    fetchMock.mockImplementation(async () => new Response("panne", { status: 503 }));

    const result = await commit([row({ currency: "USDC" })]);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/injoignable/);
  });
});
