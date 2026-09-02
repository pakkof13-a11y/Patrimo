import { describe, expect, it } from "vitest";

/**
 * Un actif classé dans une enveloppe qui lit ses fiches ne doit pas pouvoir
 * exister sans fiche.
 *
 * Deux SCPI comptaient 25 240 € au patrimoine sans figurer dans aucun onglet
 * du module Immobilier ni dans l'assiette IFI. Le seed a été corrigé, mais deux
 * portes d'écriture permettaient de recréer l'état : la création d'actif et le
 * reclassement d'enveloppe. Ces tests décrivent ce que la règle autorise.
 */

import {
  detailOrphanError,
  detailRequirementError,
  envelopeRequiresDetail,
  hasRealEstateDetail,
} from "@/app/lib/assets/envelope-requirements";

const AUCUNE = { hasRealEstate: false, hasIndirectRealEstate: false };
const BIEN_DIRECT = { hasRealEstate: true, hasIndirectRealEstate: false };
const VEHICULE = { hasRealEstate: false, hasIndirectRealEstate: true };

describe("quelles enveloppes exigent une fiche", () => {
  it("l'immobilier, dont les deux onglets partent des tables de détail", () => {
    expect(envelopeRequiresDetail("IMMOBILIER")).toBe(true);
  });

  it("aucune autre — elles énumèrent le journal et enrichissent ensuite", () => {
    for (const env of ["CTO", "PEA", "CRYPTO", "CFD"]) {
      expect(envelopeRequiresDetail(env), env).toBe(false);
    }
  });

  it("pas l'assurance-vie : un support orphelin y reste visible et signalé", () => {
    /*
      `listSupports()` part des actifs AV et rattache le support en jointure
      facultative. L'état incomplet est atteignable, affiché sous « Supports
      sans contrat rattaché », et réparable d'un clic. L'interdire bloquerait
      un flux qui fonctionne.
    */
    expect(envelopeRequiresDetail("AV")).toBe(false);
    expect(detailRequirementError("AV", AUCUNE)).toBeNull();
  });

  it("ni une valeur absente ni une valeur inconnue n'exigent quoi que ce soit", () => {
    expect(envelopeRequiresDetail(null)).toBe(false);
    expect(envelopeRequiresDetail(undefined)).toBe(false);
    expect(envelopeRequiresDetail("INEXISTANT")).toBe(false);
  });
});

describe("entrer dans l'enveloppe immobilière", () => {
  it("refuse un actif sans aucune fiche", () => {
    const err = detailRequirementError("IMMOBILIER", AUCUNE);
    expect(err).toBeTruthy();
    // Le message doit nommer les deux chemins, sinon il déplace le problème.
    expect(err).toContain("Biens");
    expect(err).toContain("SCPI");
  });

  it("accepte un bien détenu en direct", () => {
    expect(detailRequirementError("IMMOBILIER", BIEN_DIRECT)).toBeNull();
  });

  it("accepte une SCPI, qui n'a pas à porter une fiche de bien direct", () => {
    /*
      Le point qui a produit le défaut d'origine : une part de société n'a ni
      étage ni taxe foncière. Exiger `RealEstateDetail` pour tout l'immobilier
      obligerait à lui inventer une adresse.
    */
    expect(detailRequirementError("IMMOBILIER", VEHICULE)).toBeNull();
    expect(hasRealEstateDetail(VEHICULE)).toBe(true);
  });

  it("laisse passer les enveloppes sans exigence", () => {
    for (const env of ["CTO", "PEA", "CRYPTO", "CFD", "AV"]) {
      expect(detailRequirementError(env, AUCUNE), env).toBeNull();
    }
  });
});

describe("quitter l'enveloppe immobilière", () => {
  it("refuse d'abandonner une fiche derrière soi", () => {
    /*
      La fiche ne disparaît qu'avec l'actif. Son onglet continuerait donc de la
      lister, rattachée à une position que le module ne valorise plus —
      `buildPropertyView` ouvre sur la valeur du holding immobilier, donc 0 €.
    */
    const err = detailOrphanError("IMMOBILIER", "CTO", BIEN_DIRECT);
    expect(err).toBeTruthy();
    expect(err).toContain("0 €");
  });

  it("refuse aussi pour un véhicule indirect", () => {
    expect(detailOrphanError("IMMOBILIER", "PEA", VEHICULE)).toBeTruthy();
  });

  it("accepte si l'actif ne portait aucune fiche", () => {
    expect(detailOrphanError("IMMOBILIER", "CTO", AUCUNE)).toBeNull();
  });

  it("n'a rien à dire d'un changement entre deux enveloppes sans exigence", () => {
    expect(detailOrphanError("CTO", "PEA", AUCUNE)).toBeNull();
    expect(detailOrphanError("PEA", "CTO", BIEN_DIRECT)).toBeNull();
  });

  it("laisse un actif immobilier rester immobilier", () => {
    expect(detailOrphanError("IMMOBILIER", "IMMOBILIER", BIEN_DIRECT)).toBeNull();
  });
});
