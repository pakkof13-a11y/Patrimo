import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Entretien planifié des clôtures quotidiennes.
 *
 * `AssetDailyClose` n'était alimentée qu'en marge d'une consultation : ouvrir
 * un écran d'historique déclenchait le remplissage. Un compte qui n'ouvrait
 * jamais cet écran n'accumulait donc aucun historique quotidien — alors que
 * c'est cette table qui rend le passé reconstructible.
 *
 * Ces tests portent sur la boucle de collecte, pas sur la récupération : ce qui
 * doit être vérifié est *qui* est rappelé, *combien de fois*, et ce qui arrive
 * quand un fournisseur se tait.
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

import {
  collectDailyClosesForAssets,
  DAILY_LOOKBACK_DAYS,
} from "@/app/lib/market/intraday-collector";

const MAINTENANT = new Date("2026-08-26T09:00:00.000Z");

/** Série quotidienne réelle rendue par un fournisseur. */
const serieReelle = (source = "yahoo") => ({
  assetId: "a1",
  range: "1y",
  barInterval: "1d",
  currency: "EUR",
  source,
  points: [
    { date: "2026-08-24T21:00:00.000Z", label: "", price: 100, open: 100, high: 100, low: 100, close: 100 },
    { date: "2026-08-25T21:00:00.000Z", label: "", price: 102, open: 102, high: 102, low: 102, close: 102 },
  ],
  from: "2025-08-26T00:00:00.000Z",
  to: "2026-08-26T09:00:00.000Z",
  extendedToFirstBuy: false,
});

beforeEach(() => {
  assetFindMany.mockReset().mockResolvedValue([
    { id: "a1", userId: "u1", name: "LVMH" },
  ]);
  // Aucun cache : tous les actifs sont à compléter.
  groupBy.mockReset().mockResolvedValue([]);
  getHistory.mockReset().mockResolvedValue(serieReelle());
  upsert.mockReset().mockResolvedValue({});
  createMany.mockReset().mockResolvedValue({ count: 0 });
});

describe("1 — première collecte d'une journée", () => {
  it("écrit les clôtures rendues par le fournisseur", async () => {
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.assetsConsidered).toBe(1);
    expect(r.assetsStale).toBe(1);
    expect(r.closesWritten).toBeGreaterThan(0);
    expect(r.errors).toEqual([]);
  });

  it("le jour de référence est le jour parisien", async () => {
    /*
      9 h UTC le 26 = 11 h à Paris : même jour. Le point du test est qu'on
      n'introduit pas une seconde convention — découper à minuit UTC ferait
      retomber une clôture de 1 h du matin dans la veille.
    */
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.day).toBe("2026-08-26");
  });

  it("la fenêtre demandée remonte d'un an", async () => {
    await collectDailyClosesForAssets({ now: MAINTENANT });
    const [, , , opts] = getHistory.mock.calls[0] as [string, string, string, { from: Date }];
    const jours = (MAINTENANT.getTime() - opts.from.getTime()) / 86_400_000;
    expect(Math.round(jours)).toBe(DAILY_LOOKBACK_DAYS);
  });
});

describe("2 et 9 — second passage le même jour", () => {
  it("un cache frais n'est pas redemandé au fournisseur", async () => {
    /*
      L'idempotence tient à deux niveaux : `assetsNeedingFetch` écarte ce qui
      est déjà frais, et `fillDailyCloses` fait un upsert sur (assetId, day).
      Ce test vérifie le premier — le seul qui évite un appel réseau inutile.
    */
    groupBy.mockResolvedValue([
      {
        assetId: "a1",
        _max: { day: "2026-08-26", fetchedAt: new Date("2026-08-26T08:30:00Z") },
      },
    ]);

    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.assetsStale).toBe(0);
    expect(getHistory).not.toHaveBeenCalled();
    expect(r.closesWritten).toBe(0);
  });

  it("un cache ancien est complété, sans doublon possible", async () => {
    groupBy.mockResolvedValue([
      {
        assetId: "a1",
        _max: { day: "2026-08-20", fetchedAt: new Date("2026-08-20T09:00:00Z") },
      },
    ]);
    await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(getHistory).toHaveBeenCalledTimes(1);
    // L'unicité (assetId, day) est portée par la base : les jours anciens
    // s'écrivent en `createMany` (`skipDuplicates`), les plus récents en upsert.
    expect(upsert).toHaveBeenCalled();
  });
});

describe("3 et 5 — périmètre des actifs", () => {
  it("la liste est relue à chaque passage", async () => {
    await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(assetFindMany).toHaveBeenCalledTimes(1);

    assetFindMany.mockResolvedValue([
      { id: "a1", userId: "u1", name: "LVMH" },
      { id: "a2", userId: "u1", name: "Nouveau ce matin" },
    ]);
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.assetsConsidered).toBe(2);
  });

  it("c'est le même critère que la collecte intraday", async () => {
    await collectDailyClosesForAssets({ now: MAINTENANT });
    const where = (assetFindMany.mock.calls[0][0] as { where: { OR: unknown[] } }).where;
    expect(JSON.stringify(where.OR)).toContain("ACTIONS");
    expect(JSON.stringify(where.OR)).toContain("OBLIGATIONS");
    expect(JSON.stringify(where.OR)).toContain("CRYPTO");
  });

  it("un actif supprimé disparaît simplement du périmètre", async () => {
    assetFindMany.mockResolvedValue([]);
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.assetsConsidered).toBe(0);
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("restreint à un utilisateur quand on le demande", async () => {
    await collectDailyClosesForAssets({ userId: "u9", now: MAINTENANT });
    const where = (assetFindMany.mock.calls[0][0] as { where: { userId?: string } }).where;
    expect(where.userId).toBe("u9");
  });
});

describe("4, 5 et 6 — ce qui n'entre pas en base", () => {
  it("une série mock est refusée", async () => {
    /*
      Même règle que la collecte intraday, et pour la même raison : une série
      fabriquée sert à ne pas laisser un graphique vide, jamais à valoriser un
      patrimoine. `fillDailyCloses` la rejette et rend zéro.
    */
    getHistory.mockResolvedValue(serieReelle("mock"));
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.closesWritten).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("un fournisseur muet laisse un trou, jamais une valeur inventée", async () => {
    getHistory.mockResolvedValue(null);
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.closesWritten).toBe(0);
    expect(r.assetsFilled).toBe(0);
  });

  it("un fournisseur en erreur n'interrompt pas les autres actifs", async () => {
    assetFindMany.mockResolvedValue([
      { id: "a1", userId: "u1", name: "Tombe" },
      { id: "a2", userId: "u1", name: "Répond" },
    ]);
    getHistory.mockImplementation(async (_u: string, assetId: string) => {
      if (assetId === "a1") throw new Error("429 Too Many Requests");
      return serieReelle();
    });

    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain("429");
    expect(r.assetsFilled).toBe(1);
  });
});

describe("T-2c — écriture en lots, sans transaction interactive", () => {
  /**
   * Un actif détenu depuis des années (~1800 upserts) faisait expirer la
   * transaction interactive Prisma (5 s) en preview : rollback intégral, zéro
   * écriture. `fillDailyCloses` doit écrire par `createMany` (skipDuplicates)
   * plutôt que dans un `$transaction([...upserts])`.
   */
  it("écrit une longue série via createMany, pas via une transaction interactive", async () => {
    const points = Array.from({ length: 600 }, (_, i) => ({
      date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}T21:00:00.000Z`,
      label: "",
      price: 100,
      open: 100,
      high: 100,
      low: 100,
      close: 100 + i,
    }));
    getHistory.mockResolvedValue({ ...serieReelle(), points });

    await collectDailyClosesForAssets({ now: MAINTENANT });

    expect(createMany).toHaveBeenCalled();
  });

  it("rafraîchit le jour le plus récent par upsert même si le cache existe déjà", async () => {
    await collectDailyClosesForAssets({ now: MAINTENANT });
    // `serieReelle()` ne rend que deux jours : tous deux sont « récents » et
    // passent donc en upsert, jamais en createMany silencieux qui ignorerait
    // un rafraîchissement du jour courant.
    expect(upsert).toHaveBeenCalled();
  });

  it("écrit du plus récent au plus ancien : un lot interrompu laisse minDay récent", async () => {
    const points = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-08-${String(20 + i).padStart(2, "0")}T21:00:00.000Z`,
      label: "",
      price: 100,
      open: 100,
      high: 100,
      low: 100,
      close: 100 + i,
    }));
    getHistory.mockResolvedValue({ ...serieReelle(), points });

    await collectDailyClosesForAssets({ now: MAINTENANT });

    // Les deux upserts (jours récents) précèdent le createMany du reste, qui
    // couvre les jours plus anciens : c'est cet ordre qui garantit qu'une
    // écriture coupée en route laisse `minDay` proche du jour courant.
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(
      createMany.mock.invocationCallOrder[0]
    );
  });
});

describe("7 — plusieurs comptes", () => {
  it("les actifs sont regroupés par utilisateur", async () => {
    /*
      `fillDailyCloses` résout le symbole depuis l'actif, qui appartient à un
      compte : passer les identifiants en vrac ferait chercher l'actif d'un
      utilisateur sous un autre.
    */
    assetFindMany.mockResolvedValue([
      { id: "a1", userId: "u1", name: "A" },
      { id: "a2", userId: "u2", name: "B" },
    ]);
    const r = await collectDailyClosesForAssets({ now: MAINTENANT });
    expect(r.assetsConsidered).toBe(2);
    const users = getHistory.mock.calls.map((c) => c[0]).sort();
    expect(users).toEqual(["u1", "u2"]);
  });
});
