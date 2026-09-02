/**
 * Regroupement des produits bancaires par établissement.
 *
 * L'onglet Banques présentait trois listes indépendantes — comptes courants,
 * livrets, dépôts à terme — comme si elles décrivaient trois patrimoines. Ce
 * n'est pas ainsi qu'on lit son exposition bancaire : on la lit par
 * établissement, parce que c'est l'établissement qui porte le risque de
 * contrepartie, la garantie des dépôts et la relation commerciale.
 *
 * Module **pur** : il ne connaît ni Prisma, ni React, ni le réseau. Il reçoit
 * les trois listes telles que les routes existantes les renvoient et rend
 * l'arborescence `établissement → produits`. Aucune donnée n'est recalculée au
 * passage : les soldes viennent des routes, ce module ne fait que les
 * additionner.
 */

/** Nature d'un produit bancaire — détermine l'onglet et le panneau de détail. */
export type BankProductKind = "CHECKING" | "SAVINGS" | "TERM_DEPOSIT";

/**
 * Ligne unifiée présentée dans les listes.
 *
 * Volontairement plate et minimale : ce que la liste affiche. Tout le reste —
 * périodicité de versement, pénalité de retrait, jour de capitalisation —
 * reste sur la ligne d'origine et n'est lu que par le panneau de détail, qui
 * la reçoit telle quelle.
 */
export type BankProduct = {
  id: string;
  kind: BankProductKind;
  /** Libellé du produit : « Compte courant », « Livret A », « Dépôt à terme ». */
  name: string;
  /** Établissement, ou `null` quand l'utilisateur ne l'a pas renseigné. */
  bankName: string | null;
  /** Solde dans la devise du produit. */
  balance: string;
  /** Solde converti dans la devise d'affichage. */
  balanceBase: string;
  currency: string;
  /** Taux annuel en %, `null` pour un compte courant. */
  ratePercent: string | null;
  countsInNetWorth: boolean;
  isPro: boolean;
  ownershipPct: string | null;
};

export type BankInstitution = {
  /** Clé de regroupement — nom normalisé, stable entre les trois sources. */
  key: string;
  /** Nom affiché, tel que l'utilisateur l'a saisi la première fois. */
  name: string;
  products: BankProduct[];
  /** Somme des soldes convertis, tous produits confondus. */
  totalBase: number;
  accountCount: number;
};

/** Établissement non renseigné — regroupé à part plutôt qu'inventé. */
export const UNASSIGNED_KEY = "__unassigned__";
export const UNASSIGNED_LABEL = "Établissement non renseigné";

/**
 * Clé de regroupement d'un nom de banque.
 *
 * « BoursoBank », « boursobank » et « Boursobank  » désignent le même
 * établissement : sans normalisation, l'écran afficherait trois blocs pour une
 * seule banque et le total par établissement perdrait tout sens.
 */
export function institutionKey(bankName: string | null | undefined): string {
  const trimmed = (bankName ?? "").trim();
  if (!trimmed) return UNASSIGNED_KEY;
  return trimmed.toLocaleLowerCase("fr-FR").replace(/\s+/g, " ");
}

const num = (v: string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Construit l'arborescence des établissements.
 *
 * Tri : les établissements par encours décroissant — on veut voir d'abord où
 * l'argent est. Les produits dans un établissement suivent le même principe,
 * les comptes courants d'abord à encours égal, puisque c'est la trésorerie
 * disponible qu'on consulte le plus souvent.
 *
 * L'établissement non renseigné passe toujours en dernier, quel que soit son
 * encours : c'est une anomalie de saisie, pas une banque.
 */
export function groupByInstitution(products: BankProduct[]): BankInstitution[] {
  const byKey = new Map<string, BankInstitution>();

  for (const p of products) {
    const key = institutionKey(p.bankName);
    const existing = byKey.get(key);
    if (existing) {
      existing.products.push(p);
      existing.totalBase += num(p.balanceBase);
      existing.accountCount += 1;
      continue;
    }
    byKey.set(key, {
      key,
      name: key === UNASSIGNED_KEY ? UNASSIGNED_LABEL : (p.bankName ?? "").trim(),
      products: [p],
      totalBase: num(p.balanceBase),
      accountCount: 1,
    });
  }

  const KIND_ORDER: Record<BankProductKind, number> = {
    CHECKING: 0,
    SAVINGS: 1,
    TERM_DEPOSIT: 2,
  };

  const out = [...byKey.values()];
  for (const inst of out) {
    inst.products.sort((a, b) => {
      const byValue = num(b.balanceBase) - num(a.balanceBase);
      if (byValue !== 0) return byValue;
      const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (byKind !== 0) return byKind;
      return a.name.localeCompare(b.name, "fr-FR");
    });
  }

  out.sort((a, b) => {
    if (a.key === UNASSIGNED_KEY) return 1;
    if (b.key === UNASSIGNED_KEY) return -1;
    const byValue = b.totalBase - a.totalBase;
    if (byValue !== 0) return byValue;
    return a.name.localeCompare(b.name, "fr-FR");
  });

  return out;
}

/** Nombre d'établissements réellement utilisés (celui du KPI). */
export function institutionCount(products: BankProduct[]): number {
  const keys = new Set<string>();
  for (const p of products) keys.add(institutionKey(p.bankName));
  return keys.size;
}
