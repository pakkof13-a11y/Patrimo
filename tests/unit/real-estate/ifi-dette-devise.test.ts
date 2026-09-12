import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Une dette en devise pèse sur l'IFI pour sa contre-valeur en euros.
 *
 * `loadPropertyTaxRows` sélectionnait le solde du crédit sans sa devise, et
 * sommait `remainingAmountAt(l)` tel quel dans `debtEur`. Un prêt de 400 000
 * francs suisses se déduisait donc de l'assiette pour 400 000 €, soit environ
 * 25 000 € de dette inventée — au bénéfice du contribuable, ce qui ne la rend
 * pas plus vraie.
 *
 * La conversion est celle du donut (`allocation-by-venue.ts` :
 * `eur(remainingAmountAt(l), l.currency)`), pas une seconde formule.
 */

const realEstateDetailFindMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    realEstateDetail: {
      findMany: (...a: unknown[]) => realEstateDetailFindMany(...a),
    },
    indirectRealEstateDetail: { findMany: async () => [] },
  },
}));

vi.mock("@/app/lib/portfolio/service", () => ({
  getHoldings: async () => [
    { assetId: "a1", marketValueEur: "1000000", costBasisEur: "800000", quantity: "1" },
  ],
}));

/** 0,94 CHF pour un euro — 400 000 CHF valent donc ~425 532 €. */
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1, CHF: 0.94 }) };
});

import { loadPropertyTaxRows } from "@/app/lib/real-estate/tax/service";

function bien(currency: string) {
  return {
    assetId: "a1",
    propertyType: "APPARTEMENT",
    usage: "LOCATIF_NU",
    monthlyRentEur: null,
    monthlyChargesEur: null,
    annualPropertyTaxEur: null,
    rentalRegime: null,
    taxScheme: null,
    commitmentEndDate: null,
    isClassifiedTourism: false,
    schemeStartYear: null,
    schemeCommitmentYears: null,
    schemeBaseEur: null,
    schemeRatePct: null,
    livingAreaM2: null,
    asset: {
      id: "a1",
      name: "Chalet",
      manualPrice: null,
      acquisitionDate: null,
      liabilities: [
        {
          // Aucune mensualité : le capital restant dû est celui qui est stocké,
          // la projection n'a rien à amortir.
          remainingAmount: "400000",
          monthlyPayment: null,
          paymentDay: null,
          startDate: null,
          endDate: null,
          lastPaymentAppliedAt: null,
          currency,
        },
      ],
    },
  };
}

beforeEach(() => {
  realEstateDetailFindMany.mockReset().mockResolvedValue([]);
});

describe("dette immobilière en devise étrangère", () => {
  it("convertit 400 000 CHF en euros avant de les déduire", async () => {
    realEstateDetailFindMany.mockResolvedValue([bien("CHF")]);
    const [row] = await loadPropertyTaxRows("u1");
    // 400 000 / 0,94 = 425 531,91 € — et non 400 000 € à parité.
    expect(row!.debtEur).toBe("425531.91");
  });

  it("laisse une dette en euros inchangée", async () => {
    realEstateDetailFindMany.mockResolvedValue([bien("EUR")]);
    const [row] = await loadPropertyTaxRows("u1");
    expect(row!.debtEur).toBe("400000.00");
  });
});
