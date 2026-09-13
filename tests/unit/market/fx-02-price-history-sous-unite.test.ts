import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FX-02 (historique) — `result.meta.currency` fait foi sur `nativeCurrency`
 * declare ailleurs sur l'actif : une plage Yahoo cotee en pence (GBp) divise
 * l'OHLC par 100 avant conversion EUR, comme la cotation live.
 */

type MockFn = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;

let assetFindFirstMock: MockFn;
let chartMock: MockFn;

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirstMock(...a),
    },
  },
}));

vi.mock("yahoo-finance2", () => {
  class FakeYahooFinance {
    chart(...a: unknown[]) {
      return chartMock(...a);
    }
    quote() {
      return Promise.reject(new Error("not used in this test"));
    }
  }
  return { default: FakeYahooFinance };
});

vi.mock("@/app/lib/market/fx", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/market/fx")>(
    "@/app/lib/market/fx"
  );
  const GBP_RATE = 1 / 1.15; // 1 EUR = X GBP
  return {
    ...actual,
    getEurRates: async () => ({ EUR: 1, GBP: GBP_RATE }),
    convertToEurSync: (amount: number | string, cur: string) => {
      const c = String(cur).toUpperCase();
      if (c === "EUR") return Number(amount).toString();
      return (Number(amount) / GBP_RATE).toString();
    },
  };
});

function twoDays() {
  return [
    { date: new Date("2024-01-01T00:00:00Z"), open: 7500, high: 7600, low: 7400, close: 7550 },
    { date: new Date("2024-01-02T00:00:00Z"), open: 7550, high: 7650, low: 7450, close: 7600 },
  ];
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    userId: "u1",
    assetClass: "ACTIONS",
    priceProvider: "YAHOO",
    providerSymbol: null,
    ticker: "TEST.L",
    currency: "GBP",
    priceQuote: null,
    manualPrice: null,
    ...overrides,
  };
}

beforeEach(() => {
  assetFindFirstMock = vi.fn();
  chartMock = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAssetPriceHistory — chart Yahoo en sous-unite", () => {
  it("meta.currency GBp : OHLC divise par 100 avant conversion EUR", async () => {
    assetFindFirstMock.mockResolvedValue(assetRow());
    chartMock.mockResolvedValue({
      meta: { currency: "GBp" },
      quotes: twoDays(),
    });
    const { getAssetPriceHistory } = await import("@/app/lib/market/price-history");

    const out = await getAssetPriceHistory("u1", "a1", "1m");

    expect(out).not.toBeNull();
    expect(out!.points.length).toBeGreaterThanOrEqual(2);
    const first = out!.points[0]!;
    // 7550 pence / 100 = 75.5 GBP -> converti en EUR au taux mocke (x1.15)
    expect(first.close).toBeCloseTo(75.5 * 1.15, 4);
  });

  it("meta.currency deja GBP : comportement inchange (pas de division)", async () => {
    assetFindFirstMock.mockResolvedValue(assetRow());
    chartMock.mockResolvedValue({
      meta: { currency: "GBP" },
      quotes: twoDays(),
    });
    const { getAssetPriceHistory } = await import("@/app/lib/market/price-history");

    const out = await getAssetPriceHistory("u1", "a1", "1m");

    expect(out).not.toBeNull();
    const first = out!.points[0]!;
    // 7550 GBP (pas de division) converti en EUR
    expect(first.close).toBeCloseTo(7550 * 1.15, 2);
  });
});
