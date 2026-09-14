import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `Asset.manualPrice` est exprimé dans `asset.currency`, jamais en euros.
 *
 * `getAssetPriceHistory` composait pourtant son ancre de fin de courbe
 * (`endPrice`) avec la valeur brute de `manualPrice`, alors que le payload
 * se déclare `currency: "EUR"`. Sur un actif en USD, l'ancre valait donc le
 * montant en dollars annoncé en euros — 10 800 au lieu de 10 000 pour un
 * taux de 1,08.
 */

const assetFindFirst = vi.fn();
const priceHistoryFindMany = vi.fn().mockResolvedValue([]);

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) },
    priceHistory: { findMany: (...a: unknown[]) => priceHistoryFindMany(...a) },
  },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  priceHistoryFindMany.mockClear().mockResolvedValue([]);
  fetchMock = vi.fn().mockRejectedValue(new Error("FX indisponible"));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Ticker vide → `toYahooSymbol` rend "", aucun appel Yahoo n'est tenté :
 * la série retombe directement sur le point mock ancré par `endPrice`.
 */
const actif = (overrides: Record<string, unknown>) => ({
  id: "a1",
  userId: "u1",
  ticker: "",
  providerSymbol: null,
  assetClass: "AUTRE",
  priceProvider: "MANUAL",
  priceQuote: null,
  manualPrice: "10800",
  currency: "USD",
  ...overrides,
});

async function historique(overrides: Record<string, unknown>) {
  vi.resetModules();
  const { getAssetPriceHistory } = await import("@/app/lib/market/price-history");
  assetFindFirst.mockResolvedValue(actif(overrides));
  return getAssetPriceHistory("u1", "a1", "1m");
}

describe("ancre de fin de courbe — manualPrice en devise", () => {
  it("un actif en USD est converti en euros au taux fondé (repli USD = 1,08)", async () => {
    const result = await historique({});
    expect(result).not.toBeNull();
    const last = result!.points[result!.points.length - 1]!;
    // Avant correction : 10800 (le montant en dollars pris pour des euros).
    // Après correction : 10800 / 1.08 = 10000.
    expect(last.close).toBeCloseTo(10000, 6);
    expect(last.close).not.toBeCloseTo(10800, 0);
    expect(result!.currency).toBe("EUR");
  });

  it("un actif en euros n'est pas affecté par la conversion", async () => {
    const result = await historique({ manualPrice: "250", currency: "EUR" });
    expect(result).not.toBeNull();
    const last = result!.points[result!.points.length - 1]!;
    expect(last.close).toBeCloseTo(250, 6);
  });

  it("une devise qu'aucune source ne fonde échoue bruyamment (pas de zéro silencieux)", async () => {
    await expect(
      historique({ currency: "SEK", manualPrice: "1000" })
    ).rejects.toMatchObject({ name: "FxRateUnknownError" });
  });
});
