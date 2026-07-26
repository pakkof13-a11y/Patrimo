import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * L'assurance-vie ne doit jamais entrer dans le cash explicite.
 *
 * Elle y entrait, et le patrimoine net comptait alors deux fois tout support
 * saisi à la fois dans la table AV et au journal. Ce test verrouille la règle :
 * `getExplicitCashTotalEur` additionne banques, livrets et poches d'enveloppe —
 * jamais l'AV, dont les supports sont des positions du journal.
 */

const bankFindMany = vi.fn();
const savingsFindMany = vi.fn();
const envelopeFindMany = vi.fn();
const lifeInsuranceFindMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    bankAccount: { findMany: (...a: unknown[]) => bankFindMany(...a) },
    savingsAccount: { findMany: (...a: unknown[]) => savingsFindMany(...a) },
    envelopeCash: { findMany: (...a: unknown[]) => envelopeFindMany(...a) },
    lifeInsurance: {
      findMany: (...a: unknown[]) => lifeInsuranceFindMany(...a),
    },
  },
}));

vi.mock("@/app/lib/market/fx", () => ({
  getEurRates: async () => ({ EUR: 1 }),
  convertToEurSync: (v: string) => v,
  convertFromEurSync: (v: string) => v,
}));

import { getExplicitCashTotalEur } from "@/app/lib/cash/pockets";

const dec = (v: string) => ({ toString: () => v });

beforeEach(() => {
  bankFindMany.mockReset().mockResolvedValue([]);
  savingsFindMany.mockReset().mockResolvedValue([]);
  envelopeFindMany.mockReset().mockResolvedValue([]);
  lifeInsuranceFindMany.mockReset().mockResolvedValue([]);
});

describe("getExplicitCashTotalEur", () => {
  it("additionne banques et poches d'enveloppe", async () => {
    bankFindMany.mockResolvedValue([
      { balance: dec("1000"), currency: "EUR", bankName: "BoursoBank" },
    ]);
    envelopeFindMany.mockResolvedValue([
      { balance: dec("250"), currency: "EUR", envelope: "CTO" },
    ]);

    const { totalEur } = await getExplicitCashTotalEur("u1");
    expect(totalEur.toString()).toBe("1250");
  });

  it("n'interroge même pas la table assurance-vie", async () => {
    // Le contrôle porte sur l'appel, pas seulement sur le total : tant que la
    // requête existe, un futur `total.plus(...)` peut réintroduire le bug sans
    // qu'aucun test ne le voie.
    await getExplicitCashTotalEur("u1");
    expect(lifeInsuranceFindMany).not.toHaveBeenCalled();
  });

  it("ignore l'assurance-vie même si la table en contient", async () => {
    bankFindMany.mockResolvedValue([
      { balance: dec("1000"), currency: "EUR", bankName: "BoursoBank" },
    ]);
    // Contrat richement rempli : rien de tout cela ne doit peser sur le cash.
    lifeInsuranceFindMany.mockResolvedValue([
      {
        cashEuro: dec("15200"),
        currency: "EUR",
        products: [
          { currentValue: dec("28500"), currency: "EUR" },
          { currentValue: dec("8400"), currency: "EUR" },
        ],
      },
    ]);

    const { totalEur } = await getExplicitCashTotalEur("u1");
    expect(totalEur.toString()).toBe("1000");
  });

  it("exclut les soldes négatifs ou nuls", async () => {
    bankFindMany.mockResolvedValue([
      { balance: dec("500"), currency: "EUR", bankName: "A" },
      { balance: dec("-200"), currency: "EUR", bankName: "B" },
      { balance: dec("0"), currency: "EUR", bankName: "C" },
    ]);
    const { totalEur } = await getExplicitCashTotalEur("u1");
    expect(totalEur.toString()).toBe("500");
  });
});
