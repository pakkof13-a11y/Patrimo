import { describe, expect, it } from "vitest";
import {
  computeCapitalGain,
  holdingYearsBetween,
  irAbatementRate,
  socialAbatementRate,
  surtaxRate,
} from "@/app/lib/real-estate/tax/capital-gain";
import { d } from "@/app/lib/money/decimal";

describe("holdingYearsBetween", () => {
  it("compte de date à date et non par millésime", () => {
    // Piège classique : 2022 − 2000 = 22, mais l'anniversaire n'est pas atteint.
    expect(
      holdingYearsBetween(new Date("2000-12-31"), new Date("2022-01-01"))
    ).toBe(21);
  });

  it("compte l'année pleine le jour de l'anniversaire", () => {
    expect(
      holdingYearsBetween(new Date("2000-06-15"), new Date("2022-06-15"))
    ).toBe(22);
  });

  it("ne descend pas sous zéro pour une date de vente antérieure", () => {
    expect(
      holdingYearsBetween(new Date("2020-01-01"), new Date("2019-01-01"))
    ).toBe(0);
  });
});

describe("irAbatementRate", () => {
  it("est nul pendant les cinq premières années", () => {
    expect(irAbatementRate(0).toNumber()).toBe(0);
    expect(irAbatementRate(5).toNumber()).toBe(0);
  });

  it("progresse de 6 % par an de la 6e à la 21e année", () => {
    expect(irAbatementRate(6).toNumber()).toBeCloseTo(0.06, 10);
    expect(irAbatementRate(10).toNumber()).toBeCloseTo(0.3, 10);
    expect(irAbatementRate(21).toNumber()).toBeCloseTo(0.96, 10);
  });

  it("atteint l'exonération totale à 22 ans", () => {
    expect(irAbatementRate(22).toNumber()).toBe(1);
    expect(irAbatementRate(40).toNumber()).toBe(1);
  });
});

describe("socialAbatementRate", () => {
  it("est nul pendant les cinq premières années", () => {
    expect(socialAbatementRate(5).toNumber()).toBe(0);
  });

  it("progresse de 1,65 % par an de la 6e à la 21e année", () => {
    expect(socialAbatementRate(6).toNumber()).toBeCloseTo(0.0165, 10);
    expect(socialAbatementRate(21).toNumber()).toBeCloseTo(0.264, 10);
  });

  it("ajoute 1,60 % la 22e année", () => {
    expect(socialAbatementRate(22).toNumber()).toBeCloseTo(0.28, 10);
  });

  it("progresse de 9 % par an de la 23e à la 30e", () => {
    expect(socialAbatementRate(23).toNumber()).toBeCloseTo(0.37, 10);
    expect(socialAbatementRate(29).toNumber()).toBeCloseTo(0.91, 10);
  });

  it("atteint l'exonération totale à 30 ans", () => {
    expect(socialAbatementRate(30).toNumber()).toBe(1);
    expect(socialAbatementRate(35).toNumber()).toBe(1);
  });

  it("reste imposable aux PS à 22 ans alors que l'IR est déjà exonéré", () => {
    // C'est précisément l'écart entre les deux barèmes : un barème unique
    // annoncerait à tort une cession totalement exonérée à 22 ans.
    expect(irAbatementRate(22).toNumber()).toBe(1);
    expect(socialAbatementRate(22).toNumber()).toBeLessThan(1);
  });
});

describe("computeCapitalGain", () => {
  it("exonère totalement la résidence principale", () => {
    const r = computeCapitalGain({
      salePriceEur: 500_000,
      purchasePriceEur: 200_000,
      purchaseDate: new Date("2020-01-01"),
      saleDate: new Date("2026-01-01"),
      isPrimaryResidence: true,
    });
    expect(r.exempt).toBe(true);
    expect(r.exemptionReason).toBe("PRIMARY_RESIDENCE");
    expect(r.totalTaxEur.toNumber()).toBe(0);
    expect(r.netProceedsEur.toNumber()).toBe(500_000);
  });

  it("calcule une cession avant tout abattement (détention < 6 ans)", () => {
    // PV = 300 000 − (200 000 + 15 000 frais) = 85 000, aucun abattement.
    // IR  = 85 000 × 19 %   = 16 150
    // PS  = 85 000 × 17,2 % = 14 620
    // Surtaxe : 85 000 > 50 000 → tranche 2 % = 1 700
    const r = computeCapitalGain({
      salePriceEur: 300_000,
      purchasePriceEur: 200_000,
      acquisitionFeesEur: 15_000,
      purchaseDate: new Date("2022-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    expect(r.holdingYears).toBe(4);
    expect(r.grossGainEur.toNumber()).toBe(85_000);
    expect(r.irTaxEur.toNumber()).toBeCloseTo(16_150, 6);
    expect(r.socialTaxEur.toNumber()).toBeCloseTo(14_620, 6);
    expect(r.surtaxEur.toNumber()).toBeCloseTo(1_700, 6);
    expect(r.totalTaxEur.toNumber()).toBeCloseTo(32_470, 6);
  });

  it("applique le forfait de 7,5 % de frais d'acquisition", () => {
    const r = computeCapitalGain({
      salePriceEur: 300_000,
      purchasePriceEur: 200_000,
      useFlatAcquisitionFees: true,
      purchaseDate: new Date("2022-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    // 200 000 × 7,5 % = 15 000 → prix majoré 215 000
    expect(r.adjustedPurchasePriceEur.toNumber()).toBe(215_000);
    expect(r.grossGainEur.toNumber()).toBe(85_000);
  });

  it("refuse le forfait travaux avant 5 ans de détention", () => {
    const r = computeCapitalGain({
      salePriceEur: 300_000,
      purchasePriceEur: 200_000,
      useFlatWorks: true,
      purchaseDate: new Date("2023-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    // 3 ans : pas de forfait travaux, prix majoré = prix d'achat.
    expect(r.adjustedPurchasePriceEur.toNumber()).toBe(200_000);
  });

  it("accorde le forfait travaux de 15 % au-delà de 5 ans", () => {
    const r = computeCapitalGain({
      salePriceEur: 400_000,
      purchasePriceEur: 200_000,
      useFlatWorks: true,
      purchaseDate: new Date("2015-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    // 200 000 × 15 % = 30 000
    expect(r.adjustedPurchasePriceEur.toNumber()).toBe(230_000);
  });

  it("exonère l'IR mais pas les PS à 22 ans de détention", () => {
    const r = computeCapitalGain({
      salePriceEur: 300_000,
      purchasePriceEur: 200_000,
      purchaseDate: new Date("2004-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    expect(r.holdingYears).toBe(22);
    expect(r.irTaxEur.toNumber()).toBe(0);
    // PS : abattement 28 % → assiette 72 000 × 17,2 % = 12 384
    expect(r.taxableGainSocialEur.toNumber()).toBeCloseTo(72_000, 6);
    expect(r.socialTaxEur.toNumber()).toBeCloseTo(12_384, 6);
    expect(r.exempt).toBe(false);
  });

  it("exonère totalement au-delà de 30 ans", () => {
    const r = computeCapitalGain({
      salePriceEur: 500_000,
      purchasePriceEur: 100_000,
      purchaseDate: new Date("1990-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    expect(r.exempt).toBe(true);
    expect(r.exemptionReason).toBe("HOLDING_PERIOD");
    expect(r.totalTaxEur.toNumber()).toBe(0);
  });

  it("ne produit pas d'impôt négatif sur une moins-value", () => {
    const r = computeCapitalGain({
      salePriceEur: 150_000,
      purchasePriceEur: 200_000,
      purchaseDate: new Date("2020-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    expect(r.grossGainEur.toNumber()).toBeLessThan(0);
    expect(r.totalTaxEur.toNumber()).toBe(0);
    expect(r.taxableGainIrEur.toNumber()).toBe(0);
  });

  it("proratise le résultat sur la quote-part détenue", () => {
    const full = computeCapitalGain({
      salePriceEur: 300_000,
      purchasePriceEur: 200_000,
      purchaseDate: new Date("2022-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    const half = computeCapitalGain({
      salePriceEur: 300_000,
      purchasePriceEur: 200_000,
      purchaseDate: new Date("2022-01-01"),
      saleDate: new Date("2026-01-01"),
      ownershipPct: 50,
    });
    expect(half.totalTaxEur.toNumber()).toBeCloseTo(
      full.totalTaxEur.div(2).toNumber(),
      6
    );
    expect(half.grossGainEur.toNumber()).toBeCloseTo(50_000, 6);
  });

  it("déduit les frais de cession de l'assiette", () => {
    const r = computeCapitalGain({
      salePriceEur: 300_000,
      saleCostsEur: 5_000,
      purchasePriceEur: 200_000,
      purchaseDate: new Date("2022-01-01"),
      saleDate: new Date("2026-01-01"),
    });
    expect(r.netSalePriceEur.toNumber()).toBe(295_000);
    expect(r.grossGainEur.toNumber()).toBe(95_000);
  });
});

describe("surtaxRate", () => {
  it("ne s'applique pas jusqu'à 50 000 €", () => {
    expect(surtaxRate(d(50_000)).toNumber()).toBe(0);
  });

  it("suit le barème par tranches au-delà", () => {
    expect(surtaxRate(d(60_000)).toNumber()).toBeCloseTo(0.02, 10);
    expect(surtaxRate(d(120_000)).toNumber()).toBeCloseTo(0.03, 10);
    expect(surtaxRate(d(300_000)).toNumber()).toBeCloseTo(0.06, 10);
  });
});
