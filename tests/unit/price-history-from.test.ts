import { describe, expect, it } from "vitest";
import { resolveHistoryFromDate } from "@/app/lib/market/price-history";

describe("resolveHistoryFromDate", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it("short ranges ignore since (no extension)", () => {
    const since = "2018-01-01T00:00:00.000Z";
    for (const range of ["7d", "1m", "3m", "1y", "ytd"] as const) {
      const { from, extendedToFirstBuy } = resolveHistoryFromDate(
        range,
        since,
        now
      );
      expect(extendedToFirstBuy).toBe(false);
      // from stays near range start, not 2018
      expect(from.getUTCFullYear()).toBeGreaterThan(2018);
    }
  });

  it("all: extends to first buy when older than 5y window", () => {
    const since = "2018-03-15T10:00:00.000Z";
    const { from, extendedToFirstBuy } = resolveHistoryFromDate(
      "all",
      since,
      now
    );
    expect(extendedToFirstBuy).toBe(true);
    expect(from.toISOString().startsWith("2018-03-15")).toBe(true);
  });

  it("all: no extension when first buy is inside 5y window", () => {
    const since = "2024-01-10T00:00:00.000Z";
    const { from, extendedToFirstBuy } = resolveHistoryFromDate(
      "all",
      since,
      now
    );
    expect(extendedToFirstBuy).toBe(false);
    // default all ≈ 2021-07-16
    expect(from.getUTCFullYear()).toBe(2021);
  });

  it("5y: extends when since is older", () => {
    const since = "2015-06-01T00:00:00.000Z";
    const { from, extendedToFirstBuy } = resolveHistoryFromDate(
      "5y",
      since,
      now
    );
    expect(extendedToFirstBuy).toBe(true);
    expect(from.getUTCFullYear()).toBe(2015);
  });

  it("caps extension at 30 years", () => {
    const since = "1980-01-01T00:00:00.000Z";
    const { from, extendedToFirstBuy } = resolveHistoryFromDate(
      "all",
      since,
      now
    );
    expect(extendedToFirstBuy).toBe(true);
    expect(from.getUTCFullYear()).toBe(1996); // 2026 - 30
  });
});
