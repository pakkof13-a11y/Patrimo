import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D28/P1 - budget d'execution de l'entretien court des clotures quotidiennes.
 *
 * collectDailyClosesForAssets (et collectDailyCloses qu'elle appelle)
 * n'avaient aucun budget : sur un compte a N actions perimees, un 504 au
 * milieu du passage laissait un rapport perdu. Les ecritures deja faites
 * restaient (idempotentes), mais rien ne disait combien il en restait. Meme
 * patron que backfill-closes.ts::mapWithConcurrency : une echeance absolue,
 * une horloge injectable, un arret qui ne tombe jamais au milieu d'un actif.
 */

const assetFindMany = vi.fn();
const groupBy = vi.fn();
const getHistory = vi.fn();
const upsert = vi.fn();
const createMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: { findMany: (...a: unknown[]) => assetFindMany(...a) },
    assetDailyClose: {
      groupBy: (...a: unknown[]) => groupBy(...a),
      upsert: (...a: unknown[]) => upsert(...a),
      createMany: (...a: unknown[]) => createMany(...a),
      findMany: async () => [],
    },
  },
}));

vi.mock("@/app/lib/market/price-history", () => ({
  getAssetPriceHistory: (...a: unknown[]) => getHistory(...a),
}));

import { collectDailyClosesForAssets } from "@/app/lib/market/intraday-collector";
import { collectDailyCloses } from "@/app/lib/market/daily-closes";

const MAINTENANT = new Date("2026-09-17T09:00:00.000Z");

const serieReelle = (source = "yahoo") => ({
  assetId: "a1",
  range: "1y",
  barInterval: "1d",
  currency: "EUR",
  source,
  points: [
    { date: "2026-09-15T21:00:00.000Z", label: "", price: 100, open: 100, high: 100, low: 100, close: 100 },
    { date: "2026-09-16T21:00:00.000Z", label: "", price: 102, open: 102, high: 102, low: 102, close: 102 },
  ],
  from: "2025-09-17T00:00:00.000Z",
  to: "2026-09-17T09:00:00.000Z",
  extendedToFirstBuy: false,
});

const cinqActifs = [
  { id: "a1", userId: "u1", name: "NVDA" },
  { id: "a2", userId: "u1", name: "AAPL" },
  { id: "a3", userId: "u1", name: "ASML" },
  { id: "a4", userId: "u1", name: "MC.PA" },
  { id: "a5", userId: "u1", name: "TTE.PA" },
];

function horlogeQuiAvance(depart: number, pasMs: number) {
  let t = depart;
  return () => {
    const now = t;
    t += pasMs;
    return now;
  };
}

beforeEach(() => {
  assetFindMany.mockReset().mockResolvedValue(cinqActifs);
  groupBy.mockReset().mockResolvedValue([]);
  getHistory.mockReset().mockResolvedValue(serieReelle());
  upsert.mockReset().mockResolvedValue({});
  createMany.mockReset().mockResolvedValue({ count: 0 });
});

describe("collectDailyCloses - budget d'execution", () => {
  it("un budget deja epuise ne lance aucun appel fournisseur", async () => {
    const r = await collectDailyCloses({
      userId: "u1",
      assetIds: cinqActifs.map((a) => a.id),
      fromDay: "2025-09-17",
      toDay: "2026-09-17",
      now: MAINTENANT,
      budget: { deadlineAt: 0, clock: () => 1_000 },
    });

    expect(getHistory).not.toHaveBeenCalled();
    expect(r.stoppedBy).toBe("budget");
    expect(r.remainingAssets).toBe(5);
  });

  it("s'arrete entre deux actifs et compte ce qu'il reste, jamais au milieu d'un actif", async () => {
    const r = await collectDailyCloses({
      userId: "u1",
      assetIds: cinqActifs.map((a) => a.id),
      fromDay: "2025-09-17",
      toDay: "2026-09-17",
      now: MAINTENANT,
      budget: { deadlineAt: 100, clock: horlogeQuiAvance(0, 30) },
    });

    expect(r.assetsStale).toBe(5);
    expect(r.stoppedBy).toBe("budget");
    expect(r.remainingAssets).toBeGreaterThan(0);
    expect(r.remainingAssets).toBeLessThan(5);
    expect(getHistory.mock.calls.length).toBe(5 - (r.remainingAssets ?? 0));
  });

  it("un budget large laisse le passage aller au bout", async () => {
    const r = await collectDailyCloses({
      userId: "u1",
      assetIds: cinqActifs.map((a) => a.id),
      fromDay: "2025-09-17",
      toDay: "2026-09-17",
      now: MAINTENANT,
      budget: { deadlineAt: 1_000_000, clock: () => 0 },
    });

    expect(r.stoppedBy).toBe("done");
    expect(r.remainingAssets).toBe(0);
    expect(getHistory).toHaveBeenCalledTimes(5);
  });

  it("un arret par budget ne peuple pas errors[]", async () => {
    const r = await collectDailyCloses({
      userId: "u1",
      assetIds: cinqActifs.map((a) => a.id),
      fromDay: "2025-09-17",
      toDay: "2026-09-17",
      now: MAINTENANT,
      budget: { deadlineAt: 0, clock: () => 1_000 },
    });

    expect(r.errors).toEqual([]);
  });

  it("sans budget declare, le comportement historique est inchange", async () => {
    const r = await collectDailyCloses({
      userId: "u1",
      assetIds: cinqActifs.map((a) => a.id),
      fromDay: "2025-09-17",
      toDay: "2026-09-17",
      now: MAINTENANT,
    });

    expect(r.stoppedBy).toBe("done");
    expect(r.remainingAssets).toBe(0);
    expect(getHistory).toHaveBeenCalledTimes(5);
  });
});

describe("collectDailyCloses - liste d'exclusion", () => {
  it("un actif exclu n'est jamais interroge et apparait dans skipped, pas dans errors", async () => {
    const r = await collectDailyCloses({
      userId: "u1",
      assetIds: cinqActifs.map((a) => a.id),
      fromDay: "2025-09-17",
      toDay: "2026-09-17",
      now: MAINTENANT,
      excludeAssetIds: ["a3"],
    });

    expect(r.assetsConsidered).toBe(4);
    expect(r.skipped).toEqual([{ assetId: "a3", reason: "exclu" }]);
    expect(r.errors).toEqual([]);
    const calledAssetIds = getHistory.mock.calls.map((c) => c[1]);
    expect(calledAssetIds).not.toContain("a3");
  });
});

describe("collectDailyClosesForAssets - budget propage sur plusieurs comptes", () => {
  const actifsDeuxComptes = [
    { id: "a1", userId: "u1", name: "NVDA" },
    { id: "a2", userId: "u1", name: "AAPL" },
    { id: "b1", userId: "u2", name: "ASML" },
  ];

  it("un budget epuise pendant le premier compte laisse le second sans appel reseau, mais compte", async () => {
    assetFindMany.mockResolvedValue(actifsDeuxComptes);
    const r = await collectDailyClosesForAssets({
      now: MAINTENANT,
      budget: { deadlineAt: 40, clock: horlogeQuiAvance(0, 30) },
    });

    expect(r.stoppedBy).toBe("budget");
    expect(r.assetsConsidered).toBe(3);
    const calledAssetIds = getHistory.mock.calls.map((c) => c[1]);
    expect(calledAssetIds).not.toContain("b1");
    expect(r.remainingAssets).toBeGreaterThan(0);
  });

  it("sans budget, plusieurs comptes vont tous au bout", async () => {
    assetFindMany.mockResolvedValue(actifsDeuxComptes);
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });

    expect(r.stoppedBy).toBe("done");
    expect(r.remainingAssets).toBe(0);
    expect(getHistory).toHaveBeenCalledTimes(3);
  });
});

describe("idempotence - un second passage n'ecrit rien", () => {
  it("apres un premier passage complet, assetsNeedingFetch ecarte tout : aucun appel reseau", async () => {
    const premier = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(premier.closesWritten).toBeGreaterThan(0);
    expect(getHistory).toHaveBeenCalledTimes(5);

    getHistory.mockClear();
    groupBy.mockResolvedValue(
      cinqActifs.map((a) => ({
        assetId: a.id,
        _max: { day: "2026-09-17", fetchedAt: MAINTENANT },
      }))
    );

    const second = await collectDailyClosesForAssets({ now: MAINTENANT });

    expect(second.assetsStale).toBe(0);
    expect(second.closesWritten).toBe(0);
    expect(getHistory).not.toHaveBeenCalled();
  });
});
