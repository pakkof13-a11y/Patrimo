import { describe, expect, it } from "vitest";
import {
  computeIfi,
  ifiDiscount,
  ifiScaleTax,
  IFI_THRESHOLD,
} from "@/app/lib/real-estate/tax/ifi";
import { d } from "@/app/lib/money/decimal";

describe("ifiScaleTax", () => {
  it("est nul jusqu'à 800 000 €", () => {
    expect(ifiScaleTax(d(800_000)).toNumber()).toBe(0);
  });

  it("taxe la tranche 800 k–1,3 M à 0,5 %", () => {
    // (1 300 000 − 800 000) × 0,5 % = 2 500
    expect(ifiScaleTax(d(1_300_000)).toNumber()).toBeCloseTo(2_500, 6);
  });

  it("empile correctement les tranches suivantes", () => {
    // 2 500 + (2 000 000 − 1 300 000) × 0,7 % = 2 500 + 4 900 = 7 400
    expect(ifiScaleTax(d(2_000_000)).toNumber()).toBeCloseTo(7_400, 6);
  });

  it("applique la tranche à 1 % au-delà de 2,57 M", () => {
    // 2 500 + (2 570 000 − 1 300 000) × 0,7 % = 2 500 + 8 890 = 11 390
    // + (3 000 000 − 2 570 000) × 1 % = 4 300 → 15 690
    expect(ifiScaleTax(d(3_000_000)).toNumber()).toBeCloseTo(15_690, 6);
  });

  it("applique la tranche marginale à 1,5 % au-delà de 10 M", () => {
    // 2 500 + 8 890 + 24 300 (2,57→5 M à 1 %) = 35 690
    // + (10 000 000 − 5 000 000) × 1,25 % = 62 500 → 98 190
    // + (12 000 000 − 10 000 000) × 1,5 % = 30 000 → 128 190
    expect(ifiScaleTax(d(12_000_000)).toNumber()).toBeCloseTo(128_190, 6);
  });
});

describe("ifiDiscount", () => {
  it("ne s'applique pas sous le seuil", () => {
    expect(ifiDiscount(d(1_200_000), d(0)).toNumber()).toBe(0);
  });

  it("ne s'applique plus au-delà de 1,4 M", () => {
    expect(ifiDiscount(d(1_400_000), d(3_200)).toNumber()).toBe(0);
  });

  it("lisse l'effet de seuil juste au-dessus de 1,3 M", () => {
    // 17 500 − 1,25 % × 1 300 000 = 17 500 − 16 250 = 1 250
    const gross = ifiScaleTax(d(1_300_000));
    expect(ifiDiscount(d(1_300_000), gross).toNumber()).toBeCloseTo(1_250, 6);
  });

  it("ne dépasse jamais l'impôt brut", () => {
    const gross = ifiScaleTax(d(1_300_000));
    const discount = ifiDiscount(d(1_300_000), gross);
    expect(discount.lte(gross)).toBe(true);
  });
});

describe("computeIfi", () => {
  it("n'impose pas un patrimoine sous le seuil", () => {
    const r = computeIfi([
      { id: "a", label: "Appartement", grossValueEur: 900_000 },
    ]);
    expect(r.liable).toBe(false);
    expect(r.taxEur.toNumber()).toBe(0);
    expect(r.netTaxableEur.toNumber()).toBe(900_000);
  });

  it("applique l'abattement de 30 % sur la résidence principale", () => {
    const r = computeIfi([
      {
        id: "rp",
        label: "Résidence principale",
        grossValueEur: 1_000_000,
        isPrimaryResidence: true,
      },
    ]);
    expect(r.lines[0]!.allowanceEur.toNumber()).toBe(300_000);
    expect(r.netTaxableEur.toNumber()).toBe(700_000);
    expect(r.liable).toBe(false);
  });

  it("déduit les dettes rattachées aux actifs imposables", () => {
    const r = computeIfi([
      {
        id: "loc",
        label: "Locatif",
        grossValueEur: 2_000_000,
        deductibleDebtEur: 800_000,
      },
    ]);
    expect(r.totalDeductibleDebtEur.toNumber()).toBe(800_000);
    expect(r.netTaxableEur.toNumber()).toBe(1_200_000);
    expect(r.liable).toBe(false); // repasse sous le seuil grâce au crédit
  });

  it("exclut du calcul un bien marqué exclu", () => {
    const r = computeIfi([
      { id: "a", label: "Taxable", grossValueEur: 1_500_000 },
      {
        id: "b",
        label: "Bien professionnel",
        grossValueEur: 2_000_000,
        excluded: true,
      },
    ]);
    expect(r.netTaxableEur.toNumber()).toBe(1_500_000);
    expect(r.lines[1]!.taxableValueEur.toNumber()).toBe(0);
  });

  it("ne retient que la quote-part immobilière des parts de société", () => {
    // 100 000 € de parts de SCPI dont 60 % représentatifs d'immobilier.
    const r = computeIfi([
      {
        id: "scpi",
        label: "SCPI",
        grossValueEur: 100_000,
        realEstateSharePct: 60,
      },
    ]);
    expect(r.netTaxableEur.toNumber()).toBe(60_000);
  });

  it("franchit le seuil et taxe alors depuis 800 k€", () => {
    // Le contribuable devient redevable à 1,3 M mais le barème part de 800 k :
    // l'impôt ne démarre pas à zéro, il démarre à 2 500 € moins la décote.
    const r = computeIfi([
      { id: "a", label: "Parc", grossValueEur: 1_300_000 },
    ]);
    expect(r.liable).toBe(true);
    expect(r.grossTaxEur.toNumber()).toBeCloseTo(2_500, 6);
    expect(r.discountEur.toNumber()).toBeCloseTo(1_250, 6);
    expect(r.taxEur.toNumber()).toBeCloseTo(1_250, 6);
  });

  it("rend la marche au seuil supportable grâce à la décote", () => {
    // Sans décote, passer de 1 299 999 € à 1 300 000 € coûterait 2 500 €.
    const under = computeIfi([{ id: "a", label: "x", grossValueEur: 1_299_999 }]);
    const over = computeIfi([{ id: "a", label: "x", grossValueEur: 1_300_000 }]);
    expect(under.taxEur.toNumber()).toBe(0);
    expect(over.taxEur.toNumber()).toBeLessThan(1_500);
  });

  it("ne rend jamais l'assiette négative", () => {
    const r = computeIfi([
      {
        id: "a",
        label: "Sur-endetté",
        grossValueEur: 300_000,
        deductibleDebtEur: 500_000,
      },
    ]);
    expect(r.netTaxableEur.toNumber()).toBe(0);
    expect(r.taxEur.toNumber()).toBe(0);
  });

  it("agrège un patrimoine réaliste multi-biens", () => {
    const r = computeIfi([
      {
        id: "rp",
        label: "RP",
        grossValueEur: 1_200_000,
        isPrimaryResidence: true,
        deductibleDebtEur: 200_000,
      },
      { id: "l1", label: "Locatif 1", grossValueEur: 450_000, deductibleDebtEur: 150_000 },
      { id: "scpi", label: "SCPI", grossValueEur: 200_000, realEstateSharePct: 100 },
    ]);
    // RP : 1 200 000 − 30 % = 840 000
    // Total taxable = 840 000 + 450 000 + 200 000 = 1 490 000
    // Dettes = 350 000 → assiette nette 1 140 000 → sous le seuil
    expect(r.grossTaxableEur.toNumber()).toBeCloseTo(1_490_000, 6);
    expect(r.netTaxableEur.toNumber()).toBeCloseTo(1_140_000, 6);
    expect(r.liable).toBe(false);
  });

  it("expose un taux effectif cohérent", () => {
    const r = computeIfi([{ id: "a", label: "x", grossValueEur: 3_000_000 }]);
    expect(r.liable).toBe(true);
    const expected = r.taxEur.div(r.netTaxableEur).times(100);
    expect(r.effectiveRatePct.toNumber()).toBeCloseTo(expected.toNumber(), 10);
  });

  it("expose le seuil légal", () => {
    expect(IFI_THRESHOLD.toNumber()).toBe(1_300_000);
  });
});
