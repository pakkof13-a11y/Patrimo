import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le comportement du collecteur : idempotence, périmètre, pannes.
 *
 * La base est simulée — ce qui compte n'est pas Postgres mais **ce que le
 * service décide d'écrire** : ne pas créer deux fois la même barre, ne pas
 * interrompre un passage parce qu'un fournisseur est tombé, et relire la liste
 * des actifs à chaque passage plutôt que de la figer.
 */

const assetFindMany = vi.fn();
const barFindMany = vi.fn();
const barCreateMany = vi.fn();
const barUpdate = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: { findMany: (...a: unknown[]) => assetFindMany(...a) },
    assetIntradayBar: {
      findMany: (...a: unknown[]) => barFindMany(...a),
      createMany: (...a: unknown[]) => barCreateMany(...a),
      update: (...a: unknown[]) => barUpdate(...a),
    },
  },
}));

vi.mock("@/app/lib/market/price-history", () => ({
  getAssetPriceHistory: vi.fn(),
}));

import { collectIntradayBars } from "@/app/lib/market/intraday-collector";
import type { PriceHistoryResult } from "@/app/lib/market/price-history-types";

const MAINTENANT = new Date("2026-08-26T00:00:00.000Z");

const point = (iso: string, close: number) => ({
  date: iso,
  label: iso,
  price: close,
  open: close,
  high: close,
  low: close,
  close,
});

function serie(points: Array<{ date: string; close: number }>): PriceHistoryResult {
  return {
    assetId: "a1",
    range: "7d",
    barInterval: "1h",
    currency: "EUR",
    source: "yahoo",
    points: points.map((p) => point(p.date, p.close)),
    from: "2026-08-18T00:00:00.000Z",
    to: "2026-08-26T00:00:00.000Z",
    extendedToFirstBuy: false,
  } as PriceHistoryResult;
}

const deps = (fetchHistory: unknown) => ({
  fetchHistory: fetchHistory as never,
  now: () => MAINTENANT,
});

const DEUX_BARRES = serie([
  { date: "2026-08-25T09:00:00.000Z", close: 100 },
  { date: "2026-08-25T10:00:00.000Z", close: 102 },
]);

beforeEach(() => {
  assetFindMany.mockReset().mockResolvedValue([
    { id: "a1", userId: "u1", name: "LVMH" },
  ]);
  barFindMany.mockReset().mockResolvedValue([]);
  barCreateMany.mockReset().mockResolvedValue({ count: 0 });
  barUpdate.mockReset().mockResolvedValue({});
});

describe("écriture d'observations réelles", () => {
  it("persiste les barres closes d'une série fournisseur", async () => {
    const r = await collectIntradayBars({
      deps: deps(async () => DEUX_BARRES),
    });

    expect(r.barsCreated).toBe(2);
    expect(r.assetsCollected).toBe(1);
    const arg = barCreateMany.mock.calls[0][0] as {
      data: Array<{ assetId: string; interval: string; barStart: Date; source: string }>;
    };
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0]!.assetId).toBe("a1");
    expect(arg.data[0]!.interval).toBe("1h");
    expect(arg.data[0]!.source).toBe("yahoo");
  });

  it("conserve l'horodatage de la barre, aligné sur l'heure", async () => {
    await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });
    const arg = barCreateMany.mock.calls[0][0] as { data: Array<{ barStart: Date }> };
    expect(arg.data.map((d) => d.barStart.toISOString())).toEqual([
      "2026-08-25T09:00:00.000Z",
      "2026-08-25T10:00:00.000Z",
    ]);
  });

  it("conserve le fournisseur qui a produit la barre", async () => {
    await collectIntradayBars({
      deps: deps(async () => ({ ...DEUX_BARRES, source: "coingecko" })),
    });
    const arg = barCreateMany.mock.calls[0][0] as { data: Array<{ source: string }> };
    expect(arg.data.every((d) => d.source === "coingecko")).toBe(true);
  });
});

describe("idempotence", () => {
  it("un second passage identique n'écrit rien", async () => {
    // La base rend déjà les deux barres, avec les mêmes cours.
    barFindMany.mockResolvedValue([
      { barStart: new Date("2026-08-25T09:00:00.000Z"), closeEur: { toString: () => "100" } },
      { barStart: new Date("2026-08-25T10:00:00.000Z"), closeEur: { toString: () => "102" } },
    ]);

    const r = await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });

    expect(r.barsCreated).toBe(0);
    expect(r.barsUpdated).toBe(0);
    expect(r.barsUnchanged).toBe(2);
    expect(barCreateMany).not.toHaveBeenCalled();
    expect(barUpdate).not.toHaveBeenCalled();
  });

  it("une décimale écrite autrement reste la même observation", async () => {
    /*
      La base rend "100.000000000000" là où le fournisseur dit 100. Comparer
      les chaînes ferait réécrire la barre à chaque passage.
    */
    barFindMany.mockResolvedValue([
      {
        barStart: new Date("2026-08-25T09:00:00.000Z"),
        closeEur: { toString: () => "100.000000000000" },
      },
    ]);

    const r = await collectIntradayBars({
      deps: deps(async () => serie([{ date: "2026-08-25T09:00:00.000Z", close: 100 }])),
    });

    expect(r.barsUnchanged).toBe(1);
    expect(barUpdate).not.toHaveBeenCalled();
  });

  it("un cours corrigé par le fournisseur met la barre à jour, sans doublon", async () => {
    barFindMany.mockResolvedValue([
      { barStart: new Date("2026-08-25T09:00:00.000Z"), closeEur: { toString: () => "100" } },
    ]);

    const r = await collectIntradayBars({
      deps: deps(async () => serie([{ date: "2026-08-25T09:00:00.000Z", close: 101 }])),
    });

    expect(r.barsUpdated).toBe(1);
    expect(r.barsCreated).toBe(0);
    expect(barUpdate).toHaveBeenCalledTimes(1);
    const arg = barUpdate.mock.calls[0][0] as { where: { assetId_interval_barStart: unknown } };
    expect(arg.where.assetId_interval_barStart).toBeDefined();
  });

  it("la création concurrente ne fait pas échouer le passage", async () => {
    await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });
    const arg = barCreateMany.mock.calls[0][0] as { skipDuplicates: boolean };
    expect(arg.skipDuplicates).toBe(true);
  });
});

describe("périmètre des actifs", () => {
  it("la liste est relue à chaque passage", async () => {
    /*
      Un actif créé ce matin doit être collecté ce soir, un actif supprimé doit
      cesser de l'être. Une liste figée l'interdirait.
    */
    await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });
    expect(assetFindMany).toHaveBeenCalledTimes(1);

    assetFindMany.mockResolvedValue([
      { id: "a1", userId: "u1", name: "LVMH" },
      { id: "a2", userId: "u1", name: "Nouveau" },
    ]);
    const r = await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });
    expect(r.assetsConsidered).toBe(2);
  });

  it("un actif supprimé disparaît simplement du périmètre", async () => {
    assetFindMany.mockResolvedValue([]);
    const r = await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });
    expect(r.assetsConsidered).toBe(0);
    expect(barCreateMany).not.toHaveBeenCalled();
  });

  it("ne retient que les actifs cotables", async () => {
    await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });
    const where = (assetFindMany.mock.calls[0][0] as { where: { OR: unknown[] } }).where;
    expect(JSON.stringify(where.OR)).toContain("ACTIONS");
    expect(JSON.stringify(where.OR)).toContain("CRYPTO");
  });

  it("restreint à un utilisateur quand on le demande", async () => {
    await collectIntradayBars({ userId: "u9", deps: deps(async () => DEUX_BARRES) });
    const where = (assetFindMany.mock.calls[0][0] as { where: { userId?: string } }).where;
    expect(where.userId).toBe("u9");
  });
});

describe("pannes fournisseur", () => {
  it("un actif en erreur n'interrompt pas les suivants", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a1", userId: "u1", name: "Tombe" },
      { id: "a2", userId: "u1", name: "Répond" },
    ]);
    const r = await collectIntradayBars({
      deps: deps(async (_u: string, assetId: string) => {
        if (assetId === "a1") throw new Error("429 Too Many Requests");
        return DEUX_BARRES;
      }),
    });

    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain("429");
    expect(r.assetsCollected).toBe(1);
    expect(r.barsCreated).toBe(2);
  });

  it("un fournisseur muet laisse un trou, jamais une valeur inventée", async () => {
    const r = await collectIntradayBars({ deps: deps(async () => null) });
    expect(r.skipped[0]!.reason).toBe("fournisseur-indisponible");
    expect(barCreateMany).not.toHaveBeenCalled();
  });

  it("une série mock ne touche jamais la base", async () => {
    const r = await collectIntradayBars({
      deps: deps(async () => ({ ...DEUX_BARRES, source: "mock" })),
    });
    expect(r.skipped[0]!.reason).toBe("source-mock");
    expect(barCreateMany).not.toHaveBeenCalled();
    expect(barUpdate).not.toHaveBeenCalled();
  });

  it("une écriture qui échoue est signalée sans arrêter le passage", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a1", userId: "u1", name: "Un" },
      { id: "a2", userId: "u1", name: "Deux" },
    ]);
    barCreateMany.mockRejectedValueOnce(new Error("base indisponible"));
    const r = await collectIntradayBars({ deps: deps(async () => DEUX_BARRES) });
    expect(r.errors).toHaveLength(1);
    expect(r.assetsCollected).toBe(1);
  });
});
