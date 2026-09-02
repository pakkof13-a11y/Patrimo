import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Une erreur de compartiment ne devient pas un patrimoine plus petit.
 *
 * `getEmployeeSavingsTotalEur` rattrapait toute erreur et rendait `zero()` ;
 * la tranche des alternatifs faisait de même, sur trois niveaux. Ces zéros
 * entraient dans `totalAssets` puis dans `netWorth`, et le total s'affichait
 * sans la moindre réserve : une épargne salariale de 25 000 € devenue
 * illisible retirait 25 000 € du patrimoine, et le seul indice partait dans
 * les journaux du serveur.
 *
 * La règle appliquée partout ailleurs — le moteur historique, les passifs, le
 * cash explicite — est que l'inconnu n'est pas zéro. Ces tests vérifient les
 * deux moitiés de la distinction :
 *
 *   compartiment réellement vide  → 0, et c'est vrai ;
 *   compartiment illisible        → l'erreur remonte, aucun total n'est publié.
 */

const employeeFindMany = vi.fn();
const metalFindMany = vi.fn();
const peFindMany = vi.fn();
const clFindMany = vi.fn();
const tangibleFindMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    employeeSavingsLine: { findMany: (...a: unknown[]) => employeeFindMany(...a) },
    preciousMetalPosition: { findMany: (...a: unknown[]) => metalFindMany(...a) },
    privateEquityPosition: { findMany: (...a: unknown[]) => peFindMany(...a) },
    crowdlendingPosition: { findMany: (...a: unknown[]) => clFindMany(...a) },
    tangibleAsset: { findMany: (...a: unknown[]) => tangibleFindMany(...a) },
  },
}));

vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1, USD: 1.25 }) };
});

import { getEmployeeSavingsTotalEur } from "@/app/lib/portfolio/service";
import { getAlternativesPortfolioSlice } from "@/app/lib/alternatives/portfolio";
import { d } from "@/app/lib/money/decimal";

const PANNE = new Error("could not connect to database");

beforeEach(() => {
  employeeFindMany.mockReset().mockResolvedValue([]);
  metalFindMany.mockReset().mockResolvedValue([]);
  peFindMany.mockReset().mockResolvedValue([]);
  clFindMany.mockReset().mockResolvedValue([]);
  tangibleFindMany.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("épargne salariale", () => {
  it("rend la valeur quand la lecture aboutit", async () => {
    employeeFindMany.mockResolvedValue([
      { units: d("100"), nav: d("150"), currency: "EUR" },
      { units: d("40"), nav: d("125"), currency: "EUR" },
    ]);
    const total = await getEmployeeSavingsTotalEur("u1");
    expect(Number(total)).toBe(20000);
  });

  it("un compartiment réellement vide vaut zéro", async () => {
    employeeFindMany.mockResolvedValue([]);
    expect(Number(await getEmployeeSavingsTotalEur("u1"))).toBe(0);
  });

  it("des lignes réellement à zéro valent zéro", async () => {
    employeeFindMany.mockResolvedValue([
      { units: d("0"), nav: d("150"), currency: "EUR" },
    ]);
    expect(Number(await getEmployeeSavingsTotalEur("u1"))).toBe(0);
  });

  it("une lecture en échec ne rend jamais zéro : elle échoue", async () => {
    employeeFindMany.mockRejectedValue(PANNE);
    await expect(getEmployeeSavingsTotalEur("u1")).rejects.toThrow(
      /could not connect/
    );
  });
});

describe("investissements alternatifs", () => {
  it("rend la valeur quand les lectures aboutissent", async () => {
    metalFindMany.mockResolvedValue([{ currentValue: d("5000"), currency: "EUR" }]);
    peFindMany.mockResolvedValue([{ currentNav: d("3000"), currency: "EUR" }]);
    const slice = await getAlternativesPortfolioSlice("u1");
    expect(slice.totalEur).toBe(8000);
  });

  it("un compartiment réellement vide vaut zéro", async () => {
    const slice = await getAlternativesPortfolioSlice("u1");
    expect(slice.totalEur).toBe(0);
    expect(slice.slices).toEqual([]);
  });

  it("une poche en échec fait échouer la tranche, elle ne la vide pas", async () => {
    metalFindMany.mockResolvedValue([{ currentValue: d("5000"), currency: "EUR" }]);
    peFindMany.mockRejectedValue(PANNE);
    await expect(getAlternativesPortfolioSlice("u1")).rejects.toThrow(
      /could not connect/
    );
  });

  it("un modèle absent du client généré échoue au lieu de compter zéro", async () => {
    /*
      Ce cas rendait un tableau vide avec un simple avertissement : « je ne
      peux pas lire cette poche » devenait « cette poche est vide », et sa
      valeur disparaissait du patrimoine.
    */
    vi.resetModules();
    vi.doMock("@/app/lib/prisma", () => ({ prisma: {} }));
    const { getAlternativesPortfolioSlice: sansModeles } = await import(
      "@/app/lib/alternatives/portfolio"
    );
    await expect(sansModeles("u1")).rejects.toThrow(/indisponible/);
    vi.doUnmock("@/app/lib/prisma");
  });
});

describe("le patrimoine n'est jamais publié amputé", () => {
  /*
    La démonstration chiffrée du défaut. Épargne salariale 20 000 €, autres
    actifs 100 000 €.

    Avant : la lecture échouait, la fonction rendait 0, `totalAssets` valait
    100 000 € et l'écran l'affichait comme un montant exact. L'utilisateur ne
    pouvait pas distinguer ce total d'un patrimoine réellement égal à
    100 000 €.

    Après : l'erreur remonte. La route rend un 500, la requête cliente n'a pas
    de résumé, et la bande d'indicateurs affiche « — € » — son placeholder de
    montant inconnu, déjà en place. Aucun total faux n'est publié.
  */
  const AUTRES_ACTIFS = 100_000;

  it("20 000 € illisibles ne se lisent pas comme 100 000 € de patrimoine", async () => {
    employeeFindMany.mockRejectedValue(PANNE);

    let total: number | null = null;
    try {
      total = AUTRES_ACTIFS + Number(await getEmployeeSavingsTotalEur("u1"));
    } catch {
      total = null; // rien n'est publié
    }

    expect(total).toBeNull();
    expect(total).not.toBe(AUTRES_ACTIFS);
  });

  it("des alternatifs illisibles ne se lisent pas non plus comme un total exact", async () => {
    peFindMany.mockRejectedValue(PANNE);

    let total: number | null = null;
    try {
      total = AUTRES_ACTIFS + (await getAlternativesPortfolioSlice("u1")).totalEur;
    } catch {
      total = null;
    }

    expect(total).toBeNull();
    expect(total).not.toBe(AUTRES_ACTIFS);
  });

  it("sans erreur, le total reste exactement celui d'avant", async () => {
    // Non-régression : un portefeuille complet et sain n'a pas bougé.
    employeeFindMany.mockResolvedValue([
      { units: d("100"), nav: d("200"), currency: "EUR" },
    ]);
    metalFindMany.mockResolvedValue([{ currentValue: d("5000"), currency: "EUR" }]);

    const es = Number(await getEmployeeSavingsTotalEur("u1"));
    const alt = (await getAlternativesPortfolioSlice("u1")).totalEur;

    expect(es).toBe(20000);
    expect(alt).toBe(5000);
    expect(AUTRES_ACTIFS + es + alt).toBe(125000);
  });

  it("un utilisateur sans aucune donnée garde son total à zéro", async () => {
    const es = Number(await getEmployeeSavingsTotalEur("u1"));
    const alt = (await getAlternativesPortfolioSlice("u1")).totalEur;
    expect(es).toBe(0);
    expect(alt).toBe(0);
  });
});
