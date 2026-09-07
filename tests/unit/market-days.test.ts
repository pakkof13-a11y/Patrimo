import { describe, expect, it } from "vitest";
import {
  buildMarketDayWindow,
  buildReleaseDayWindow,
  coveredDayRange,
  isDayCovered,
} from "@/app/lib/news/market-days";

/*
  La barre J−7…J+7 symétrique n'est plus la règle produit : elle a été
  remplacée par deux fenêtres de sept jours, mutuellement exclusives, qui se
  rejoignent sur J (« D24 — la règle qui remplace la barre J−7…J+7 »).
  `buildMarketDayWindow` reste le primitif générique paramétrable
  (`before`/`after`) ; ces tests vérifient désormais les deux largeurs
  réellement utilisées par le produit (6/0 et 0/6) plutôt que le défaut 7/7,
  que plus aucun appelant n'utilise. `buildReleaseDayWindow` teste la règle
  produit elle-même.
*/
describe("buildMarketDayWindow (primitif générique)", () => {
  it("before=6/after=0 : 7 jours distincts, J-6..J, centrés sur aujourd'hui (Paris)", () => {
    const now = new Date("2026-09-07T08:00:00.000Z"); // lundi, 10h Paris (CEST)
    const days = buildMarketDayWindow(now, 6, 0);
    expect(days).toHaveLength(7);
    expect(new Set(days.map((d) => d.key)).size).toBe(7);
    expect(days.map((d) => d.offset)).toEqual([-6, -5, -4, -3, -2, -1, 0]);
    expect(days[0]!.key).toBe("2026-09-01");
    expect(days[6]!.key).toBe("2026-09-07");
    expect(days[6]!.isToday).toBe(true);
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
  });

  it("before=0/after=6 : 7 jours distincts, J..J+6, centrés sur aujourd'hui (Paris)", () => {
    const now = new Date("2026-09-07T08:00:00.000Z");
    const days = buildMarketDayWindow(now, 0, 6);
    expect(days).toHaveLength(7);
    expect(new Set(days.map((d) => d.key)).size).toBe(7);
    expect(days.map((d) => d.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(days[0]!.key).toBe("2026-09-07");
    expect(days[0]!.isToday).toBe(true);
    expect(days[6]!.key).toBe("2026-09-13");
  });

  it("does not skip or duplicate a day across the spring DST transition", () => {
    // Nuit du 28 au 29 mars 2026 : passage à l'heure d'été (02:00 → 03:00 Paris).
    const now = new Date("2026-03-28T23:30:00.000Z");
    const days = buildMarketDayWindow(now, 6, 6);
    expect(new Set(days.map((d) => d.key)).size).toBe(13);
    expect(days.map((d) => d.key)).toEqual([
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
    ]);
  });

  it("does not skip or duplicate a day across the autumn DST transition", () => {
    // Nuit du 24 au 25 octobre 2026 : retour à l'heure d'hiver.
    const now = new Date("2026-10-25T12:00:00.000Z");
    const days = buildMarketDayWindow(now, 6, 6);
    expect(new Set(days.map((d) => d.key)).size).toBe(13);
    expect(days[0]!.key).toBe("2026-10-19");
    expect(days[12]!.key).toBe("2026-10-31");
  });
});

describe("buildReleaseDayWindow — deux modes mutuellement exclusifs", () => {
  const now = new Date("2026-09-07T08:00:00.000Z"); // lundi 7 sept. 2026, Paris

  it("« upcoming » couvre J…J+6, aujourd'hui inclus, en ordre chronologique", () => {
    const days = buildReleaseDayWindow("upcoming", now);
    expect(days.map((d) => d.key)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
    expect(days[0]!.isToday).toBe(true);
    // J−1 et au-delà ne figurent pas dans cette fenêtre.
    expect(days.some((d) => d.key === "2026-09-06")).toBe(false);
    // J+7 et au-delà sont retirés.
    expect(days.some((d) => d.key === "2026-09-14")).toBe(false);
  });

  it("« published » couvre J−6…J, aujourd'hui inclus, en ordre chronologique", () => {
    const days = buildReleaseDayWindow("published", now);
    expect(days.map((d) => d.key)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
    ]);
    expect(days[6]!.isToday).toBe(true);
    // J+1 et au-delà ne figurent pas dans cette fenêtre.
    expect(days.some((d) => d.key === "2026-09-08")).toBe(false);
    // J−7 et au-delà sont retirés.
    expect(days.some((d) => d.key === "2026-08-31")).toBe(false);
  });

  it("les deux fenêtres ne partagent qu'un seul jour : J", () => {
    const upcoming = new Set(
      buildReleaseDayWindow("upcoming", now).map((d) => d.key)
    );
    const published = new Set(
      buildReleaseDayWindow("published", now).map((d) => d.key)
    );
    const shared = [...upcoming].filter((k) => published.has(k));
    expect(shared).toEqual(["2026-09-07"]);
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
