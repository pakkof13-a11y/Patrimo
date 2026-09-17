import { describe, expect, it } from "vitest";
import {
  compteActifs,
  etatPoche,
  montantAffiche,
} from "@/components/crypto/spot-known";
import { MONTANT_INCONNU } from "@/app/lib/utils";

/**
 * Inconnu ≠ zéro sur la vue d'ensemble Cryptos.
 *
 * Le défaut corrigé : les positions arrivent en prop sous forme de tableau, et
 * `[]` valait aussi bien « portefeuille vide » que « requête en cours ». Au
 * premier rendu, l'écran annonçait donc 0,00 €, « 0 actif » et « aucune
 * position » avant d'afficher les 208 937,70 € et les 5 actifs réels.
 *
 * Ces trois fonctions portent toute la distinction ; les composants ne font que
 * les appeler.
 */

describe("etatPoche", () => {
  it("dit « inconnu » tant que la requête n'a pas répondu", () => {
    expect(etatPoche(false, false)).toBe("inconnu");
    // Même sans positions connues : l'absence de réponse prime.
    expect(etatPoche(false, true)).toBe("inconnu");
  });

  it("garde l'état vide d'un portefeuille réellement vide", () => {
    expect(etatPoche(true, false)).toBe("vide");
  });

  it("dit « garni » dès qu'une position est connue", () => {
    expect(etatPoche(true, true)).toBe("garni");
  });
});

describe("compteActifs", () => {
  it("n'écrit pas « 0 actif » avant d'avoir lu le portefeuille", () => {
    expect(compteActifs(false, 0)).toBe("—");
  });

  it("écrit « 0 actif » quand le portefeuille est lu et vide", () => {
    expect(compteActifs(true, 0)).toBe("0 actif");
  });

  it("accorde le pluriel au-delà d'un actif", () => {
    expect(compteActifs(true, 1)).toBe("1 actif");
    expect(compteActifs(true, 5)).toBe("5 actifs");
  });
});

describe("montantAffiche", () => {
  it("rend « — € » tant que la donnée n'est pas connue", () => {
    expect(montantAffiche(false, 0)).toBe(MONTANT_INCONNU);
    expect(montantAffiche(false, 208_937.7)).toBe(MONTANT_INCONNU);
  });

  it("rend un zéro réellement observé comme un zéro", () => {
    const zero = montantAffiche(true, 0);
    expect(zero).not.toBe(MONTANT_INCONNU);
    expect(zero).toMatch(/0,00/);
  });

  it("rend le montant lu tel qu'il est formaté ailleurs", () => {
    expect(montantAffiche(true, 208_937.7)).toMatch(/208\s?937,70/);
  });
});
