import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stale ne veut pas dire « il existe un close dans la fenêtre de lookback » —
 * ça veut dire « il manque un jour ouvré (hors week-end) entre la dernière
 * clôture connue et `toDay` ». Ces tests couvrent la mesure demandée :
 * lundi → jeudi (mar/mer/jeu ouvrés manquants) doit être stale même si un
 * fetch récent (< 6 h) a déjà été tenté ; vendredi → week-end (aucun jour
 * ouvré manquant) ne doit pas être marqué stale à tort.
 */

const groupBy = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    assetDailyClose: {
      groupBy: (...a: unknown[]) => groupBy(...a),
    },
  },
}));

import { assetsNeedingFetch } from "@/app/lib/market/daily-closes";

beforeEach(() => {
  groupBy.mockReset();
});

describe("assetsNeedingFetch — jours ouvrés manquants", () => {
  it("lundi (connu) → jeudi (toDay) est stale malgré un fetch vieux de moins de 6 h", async () => {
    const now = new Date("2026-08-27T09:00:00Z"); // jeudi
    groupBy.mockResolvedValue([
      {
        assetId: "a1",
        _max: {
          day: "2026-08-24", // lundi
          fetchedAt: new Date("2026-08-27T07:00:00Z"), // il y a 2 h
        },
      },
    ]);

    const stale = await assetsNeedingFetch(["a1"], "2026-08-27", now);

    expect(stale).toEqual(["a1"]);
  });

  it("vendredi (connu) → samedi (toDay) n'est pas stale : aucun jour ouvré manquant", async () => {
    const now = new Date("2026-08-29T09:00:00Z"); // samedi
    groupBy.mockResolvedValue([
      {
        assetId: "a1",
        _max: {
          day: "2026-08-28", // vendredi
          fetchedAt: new Date("2000-01-01T00:00:00Z"), // très ancien : ne doit pas jouer
        },
      },
    ]);

    const stale = await assetsNeedingFetch(["a1"], "2026-08-29", now);

    expect(stale).toEqual([]);
  });

  it("vendredi (connu) → dimanche (toDay) n'est pas stale non plus", async () => {
    const now = new Date("2026-08-30T09:00:00Z"); // dimanche
    groupBy.mockResolvedValue([
      {
        assetId: "a1",
        _max: {
          day: "2026-08-28", // vendredi
          fetchedAt: new Date("2000-01-01T00:00:00Z"),
        },
      },
    ]);

    const stale = await assetsNeedingFetch(["a1"], "2026-08-30", now);

    expect(stale).toEqual([]);
  });

  it("une seule séance manquante (celle de toDay) reste soumise au throttle de 6 h", async () => {
    const now = new Date("2026-08-25T09:00:00Z"); // mardi, dernière connue = lundi
    groupBy.mockResolvedValue([
      {
        assetId: "a1",
        _max: {
          day: "2026-08-24", // lundi
          fetchedAt: new Date("2026-08-25T08:00:00Z"), // il y a 1 h
        },
      },
    ]);

    const stale = await assetsNeedingFetch(["a1"], "2026-08-25", now);

    expect(stale).toEqual([]);
  });
});
