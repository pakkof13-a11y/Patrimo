import { describe, expect, it } from "vitest";
import {
  groupByInstitution,
  institutionCount,
  institutionKey,
  UNASSIGNED_KEY,
  UNASSIGNED_LABEL,
  type BankProduct,
} from "@/app/lib/cash/bank-groups";

function product(over: Partial<BankProduct> & { id: string }): BankProduct {
  return {
    kind: "CHECKING",
    name: "Compte courant",
    bankName: "BoursoBank",
    balance: "1000",
    balanceBase: "1000",
    currency: "EUR",
    ratePercent: null,
    countsInNetWorth: true,
    isPro: false,
    ownershipPct: null,
    ...over,
  };
}

describe("regroupement par établissement", () => {
  it("réunit sous une seule banque les saisies de casse ou d'espacement différentes", () => {
    /*
      Sans normalisation, « BoursoBank » saisi sur le compte courant et
      « boursobank » sur le livret produisaient deux blocs pour un seul
      établissement — et deux totaux dont aucun n'était l'exposition réelle.
    */
    const groups = groupByInstitution([
      product({ id: "a", bankName: "BoursoBank", balanceBase: "8420.32" }),
      product({
        id: "b",
        bankName: "  boursobank ",
        kind: "SAVINGS",
        name: "Livret A",
        balanceBase: "4010.20",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.accountCount).toBe(2);
    expect(groups[0]!.totalBase).toBeCloseTo(12_430.52, 6);
    // Le nom affiché est celui de la première saisie, pas la clé normalisée.
    expect(groups[0]!.name).toBe("BoursoBank");
  });

  it("classe les établissements par encours décroissant", () => {
    const groups = groupByInstitution([
      product({ id: "a", bankName: "Revolut", balanceBase: "8210" }),
      product({ id: "b", bankName: "Crédit Agricole", balanceBase: "24800" }),
      product({ id: "c", bankName: "BNP", balanceBase: "5440" }),
    ]);

    expect(groups.map((g) => g.name)).toEqual([
      "Crédit Agricole",
      "Revolut",
      "BNP",
    ]);
  });

  it("range les produits d'un établissement du plus gros au plus petit", () => {
    const groups = groupByInstitution([
      product({ id: "a", name: "Compte courant", balanceBase: "3210" }),
      product({
        id: "b",
        kind: "SAVINGS",
        name: "Épargne",
        balanceBase: "5000",
      }),
    ]);

    expect(groups[0]!.products.map((p) => p.name)).toEqual([
      "Épargne",
      "Compte courant",
    ]);
  });

  it("isole les produits sans établissement et les place en dernier", () => {
    /*
      Un produit sans banque n'est pas rattachable : l'inventer le placerait
      dans une exposition qui n'est pas la sienne. Il est donc regroupé à part,
      et toujours en fin de liste — c'est une anomalie de saisie, pas une
      banque, même quand son encours dépasse celui des autres.
    */
    const groups = groupByInstitution([
      product({ id: "a", bankName: null, balanceBase: "99999" }),
      product({ id: "b", bankName: "Revolut", balanceBase: "100" }),
      product({ id: "c", bankName: "   ", balanceBase: "50" }),
    ]);

    expect(groups.map((g) => g.name)).toEqual(["Revolut", UNASSIGNED_LABEL]);
    expect(groups[1]!.key).toBe(UNASSIGNED_KEY);
    expect(groups[1]!.accountCount).toBe(2);
  });

  it("compte les établissements réellement utilisés", () => {
    expect(
      institutionCount([
        product({ id: "a", bankName: "Revolut" }),
        product({ id: "b", bankName: "revolut" }),
        product({ id: "c", bankName: "BNP" }),
      ])
    ).toBe(2);
  });

  it("ne fabrique aucun établissement à partir d'une liste vide", () => {
    expect(groupByInstitution([])).toEqual([]);
    expect(institutionCount([])).toBe(0);
  });

  it("tolère un solde illisible sans propager NaN dans le total", () => {
    const groups = groupByInstitution([
      product({ id: "a", balanceBase: "1000" }),
      product({ id: "b", balanceBase: "n/a" }),
    ]);
    expect(groups[0]!.totalBase).toBeCloseTo(1000, 6);
  });

  it("normalise une clé d'établissement", () => {
    expect(institutionKey("  Crédit  Agricole ")).toBe("crédit agricole");
    expect(institutionKey(null)).toBe(UNASSIGNED_KEY);
    expect(institutionKey("")).toBe(UNASSIGNED_KEY);
  });
});
