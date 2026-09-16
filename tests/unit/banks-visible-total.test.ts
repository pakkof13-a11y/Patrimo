import { describe, expect, it } from "vitest";
import type { BankProduct } from "@/app/lib/cash/bank-groups";
import {
  visibleBankProducts,
  visibleBankTotal,
} from "@/components/banks/visible-total";

function product(over: Partial<BankProduct> & { id: string }): BankProduct {
  return {
    kind: "CHECKING",
    name: "Compte courant",
    bankName: "BoursoBank",
    balance: "0",
    balanceBase: "0",
    currency: "EUR",
    ratePercent: null,
    countsInNetWorth: true,
    isPro: false,
    ownershipPct: null,
    ...over,
  };
}

/*
  Base démo, mesurée par lecture directe (listBankAccounts /
  listSavingsAccounts, base EUR) : quatre comptes courants et quatre livrets,
  aucun dépôt à terme. Les soldes des livrets sont ceux affichés, intérêts
  courus compris — c'est ce que la liste montre.
*/
const DEMO: BankProduct[] = [
  product({ id: "c1", bankName: "BoursoBank", balance: "8420.35", balanceBase: "8420.350000000000" }),
  product({ id: "c2", bankName: "Caisse d'Épargne", balance: "-210", balanceBase: "-210.000000000000" }),
  product({ id: "c3", bankName: "Crédit Agricole", balance: "2150", balanceBase: "2150.000000000000" }),
  product({ id: "c4", bankName: "Revolut", balance: "1250.4", balanceBase: "1250.400000000000" }),
  product({ id: "s1", kind: "SAVINGS", name: "LDDS", bankName: "Crédit Agricole", balance: "12002.33939227", balanceBase: "12002.339392270000", ratePercent: "2.4" }),
  product({ id: "s2", kind: "SAVINGS", name: "LEP", bankName: "Caisse d'Épargne", balance: "2110.52027397", balanceBase: "2110.520273970000", ratePercent: "3" }),
  product({ id: "s3", kind: "SAVINGS", name: "Livret A", bankName: "BoursoBank", balance: "22954.47408772", balanceBase: "22954.474087720000", ratePercent: "2.4" }),
  product({ id: "s4", kind: "SAVINGS", name: "PEL", bankName: "Crédit Agricole", balance: "18503.38362116", balanceBase: "18503.383621160000", ratePercent: "2.25" }),
];

describe("total visible de l'onglet Banques", () => {
  it("sous-onglet Comptes : le total est celui des lignes listées, pas celui de toutes les poches", () => {
    /*
      Recette : « Comptes » listait 11 610,75 € sous un « Total » à
      67 181,47 €. Le total doit être celui de la liste.
    */
    const { label, totalBase } = visibleBankTotal(DEMO, "checking");
    expect(totalBase).toBeCloseTo(11610.75, 2);
    expect(label).toBe("Total comptes");
    expect(visibleBankProducts(DEMO, "checking").map((p) => p.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  it("sous-onglet Livrets : total des livrets, intérêts courus compris", () => {
    const { label, totalBase } = visibleBankTotal(DEMO, "savings");
    expect(totalBase).toBeCloseTo(55570.72, 2);
    expect(label).toBe("Total livrets");
  });

  it("sous-onglet Dépôts à terme sans CAT : zéro et non le total global", () => {
    /*
      Une liste vide totalise 0 — c'est un ZERO mesuré (aucun produit de ce
      type), pas un inconnu : la requête a répondu, il n'y a rien à sommer.
    */
    const { label, totalBase } = visibleBankTotal(DEMO, "term");
    expect(totalBase).toBe(0);
    expect(label).toBe("Total dépôts à terme");
    expect(visibleBankProducts(DEMO, "term")).toEqual([]);
  });

  it("vue d'ensemble : toutes les poches, et le libellé le dit", () => {
    /*
      C'est le chiffre que l'en-tête affichait déjà quelle que soit la vue ;
      il reste juste ici, où la liste dessous couvre bien tous les produits.
    */
    const { label, totalBase } = visibleBankTotal(DEMO, "overview");
    expect(totalBase).toBeCloseTo(67181.47, 2);
    expect(label).toBe("Total banques");
    expect(visibleBankProducts(DEMO, "overview")).toHaveLength(8);
  });

  it("un solde non numérique compte pour zéro, comme dans groupByInstitution", () => {
    const rows = [
      product({ id: "a", balanceBase: "100" }),
      product({ id: "b", balanceBase: "n/a" }),
    ];
    expect(visibleBankTotal(rows, "checking").totalBase).toBe(100);
  });
});
