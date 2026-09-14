import { describe, expect, it } from "vitest";
import {
  isCloseFetchStale,
  lastCloseAligned,
  oldestFetchedAt,
  resolveLastCloseAsOf,
  sessionGap,
} from "@/app/lib/market/last-close-as-of";

/**
 * Vague2 D4 — hero, KPI et watchlist lisent la même dernière clôture
 * que le dernier point getDailyNav. DoD : écart ≤ 1 séance.
 */

describe("sessionGap — séances Paris, week-end ignoré", () => {
  it("même jour : 0", () => {
    expect(sessionGap("2026-09-04", "2026-09-04")).toBe(0);
  });

  it("vendredi → samedi : 0 (le week-end n'est pas une séance)", () => {
    expect(sessionGap("2026-09-04", "2026-09-05")).toBe(0);
  });

  it("vendredi → lundi : 1", () => {
    expect(sessionGap("2026-09-04", "2026-09-07")).toBe(1);
  });

  it("vendredi → mardi : 2", () => {
    expect(sessionGap("2026-09-04", "2026-09-08")).toBe(2);
  });

  it("l'ordre des bornes ne change pas l'écart", () => {
    expect(sessionGap("2026-09-08", "2026-09-04")).toBe(2);
  });
});

describe("resolveLastCloseAsOf — même règle que loadHistoricalInputs", () => {
  const lastDaily = {
    day: "2026-09-04",
    closeEur: 100,
    fetchedAt: new Date("2026-09-04T16:30:00.000Z"),
  };

  it("un cours live se pose sur aujourd'hui, comme l'overlay NAV", () => {
    const asOf = resolveLastCloseAsOf({
      today: "2026-09-05",
      lastDaily,
      quote: {
        priceEur: 102,
        lastUpdatedAt: new Date("2026-09-05T07:00:00.000Z"),
      },
    });
    expect(asOf).toEqual({
      day: "2026-09-05",
      closeEur: 102,
      fetchedAt: "2026-09-05T07:00:00.000Z",
      source: "quote",
    });
  });

  it("sans cours live, on garde le jour de la dernière AssetDailyClose", () => {
    const asOf = resolveLastCloseAsOf({
      today: "2026-09-05",
      lastDaily,
    });
    expect(asOf?.day).toBe("2026-09-04");
    expect(asOf?.source).toBe("daily-close");
    expect(asOf?.fetchedAt).toBe("2026-09-04T16:30:00.000Z");
  });

  it("un prix manuel sans collecte n'invente pas de fetchedAt", () => {
    const asOf = resolveLastCloseAsOf({
      today: "2026-09-05",
      quote: { priceEur: 50, lastUpdatedAt: null },
    });
    expect(asOf).toEqual({
      day: "2026-09-05",
      closeEur: 50,
      fetchedAt: null,
      source: "quote",
    });
  });

  it("sans cours ni clôture : rien", () => {
    expect(resolveLastCloseAsOf({ today: "2026-09-05" })).toBeNull();
  });
});

describe("DoD D4 — watchlist et dernier point de courbe", () => {
  it("cours live : watchlist.closeDay = dernier point NAV (aujourd'hui)", () => {
    const navLast = "2026-09-05";
    const watchlist = resolveLastCloseAsOf({
      today: navLast,
      lastDaily: {
        day: "2026-09-04",
        closeEur: 100,
        fetchedAt: new Date("2026-09-04T16:30:00.000Z"),
      },
      quote: {
        priceEur: 102,
        lastUpdatedAt: new Date("2026-09-05T07:00:00.000Z"),
      },
    });
    expect(watchlist?.day).toBe(navLast);
    expect(lastCloseAligned(watchlist?.day, navLast)).toBe(true);
  });

  it("clôture de la veille, courbe au samedi : écart ≤ 1 séance", () => {
    const navLast = "2026-09-05";
    const watchlist = resolveLastCloseAsOf({
      today: navLast,
      lastDaily: {
        day: "2026-09-04",
        closeEur: 100,
        fetchedAt: new Date("2026-09-04T16:30:00.000Z"),
      },
    });
    expect(lastCloseAligned(watchlist?.day, navLast)).toBe(true);
    expect(sessionGap(watchlist!.day, navLast)).toBeLessThanOrEqual(1);
  });

  it("clôture vieille de deux semaines : le DoD échoue — c'est P1002, pas l'UI", () => {
    const navLast = "2026-09-05";
    const watchlist = resolveLastCloseAsOf({
      today: navLast,
      lastDaily: {
        day: "2026-08-21",
        closeEur: 90,
        fetchedAt: new Date("2026-08-21T16:30:00.000Z"),
      },
    });
    expect(lastCloseAligned(watchlist?.day, navLast)).toBe(false);
    expect(sessionGap(watchlist!.day, navLast)).toBeGreaterThan(1);
  });
});

describe("fetchedAt — badge si > 24 h (D11)", () => {
  it("une collecte d'il y a 25 h est périmée", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    expect(isCloseFetchStale("2026-09-04T10:00:00.000Z", now)).toBe(true);
  });

  it("une collecte d'il y a 2 h ne l'est pas", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    expect(isCloseFetchStale("2026-09-05T10:00:00.000Z", now)).toBe(false);
  });

  it("sans fetchedAt, on n'affirme pas la péremption", () => {
    expect(isCloseFetchStale(null)).toBe(false);
  });

  it("l'enveloppe daily-nav retient la collecte la plus ancienne", () => {
    expect(
      oldestFetchedAt([
        {
          day: "2026-09-05",
          closeEur: 1,
          fetchedAt: "2026-09-05T08:00:00.000Z",
          source: "quote",
        },
        {
          day: "2026-09-04",
          closeEur: 2,
          fetchedAt: "2026-09-04T16:00:00.000Z",
          source: "daily-close",
        },
      ])
    ).toBe("2026-09-04T16:00:00.000Z");
  });
});
