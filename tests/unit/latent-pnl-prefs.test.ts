import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  LATENT_PNL_RANGES,
  computePeriodLatentFromHistory,
  latentRangeStart,
  loadLatentPnlRange,
  saveLatentPnlRange,
} from "@/app/lib/portfolio/latent-pnl-prefs";

describe("latentRangeStart", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");

  it("returns null for 'all'", () => {
    expect(latentRangeStart("all", now)).toBeNull();
  });

  it("computes fixed-day offsets", () => {
    expect(latentRangeStart("1d", now)!.getTime()).toBe(
      now.getTime() - 24 * 3600_000
    );
    expect(latentRangeStart("7d", now)!.getTime()).toBe(
      now.getTime() - 7 * 24 * 3600_000
    );
  });

  it("ytd starts at Jan 1st UTC of the current year", () => {
    const start = latentRangeStart("ytd", now)!;
    expect(start.getUTCFullYear()).toBe(2026);
    expect(start.getUTCMonth()).toBe(0);
    expect(start.getUTCDate()).toBe(1);
  });
});

describe("computePeriodLatentFromHistory", () => {
  it("returns null for range 'all'", () => {
    expect(
      computePeriodLatentFromHistory(
        [
          { date: "2026-01-01", unrealizedPnlBase: 100 },
          { date: "2026-07-01", unrealizedPnlBase: 200 },
        ],
        "all"
      )
    ).toBeNull();
  });

  it("returns null with fewer than 2 points", () => {
    expect(
      computePeriodLatentFromHistory(
        [{ date: "2026-07-01", unrealizedPnlBase: 200 }],
        "1m"
      )
    ).toBeNull();
  });

  it("returns null when fewer than 2 points fall within the requested range", () => {
    // Toute l'historique est bien plus ancien que la fenêtre "1d" demandée —
    // aucun point ne passe le filtre >= (now - 1d - 12h de tolérance).
    const old1 = new Date(Date.now() - 40 * 24 * 3600_000).toISOString();
    const old2 = new Date(Date.now() - 39 * 24 * 3600_000).toISOString();
    const points = [
      { date: old1, unrealizedPnlBase: 100 },
      { date: old2, unrealizedPnlBase: 110 },
    ];
    expect(computePeriodLatentFromHistory(points, "1d")).toBeNull();
  });

  it("prefers the delta of unrealizedPnlBase when present", () => {
    const now = new Date();
    const points = [
      {
        date: new Date(now.getTime() - 6 * 24 * 3600_000).toISOString(),
        unrealizedPnlBase: 1_000,
        positionsBase: 50_000,
      },
      {
        date: now.toISOString(),
        unrealizedPnlBase: 1_500,
        positionsBase: 52_000,
      },
    ];
    expect(computePeriodLatentFromHistory(points, "7d")).toBe(500);
  });

  it("falls back to positionsBase delta when unrealizedPnlBase is missing", () => {
    const now = new Date();
    const points = [
      { date: new Date(now.getTime() - 6 * 24 * 3600_000).toISOString(), positionsBase: 50_000 },
      { date: now.toISOString(), positionsBase: 53_500 },
    ];
    expect(computePeriodLatentFromHistory(points, "7d")).toBe(3_500);
  });

  it("falls back to totalValueBase when positionsBase is also missing", () => {
    const now = new Date();
    const points = [
      { date: new Date(now.getTime() - 6 * 24 * 3600_000).toISOString(), totalValueBase: 80_000 },
      { date: now.toISOString(), totalValueBase: 79_000 },
    ];
    expect(computePeriodLatentFromHistory(points, "7d")).toBe(-1_000);
  });
});

describe("loadLatentPnlRange / saveLatentPnlRange", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: ls,
    });
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.localStorage;
    // @ts-expect-error cleanup
    delete globalThis.window;
  });

  it("defaults to 'all' when nothing stored", () => {
    expect(loadLatentPnlRange()).toBe("all");
  });

  it("round-trips a valid range", () => {
    saveLatentPnlRange("1y");
    expect(loadLatentPnlRange()).toBe("1y");
  });

  it("falls back to 'all' when the stored value is not a known range", () => {
    localStorage.setItem("patrimo.ui.latentPnlRange", JSON.stringify("bogus"));
    expect(loadLatentPnlRange()).toBe("all");
  });

  it("LATENT_PNL_RANGES contains the value used as fallback", () => {
    expect(LATENT_PNL_RANGES).toContain("all");
  });
});
