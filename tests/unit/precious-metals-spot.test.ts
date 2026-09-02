import { describe, expect, it } from "vitest";
import {
  fineWeightGrams,
  metalValueEur,
  perGramFromOunce,
  premiumPct,
  TROY_OUNCE_G,
} from "@/app/lib/precious-metals/spot";

describe("cours des métaux précieux", () => {
  it("convertit l'once troy en gramme", () => {
    // 2 400 $ l'once → 77,16 $ le gramme.
    expect(Number(perGramFromOunce(2400).toFixed(4))).toBeCloseTo(
      2400 / TROY_OUNCE_G,
      4
    );
  });

  it("ne rend rien d'un prix nul ou négatif", () => {
    expect(perGramFromOunce(0).toNumber()).toBe(0);
    expect(perGramFromOunce(-5).toNumber()).toBe(0);
  });

  it("retient le poids fin, pas le poids pesé", () => {
    /*
      Deux pièces de 20 F : 6,4516 g pesés à 900 ‰, soit 5,8064 g d'or fin
      chacune. Valoriser le poids brut surestimerait le lot de 11 %.
    */
    const fine = fineWeightGrams(2, 6.4516, 900);
    expect(Number(fine.toFixed(4))).toBeCloseTo(11.6129, 3);
  });

  it("valorise le contenu métal au cours du gramme", () => {
    const fine = fineWeightGrams(1, 31.1034768, 999.9);
    const value = metalValueEur(fine, 70);
    // Une once de métal à 999,9 ‰ vaut ~ 70 € × 31,10 g.
    expect(Number(value.toFixed(2))).toBeCloseTo(2177.03, 1);
  });

  it("rend zéro plutôt qu'un nombre inventé sans cours", () => {
    expect(metalValueEur(10, 0).toNumber()).toBe(0);
    expect(fineWeightGrams(0, 10, 999).toNumber()).toBe(0);
  });

  it("mesure la prime payée au-delà du métal", () => {
    // 2 200 € pour 2 000 € de métal : 10 % de prime.
    expect(Number(premiumPct(2200, 2000)!.toFixed(4))).toBeCloseTo(10, 6);
    // Une décote existe aussi — un ETC légèrement sous son sous-jacent.
    expect(Number(premiumPct(1980, 2000)!.toFixed(4))).toBeCloseTo(-1, 6);
  });

  it("refuse de calculer une prime sans contenu métal", () => {
    /*
      Sans métal, la prime n'est pas « infinie » : elle n'existe pas. Rendre un
      nombre ferait afficher une colonne pleine de valeurs sans objet.
    */
    expect(premiumPct(500, 0)).toBeNull();
  });
});
