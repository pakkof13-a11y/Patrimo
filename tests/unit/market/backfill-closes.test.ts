import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_CLOSE_GRACE_DAYS,
  needsHistoryBackfill,
} from "@/app/lib/market/backfill-closes";

/**
 * T-04 — backfill des clôtures depuis le premier achat.
 *
 * La décision « faut-il fetcher » est pure : c'est elle qui empêchait de
 * remonter au-delà d'un an (on ne regardait que le max(day)).
 */

describe("needsHistoryBackfill — couverture depuis le premier achat", () => {
  const now = new Date("2026-09-04T09:00:00.000Z");
  const fallback = "2025-09-04";
  const toDay = "2026-09-04";

  it("cache vide → fetch", () => {
    expect(
      needsHistoryBackfill({
        firstTxDay: "2023-03-12",
        fallbackFromDay: fallback,
        toDay,
        minDay: null,
        maxDay: null,
        fetchedAt: null,
        now,
      })
    ).toBe(true);
  });

  it("un an de cache alors que le premier achat date de 2023 → fetch", () => {
    expect(
      needsHistoryBackfill({
        firstTxDay: "2023-03-12",
        fallbackFromDay: fallback,
        toDay,
        minDay: "2025-09-04",
        maxDay: "2026-09-04",
        fetchedAt: now,
        now,
      })
    ).toBe(true);
  });

  it("couverture depuis le premier achat jusqu'à aujourd'hui → no-op", () => {
    expect(
      needsHistoryBackfill({
        firstTxDay: "2023-03-12",
        fallbackFromDay: fallback,
        toDay,
        minDay: "2023-03-13",
        maxDay: "2026-09-04",
        fetchedAt: now,
        now,
      })
    ).toBe(false);
  });

  it(`un premier achat le dimanche tolère ${FIRST_CLOSE_GRACE_DAYS} jours`, () => {
    expect(
      needsHistoryBackfill({
        firstTxDay: "2023-03-12", // dimanche
        fallbackFromDay: fallback,
        toDay,
        minDay: "2023-03-13", // lundi
        maxDay: toDay,
        fetchedAt: now,
        now,
      })
    ).toBe(false);
  });

  it("sans transaction, la fenêtre d'un an suffit si elle est fraîche", () => {
    expect(
      needsHistoryBackfill({
        firstTxDay: undefined,
        fallbackFromDay: fallback,
        toDay,
        minDay: fallback,
        maxDay: toDay,
        fetchedAt: now,
        now,
      })
    ).toBe(false);
  });

  it("fin de fenêtre en retard et cache périmé → fetch", () => {
    expect(
      needsHistoryBackfill({
        firstTxDay: "2023-03-12",
        fallbackFromDay: fallback,
        toDay,
        minDay: "2023-03-12",
        maxDay: "2026-08-20",
        fetchedAt: new Date("2026-08-20T09:00:00Z"),
        now,
      })
    ).toBe(true);
  });
});

const assetFindMany = vi.fn();
const groupByCloses = vi.fn();
const groupByTx = vi.fn();
const getHistory = vi.fn();
const upsert = vi.fn();
const transaction = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: { findMany: (...a: unknown[]) => assetFindMany(...a) },
    assetDailyClose: {
      groupBy: (...a: unknown[]) => groupByCloses(...a),
      upsert: (...a: unknown[]) => upsert(...a),
      findMany: async () => [],
    },
    transaction: {
      groupBy: (...a: unknown[]) => groupByTx(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

vi.mock("@/app/lib/market/price-history", () => ({
  getAssetPriceHistory: (...a: unknown[]) => getHistory(...a),
}));

import { backfillDailyClosesFromFirstTx } from "@/app/lib/market/backfill-closes";

const MAINTENANT = new Date("2026-09-04T09:00:00.000Z");

function serieDepuis(fromIso: string, source = "yahoo") {
  return {
    assetId: "a1",
    range: "all",
    barInterval: "1d",
    currency: "EUR",
    source,
    points: [
      { date: fromIso, label: "", price: 80, open: 80, high: 80, low: 80, close: 80 },
      {
        date: "2026-09-03T21:00:00.000Z",
        label: "",
        price: 102,
        open: 102,
        high: 102,
        low: 102,
        close: 102,
      },
    ],
    from: fromIso,
    to: MAINTENANT.toISOString(),
    extendedToFirstBuy: true,
  };
}

beforeEach(() => {
  assetFindMany.mockReset().mockResolvedValue([
    { id: "a1", userId: "u1", name: "LVMH" },
  ]);
  groupByCloses.mockReset().mockResolvedValue([]);
  groupByTx.mockReset().mockResolvedValue([
    { assetId: "a1", _min: { occurredAt: new Date("2023-03-12T10:00:00Z") } },
  ]);
  getHistory.mockReset().mockResolvedValue(
    serieDepuis("2023-03-12T18:00:00.000Z")
  );
  upsert.mockReset().mockResolvedValue({});
  transaction.mockReset().mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return ops;
    return [];
  });
});

describe("backfillDailyClosesFromFirstTx — fumée", () => {
  it("demande l'historique depuis le premier achat, pas depuis un an", async () => {
    const r = await backfillDailyClosesFromFirstTx({ now: MAINTENANT });
    expect(r.assetsConsidered).toBe(1);
    expect(r.assetsStale).toBe(1);
    expect(r.assetsFromFirstTx).toBe(1);
    expect(r.closesWritten).toBeGreaterThan(0);

    const [, , range, opts] = getHistory.mock.calls[0] as [
      string,
      string,
      string,
      { from: Date },
    ];
    expect(range).toBe("all");
    const from = opts.from;
    expect(from.toISOString().slice(0, 10)).toBe("2023-03-12");
  });

  it("un cache qui couvre déjà le premier achat n'appelle pas le fournisseur", async () => {
    groupByCloses.mockResolvedValue([
      {
        assetId: "a1",
        _min: { day: "2023-03-13" },
        _max: { day: "2026-09-04", fetchedAt: MAINTENANT },
      },
    ]);
    const r = await backfillDailyClosesFromFirstTx({ now: MAINTENANT });
    expect(r.assetsStale).toBe(0);
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("une série mock est refusée", async () => {
    getHistory.mockResolvedValue(serieDepuis("2023-03-12T18:00:00.000Z", "mock"));
    const r = await backfillDailyClosesFromFirstTx({ now: MAINTENANT });
    expect(r.closesWritten).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("inclut les obligations dans le périmètre collectable", async () => {
    await backfillDailyClosesFromFirstTx({ now: MAINTENANT });
    const where = (assetFindMany.mock.calls[0][0] as { where: { OR: unknown[] } }).where;
    expect(JSON.stringify(where.OR)).toContain("OBLIGATIONS");
  });
});
