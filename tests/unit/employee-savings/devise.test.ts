import { describe, expect, it, vi } from "vitest";

/**
 * La devise d'un FCPE était lue, affichée, et jamais appliquée.
 *
 * `mapLine` rendait `marketValue = parts × VL` sans conversion, puis
 * `summarizeLines` additionnait ces valeurs comme des euros : un support
 * libellé en francs suisses entrait dans l'encours pour son nombre. La liste
 * affichait bien « 10 000,00 CHF » à côté d'un total de « 10 000,00 € ».
 *
 * La conversion est celle du reste du dépôt — `convertToEurSync(mv,
 * r.currency)`, comme `getEmployeeSavingsTotalsEur` dans `portfolio/service`.
 */

const findMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    employeeSavingsLine: {
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

/** 0,94 CHF pour un euro. */
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1, CHF: 0.94 }) };
});

const { listEmployeeSavings } = await import(
  "@/app/lib/employee-savings/service"
);
const { Prisma } = await import("@/app/lib/prisma-client/client");

function ligne(currency: string, units: string, nav: string, id = "l1") {
  return {
    id,
    planType: "PEE",
    manager: "Amundi",
    fundName: "FCPE Monde",
    isin: null,
    units: new Prisma.Decimal(units),
    nav: new Prisma.Decimal(nav),
    currency,
    sourceType: "PARTICIPATION",
    contributionDate: null,
    contributedAmount: null,
    fundCategory: null,
    unlockDate: null,
    unlockMode: "RETIREMENT",
    notes: null,
  };
}

describe("épargne salariale en devise", () => {
  it("publie la valeur du support et sa contre-valeur en euros", async () => {
    findMany.mockResolvedValue([ligne("CHF", "100", "100")]);
    const { lines } = await listEmployeeSavings("u1");
    expect(lines[0]!.marketValue).toBe("10000.00");
    // 10 000 / 0,94 = 10 638,30 €
    expect(lines[0]!.marketValueEur).toBe("10638.30");
  });

  it("laisse une ligne en euros identique sur les deux champs", async () => {
    findMany.mockResolvedValue([ligne("EUR", "100", "100")]);
    const { lines } = await listEmployeeSavings("u1");
    expect(lines[0]!.marketValue).toBe("10000.00");
    expect(lines[0]!.marketValueEur).toBe("10000.00");
  });

  it("n'additionne que les euros dans le total du plan", async () => {
    findMany.mockResolvedValue([
      ligne("EUR", "100", "100"),
      ligne("CHF", "100", "100", "l2"),
    ]);
    const { summary } = await listEmployeeSavings("u1");
    // 10 000 € + 10 638,30 € — et non 20 000 comme avant.
    expect(Number(summary.totalValue)).toBeCloseTo(20638.3, 2);
  });
});
