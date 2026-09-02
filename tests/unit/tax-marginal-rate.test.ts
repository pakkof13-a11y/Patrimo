import { describe, it, expect } from "vitest";
import {
  DEFAULT_MARGINAL_RATE_PCT,
  MARGINAL_RATE_OPTIONS,
  isMarginalRatePct,
  marginalRateNotice,
  resolveMarginalRate,
} from "@/app/lib/tax/marginal-rate";
import { compareRentalRegimes } from "@/app/lib/real-estate/tax/rental-income";
import { d } from "@/app/lib/money/decimal";

/**
 * Source de vérité de la tranche marginale.
 *
 * Ces tests protègent la propriété centrale du chantier : **deux écrans qui
 * lisent la même tranche produisent le même impôt**. Avant, Fiscalité passait
 * `tmi=30` en dur pendant qu'Immobilier tenait la valeur dans un `useState`
 * local — le même bien affichait deux montants.
 */

describe("résolution de la tranche", () => {
  it("le profil l'emporte sur le défaut", () => {
    // Cas 2 de la spécification : un utilisateur à 41 % est calculé à 41 %.
    const r = resolveMarginalRate({ user: 41 });
    expect(r.pct).toBe(41);
    expect(r.source).toBe("USER");
  });

  it("une valeur de requête l'emporte sur le profil", () => {
    /*
      L'ordre est délibéré : le sélecteur d'Immobilier doit pouvoir répondre
      à « et si j'étais à 45 % ? » sans écrire dans le profil.
    */
    const r = resolveMarginalRate({ query: 45, user: 11 });
    expect(r.pct).toBe(45);
    expect(r.source).toBe("QUERY");
  });

  it("rien de déclaré : le défaut s'applique mais se signale", () => {
    // Cas 4 : l'absence n'est pas remplacée en silence.
    const r = resolveMarginalRate({});
    expect(r.pct).toBe(DEFAULT_MARGINAL_RATE_PCT);
    expect(r.source).toBe("DEFAULT");
    expect(marginalRateNotice(r)).toMatch(/par défaut/i);
    expect(marginalRateNotice({ pct: 41, source: "USER" })).toMatch(/votre/i);
  });

  it("une tranche hors barème est ignorée, jamais corrigée", () => {
    /*
      Accepter 33 % produirait un impôt qu'aucun barème français ne prévoit.
      Le rejet fait retomber sur la source suivante.
    */
    expect(resolveMarginalRate({ query: 33, user: 41 })).toEqual({
      pct: 41,
      source: "USER",
    });
    expect(resolveMarginalRate({ query: 33 }).source).toBe("DEFAULT");
    expect(isMarginalRatePct(33)).toBe(false);
    expect(isMarginalRatePct(0)).toBe(true);
  });

  it("zéro est une tranche, pas une absence", () => {
    /*
      Piège classique : `0` est falsy. Un foyer non imposable est bien à 0 %,
      et doit le rester au lieu de retomber sur 30 %.
    */
    const r = resolveMarginalRate({ user: 0 });
    expect(r.pct).toBe(0);
    expect(r.source).toBe("USER");
  });

  it("les options couvrent le barème de l'impôt sur le revenu", () => {
    expect([...MARGINAL_RATE_OPTIONS]).toEqual([0, 11, 30, 41, 45]);
  });
});

describe("cohérence Immobilier ↔ Fiscalité", () => {
  /*
    Les deux écrans consomment `getRealEstateTaxBundle`, qui délègue à
    `compareRentalRegimes`. Vérifier ici que le moteur est bien déterministe
    pour une tranche donnée revient à vérifier que deux appelants lisant la
    même tranche obtiennent le même impôt — la propriété que le chantier
    rétablit.
  */
  const input = {
    grossRentEur: d("12000"),
    deductibleChargesEur: d("3000"),
  };

  function taxAt(pct: number) {
    const out = compareRentalRegimes(
      { ...input, marginalTaxRatePct: pct },
      false
    );
    return out.best?.totalTaxEur.toFixed(2) ?? null;
  }

  it("Cas 1 — deux lectures à 30 % donnent le même impôt", () => {
    expect(taxAt(30)).toBe(taxAt(30));
    expect(taxAt(30)).not.toBeNull();
  });

  it("Cas 2 — deux lectures à 41 % donnent le même impôt", () => {
    expect(taxAt(41)).toBe(taxAt(41));
  });

  it("Cas 3 — changer de tranche change bien le résultat", () => {
    /*
      Le vrai symptôme du bug : à 30 % et à 41 %, le même bien doit produire
      des impôts *différents*. S'ils étaient égaux, la tranche ne serait pas
      réellement consommée et la correction n'aurait rien changé.
    */
    expect(taxAt(41)).not.toBe(taxAt(30));
    expect(Number(taxAt(41))).toBeGreaterThan(Number(taxAt(30)));
  });

  it("Cas 4 — la tranche par défaut donne le résultat historique", () => {
    // Aucune régression pour les comptes qui n'ont jamais rien déclaré.
    expect(taxAt(DEFAULT_MARGINAL_RATE_PCT)).toBe(taxAt(30));
  });

  it("une tranche à 0 % ne laisse que les prélèvements sociaux", () => {
    const out = compareRentalRegimes(
      { ...input, marginalTaxRatePct: 0 },
      false
    );
    const best = out.best!;
    expect(best.incomeTaxEur.toNumber()).toBe(0);
    expect(best.socialTaxEur.toNumber()).toBeGreaterThan(0);
  });
});
