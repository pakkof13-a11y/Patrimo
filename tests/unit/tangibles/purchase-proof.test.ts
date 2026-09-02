import { describe, expect, it } from "vitest";
import { computeMovableSaleTax } from "@/app/lib/tax/movable-assets";

/**
 * Justificatif d'achat et frais d'acquisition.
 *
 * Reprend les cas limites du cahier des charges, avec les taux réellement en
 * vigueur : 6,5 % au forfait (et non 7 %), 37,6 % au régime réel (et non
 * 36,2 %), et le seuil d'exonération de 5 000 € qu'il ne mentionnait pas.
 */

const collectible = {
  nature: "COLLECTIBLE",
  soldAt: "2026-01-01",
} as const;

describe("cas limites du cahier des charges", () => {
  it("achat 10 000, vente 10 000 : rien à taxer au régime réel", () => {
    const r = computeMovableSaleTax({
      ...collectible,
      salePriceEur: "10000",
      costBasisEur: "10000",
      acquiredAt: "2025-01-01",
      hasInvoice: true,
    });

    expect(r.grossGainEur).toBe("0.00");
    expect(r.capitalGain.taxEur).toBe("0.00");
    // Mais le forfait, lui, reste dû : il porte sur le prix de vente, pas sur
    // le gain. Annoncer « aucun impôt » serait faux.
    expect(r.flat.taxEur).toBe("650.00");
    expect(r.recommended).toBe("PLUS_VALUE");
  });

  it("vente 15 000 après 1 an avec preuve : le forfait l'emporte", () => {
    const r = computeMovableSaleTax({
      ...collectible,
      salePriceEur: "15000",
      costBasisEur: "10000",
      acquiredAt: "2025-01-01",
      hasInvoice: true,
    });

    // 15 000 × 6,5 % = 975 € — et non les 1 050 € du cahier des charges, qui
    // ajoutait la CRDS une seconde fois.
    expect(r.flat.taxEur).toBe("975.00");
    // 5 000 € sans abattement × 37,6 % = 1 880 €.
    expect(r.capitalGain.taxEur).toBe("1880.00");
    expect(r.recommended).toBe("FORFAIT");
  });

  it("même plus-value après 10 ans : 40 % d'abattement", () => {
    const r = computeMovableSaleTax({
      ...collectible,
      salePriceEur: "15000",
      costBasisEur: "10000",
      acquiredAt: "2016-01-01",
      hasInvoice: true,
    });

    expect(r.allowanceRate).toBe("0.4000");
    // 5 000 × 60 % × 37,6 % = 1 128 €, toujours au-dessus du forfait.
    expect(r.capitalGain.taxEur).toBe("1128.00");
    expect(r.recommended).toBe("FORFAIT");
  });

  it("22 ans avec preuve : exonération totale", () => {
    const r = computeMovableSaleTax({
      ...collectible,
      salePriceEur: "15000",
      costBasisEur: "10000",
      acquiredAt: "2004-01-01",
      hasInvoice: true,
    });

    expect(r.capitalGain.taxEur).toBe("0.00");
    expect(r.exempt).toBe(true);
    expect(r.exemptionReason).toBe("HOLDING_PERIOD");
    expect(r.recommended).toBe("PLUS_VALUE");
  });

  it("sans date d'achat : le forfait s'impose", () => {
    const r = computeMovableSaleTax({
      ...collectible,
      salePriceEur: "15000",
      costBasisEur: "10000",
      acquiredAt: null,
      hasInvoice: true,
    });

    expect(r.capitalGain.available).toBe(false);
    expect(r.recommended).toBe("FORFAIT");
  });

  it("date connue mais preuve absente : le forfait s'impose aussi", () => {
    // Le cas que corrige ce chantier : jusqu'ici un certificat d'authenticité
    // suffisait à ouvrir l'option, alors qu'il n'atteste ni le prix ni la date.
    const r = computeMovableSaleTax({
      ...collectible,
      salePriceEur: "15000",
      costBasisEur: "10000",
      acquiredAt: "2016-01-01",
      hasInvoice: false,
    });

    expect(r.capitalGain.available).toBe(false);
    expect(r.capitalGain.unavailableReason).toMatch(/facture/i);
    expect(r.recommended).toBe("FORFAIT");
  });

  it("les frais d'acquisition entrent dans le prix de revient", () => {
    const withFees = computeMovableSaleTax({
      ...collectible,
      salePriceEur: "15000",
      costBasisEur: "10500", // 10 000 + 500 de commissaire-priseur
      acquiredAt: "2025-01-01",
      hasInvoice: true,
    });

    expect(withFees.grossGainEur).toBe("4500.00");
    // 500 € de frais retirent 188 € d'impôt au régime réel.
    expect(withFees.capitalGain.taxEur).toBe("1692.00");
  });
});
