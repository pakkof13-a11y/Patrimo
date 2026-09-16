import { describe, expect, it } from "vitest";
import { computeCapitalGain } from "@/app/lib/real-estate/tax/capital-gain";
import {
  parseAmountInput,
  simulateCapitalGain,
} from "@/app/lib/real-estate/tax/simulation-input";

/**
 * Bien de démonstration du simulateur : prix de revient 477 600 €, acquis il y
 * a moins de six ans (aucun abattement pour durée de détention).
 */
const DEMO = {
  purchasePriceEur: "477600",
  purchaseDate: "2023-01-15",
  saleDate: new Date("2026-09-15"),
};

describe("parseAmountInput", () => {
  it("rend null sur une saisie absente ou vide — et non zéro", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("   ")).toBeNull();
    expect(parseAmountInput(null)).toBeNull();
    expect(parseAmountInput(undefined)).toBeNull();
  });

  it("rend null sur une saisie illisible", () => {
    expect(parseAmountInput("abc")).toBeNull();
    expect(parseAmountInput("650 000")).toBeNull();
    expect(parseAmountInput("650000,50")).toBeNull();
    expect(parseAmountInput(Number.NaN)).toBeNull();
  });

  it("lit un montant valide, zéro inclus", () => {
    expect(parseAmountInput("650000")).toBe(650_000);
    expect(parseAmountInput("650000.50")).toBe(650_000.5);
    // Un zéro explicitement saisi est une donnée, pas une absence de donnée.
    expect(parseAmountInput("0")).toBe(0);
  });
});

describe("simulateCapitalGain — prix de cession vide", () => {
  it("ne produit aucun chiffre quand le champ est vide", () => {
    const sim = simulateCapitalGain({ salePriceRaw: "", ...DEMO });
    expect(sim.status).toBe("MISSING_SALE_PRICE");
    expect(sim.result).toBeNull();
  });

  it("ne produit aucun chiffre quand le champ est illisible", () => {
    expect(simulateCapitalGain({ salePriceRaw: "abc", ...DEMO }).result).toBeNull();
    expect(simulateCapitalGain({ salePriceRaw: null, ...DEMO }).result).toBeNull();
  });

  it("ne retombe jamais sur la moins-value de -477 600 € du champ vide", () => {
    // Régression historique : `Number("")` valant 0, la cession vide était
    // lue comme une cession à titre gratuit.
    const sim = simulateCapitalGain({ salePriceRaw: "", ...DEMO });
    expect(sim.result).toBeNull();

    // Le même montant saisi volontairement, lui, reste calculé : ZERO ≠ UNKNOWN.
    const zero = simulateCapitalGain({ salePriceRaw: "0", ...DEMO });
    expect(zero.status).toBe("OK");
    expect(zero.result?.grossGainEur.toNumber()).toBe(-477_600);
  });

  it("signale l'acquisition manquante avant de réclamer un prix de cession", () => {
    expect(
      simulateCapitalGain({ salePriceRaw: "650000", ...DEMO, purchasePriceEur: null })
        .status
    ).toBe("MISSING_ACQUISITION");
    expect(
      simulateCapitalGain({ salePriceRaw: "650000", ...DEMO, purchaseDate: null }).status
    ).toBe("MISSING_ACQUISITION");
  });
});

describe("simulateCapitalGain — date de cession vide", () => {
  it("ne produit aucun chiffre quand la date est invalide (champ effacé)", () => {
    const sim = simulateCapitalGain({
      salePriceRaw: "650000",
      purchasePriceEur: DEMO.purchasePriceEur,
      purchaseDate: DEMO.purchaseDate,
      saleDate: new Date(""),
    });
    expect(sim.status).toBe("MISSING_SALE_DATE");
    expect(sim.result).toBeNull();
  });

  it("ne produit aucun chiffre quand la date est absente", () => {
    const sim = simulateCapitalGain({
      salePriceRaw: "650000",
      purchasePriceEur: DEMO.purchasePriceEur,
      purchaseDate: DEMO.purchaseDate,
      saleDate: null as unknown as Date,
    });
    expect(sim.status).toBe("MISSING_SALE_DATE");
    expect(sim.result).toBeNull();
  });

  it("signale l'acquisition manquante avant la date de cession manquante", () => {
    expect(
      simulateCapitalGain({
        salePriceRaw: "650000",
        purchasePriceEur: null,
        purchaseDate: DEMO.purchaseDate,
        saleDate: new Date(""),
      }).status
    ).toBe("MISSING_ACQUISITION");
  });

  it("signale le prix de cession manquant avant la date de cession manquante", () => {
    expect(
      simulateCapitalGain({
        salePriceRaw: "",
        purchasePriceEur: DEMO.purchasePriceEur,
        purchaseDate: DEMO.purchaseDate,
        saleDate: new Date(""),
      }).status
    ).toBe("MISSING_SALE_PRICE");
  });
});

describe("simulateCapitalGain — non-régression à 650 000 €", () => {
  it("conserve la plus-value brute et l'impôt total au centime", () => {
    const sim = simulateCapitalGain({ salePriceRaw: "650000", ...DEMO });
    expect(sim.status).toBe("OK");
    const r = sim.result!;

    expect(r.holdingYears).toBe(3);
    expect(r.adjustedPurchasePriceEur.toNumber()).toBe(477_600);
    expect(r.grossGainEur.toNumber()).toBe(172_400);
    // 19 % + 17,2 % sans abattement, plus la surtaxe de 4 % (art. 1609 nonies G).
    expect(r.irTaxEur.toNumber()).toBe(32_756);
    expect(r.socialTaxEur.toNumber()).toBe(29_652.8);
    expect(r.surtaxEur.toNumber()).toBe(6_896);
    expect(r.totalTaxEur.toNumber()).toBe(69_304.8);
  });

  it("délègue au moteur sans rien modifier de la formule", () => {
    const viaGuard = simulateCapitalGain({ salePriceRaw: "650000", ...DEMO }).result!;
    const direct = computeCapitalGain({
      salePriceEur: 650_000,
      purchasePriceEur: 477_600,
      purchaseDate: new Date("2023-01-15"),
      saleDate: new Date("2026-09-15"),
    });
    expect(viaGuard.grossGainEur.toString()).toBe(direct.grossGainEur.toString());
    expect(viaGuard.totalTaxEur.toString()).toBe(direct.totalTaxEur.toString());
    expect(viaGuard.netProceedsEur.toString()).toBe(direct.netProceedsEur.toString());
  });
});
