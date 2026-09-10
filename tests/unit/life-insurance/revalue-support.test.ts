import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Réévaluation d'un support : le relevé donne un **encours total**, la base
 * stocke un **prix unitaire**.
 *
 * Écrire le total tel quel multipliait la position par sa quantité — un fonds
 * euro de 25 000 parts passait de 25 500 € à 637 millions. Ces tests
 * verrouillent la division, et la purge du cache de cotation qui sinon rendait
 * la réévaluation sans effet tout en répondant « enregistré ».
 *
 * Le diviseur est la quantité **détenue**, celle que `getHoldings` calcule.
 * C'est `getHoldings` qui est donc mocké ici : l'ancienne version de ce fichier
 * mockait `transaction.aggregate`, ce qui l'empêchait par construction de voir
 * que cet agrégat additionne les ventes au lieu de les retrancher.
 */

const assetFindFirst = vi.fn();
const assetUpdate = vi.fn();
const quoteDeleteMany = vi.fn();
const getHoldings = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      update: (...a: unknown[]) => assetUpdate(...a),
    },
    priceQuote: { deleteMany: (...a: unknown[]) => quoteDeleteMany(...a) },
  },
}));

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: vi.fn(),
}));

vi.mock("@/app/lib/portfolio/service", () => ({
  getHoldings: (...a: unknown[]) => getHoldings(...a),
}));

import {
  LifeInsuranceInputError,
  revalueSupport,
} from "@/app/lib/life-insurance/support-service";

/** La position telle que `getHoldings` la rend. */
const position = (quantity: string, assetId = "a1") => [
  { assetId, quantity },
];

/** Prix unitaire effectivement écrit. */
function writtenPrice(): string {
  return String(assetUpdate.mock.calls[0]![0].data.manualPrice);
}

beforeEach(() => {
  assetFindFirst.mockReset().mockResolvedValue({ id: "a1" });
  assetUpdate.mockReset().mockResolvedValue({});
  quoteDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  getHoldings.mockReset().mockResolvedValue(position("1"));
});

describe("revalueSupport", () => {
  it("divise l'encours par la quantité détenue", async () => {
    // 25 000 parts, encours 26 000 € → 1,04 € l'unité.
    getHoldings.mockResolvedValue(position("25000"));

    await revalueSupport("u1", "a1", "26000");

    expect(writtenPrice()).toBe("1.04");
  });

  it("écrit le montant tel quel pour une quantité de 1", async () => {
    await revalueSupport("u1", "a1", "9200");
    expect(writtenPrice()).toBe("9200");
  });

  it("gère une quantité fractionnaire", async () => {
    getHoldings.mockResolvedValue(position("0.5"));
    await revalueSupport("u1", "a1", "1000");
    expect(writtenPrice()).toBe("2000");
  });

  /*
    La mesure du chantier.

    Position de 1, rachat partiel de 0,4 saisi en VENTE. `createTransaction`
    exige une quantité positive pour une vente comme pour un achat, et
    `accounting/cump.ts` la retranche : la quantité détenue vaut 0,6 quand la
    somme brute des transactions vaut 1,4.

    L'ancien diviseur écrivait donc 10 000 / 1,4 = 7 142,86, et la position
    valait ensuite 0,6 × 7 142,86 = 4 285,71 € — pour un relevé à 10 000 €.
  */
  it("part de la quantité nette, pas de la somme des transactions", async () => {
    getHoldings.mockResolvedValue(position("0.6"));

    await revalueSupport("u1", "a1", "10000");

    // 10 000 / 0,6 — et non 10 000 / 1,4.
    expect(Number(writtenPrice())).toBeCloseTo(16_666.666667, 6);
    // Ce qui compte : quantité × prix retombe sur le relevé.
    expect(0.6 * Number(writtenPrice())).toBeCloseTo(10_000, 6);
  });

  /*
    Un SPLIT stocke son ratio dans `quantity` : l'agrégat l'additionnait comme
    une acquisition. La quantité détenue, elle, en tient compte correctement.
  */
  it("ne se laisse pas fausser par un ratio de SPLIT", async () => {
    getHoldings.mockResolvedValue(position("2"));
    await revalueSupport("u1", "a1", "10000");
    expect(writtenPrice()).toBe("5000");
  });

  it("ne lit que la position du support réévalué", async () => {
    getHoldings.mockResolvedValue([
      { assetId: "autre", quantity: "999" },
      { assetId: "a1", quantity: "4" },
    ]);
    await revalueSupport("u1", "a1", "10000");
    expect(writtenPrice()).toBe("2500");
  });

  it("purge le cache de cotation, qui primerait sur le prix saisi", async () => {
    await revalueSupport("u1", "a1", "9200");
    expect(quoteDeleteMany).toHaveBeenCalledWith({ where: { assetId: "a1" } });
  });

  it("refuse une position sans quantité plutôt que de diviser par zéro", async () => {
    getHoldings.mockResolvedValue(position("0"));

    await expect(revalueSupport("u1", "a1", "1000")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(assetUpdate).not.toHaveBeenCalled();
  });

  it("refuse un support absent des positions", async () => {
    getHoldings.mockResolvedValue([]);
    await expect(revalueSupport("u1", "a1", "1000")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(assetUpdate).not.toHaveBeenCalled();
  });

  it("refuse une valorisation négative", async () => {
    await expect(revalueSupport("u1", "a1", "-5")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(assetUpdate).not.toHaveBeenCalled();
  });

  it("refuse un montant illisible", async () => {
    await expect(revalueSupport("u1", "a1", "beaucoup")).rejects.toThrow(
      LifeInsuranceInputError
    );
  });

  it("accepte la virgule décimale", async () => {
    await revalueSupport("u1", "a1", "1234,56");
    expect(writtenPrice()).toBe("1234.56");
  });

  it("n'écrit rien si le support n'appartient pas à l'utilisateur", async () => {
    assetFindFirst.mockResolvedValue(null);
    await expect(revalueSupport("u1", "a1", "1000")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(assetUpdate).not.toHaveBeenCalled();
    expect(quoteDeleteMany).not.toHaveBeenCalled();
    // Et la position n'est même pas chargée : la propriété se vérifie d'abord.
    expect(getHoldings).not.toHaveBeenCalled();
  });

  it("filtre sur l'utilisateur et l'enveloppe AV", async () => {
    await revalueSupport("u1", "a1", "1000");
    expect(assetFindFirst.mock.calls[0]![0].where).toMatchObject({
      id: "a1",
      userId: "u1",
      accountType: "AV",
    });
  });
});
