import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getAlternativesPortfolioSlice` doit peser le crowdlending sur
 * `effectiveRemainingCapital`, pas sur `capitalInvested` : un prêt
 * partiellement remboursé ne doit pas compter son capital initial en entier
 * dans le patrimoine net une fois qu'une partie a été remboursée.
 */

const metalFindMany = vi.fn();
const peFindMany = vi.fn();
const clFindMany = vi.fn();
const tangibleFindMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
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

import { getAlternativesPortfolioSlice } from "@/app/lib/alternatives/portfolio";
import { Prisma } from "@/app/lib/prisma-client/client";

beforeEach(() => {
  metalFindMany.mockReset().mockResolvedValue([]);
  peFindMany.mockReset().mockResolvedValue([]);
  clFindMany.mockReset().mockResolvedValue([]);
  tangibleFindMany.mockReset().mockResolvedValue([]);
});

describe("getAlternativesPortfolioSlice — crowdlending pèse l'encours restant", () => {
  it("un prêt à 10 000 investis / 6 000 restants pèse 6 000, pas 10 000", async () => {
    clFindMany.mockResolvedValue([
      {
        capitalInvested: new Prisma.Decimal(10000),
        remainingCapital: new Prisma.Decimal(6000),
        currency: "EUR",
        status: "ACTIVE",
      },
    ]);
    const slice = await getAlternativesPortfolioSlice("u1");
    expect(slice.crowdlendingEur).toBe(6000);
    expect(slice.totalEur).toBe(6000);
  });

  it("sans remainingCapital saisi (0 par défaut), replie sur capitalInvested", async () => {
    clFindMany.mockResolvedValue([
      {
        capitalInvested: new Prisma.Decimal(10000),
        remainingCapital: new Prisma.Decimal(0),
        currency: "EUR",
        status: "ACTIVE",
      },
    ]);
    const slice = await getAlternativesPortfolioSlice("u1");
    expect(slice.crowdlendingEur).toBe(10000);
  });
});
