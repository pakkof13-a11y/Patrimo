import { describe, expect, it } from "vitest";
import {
  buildMarketDayWindow,
  coveredDayRange,
  isDayCovered,
} from "@/app/lib/news/market-days";

describe("buildMarketDayWindow", () => {
  it("returns 15 distinct civil days, J-7..J+7, centered on today (Paris)", () => {
    const now = new Date("2026-09-07T08:00:00.000Z"); // lundi, 10h Paris (CEST)
    const days = buildMarketDayWindow(now);
    expect(days).toHaveLength(15);
    expect(new Set(days.map((d) => d.key)).size).toBe(15);
    expect(days.map((d) => d.offset)).toEqual([
      -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(days[7]!.key).toBe("2026-09-07");
    expect(days[7]!.isToday).toBe(true);
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
    expect(days[0]!.key).toBe("2026-08-31");
    expect(days[14]!.key).toBe("2026-09-14");
  });

  it("does not skip or duplicate a day across the spring DST transition", () => {
    // Nuit du 28 au 29 mars 2026 : passage à l'heure d'été (02:00 → 03:00 Paris).
    const now = new Date("2026-03-28T23:30:00.000Z");
    const days = buildMarketDayWindow(now);
    expect(new Set(days.map((d) => d.key)).size).toBe(15);
    expect(days.map((d) => d.key)).toEqual([
      "2026-03-22",
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
    ]);
  });

  it("does not skip or duplicate a day across the autumn DST transition", () => {
    // Nuit du 24 au 25 octobre 2026 : retour à l'heure d'hiver.
    const now = new Date("2026-10-25T12:00:00.000Z");
    const days = buildMarketDayWindow(now);
    expect(new Set(days.map((d) => d.key)).size).toBe(15);
    expect(days[0]!.key).toBe("2026-10-18");
    expect(days[14]!.key).toBe("2026-11-01");
  });
});

describe("coveredDayRange / isDayCovered", () => {
  it("returns null on an empty list — unknown, not zero coverage", () => {
    expect(coveredDayRange([])).toBeNull();
    expect(isDayCovered("2026-09-07", null)).toBeNull();
  });

  it("derives min/max civil day from the events actually returned", () => {
    const range = coveredDayRange([
      "2026-09-07T02:00:00-04:00",
      "2026-09-09T10:00:00Z",
      "2026-09-06T21:30:00-04:00",
    ]);
    expect(range).toEqual({ min: "2026-09-07", max: "2026-09-09" });
  });

  it("flags a day outside the covered range, without claiming it has zero events", () => {
    const range = { min: "2026-09-06", max: "2026-09-12" };
    expect(isDayCovered("2026-09-07", range)).toBe(true);
    expect(isDayCovered("2026-09-06", range)).toBe(true);
    expect(isDayCovered("2026-09-12", range)).toBe(true);
    expect(isDayCovered("2026-08-31", range)).toBe(false);
    expect(isDayCovered("2026-09-14", range)).toBe(false);
  });

  it("ignores unparseable timestamps rather than treating them as a day", () => {
    expect(coveredDayRange(["not-a-date", ""])).toBeNull();
  });
});
