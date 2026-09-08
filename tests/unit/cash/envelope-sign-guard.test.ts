import { describe, expect, it } from "vitest";

/**
 * Le signe admis dépend de l'enveloppe, pas de la table.
 *
 * `PUT /api/envelopes` acceptait un solde négatif sur les trois poches :
 * `decimalString` ne porte aucune contrainte de signe. Or les trois enveloppes
 * n'obéissent pas à la même règle — un compte espèces de PEA ne peut pas être
 * débiteur, une assurance-vie non plus, un compte-titres ordinaire si.
 *
 * Le garde est donc **par enveloppe**. Le poser globalement aurait fermé le
 * découvert de CTO, qui est un fait comptable que le patrimoine compte avec son
 * signe depuis le chantier des soldes signés — cf.
 * `tests/unit/cash/negative-balances.test.ts`, qui vérifie l'autre moitié de la
 * règle.
 */

import { envelopeCashUpdateSchema } from "@/app/lib/schemas";

function parse(body: unknown) {
  return envelopeCashUpdateSchema.safeParse(body);
}

describe("solde négatif d'enveloppe", () => {
  it("le CTO peut être débiteur — découvert, appel de marge, règlement différé", () => {
    const r = parse({ envelope: "CTO", balance: "-1200" });
    expect(r.success).toBe(true);
  });

  it("le PEA ne le peut pas", () => {
    const r = parse({ envelope: "PEA", balance: "-1" });
    expect(r.success).toBe(false);
    // Le message doit nommer l'enveloppe : c'est ce que l'écran affichera.
    expect(r.error!.issues[0]!.message).toContain("PEA");
    expect(r.error!.issues[0]!.path).toEqual(["balance"]);
  });

  it("l'assurance-vie non plus", () => {
    const r = parse({ envelope: "AV", balance: "-0.01" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toContain("AV");
  });

  /*
    Zéro n'est pas un solde négatif. La distinction compte : le panneau propose
    zéro par défaut, et refuser cette saisie rendrait la remise à zéro d'un PEA
    impossible.
  */
  it("zéro reste accepté partout", () => {
    for (const envelope of ["CTO", "PEA", "AV"]) {
      expect(parse({ envelope, balance: "0" }).success).toBe(true);
    }
  });

  it("un solde créditeur reste accepté partout", () => {
    for (const envelope of ["CTO", "PEA", "AV"]) {
      expect(parse({ envelope, balance: "4000" }).success).toBe(true);
    }
  });

  /*
    La virgule décimale passe par la transformation de `decimalString` avant le
    garde. Sans cet ordre, « -1,50 » deviendrait `NaN` au test de signe et
    passerait — un négatif accepté sur un PEA, pour une virgule.
  */
  it("la virgule décimale est lue avant le contrôle de signe", () => {
    expect(parse({ envelope: "PEA", balance: "-1,50" }).success).toBe(false);
    expect(parse({ envelope: "CTO", balance: "-1,50" }).success).toBe(true);
  });

  /*
    Une saisie vide vaut zéro plus loin dans la route (`f.balance || "0"`). Elle
    n'affirme aucun signe, et le garde n'a rien à y redire.
  */
  it("une saisie vide traverse le garde", () => {
    expect(parse({ envelope: "PEA", balance: "" }).success).toBe(true);
  });

  it("changer la seule devise ne déclenche pas le garde", () => {
    expect(parse({ envelope: "PEA", currency: "EUR" }).success).toBe(true);
  });
});
