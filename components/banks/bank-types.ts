/**
 * Formes renvoyées par les routes bancaires existantes.
 *
 * Recopiées depuis les `useQuery` de l'ancien onglet, sans rien retirer : la
 * refonte ne touche pas au backend, et ces types sont le contrat qu'elle doit
 * continuer d'honorer. Le panneau de détail les reçoit tels quels — c'est ce
 * qui garantit qu'aucun champ n'a été perdu au passage.
 */

export type BankAccountRow = {
  id: string;
  bankName: string;
  balance: string;
  balanceBase?: string;
  currency: string;
  countsInNetWorth: boolean;
  isPro: boolean;
  ownershipPct: string | null;
};

export type SavingsRow = {
  id: string;
  name: string;
  bankName: string | null;
  productType: string;
  ceilingAmount: string | null;
  balance: string;
  displayBalance: string;
  displayBalanceBase?: string;
  apyPercent: string;
  rateType: string;
  payoutFrequency: string;
  payoutDayOfWeek: number | null;
  payoutDayOfMonth: number | null;
  payoutMonth: number | null;
  payoutRuleLabel: string;
  dailyInterest: string;
  periodInterest: string;
  daysElapsed: number;
  currency: string;
  countsInNetWorth: boolean;
  lastPayoutAt: string | null;
  isPro: boolean;
  ownershipPct: string | null;
};

export type TermDepositRow = {
  id: string;
  bankName: string | null;
  principal: string;
  principalBase: string;
  ratePercent: string;
  currency: string;
  openedAt: string;
  maturityDate: string;
  earlyWithdrawalPenaltyPct: string | null;
  isPro: boolean;
  ownershipPct: string | null;
  notes: string | null;
  status: "ACTIVE" | "MATURED";
  daysUntilMaturity: number;
};

export type BanksSummary = {
  checkingTotalBase: string;
  savingsTotalBase: string;
  termDepositTotalBase: string;
  weightedApyPct: string | null;
  projectedAnnualInterestBase: string;
};

/**
 * Ce que la liste passe au panneau : l'identité de l'élément choisi, et la
 * ligne d'origine complète.
 *
 * Un établissement est aussi sélectionnable — c'est le premier niveau de
 * lecture de l'écran, il doit donc pouvoir avoir sa fiche comme les produits.
 */
export type BankSelection =
  | { kind: "CHECKING"; id: string }
  | { kind: "SAVINGS"; id: string }
  | { kind: "TERM_DEPOSIT"; id: string }
  | { kind: "INSTITUTION"; id: string };
