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
const getEurRates = vi.fn();

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

/*
  Seul `getEurRates` est remplacé : la conversion reste celle de production.

  Elle est nécessaire depuis que la réévaluation convertit la saisie en euros
  vers la devise de l'actif — sans ce mock, un test unitaire appellerait le
  fournisseur de taux, et le relevé servi ne serait pas celui qu'il mesure.
*/
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return {
    ...actual,
    getEurRates: (...a: unknown[]) => getEurRates(...a),
  };
});

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

/** Le relevé de taux servi à l'écriture : 1 EUR = X devise. */
const RATES: Record<string, number> = { EUR: 1, USD: 1.08 };

beforeEach(() => {
  // `currency` est lu depuis l'actif, jamais depuis le contrat : c'est l'actif
  // qui porte la devise dans laquelle `manualPrice` sera relu.
  assetFindFirst.mockReset().mockResolvedValue({ id: "a1", currency: "EUR" });
  assetUpdate.mockReset().mockResolvedValue({});
  quoteDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  getHoldings.mockReset().mockResolvedValue(position("1"));
  getEurRates.mockReset().mockResolvedValue(RATES);
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

  /*
    L'unité du champ écrit.

    La saisie est en euros, `manualPrice` est un prix **dans la devise de
    l'actif** : `getHoldings` le convertit par `convertToEurSync(prix,
    asset.currency)`. Écrire l'euro tel quel sur un support en dollars
    sous-évaluait la position de 740,74 € pour 10 000 € de relevé — et la
    conversion s'applique **avant** la division par la quantité.
  */
  it("convertit le relevé dans la devise de l'actif", async () => {
    assetFindFirst.mockResolvedValue({ id: "a1", currency: "USD" });

    await revalueSupport("u1", "a1", "10000");

    // 10 000 € × 1,08, quantité 1.
    expect(writtenPrice()).toBe("10800");
  });

  it("convertit puis divise, dans cet ordre, après un rachat partiel", async () => {
    assetFindFirst.mockResolvedValue({ id: "a1", currency: "USD" });
    getHoldings.mockResolvedValue(position("0.6"));

    await revalueSupport("u1", "a1", "10000");

    // 10 800 USD pour 0,6 part → 18 000 USD la part.
    expect(writtenPrice()).toBe("18000");
    // Ce qui compte : quantité × prix, reconverti, retombe sur le relevé.
    expect((0.6 * Number(writtenPrice())) / 1.08).toBeCloseTo(10_000, 9);
  });

  /*
    Un seul relevé de taux par écriture.

    Le taux qui convertit la saisie et celui qui valorise les positions lues
    juste après doivent être le même objet. Deux appels de part et d'autre du
    TTL d'une heure divergent, et 0,1 % de mouvement EUR/USD vaut 10 € sur
    10 000 € — qui s'afficheraient en plus-value le jour de la saisie.
  */
  it("prête son relevé de taux à getHoldings", async () => {
    await revalueSupport("u1", "a1", "10000");

    expect(getEurRates).toHaveBeenCalledTimes(1);
    expect(getHoldings.mock.calls[0]).toEqual(["u1", "EUR", RATES]);
    // Identité, pas égalité structurelle : c'est bien le même objet.
    expect(getHoldings.mock.calls[0]![2]).toBe(RATES);
  });

  it("refuse une devise que rien ne fonde, avant même de lire les positions", async () => {
    // Hors des cinq devises couvertes : aucun taux ne fonde la conversion.
    assetFindFirst.mockResolvedValue({ id: "a1", currency: "SEK" });

    await expect(revalueSupport("u1", "a1", "10000")).rejects.toThrow(
      LifeInsuranceInputError
    );
    // Aucun prix écrit — et pas un centime de calcul de positions dépensé.
    expect(assetUpdate).not.toHaveBeenCalled();
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
