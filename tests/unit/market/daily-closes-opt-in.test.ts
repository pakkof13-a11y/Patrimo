import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La collecte de clôtures quotidiennes se demande, elle ne s'obtient pas par
 * omission.
 *
 * La condition était `opts?.refresh !== false` : ne rien passer suffisait donc
 * à déclencher des appels fournisseurs et des écritures dans `AssetDailyClose`.
 * Les trois appelants de lecture passaient bien `refresh: false`, mais le
 * défaut était structurel — le comportement dangereux était celui qu'on
 * obtenait sans rien écrire.
 *
 * ## Ce que ces tests apportent
 *
 * La couverture existante était textuelle : elle lisait les fichiers source et
 * vérifiait la présence de `refresh: false`. Utile contre une régression de
 * code, aveugle au comportement réel de la fonction. Ces tests-ci l'exercent :
 * le fournisseur et la base sont simulés, et l'on compte les appels.
 */

/**
 * Le point de contact réel avec un fournisseur.
 *
 * `fillDailyCloses` est locale au module ; c'est elle qui appelle
 * `getAssetPriceHistory`, et c'est donc cet appel qu'on compte. Le mesurer ici
 * plutôt qu'à un étage supérieur garantit qu'on observe une vraie sortie
 * réseau, pas une intention.
 */
const getAssetPriceHistory = vi.fn();
const findMany = vi.fn();
const groupBy = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    assetDailyClose: {
      findMany: (...a: unknown[]) => findMany(...a),
      // Sert à décider quels actifs sont périmés, donc à collecter.
      groupBy: (...a: unknown[]) => groupBy(...a),
    },
    asset: { findMany: async () => [] },
  },
}));

vi.mock("@/app/lib/market/price-history", () => ({
  getAssetPriceHistory: (...a: unknown[]) => getAssetPriceHistory(...a),
}));

import { getDailyCloses } from "@/app/lib/market/daily-closes";

beforeEach(() => {
  // Aucun point rendu : la collecte a lieu, mais n'écrit rien.
  getAssetPriceHistory.mockReset().mockResolvedValue(null);
  findMany.mockReset().mockResolvedValue([]);
  // Aucun actif connu du cache : tous seraient donc à rafraîchir.
  groupBy.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Une clôture telle que la rend Prisma : `closeEur` est un Decimal. */
function cloture(assetId: string, day: string, close: string) {
  return { assetId, day, closeEur: { toString: () => close } };
}

const ACTIFS = ["a1", "a2"];

describe("refresh absent", () => {
  it("ne déclenche aucune collecte", async () => {
    await getDailyCloses("u1", ACTIFS, "2026-01-01", "2026-01-31");
    expect(getAssetPriceHistory).not.toHaveBeenCalled();
  });

  it("rend malgré tout ce que le cache contient", async () => {
    findMany.mockResolvedValue([
      cloture("a1", "2026-01-05", "101.5"),
      cloture("a1", "2026-01-06", "102"),
    ]);

    const { closes, coverage } = await getDailyCloses(
      "u1",
      ACTIFS,
      "2026-01-01",
      "2026-01-31"
    );

    expect(getAssetPriceHistory).not.toHaveBeenCalled();
    expect(closes.get("a1")?.size).toBe(2);
    expect(coverage.covered).toEqual(["a1"]);
    expect(coverage.missing).toEqual(["a2"]);
  });

  it("sans données, rend une couverture vide plutôt que d'aller en chercher", async () => {
    /*
      Le point important : l'absence de donnée ne justifie pas une collecte. La
      restitution reste celle prévue — tout en `missing`, rien d'inventé.
    */
    const { closes, coverage } = await getDailyCloses(
      "u1",
      ACTIFS,
      "2026-01-01",
      "2026-01-31"
    );

    expect(getAssetPriceHistory).not.toHaveBeenCalled();
    expect(closes.size).toBe(0);
    expect(coverage.covered).toEqual([]);
    expect(coverage.missing).toEqual(ACTIFS);
  });
});

describe("refresh explicite", () => {
  it("refresh: false ne collecte pas", async () => {
    await getDailyCloses("u1", ACTIFS, "2026-01-01", "2026-01-31", {
      refresh: false,
    });
    expect(getAssetPriceHistory).not.toHaveBeenCalled();
  });

  it("refresh: true collecte, comme avant", async () => {
    await getDailyCloses("u1", ACTIFS, "2026-01-01", "2026-01-31", {
      refresh: true,
    });
    // Un remplissage par actif jugé périmé — ici les deux, le cache étant vide.
    // Un appel fournisseur par actif jugé périmé — ici les deux, cache vide.
    expect(getAssetPriceHistory).toHaveBeenCalled();
    const actifs = getAssetPriceHistory.mock.calls.map((c) => c[1]);
    expect(actifs.sort()).toEqual(["a1", "a2"]);
  });

  it("refresh: true sur une liste vide ne collecte rien", async () => {
    await getDailyCloses("u1", [], "2026-01-01", "2026-01-31", {
      refresh: true,
    });
    expect(getAssetPriceHistory).not.toHaveBeenCalled();
  });

  it("une collecte qui échoue ne fait pas échouer la lecture", async () => {
    // Comportement existant, inchangé : l'erreur est journalisée, pas propagée.
    getAssetPriceHistory.mockRejectedValue(new Error("fournisseur indisponible"));
    findMany.mockResolvedValue([cloture("a1", "2026-01-05", "101.5")]);

    const { coverage } = await getDailyCloses(
      "u1",
      ACTIFS,
      "2026-01-01",
      "2026-01-31",
      { refresh: true }
    );

    expect(coverage.covered).toEqual(["a1"]);
  });
});

describe("les appelants de lecture du produit", () => {
  /*
    Les trois chemins qui lisent des clôtures passent `refresh: false`. Ils
    étaient corrects avant ce chantier et le restent : l'inversion du défaut ne
    change rien pour eux, et c'est précisément ce qu'on vérifie.
  */
  it("passer refresh: false donne le même résultat que ne rien passer", async () => {
    findMany.mockResolvedValue([cloture("a1", "2026-01-05", "101.5")]);

    const sansOption = await getDailyCloses(
      "u1",
      ACTIFS,
      "2026-01-01",
      "2026-01-31"
    );
    const avecFalse = await getDailyCloses(
      "u1",
      ACTIFS,
      "2026-01-01",
      "2026-01-31",
      { refresh: false }
    );

    expect(avecFalse.coverage).toEqual(sansOption.coverage);
    expect(avecFalse.closes.get("a1")?.size).toBe(
      sansOption.closes.get("a1")?.size
    );
    expect(getAssetPriceHistory).not.toHaveBeenCalled();
  });
});
