import { describe, expect, it } from "vitest";
import {
  ANNUAL_ALLOWANCE_COUPLE_EUR,
  ANNUAL_ALLOWANCE_SINGLE_EUR,
  SOCIAL_CHARGES_RATE,
} from "@/app/lib/life-insurance/fiscal";
import {
  computeRedemptionTax,
  gainsInPartialRedemption,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  PFU_REDUCED_RATE,
  PFU_STANDARD_RATE,
  type RedemptionTaxInput,
} from "@/app/lib/life-insurance/redemption-tax";

const n = (s: string) => Number(s);

function base(over: Partial<RedemptionTaxInput> = {}): RedemptionTaxInput {
  return {
    redemptionEur: "10000",
    gainsInRedemptionEur: "2000",
    hasAnteriority: true,
    premiumsBefore2017Eur: "50000",
    premiumsAfter2017Eur: "50000",
    totalOutstandingAllContractsEur: "100000",
    taxHousehold: "SINGLE",
    allowanceAlreadyUsedThisYearEur: 0,
    ...over,
  };
}

describe("computeRedemptionTax — rachat partiel = gains seulement", () => {
  it("n'impose jamais le montant brut retiré, seulement la quote-part de gains", () => {
    // Rachat 10 000 € dont 2 000 € de gains → capital 8 000 € intact.
    const r = computeRedemptionTax(
      base({
        redemptionEur: "10000",
        gainsInRedemptionEur: "2000",
        hasAnteriority: false, // 12,8 % sur les seuls gains
      })
    );
    expect(r.ok).toBe(true);
    expect(n(r.capitalInRedemptionEur)).toBe(8000);
    expect(n(r.gainsInRedemptionEur)).toBe(2000);

    // PS et IR se calculent sur 2 000, pas sur 10 000.
    expect(n(r.socialChargesEur)).toBeCloseTo(2000 * SOCIAL_CHARGES_RATE, 2);
    expect(n(r.socialChargesEur)).not.toBeCloseTo(10000 * SOCIAL_CHARGES_RATE, 2);
    expect(n(r.pfuTaxEur)).toBeCloseTo(2000 * PFU_STANDARD_RATE, 2);
    expect(n(r.pfuTaxEur)).not.toBeCloseTo(10000 * PFU_STANDARD_RATE, 2);

    // Net = brut − impôts sur gains uniquement.
    expect(n(r.netReceivedEur)).toBeCloseTo(
      10000 - n(r.socialChargesEur) - n(r.pfuTaxEur),
      2
    );
    // Le capital est intégralement dans le net (minoré seulement de l'impôt sur gains).
    expect(n(r.netReceivedEur)).toBeGreaterThan(8000 - 1);
  });

  it("refuse une quote-part de gains supérieure au rachat", () => {
    const r = computeRedemptionTax(
      base({ redemptionEur: "1000", gainsInRedemptionEur: "1001" })
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gains/i);
  });
});

describe("computeRedemptionTax — abattement non reportable", () => {
  it("n'ajoute pas le reliquat d'abattement N à l'enveloppe de N+1", () => {
    // Année N : petit rachat qui ne consomme que 1 000 € d'abattement.
    const yearN = computeRedemptionTax(
      base({
        redemptionEur: "5000",
        gainsInRedemptionEur: "1000",
        hasAnteriority: true,
        taxHousehold: "SINGLE",
        allowanceAlreadyUsedThisYearEur: 0,
        // Encours bas + tout en pré-2017 pour isoler l'abattement.
        premiumsBefore2017Eur: "100000",
        premiumsAfter2017Eur: "0",
        totalOutstandingAllContractsEur: "80000",
      })
    );
    expect(yearN.ok).toBe(true);
    expect(n(yearN.allowanceAppliedEur)).toBe(1000);
    expect(n(yearN.allowanceRemainingThisYearEur)).toBe(
      ANNUAL_ALLOWANCE_SINGLE_EUR - 1000
    );
    // Gains entièrement absorbés par l'abattement → pas d'IR.
    expect(n(yearN.taxableGainsEur)).toBe(0);
    expect(n(yearN.pfuTaxEur)).toBe(0);

    // Année N+1 : l'appelant repart de 0 — il ne doit PAS réinjecter le
    // reliquat 3 600 € comme crédit supplémentaire. L'enveloppe reste 4 600 €.
    const yearN1 = computeRedemptionTax(
      base({
        redemptionEur: "20000",
        gainsInRedemptionEur: "10000",
        hasAnteriority: true,
        taxHousehold: "SINGLE",
        allowanceAlreadyUsedThisYearEur: 0, // nouvelle année
        premiumsBefore2017Eur: "100000",
        premiumsAfter2017Eur: "0",
        totalOutstandingAllContractsEur: "80000",
      })
    );
    expect(yearN1.ok).toBe(true);
    expect(n(yearN1.allowanceAppliedEur)).toBe(ANNUAL_ALLOWANCE_SINGLE_EUR);
    // Si on reportait le reliquat N, l'abattement appliqué serait 4 600+3 600=8 200.
    expect(n(yearN1.allowanceAppliedEur)).toBeLessThan(
      ANNUAL_ALLOWANCE_SINGLE_EUR + (ANNUAL_ALLOWANCE_SINGLE_EUR - 1000)
    );
    expect(n(yearN1.taxableGainsEur)).toBe(
      10000 - ANNUAL_ALLOWANCE_SINGLE_EUR
    );
  });

  it("cumule l'abattement déjà consommé dans la même année uniquement", () => {
    const secondSameYear = computeRedemptionTax(
      base({
        redemptionEur: "10000",
        gainsInRedemptionEur: "5000",
        hasAnteriority: true,
        taxHousehold: "SINGLE",
        // 3 000 € déjà utilisés plus tôt dans l'année → reste 1 600 €.
        allowanceAlreadyUsedThisYearEur: 3000,
        premiumsBefore2017Eur: "100000",
        premiumsAfter2017Eur: "0",
        totalOutstandingAllContractsEur: "50000",
      })
    );
    expect(secondSameYear.ok).toBe(true);
    expect(n(secondSameYear.allowanceAppliedEur)).toBe(1600);
    expect(n(secondSameYear.taxableGainsEur)).toBe(3400);
  });

  it("double l'abattement pour un couple sans le reporter", () => {
    const r = computeRedemptionTax(
      base({
        gainsInRedemptionEur: "9200",
        redemptionEur: "9200",
        hasAnteriority: true,
        taxHousehold: "COUPLE",
        premiumsBefore2017Eur: "100000",
        premiumsAfter2017Eur: "0",
        totalOutstandingAllContractsEur: "50000",
      })
    );
    expect(n(r.allowanceAppliedEur)).toBe(ANNUAL_ALLOWANCE_COUPLE_EUR);
    expect(n(r.taxableGainsEur)).toBe(0);
  });
});

describe("computeRedemptionTax — sans antériorité de 8 ans", () => {
  it("n'applique aucun abattement et taxe 12,8 % sur la totalité des gains", () => {
    const r = computeRedemptionTax(
      base({
        redemptionEur: "20000",
        gainsInRedemptionEur: "8000",
        hasAnteriority: false,
        // Même avec versements 100 % pré-2017 et encours sous 150 k€,
        // le taux réduit et l'abattement restent fermés.
        premiumsBefore2017Eur: "200000",
        premiumsAfter2017Eur: "0",
        totalOutstandingAllContractsEur: "50000",
        taxHousehold: "COUPLE",
      })
    );
    expect(r.ok).toBe(true);
    expect(n(r.allowanceAppliedEur)).toBe(0);
    expect(n(r.taxableGainsEur)).toBe(8000);
    expect(n(r.pfuStandardBaseEur)).toBe(8000);
    expect(n(r.pfuReducedBaseEur)).toBe(0);
    expect(n(r.pfuTaxEur)).toBeCloseTo(8000 * PFU_STANDARD_RATE, 2);
    // PS toujours dus sur les gains.
    expect(n(r.socialChargesEur)).toBeCloseTo(8000 * SOCIAL_CHARGES_RATE, 2);
  });

  it("reste à 12,8 % même si l'encours est sous le seuil de 150 000 €", () => {
    const r = computeRedemptionTax(
      base({
        hasAnteriority: false,
        gainsInRedemptionEur: "1000",
        redemptionEur: "1000",
        totalOutstandingAllContractsEur: "1",
        premiumsBefore2017Eur: "1",
        premiumsAfter2017Eur: "0",
      })
    );
    expect(n(r.pfuTaxEur)).toBeCloseTo(1000 * PFU_STANDARD_RATE, 2);
    expect(n(r.pfuTaxEur)).not.toBeCloseTo(1000 * PFU_REDUCED_RATE, 2);
  });
});

describe("computeRedemptionTax — après 8 ans, taux selon versements / encours", () => {
  it("applique 7,5 % sur les gains imposables quand encours ≤ 150 k€", () => {
    const gains = 10_000;
    const r = computeRedemptionTax(
      base({
        redemptionEur: String(gains),
        gainsInRedemptionEur: String(gains),
        hasAnteriority: true,
        taxHousehold: "SINGLE",
        premiumsBefore2017Eur: "0",
        premiumsAfter2017Eur: "100000",
        totalOutstandingAllContractsEur: PFU_OUTSTANDING_THRESHOLD_EUR,
      })
    );
    const taxable = gains - ANNUAL_ALLOWANCE_SINGLE_EUR;
    expect(n(r.taxableGainsEur)).toBe(taxable);
    expect(n(r.pfuReducedBaseEur)).toBe(taxable);
    expect(n(r.pfuStandardBaseEur)).toBe(0);
    expect(n(r.pfuTaxEur)).toBeCloseTo(taxable * PFU_REDUCED_RATE, 2);
  });

  it("mixe 7,5 % (pré-2017) et 12,8 % (post-2017) au-delà de 150 k€ d'encours", () => {
    const gains = 10_000;
    const r = computeRedemptionTax(
      base({
        redemptionEur: String(gains),
        gainsInRedemptionEur: String(gains),
        hasAnteriority: true,
        taxHousehold: "SINGLE",
        // 40 % pré / 60 % post
        premiumsBefore2017Eur: "40000",
        premiumsAfter2017Eur: "60000",
        totalOutstandingAllContractsEur: PFU_OUTSTANDING_THRESHOLD_EUR + 1,
      })
    );
    const taxable = gains - ANNUAL_ALLOWANCE_SINGLE_EUR;
    expect(n(r.taxableGainsEur)).toBe(taxable);
    expect(n(r.pfuReducedBaseEur)).toBeCloseTo(taxable * 0.4, 2);
    expect(n(r.pfuStandardBaseEur)).toBeCloseTo(taxable * 0.6, 2);
    const expectedTax =
      taxable * 0.4 * PFU_REDUCED_RATE + taxable * 0.6 * PFU_STANDARD_RATE;
    expect(n(r.pfuTaxEur)).toBeCloseTo(expectedTax, 2);
  });
});

describe("gainsInPartialRedemption", () => {
  it("proportionne les gains au rachat partiel (pas le gain global)", () => {
    // Position 100 k€, PR 80 k€ → 20 % de gains. Rachat 10 k€ → 2 k€ de gains.
    const r = gainsInPartialRedemption({
      redemptionEur: "10000",
      positionValueEur: "100000",
      costBasisEur: "80000",
    });
    expect(r.ok).toBe(true);
    expect(n(r.gainsInRedemptionEur)).toBeCloseTo(2000, 2);
    expect(n(r.capitalInRedemptionEur)).toBeCloseTo(8000, 2);
    expect(r.gainRatio).toBeCloseTo(0.2, 8);
  });

  it("sur un rachat total, reprend tout le gain latent", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "100000",
      positionValueEur: "100000",
      costBasisEur: "80000",
    });
    expect(n(r.gainsInRedemptionEur)).toBeCloseTo(20000, 2);
  });

  it("n'invente pas de gains en moins-value latente", () => {
    const r = gainsInPartialRedemption({
      redemptionEur: "5000",
      positionValueEur: "8000",
      costBasisEur: "10000",
    });
    expect(n(r.gainsInRedemptionEur)).toBe(0);
    expect(n(r.capitalInRedemptionEur)).toBeCloseTo(5000, 2);
  });
});

describe("computeRedemptionTax — invariants de sortie", () => {
  it("garantit net = rachat − IR − PS", () => {
    const r = computeRedemptionTax(base({ hasAnteriority: true }));
    expect(r.ok).toBe(true);
    expect(n(r.netReceivedEur)).toBeCloseTo(
      n(r.redemptionEur) - n(r.pfuTaxEur) - n(r.socialChargesEur),
      2
    );
    expect(n(r.totalTaxEur)).toBeCloseTo(
      n(r.pfuTaxEur) + n(r.socialChargesEur),
      2
    );
  });

  it("rend capital + gains = rachat", () => {
    const r = computeRedemptionTax(
      base({ redemptionEur: "12345.67", gainsInRedemptionEur: "2345.67" })
    );
    expect(n(r.capitalInRedemptionEur) + n(r.gainsInRedemptionEur)).toBeCloseTo(
      n(r.redemptionEur),
      2
    );
  });
});
