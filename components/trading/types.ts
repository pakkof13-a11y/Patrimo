/**
 * Formes renvoyées par `/api/trading`.
 *
 * Partagées entre les panneaux plutôt que redéclarées dans chacun : deux
 * copies d'un même contrat finissent toujours par diverger.
 */

export type TradingAccountRow = {
  id: string;
  brokerName: string;
  accountType: string;
  accountTypeLabel: string;
  currency: string;
  balance: string;
  marginAvailable: string | null;
  openDate: string | null;
  notes: string | null;
  positionCount: number;
  openPositionCount: number;
};

export type TradingPositionRow = {
  id: string;
  tradingAccountId: string | null;
  underlyingType: string;
  exchange: string;
  instrument: string;
  contractType: string;
  direction: string;
  leverage: string;
  sizeContracts: string;
  entryPrice: string;
  markPrice: string | null;
  expiryDate: string | null;
  fundingPaid: string | null;
  commissionPaid: string | null;
  unrealizedPnl: string | null;
  realizedPnl: string | null;
  isOpen: boolean;
  openedAt: string | null;
  closedAt: string | null;
};

export type TradingAnalyticsRow = {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  breakEvenCount: number;
  winRatePct: string | null;
  grossProfitEur: string;
  grossLossEur: string;
  netPnlEur: string;
  averageWinEur: string | null;
  averageLossEur: string | null;
  riskRewardRatio: string | null;
  profitFactor: string | null;
  maxDrawdownEur: string;
  bestTradeEur: string | null;
  worstTradeEur: string | null;
  averageHoldingDays: number | null;
};

export type TradingFiscalRow = {
  year: number;
  grossGainsEur: string;
  grossLossesEur: string;
  feesEur: string;
  netBeforeCarryEur: string;
  carryUsedEur: string;
  taxableEur: string;
  newLossEur: string;
  expiredEur: string;
  carryForwardEur: string;
  carryForward: { year: number; remainingEur: string }[];
  pfu: {
    incomeTaxEur: string;
    socialChargesEur: string;
    totalEur: string;
    effectiveRatePct: string;
  };
  /** `null` tant qu'aucune tranche marginale n'a été fournie. */
  bareme: {
    marginalRatePct: string;
    incomeTaxEur: string;
    socialChargesEur: string;
    totalEur: string;
    effectiveRatePct: string;
  } | null;
  cheaper: "PFU" | "BAREME" | "EQUAL" | null;
};

export type TradingBundle = {
  accounts: TradingAccountRow[];
  positions: TradingPositionRow[];
  analytics: TradingAnalyticsRow;
  fiscal: TradingFiscalRow;
};
