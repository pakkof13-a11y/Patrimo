/**
 * KPI de synthèse de l'onglet Banques — fonction pure.
 *
 * Consomme les lignes déjà converties en devise de base par
 * `listBankAccounts` / `listSavingsAccounts` (pockets.ts) : aucune conversion
 * FX n'est refaite ici, seulement des sommes et une moyenne pondérée.
 */

import { d, zero, type Decimal } from "../money/decimal";

export type CashSummary = {
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
};

export type CheckingRowForSummary = {
  balanceBase: string;
  countsInNetWorth: boolean;
};

export type SavingsRowForSummary = {
  displayBalanceBase: string;
  apyPercent: string;
  countsInNetWorth: boolean;
};

export type TermDepositRowForSummary = {
  principalBase: string;
};

export function summarizeCash(
  checking: CheckingRowForSummary[],
  savings: SavingsRowForSummary[],
  termDeposits: TermDepositRowForSummary[]
): CashSummary {
  let checkingTotal = zero();
  for (const c of checking) {
    if (!c.countsInNetWorth) continue;
    checkingTotal = checkingTotal.plus(d(c.balanceBase));
  }

  let savingsTotal = zero();
  let apyWeightedSum = zero();
  let projectedInterest = zero();
  for (const s of savings) {
    if (!s.countsInNetWorth) continue;
    const balance = d(s.displayBalanceBase);
    savingsTotal = savingsTotal.plus(balance);
    apyWeightedSum = apyWeightedSum.plus(balance.times(d(s.apyPercent)));
    projectedInterest = projectedInterest.plus(
      balance.times(d(s.apyPercent)).div(100)
    );
  }

  let termDepositTotal = zero();
  for (const t of termDeposits) {
    termDepositTotal = termDepositTotal.plus(d(t.principalBase));
  }

  return {
    checkingTotalBase: checkingTotal,
    savingsTotalBase: savingsTotal,
    termDepositTotalBase: termDepositTotal,
    weightedApyPct: savingsTotal.gt(0) ? apyWeightedSum.div(savingsTotal) : null,
    projectedAnnualInterestBase: projectedInterest,
  };
}
