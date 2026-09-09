/**
 * Ce qu'un compte apporte au **patrimoine personnel** — la règle, à un seul
 * endroit.
 *
 * Deux champs la décidaient sans que rien ne les lise. Le schéma les déclare
 * pourtant sans ambiguïté, et l'écran les promet à l'utilisateur :
 *
 * - `isPro` — *« Exclu du patrimoine personnel : un compte pro ne s'additionne
 *   pas au patrimoine net comme un compte perso, même s'il figure dans la
 *   liste. »* (`prisma/schema.prisma`). Le panneau de détail propose la case
 *   « Exclure du patrimoine personnel », et la liste affiche déjà une puce
 *   « Pro — hors patrimoine personnel ».
 * - `ownershipPct` — *« Part détenue sur un compte joint, 0–100. Null = compte
 *   individuel. »* Le panneau écrit « Vide = compte individuel, 100 %
 *   implicite ».
 *
 * Ni l'un ni l'autre n'entrait dans un total. `getExplicitCashTotalEur`
 * sommait tous les comptes, pro compris et sans quote-part ; un compte joint à
 * 50 % apportait ses 10 000 € entiers, et un compte professionnel les siens.
 * L'écran affirmait donc une exclusion que le patrimoine net ne pratiquait
 * pas.
 *
 * La règle vit ici plutôt que dans chacun des deux totaux : ils divergeraient
 * à la première retouche, et c'est précisément ce que la revue a trouvé —
 * `summarizeCash` gardait une branche `countsInNetWorth` que `listBankAccounts`
 * ne pouvait plus déclencher, pendant que le vrai total ignorait la question.
 *
 * Le pendant crypto existe déjà et fait la même chose sur la même donnée :
 * `defi-position-service.ts` divise par 100 une `ownershipPct` stockée de la
 * même façon. Un seul vocabulaire pour un seul concept.
 */

import { d, type Decimal } from "../money/decimal";

/** Ce qu'il faut savoir d'une ligne pour lui appliquer la règle. */
export type OwnershipInput = {
  isPro?: boolean | null;
  /** 0–100, ou `null` pour un compte individuel. */
  ownershipPct?: { toString(): string } | string | null;
};

/**
 * La fraction du solde qui entre dans le patrimoine personnel : `0` pour un
 * compte professionnel, sinon la quote-part, `1` par défaut.
 *
 * **Un compte pro à 100 % rend `0`.** Les deux champs ne se composent pas :
 * `isPro` dit « ce n'est pas mon patrimoine », la quote-part dit « voici quelle
 * part m'en revient ». La seconde ne peut pas rattraper la première.
 *
 * Une quote-part illisible ou hors de 0–100 retombe sur `1` : la borne est
 * posée à la saisie (`bankAccountSchema`), et deviner ici une valeur que
 * personne n'a écrite serait pire que de compter le compte en entier — un
 * total trop bas se remarque moins qu'un total trop haut, et se corrige moins
 * vite.
 */
export function personalShareOf(row: OwnershipInput): Decimal {
  if (row.isPro) return d(0);
  if (row.ownershipPct == null || row.ownershipPct === "") return d(1);
  // `d()` lève sur une chaîne illisible : la colonne est un `Decimal?` en base,
  // mais cette fonction sert aussi des lignes venues d'un JSON.
  let pct: Decimal;
  try {
    pct = d(String(row.ownershipPct));
  } catch {
    return d(1);
  }
  if (!pct.isFinite() || pct.lt(0) || pct.gt(100)) return d(1);
  return pct.div(100);
}

/** Le montant retenu : `amount × personalShareOf(row)`. */
export function personalAmountOf(
  amount: { toString(): string } | string,
  row: OwnershipInput
): Decimal {
  return d(String(amount)).times(personalShareOf(row));
}

/** Vrai si la ligne apporte quelque chose au patrimoine personnel. */
export function countsInPersonalNetWorth(row: OwnershipInput): boolean {
  return !row.isPro;
}
