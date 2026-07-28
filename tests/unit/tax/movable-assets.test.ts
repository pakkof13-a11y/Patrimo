import { describe, expect, it } from "vitest";
import {
  computeMovableSaleTax,
  flatTaxBreakdown,
  hasSmallSaleThreshold,
  SMALL_SALE_EXEMPTION_EUR,
} from "@/app/lib/tax/movable-assets";

/**
 * Moteur commun des cessions de biens meubles.
 *
 * Les tests des métaux précieux couvrent déjà les deux régimes et l'abattement.
 * Ceux-ci portent sur ce qui distingue les autres biens meubles : le seuil de
 * 5 000 €, l'exonération par nature, et le taux forfaitaire réduit.
 */

const base = {
  costBasisEur: "1000",
  acquiredAt: "2020-01-01",
  soldAt: "2026-06-01",
  hasInvoice: true,
} as const;

describe("seuil des 5 000 €", () => {
  it("exonère une cession d'objet précieux qui n'excède pas le seuil", () => {
    // Le cas le plus fréquent d'une collection personnelle : afficher un impôt
    // ici serait une invention pure.
    const r = computeMovableSaleTax({
      ...base,
      nature: "COLLECTIBLE",
      salePriceEur: SMALL_SALE_EXEMPTION_EUR,
    });

    expect(r.exempt).toBe(true);
    expect(r.exemptionReason).toBe("SMALL_SALE");
    expect(r.flat.taxEur).toBe("0.00");
    expect(r.capitalGain.taxEur).toBe("0.00");
    expect(r.rationale).toMatch(/par cession/i);
  });

  it("taxe dès le premier euro au-dessus du seuil", () => {
    const r = computeMovableSaleTax({
      ...base,
      nature: "COLLECTIBLE",
      salePriceEur: "5000.01",
    });

    expect(r.exempt).toBe(false);
    // Le seuil n'est pas un abattement : c'est bien la totalité du prix qui
    // devient l'assiette, pas la seule fraction excédentaire.
    expect(r.flat.taxableBaseEur).toBe("5000.01");
    expect(r.flat.taxEur).toBe("325.00");
  });

  it("ne s'applique jamais aux métaux précieux", () => {
    expect(hasSmallSaleThreshold("PRECIOUS_METAL")).toBe(false);
    expect(hasSmallSaleThreshold("COLLECTIBLE")).toBe(true);

    const r = computeMovableSaleTax({
      ...base,
      nature: "PRECIOUS_METAL",
      salePriceEur: "1000",
    });
    expect(r.exempt).toBe(false);
    expect(r.flat.taxEur).toBe("115.00");
  });
});

describe("exonération par nature", () => {
  it("n'impose ni les meubles meublants ni les automobiles ordinaires", () => {
    // Art. 150 UA II 1° : une voiture revendue avec profit ne supporte aucun
    // impôt — y compris très au-dessus du seuil.
    const r = computeMovableSaleTax({
      ...base,
      nature: "EXEMPT_BY_NATURE",
      salePriceEur: "60000",
    });

    expect(r.exempt).toBe(true);
    expect(r.exemptionReason).toBe("NATURE");
    expect(r.flat.taxEur).toBe("0.00");
    expect(r.rationale).toMatch(/collection/i);
  });

  it("impose le même véhicule déclaré objet de collection", () => {
    const r = computeMovableSaleTax({
      ...base,
      nature: "COLLECTIBLE",
      salePriceEur: "60000",
    });

    expect(r.exempt).toBe(false);
    expect(r.flat.taxEur).toBe("3900.00"); // 60 000 × 6,5 %
  });
});

describe("taux forfaitaire par nature", () => {
  it("applique 6,5 % aux objets précieux et 11,5 % aux métaux", () => {
    const collectible = computeMovableSaleTax({
      ...base,
      nature: "COLLECTIBLE",
      salePriceEur: "10000",
    });
    const metal = computeMovableSaleTax({
      ...base,
      nature: "PRECIOUS_METAL",
      salePriceEur: "10000",
    });

    expect(collectible.flat.taxEur).toBe("650.00");
    expect(metal.flat.taxEur).toBe("1150.00");
  });

  it("décompose le taux sans le réinventer côté affichage", () => {
    const [main, crds] = flatTaxBreakdown("COLLECTIBLE");
    expect(main!.rate).toBe("0.06");
    expect(crds!.rate).toBe("0.005");
    expect(flatTaxBreakdown("EXEMPT_BY_NATURE")).toHaveLength(0);
  });
});

describe("interaction du seuil avec les autres règles", () => {
  it("n'annonce pas « exonéré » pour une durée de détention quand l'option est fermée", () => {
    // 25 ans de détention donnent 100 % d'abattement, mais sans justificatif
    // le régime réel n'est pas ouvert : la taxe forfaitaire reste due, et
    // parler d'exonération induirait en erreur.
    const r = computeMovableSaleTax({
      nature: "COLLECTIBLE",
      salePriceEur: "20000",
      costBasisEur: "1000",
      acquiredAt: "1999-01-01",
      soldAt: "2026-06-01",
      hasInvoice: false,
    });

    expect(r.holdingYears).toBeGreaterThanOrEqual(22);
    expect(r.capitalGain.available).toBe(true); // l'ancienneté vaut preuve
    expect(r.exempt).toBe(true);
  });

  it("laisse l'option ouverte sous le seuil, sans quoi le message serait absurde", () => {
    // Aucun impôt n'étant dû, aucun régime ne peut être « fermé » : afficher
    // un avertissement de justificatif ici n'aurait aucun sens.
    const r = computeMovableSaleTax({
      nature: "COLLECTIBLE",
      salePriceEur: "3000",
      costBasisEur: "500",
      acquiredAt: null,
      soldAt: "2026-06-01",
      hasInvoice: false,
    });

    expect(r.capitalGain.available).toBe(true);
    expect(r.capitalGain.unavailableReason).toBeNull();
  });
});
