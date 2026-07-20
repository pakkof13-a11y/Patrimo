import type { Decimal } from "../money/decimal";
// Decimal is a type alias for decimal.js instances

export const TX_TYPES = [
  "ACHAT",
  "VENTE",
  "DIVIDENDE",
  "COUPON",
  "LOYER",
  "INTERET",
  /**
   * Réception gratuite d’actifs (staking, learning reward…) :
   * +quantité, coût d’acquisition 0 (rien dépensé) — distinct d’un ACHAT.
   * unitPrice optionnel = valeur de marché à la réception (affichage / notes), pas de CUMP.
   */
  "REWARD",
  /**
   * Airdrop token (réception gratuite hors staking) — même ledger que REWARD
   * (+qty, coût 0). Séparé pour filtre / reporting.
   */
  "AIRDROP",
  "FRAIS",
  "APPORT",
  "RETRAIT",
  "TRANSFERT_CASH",
  "TRANSFERT_TITRE",
  /** Split / reverse split : quantity = ratio (ex. 2 = 2-for-1). Coût total inchangé. */
  "SPLIT",
] as const;

export type TxType = (typeof TX_TYPES)[number];

export const INCOME_TYPES: TxType[] = ["DIVIDENDE", "COUPON", "LOYER", "INTERET"];

export type LedgerTx = {
  id: string;
  type: TxType;
  platformId: string;
  toPlatformId?: string | null;
  assetId?: string | null;
  quantity?: Decimal | null;
  unitPrice?: Decimal | null;
  fees: Decimal;
  currency: string;
  fxRateToEur: Decimal;
  /** Gross trade amount in original currency (qty * unitPrice) when applicable */
  grossOriginal?: Decimal | null;
  /** Explicit cash amount in original currency (income, apport, retrait, frais) */
  cashAmountOriginal?: Decimal | null;
  /** WHT rate 0–1 for DIVIDENDE/COUPON (snapshot) */
  withholdingTaxRate?: Decimal | null;
  /** Optional absolute WHT EUR if already known */
  withholdingTaxEur?: Decimal | null;
  occurredAt: Date;
  /** When true, ACHAT/RETRAIT/FRAIS may drive platform cash negative */
  allowNegativeCash?: boolean;
};

export type ApplyTxOptions = {
  /** Default false — set true for immobilier / financed purchases */
  allowNegativeCash?: boolean;
  /**
   * Si true, une VENTE qui dépasse le stock est bornée à la qty dispo
   * (ou ignorée si 0). Sert au replay historique / seed incohérent —
   * jamais pour la validation d'écriture temps réel.
   */
  clampOversell?: boolean;
};

export type PositionKey = string; // `${assetId}::${platformId}`

export type Position = {
  assetId: string;
  platformId: string;
  quantity: Decimal;
  /** Total remaining acquisition cost in EUR (CUMP * qty) */
  costBasisEur: Decimal;
};

export type PlatformCash = {
  platformId: string;
  cashEur: Decimal;
};

export type RealizedLot = {
  assetId: string;
  platformId: string;
  quantity: Decimal;
  proceedsEur: Decimal;
  costBasisEur: Decimal;
  feesEur: Decimal;
  realizedPnlEur: Decimal;
  occurredAt: Date;
};

export type LedgerState = {
  positions: Map<PositionKey, Position>;
  cashByPlatform: Map<string, Decimal>;
  realizedLots: RealizedLot[];
  /** Cumulative cash income (div/coupon/rent/interest) in EUR */
  cashIncomeEur: Decimal;
  /** Cumulative absolute fees paid (FRAIS type + trade fees already in CUMP/proceeds) */
  totalFeesPaidEur: Decimal;
};

export type HoldingView = {
  assetId: string;
  platformId: string;
  quantity: string;
  avgCostEur: string;
  costBasisEur: string;
  currentPriceEur: string;
  marketValueEur: string;
  unrealizedPnlEur: string;
  unrealizedPnlPct: string;
};

export type PortfolioKpis = {
  totalMarketValueEur: string;
  totalCostBasisEur: string;
  totalCashEur: string;
  unrealizedPnlEur: string;
  realizedPnlEur: string;
  cashIncomeEur: string;
  totalReturnEur: string;
  assetCount: number;
};

export class AccountingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountingError";
    this.code = code;
  }
}

export function positionKey(assetId: string, platformId: string): PositionKey {
  return `${assetId}::${platformId}`;
}
