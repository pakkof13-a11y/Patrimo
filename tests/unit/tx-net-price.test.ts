import { describe, it, expect } from "vitest";
import { txNetPriceEur, type NetPriceTx } from "@/app/lib/transactions/net-price";

function tx(over: Partial<NetPriceTx>): NetPriceTx {
  return {
    type: "ACHAT",
    quantity: "0",
    unitPrice: null,
    fees: "0",
    grossAmountEur: "0",
    netCashImpactEur: "0",
    fxRateToEur: "1",
    ...over,
  };
}

describe("txNetPriceEur", () => {
  it("recompute un ACHAT depuis prix unitaire × qté (EUR)", () => {
    const v = txNetPriceEur(
      tx({ type: "ACHAT", quantity: "10", unitPrice: "100", fees: "5" })
    );
    // 10×100 − 5 = 995
    expect(v).toBeCloseTo(995, 6);
  });

  it("convertit un trade en devise étrangère via fx", () => {
    const v = txNetPriceEur(
      tx({
        type: "VENTE",
        quantity: "2",
        unitPrice: "150", // USD
        fees: "0",
        fxRateToEur: "0.9",
      })
    );
    expect(v).toBeCloseTo(2 * 150 * 0.9, 6);
  });

  it("REGRESSION: trade sans prix unitaire retombe sur le brut EUR (pas 0)", () => {
    const v = txNetPriceEur(
      tx({
        type: "VENTE",
        quantity: "3",
        unitPrice: null, // import sans prix unitaire
        grossAmountEur: "1234.56",
      })
    );
    expect(v).toBeCloseTo(1234.56, 6);
  });

  it("REGRESSION: REWARD sans prix ni brut → null (— et non 0 trompeur)", () => {
    const v = txNetPriceEur(
      tx({ type: "REWARD", quantity: "42", unitPrice: null, grossAmountEur: "0" })
    );
    expect(v).toBeNull();
  });

  it("REWARD avec FMV (grossAmountEur) affiche la valeur", () => {
    const v = txNetPriceEur(
      tx({ type: "AIRDROP", quantity: "42", unitPrice: null, grossAmountEur: "88.5" })
    );
    expect(v).toBeCloseTo(88.5, 6);
  });

  it("mouvement de cash (DIVIDENDE) utilise l'impact cash net", () => {
    const v = txNetPriceEur(
      tx({ type: "DIVIDENDE", netCashImpactEur: "-42.5", grossAmountEur: "50" })
    );
    expect(v).toBeCloseTo(42.5, 6);
  });

  it("ne double-convertit pas le brut EUR quand fx ≠ 1", () => {
    // grossAmountEur est déjà en EUR : fees natifs convertis, brut inchangé
    const v = txNetPriceEur(
      tx({
        type: "VENTE",
        quantity: "1",
        unitPrice: null,
        grossAmountEur: "1000",
        fees: "10",
        fxRateToEur: "0.5",
      })
    );
    // 1000 − (10 × 0.5) = 995
    expect(v).toBeCloseTo(995, 6);
  });
});
