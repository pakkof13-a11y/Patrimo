import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FX-02 — une devise de cotation en sous-unite (pence, centimes) n'est plus
 * traitee comme l'unite principale.
 *
 * `quote.currency === "GBp"` (sterling en pence) etait passe tel quel a
 * `.toUpperCase()`, devenant "GBP" : 7550 pence traite comme 7550 livres,
 * soit une erreur x100. Meme defaut sur `result.meta.currency` cote
 * historique. `normalizeQuoteCurrency` isole ce signal (la casse du suffixe
 * brut) avant toute transformation.
 */

type MockFn = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;

let quoteMock: MockFn;
let chartMock: MockFn;

vi.mock("yahoo-finance2", () => {
  class FakeYahooFinance {
    quote(...a: unknown[]) {
      return quoteMock(...a);
    }
    chart(...a: unknown[]) {
      return chartMock(...a);
    }
  }
  return { default: FakeYahooFinance };
});

vi.mock("@/app/lib/market/fx", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/market/fx")>(
    "@/app/lib/market/fx"
  );
  const RATES: Record<string, number> = { GBP: 1.15, USD: 0.9, EUR: 1 };
  return {
    ...actual,
    toEurAmount: async (amount: string, cur: string) =>
      (Number(amount) * (RATES[cur.toUpperCase()] ?? 1)).toString(),
    getEurRates: async () => ({ EUR: 1, GBP: 1 / 1.15, USD: 1 / 0.9 }),
    convertToEurSync: (amount: number | string, cur: string, rates: Record<string, number>) => {
      const c = cur.toUpperCase();
      if (c === "EUR") return Number(amount).toString();
      const rate = rates[c];
      return (Number(amount) / rate).toString();
    },
  };
});

function assetMeta(partial: Record<string, unknown> = {}) {
  return {
    id: "a1",
    name: "Test PLC",
    ticker: "TEST.L",
    assetClass: "ACTIONS",
    priceProvider: "YAHOO",
    providerSymbol: null,
    currency: "GBP",
    ...partial,
  };
}

beforeEach(() => {
  quoteMock = vi.fn();
  chartMock = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("yahooProvider.fetchPrice — cotation en pence", () => {
  it("GBp : divise par 100 et normalise la devise en GBP", async () => {
    quoteMock.mockResolvedValue({
      regularMarketPrice: 7550,
      currency: "GBp",
    });
    const { yahooProvider } = await import("@/app/lib/market/providers/yahoo");

    const out = await yahooProvider.fetchPrice(assetMeta() as never);

    expect(out.status).toBe("OK");
    expect(out.nativeCurrency).toBe("GBP");
    expect(Number(out.priceNative)).toBeCloseTo(75.5, 8);
    expect(Number(out.priceEur)).toBeCloseTo(75.5 * 1.15, 6);
  });

  it("GBP deja unite principale : inchange", async () => {
    quoteMock.mockResolvedValue({
      regularMarketPrice: 75.5,
      currency: "GBP",
    });
    const { yahooProvider } = await import("@/app/lib/market/providers/yahoo");

    const out = await yahooProvider.fetchPrice(assetMeta() as never);

    expect(out.nativeCurrency).toBe("GBP");
    expect(Number(out.priceNative)).toBeCloseTo(75.5, 8);
  });

  it("USD sur un ticker .L : aucune division deduite du suffixe de marche", async () => {
    quoteMock.mockResolvedValue({
      regularMarketPrice: 100,
      currency: "USD",
    });
    const { yahooProvider } = await import("@/app/lib/market/providers/yahoo");

    const out = await yahooProvider.fetchPrice(
      assetMeta({ ticker: "SOMENAME.L", currency: "USD" }) as never
    );

    expect(out.nativeCurrency).toBe("USD");
    expect(Number(out.priceNative)).toBeCloseTo(100, 8);
  });
});
