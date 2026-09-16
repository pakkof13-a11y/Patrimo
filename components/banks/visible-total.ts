/**
 * Total affiché à côté des sous-onglets de l'onglet Banques.
 *
 * Le libellé « Total » vit dans la même barre que « Comptes », « Livrets »,
 * « Dépôts à terme » : il se lit comme le total de la liste juste dessous.
 * Il sommait pourtant tous les établissements quelle que soit la vue — mesuré
 * sur la base démo, « Comptes » listait 11 610,75 € sous un « Total » à
 * 67 181,47 € (comptes + livrets). Un chiffre qui contredit la liste sous lui
 * est pire qu'aucun chiffre.
 *
 * Le total suit donc la vue, et le libellé dit ce qu'il totalise. Aucun
 * montant n'est recalculé ici : on filtre les mêmes produits que la liste, et
 * on additionne par `groupByInstitution`, exactement comme l'en-tête le
 * faisait déjà pour la vue d'ensemble.
 *
 * Module **pur** : ni React, ni réseau.
 */

import {
  groupByInstitution,
  type BankProduct,
  type BankProductKind,
} from "@/app/lib/cash/bank-groups";

/** Identifiants des sous-onglets — ceux de `VIEWS` dans `banks-tab.tsx`. */
export type BanksViewId = "overview" | "checking" | "savings" | "term";

const VIEW_KIND: Record<Exclude<BanksViewId, "overview">, BankProductKind> = {
  checking: "CHECKING",
  savings: "SAVINGS",
  term: "TERM_DEPOSIT",
};

/**
 * Libellés du total, par vue.
 *
 * « Total banques » et non « Total » pour la vue d'ensemble : c'est le seul
 * endroit où le chiffre couvre les trois familles, et il doit le dire.
 */
const VIEW_TOTAL_LABEL: Record<BanksViewId, string> = {
  overview: "Total banques",
  checking: "Total comptes",
  savings: "Total livrets",
  term: "Total dépôts à terme",
};

/** Les produits que la vue affiche — la même règle que la liste. */
export function visibleBankProducts(
  products: BankProduct[],
  view: BanksViewId
): BankProduct[] {
  if (view === "overview") return products;
  const kind = VIEW_KIND[view];
  return products.filter((p) => p.kind === kind);
}

/**
 * Total des produits visibles, en devise d'affichage, et son libellé.
 *
 * Somme par `groupByInstitution` : c'est la fonction qui additionne déjà les
 * `balanceBase` pour la vue d'ensemble, ce total en est la restriction à la
 * vue courante — pas une seconde addition qui pourrait diverger.
 */
export function visibleBankTotal(
  products: BankProduct[],
  view: BanksViewId
): { label: string; totalBase: number } {
  const totalBase = groupByInstitution(
    visibleBankProducts(products, view)
  ).reduce((acc, inst) => acc + inst.totalBase, 0);
  return { label: VIEW_TOTAL_LABEL[view], totalBase };
}
