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
  it("recompute un ACHAT depuis prix unitaire × qté, frais ajoutés", () => {
    const v = txNetPriceEur(
      tx({ type: "ACHAT", quantity: "10", unitPrice: "100", fees: "5" })
    );
    // À l'achat on décaisse le brut ET les frais : 10×100 + 5 = 1005.
    // Ce test attendait 995 (frais retranchés), ce qui contredisait
    // `applyBuy` (coût = qty × prix + frais) et le PRU affiché à l'écran.
    expect(v).toBeCloseTo(1005, 6);
  });

  it("retranche les frais sur une VENTE (produit encaissé)", () => {
    const v = txNetPriceEur(
      tx({ type: "VENTE", quantity: "10", unitPrice: "100", fees: "5" })
    );
    expect(v).toBeCloseTo(995, 6);
  });

  it("aligne le net d'un ACHAT sur le coût de revient du grand livre", () => {
    // Cas réel : achat immobilier 285 000 € + 12 000 € de frais → PRU 297 000 €.
    const v = txNetPriceEur(
      tx({
        type: "ACHAT",
        quantity: "1",
        unitPrice: "285000",
        grossAmountEur: "285000",
        fees: "12000",
      })
    );
    expect(v).toBeCloseTo(297_000, 6);
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
