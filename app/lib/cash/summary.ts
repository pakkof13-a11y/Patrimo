/**
 * KPI de synthèse de l'onglet Banques — fonction pure.
 *
 * Consomme les lignes déjà converties en devise de base par
 * `listBankAccounts` / `listSavingsAccounts` (pockets.ts) : aucune conversion
 * FX n'est refaite ici, seulement des sommes et une moyenne pondérée.
 */

import { d, zero, type Decimal } from "../money/decimal";
import { personalShareOf, type OwnershipInput } from "./ownership";

export type CashSummary = {
  /** Ce qui entre réellement dans le patrimoine personnel — voir `excluded`. */
  checkingTotalBase: Decimal;
  savingsTotalBase: Decimal;
  termDepositTotalBase: Decimal;
  /** Moyenne des taux de livrets pondérée par le solde affiché (courus inclus). Null si aucun livret compté. */
  weightedApyPct: Decimal | null;
  /**
   * Estimation simple = Σ(solde × taux / 100), tous livrets confondus.
   * Déclaratif : ignore la nuance APR/APY et la capitalisation réelle —
   * sert à donner un ordre de grandeur, pas une valeur contractuelle.
   */
  projectedAnnualInterestBase: Decimal;
  /**
   * Ce que les totaux ci-dessus ne comptent pas, et pourquoi.
   *
   * Sans ça, le KPI de tête cesserait de correspondre à la liste juste en
   * dessous sans que rien ne l'explique — le défaut que l'en-tête de la route
   * dit vouloir éviter. L'écran nomme donc l'écart au lieu de le taire.
   */
  excluded: {
    /** Comptes et livrets marqués professionnels. */
    proCount: number;
    /** Leur solde entier, en devise de base. */
    proTotalBase: Decimal;
    /** Comptes joints dont une part revient à quelqu'un d'autre. */
    sharedCount: number;
    /** La part qui ne revient pas au détenteur, en devise de base. */
    sharedNotOwnedBase: Decimal;
  };
};

export type CheckingRowForSummary = OwnershipInput & {
  balanceBase: string;
};

export type SavingsRowForSummary = OwnershipInput & {
  displayBalanceBase: string;
  apyPercent: string;
};

export type TermDepositRowForSummary = OwnershipInput & {
  principalBase: string;
};

/**
 * Les totaux du bandeau, sur le seul patrimoine personnel.
 *
 * Le garde était `if (!countsInNetWorth) continue`, et `listBankAccounts`
 * posait ce champ à `true` en dur : la branche ne pouvait plus se déclencher.
 * Un compte professionnel entrait donc dans « Comptes courants », et un compte
 * joint à 50 % y entrait pour le double de ce qu'il vaut à son détenteur —
 * alors que la liste juste en dessous affiche déjà une puce « Pro — hors
 * patrimoine personnel » sur le premier.
 *
 * La règle vient de `personalShareOf`, partagée avec `getExplicitCashTotalEur` :
 * c'est ce qui garantit que ce bandeau et le patrimoine net répondent la même
 * chose. Ce qui sort est compté à part et rendu dans `excluded`, pour que
 * l'écran puisse le nommer plutôt que de laisser un écart inexpliqué.
 *
 * Le rendement moyen suit la même pondération : c'est le taux de ce qu'on
 * détient, pas de ce qui passe sur le relevé.
 */
export function summarizeCash(
  checking: CheckingRowForSummary[],
  savings: SavingsRowForSummary[],
  termDeposits: TermDepositRowForSummary[]
): CashSummary {
  let proCount = 0;
  let proTotal = zero();
  let sharedCount = 0;
  let sharedNotOwned = zero();

  /** Retient la part personnelle et note ce qui a été laissé de côté. */
  const retenu = (montant: string, row: OwnershipInput) => {
    const brut = d(montant);
    if (row.isPro) {
      proCount += 1;
      proTotal = proTotal.plus(brut);
      return zero();
    }
    const part = personalShareOf(row);
    if (!part.eq(1)) {
      sharedCount += 1;
      sharedNotOwned = sharedNotOwned.plus(brut.times(d(1).minus(part)));
    }
    return brut.times(part);
  };

  let checkingTotal = zero();
  for (const c of checking) {
    checkingTotal = checkingTotal.plus(retenu(c.balanceBase, c));
  }

  let savingsTotal = zero();
  let apyWeightedSum = zero();
  let projectedInterest = zero();
  for (const s of savings) {
    const balance = retenu(s.displayBalanceBase, s);
    savingsTotal = savingsTotal.plus(balance);
    apyWeightedSum = apyWeightedSum.plus(balance.times(d(s.apyPercent)));
    projectedInterest = projectedInterest.plus(
      balance.times(d(s.apyPercent)).div(100)
    );
  }

  /*
    Le CAT suit la même règle que le compte courant et le livret.

    Il ne la suivait pas : sa boucle sommait le principal brut pendant que
    les deux autres passaient par `retenu()`. Un dépôt à terme professionnel
    de 100 000 € entrait donc entier dans le bandeau, avec `excluded.proCount`
    à zéro — en contradiction avec l'en-tête de la route qui promet des
    totaux « patrimoine personnel ». Son type ne portait même pas les deux
    champs, alors que `listTermDeposits` les sert.

    Le modèle a bien les deux colonnes (`prisma/schema.prisma`) et la route
    les persiste : il n'y avait aucune raison de l'exempter, seulement un
    oubli au moment où la règle a été posée sur les deux autres.
  */
  let termDepositTotal = zero();
  for (const t of termDeposits) {
    termDepositTotal = termDepositTotal.plus(retenu(t.principalBase, t));
  }

  return {
    checkingTotalBase: checkingTotal,
    savingsTotalBase: savingsTotal,
    termDepositTotalBase: termDepositTotal,
    weightedApyPct: savingsTotal.gt(0) ? apyWeightedSum.div(savingsTotal) : null,
    projectedAnnualInterestBase: projectedInterest,
    excluded: {
      proCount,
      proTotalBase: proTotal,
      sharedCount,
      sharedNotOwnedBase: sharedNotOwned,
    },
  };
}
