import { d, zero, type Decimal } from "../money/decimal";
import { toEur } from "./fx";
import {
  applyBuy,
  applySell,
  applySplit,
  applyTransferIn,
  applyTransferOut,
  avgCost,
  emptyPosition,
  type CumpPosition,
} from "./cump";
import {
  AccountingError,
  INCOME_TYPES,
  positionKey,
  type ApplyTxOptions,
  type LedgerState,
  type LedgerTx,
  type RealizedLot,
  type TxType,
} from "./types";

export function createEmptyLedger(): LedgerState {
  return {
    positions: new Map(),
    cashByPlatform: new Map(),
    realizedLots: [],
    cashIncomeEur: zero(),
    totalFeesPaidEur: zero(),
  };
}

function getCash(state: LedgerState, platformId: string): Decimal {
  return state.cashByPlatform.get(platformId) ?? zero();
}

function setCash(state: LedgerState, platformId: string, amount: Decimal): void {
  state.cashByPlatform.set(platformId, amount);
}

function addCash(state: LedgerState, platformId: string, delta: Decimal): void {
  setCash(state, platformId, getCash(state, platformId).plus(delta));
}

function getPos(state: LedgerState, assetId: string, platformId: string): CumpPosition {
  const key = positionKey(assetId, platformId);
  const existing = state.positions.get(key);
  if (!existing) return emptyPosition();
  return { quantity: existing.quantity, costBasisEur: existing.costBasisEur };
}

function setPos(state: LedgerState, assetId: string, platformId: string, pos: CumpPosition): void {
  const key = positionKey(assetId, platformId);
  if (pos.quantity.isZero() && pos.costBasisEur.isZero()) {
    state.positions.delete(key);
    return;
  }
  state.positions.set(key, {
    assetId,
    platformId,
    quantity: pos.quantity,
    costBasisEur: pos.costBasisEur,
  });
}

function requireAsset(tx: LedgerTx): string {
  if (!tx.assetId) {
    throw new AccountingError("ASSET_REQUIRED", "Un actif est requis pour cette opération");
  }
  return tx.assetId;
}

function tradeGrossOriginal(tx: LedgerTx): Decimal {
  if (tx.grossOriginal != null) return d(tx.grossOriginal);
  const qty = d(tx.quantity ?? 0);
  const price = d(tx.unitPrice ?? 0);
  return qty.times(price);
}

function cashAmountOriginal(tx: LedgerTx): Decimal {
  if (tx.cashAmountOriginal != null) return d(tx.cashAmountOriginal);
  return tradeGrossOriginal(tx);
}

/**
 * Apply a single transaction.
 *
 * IMPORTANT (personal portfolio model):
 * - ACHAT / VENTE / TRANSFERT_TITRE only affect asset quantities & cost basis (CUMP).
 *   They never touch platform cash.
 * - Cash is ONLY bank liquidity: APPORT, RETRAIT, and optionally income/fees
 *   the user records as cash movements on bank platforms.
 */
export function applyTransaction(
  state: LedgerState,
  tx: LedgerTx,
  _options?: ApplyTxOptions
): LedgerState {
  const feesEur = toEur(tx.fees, tx.fxRateToEur);
  const type = tx.type as TxType;
  const allowNeg = Boolean(_options?.allowNegativeCash || tx.allowNegativeCash);
  const clampOversell = Boolean(_options?.clampOversell);

  switch (type) {
    case "ACHAT": {
      // Positions only — no cash impact
      const assetId = requireAsset(tx);
      const qty = d(tx.quantity ?? 0);
      const unitEur = toEur(tx.unitPrice ?? 0, tx.fxRateToEur);
      const next = applyBuy(getPos(state, assetId, tx.platformId), qty, unitEur, feesEur);
      setPos(state, assetId, tx.platformId, next);
      state.totalFeesPaidEur = state.totalFeesPaidEur.plus(feesEur);
      break;
    }
    case "REWARD": {
      // Staking / airdrop / learning reward : +qty, coût d’acquisition 0 (rien dépensé).
      // unitPrice éventuel = FMV à la réception (audit) — n’entre pas dans le CUMP.
      // Frais éventuels restent comptés en fees globaux, pas en PRU (récompense gratuite).
      const assetId = requireAsset(tx);
      const qty = d(tx.quantity ?? 0);
      if (qty.lte(0)) {
        throw new AccountingError(
          "INVALID_QTY",
          "Quantité de récompense strictement positive requise"
        );
      }
      const next = applyBuy(getPos(state, assetId, tx.platformId), qty, 0, 0);
      setPos(state, assetId, tx.platformId, next);
      if (feesEur.gt(0)) {
        state.totalFeesPaidEur = state.totalFeesPaidEur.plus(feesEur);
      }
      break;
    }
    case "VENTE": {
      // Positions + realized P&L only — sale proceeds do NOT increase bank cash
      const assetId = requireAsset(tx);
      let qty = d(tx.quantity ?? 0);
      const unitEur = toEur(tx.unitPrice ?? 0, tx.fxRateToEur);
      const pos = getPos(state, assetId, tx.platformId);
      if (clampOversell) {
        if (pos.quantity.lte(0) || qty.lte(0)) break;
        if (pos.quantity.lt(qty)) qty = pos.quantity;
      }
      const result = applySell(pos, qty, unitEur, feesEur);
      setPos(state, assetId, tx.platformId, result.position);
      const lot: RealizedLot = {
        assetId,
        platformId: tx.platformId,
        quantity: qty,
        proceedsEur: result.proceedsEur,
        costBasisEur: result.costReleasedEur,
        feesEur: result.feesEur,
        realizedPnlEur: result.realizedPnlEur,
        occurredAt: tx.occurredAt,
      };
      state.realizedLots.push(lot);
      state.totalFeesPaidEur = state.totalFeesPaidEur.plus(feesEur);
      break;
    }
    case "DIVIDENDE":
    case "COUPON":
    case "LOYER":
    case "INTERET": {
      // Cash income net de WHT (prélèvement source) et frais courtier
      const grossEur = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      let whtEur = d(0);
      if (tx.withholdingTaxEur != null && !d(tx.withholdingTaxEur).isZero()) {
        whtEur = d(tx.withholdingTaxEur);
      } else if (tx.withholdingTaxRate != null && d(tx.withholdingTaxRate).gt(0)) {
        whtEur = grossEur.times(d(tx.withholdingTaxRate));
      }
      const amountEur = grossEur.minus(whtEur).minus(feesEur);
      if (amountEur.lt(0)) {
        throw new AccountingError("INVALID_AMOUNT", "Le revenu net ne peut pas être négatif");
      }
      addCash(state, tx.platformId, amountEur);
      state.cashIncomeEur = state.cashIncomeEur.plus(amountEur);
      state.totalFeesPaidEur = state.totalFeesPaidEur.plus(feesEur);
      break;
    }
    case "FRAIS": {
      // Bank fees only (not trade fees — those are on ACHAT/VENTE)
      const amountEur = toEur(cashAmountOriginal(tx), tx.fxRateToEur).plus(feesEur);
      const newCash = getCash(state, tx.platformId).minus(amountEur);
      if (newCash.lt(0) && !allowNeg) {
        throw new AccountingError("INSUFFICIENT_CASH", "Cash bancaire insuffisant pour ces frais");
      }
      setCash(state, tx.platformId, newCash);
      state.totalFeesPaidEur = state.totalFeesPaidEur.plus(amountEur);
      break;
    }
    case "APPORT": {
      // Declare / deposit bank cash (livret, compte courant, etc.)
      const amountEur = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      if (amountEur.lte(0)) {
        throw new AccountingError("INVALID_AMOUNT", "L'apport doit être strictement positif");
      }
      addCash(state, tx.platformId, amountEur);
      break;
    }
    case "RETRAIT": {
      const amountEur = toEur(cashAmountOriginal(tx), tx.fxRateToEur).plus(feesEur);
      const newCash = getCash(state, tx.platformId).minus(amountEur);
      if (newCash.lt(0) && !allowNeg) {
        throw new AccountingError("INSUFFICIENT_CASH", "Cash bancaire insuffisant pour le retrait");
      }
      setCash(state, tx.platformId, newCash);
      state.totalFeesPaidEur = state.totalFeesPaidEur.plus(feesEur);
      break;
    }
    case "TRANSFERT_CASH": {
      if (!tx.toPlatformId) {
        throw new AccountingError("TO_PLATFORM_REQUIRED", "Plateforme de destination requise");
      }
      if (tx.toPlatformId === tx.platformId) {
        throw new AccountingError("SAME_PLATFORM", "Les plateformes source et destination doivent différer");
      }
      const amountEur = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      if (amountEur.lte(0)) {
        throw new AccountingError("INVALID_AMOUNT", "Le montant du transfert doit être positif");
      }
      const totalOut = amountEur.plus(feesEur);
      const newCash = getCash(state, tx.platformId).minus(totalOut);
      if (newCash.lt(0) && !allowNeg) {
        throw new AccountingError("INSUFFICIENT_CASH", "Cash insuffisant pour le transfert");
      }
      setCash(state, tx.platformId, newCash);
      addCash(state, tx.toPlatformId, amountEur);
      state.totalFeesPaidEur = state.totalFeesPaidEur.plus(feesEur);
      break;
    }
    case "TRANSFERT_TITRE": {
      const assetId = requireAsset(tx);
      if (!tx.toPlatformId) {
        throw new AccountingError("TO_PLATFORM_REQUIRED", "Plateforme de destination requise");
      }
      if (tx.toPlatformId === tx.platformId) {
        throw new AccountingError("SAME_PLATFORM", "Les plateformes source et destination doivent différer");
      }
      const qty = d(tx.quantity ?? 0);
      const { remaining, moved } = applyTransferOut(getPos(state, assetId, tx.platformId), qty);
      setPos(state, assetId, tx.platformId, remaining);
      setPos(state, assetId, tx.toPlatformId, applyTransferIn(getPos(state, assetId, tx.toPlatformId), moved));
      // No cash impact for title transfers
      break;
    }
    case "SPLIT": {
      // quantity = ratio multiplicatif (2 = 2-for-1). Coût total inchangé, pas de cash.
      const assetId = requireAsset(tx);
      const ratio = d(tx.quantity ?? 0);
      const next = applySplit(getPos(state, assetId, tx.platformId), ratio);
      setPos(state, assetId, tx.platformId, next);
      break;
    }
    default:
      throw new AccountingError("UNKNOWN_TYPE", `Type de transaction inconnu: ${type}`);
  }

  return state;
}

/** Replay ordered transactions chronologically */
export function replayTransactions(
  transactions: LedgerTx[],
  options?: ApplyTxOptions
): LedgerState {
  const state = createEmptyLedger();
  const sorted = [...transactions].sort((a, b) => {
    const t = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
  for (const tx of sorted) {
    applyTransaction(state, tx, options);
  }
  return state;
}

export function platformCashAfter(state: LedgerState, platformId: string) {
  return state.cashByPlatform.get(platformId) ?? zero();
}

export function totalRealizedPnl(state: LedgerState): Decimal {
  return state.realizedLots.reduce((acc, lot) => acc.plus(lot.realizedPnlEur), zero());
}

export function totalCash(state: LedgerState): Decimal {
  let t = zero();
  for (const v of state.cashByPlatform.values()) t = t.plus(v);
  return t;
}

export function totalCostBasis(state: LedgerState): Decimal {
  let t = zero();
  for (const p of state.positions.values()) t = t.plus(p.costBasisEur);
  return t;
}

export function getAvgCost(state: LedgerState, assetId: string, platformId: string): Decimal {
  return avgCost(getPos(state, assetId, platformId));
}

export function isIncomeType(type: string): boolean {
  return (INCOME_TYPES as string[]).includes(type);
}

/**
 * Signed net cash impact on the source platform (EUR).
 * ACHAT/VENTE = 0 (cash is independent of investments).
 */
export function computeNetCashImpactEur(tx: LedgerTx): {
  grossAmountEur: Decimal;
  feesEur: Decimal;
  netCashImpactEur: Decimal;
} {
  const feesEur = toEur(tx.fees, tx.fxRateToEur);
  switch (tx.type) {
    case "ACHAT": {
      const qty = d(tx.quantity ?? 0);
      const unitEur = toEur(tx.unitPrice ?? 0, tx.fxRateToEur);
      const gross = qty.times(unitEur);
      // No cash impact — still store gross for audit
      return { grossAmountEur: gross, feesEur, netCashImpactEur: zero() };
    }
    case "REWARD": {
      // Quantité reçue gratuitement — pas d’impact cash ni de coût.
      // gross = FMV indicative (qty × unitPrice) si prix fourni, sinon 0.
      const qty = d(tx.quantity ?? 0);
      const unitEur = toEur(tx.unitPrice ?? 0, tx.fxRateToEur);
      const gross = qty.times(unitEur);
      return { grossAmountEur: gross, feesEur, netCashImpactEur: zero() };
    }
    case "VENTE": {
      const qty = d(tx.quantity ?? 0);
      const unitEur = toEur(tx.unitPrice ?? 0, tx.fxRateToEur);
      const gross = qty.times(unitEur);
      return { grossAmountEur: gross, feesEur, netCashImpactEur: zero() };
    }
    case "DIVIDENDE":
    case "COUPON":
    case "LOYER":
    case "INTERET": {
      const gross = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      let whtEur = d(0);
      if (tx.withholdingTaxEur != null && !d(tx.withholdingTaxEur).isZero()) {
        whtEur = d(tx.withholdingTaxEur);
      } else if (tx.withholdingTaxRate != null && d(tx.withholdingTaxRate).gt(0)) {
        whtEur = gross.times(d(tx.withholdingTaxRate));
      }
      return {
        grossAmountEur: gross,
        feesEur,
        netCashImpactEur: gross.minus(whtEur).minus(feesEur),
      };
    }
    case "FRAIS": {
      const gross = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      return { grossAmountEur: gross, feesEur, netCashImpactEur: gross.plus(feesEur).neg() };
    }
    case "APPORT": {
      const gross = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      return { grossAmountEur: gross, feesEur: zero(), netCashImpactEur: gross };
    }
    case "RETRAIT": {
      const gross = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      return { grossAmountEur: gross, feesEur, netCashImpactEur: gross.plus(feesEur).neg() };
    }
    case "TRANSFERT_CASH": {
      const gross = toEur(cashAmountOriginal(tx), tx.fxRateToEur);
      return { grossAmountEur: gross, feesEur, netCashImpactEur: gross.plus(feesEur).neg() };
    }
    case "TRANSFERT_TITRE": {
      const gross = toEur(tradeGrossOriginal(tx), tx.fxRateToEur);
      return { grossAmountEur: gross, feesEur, netCashImpactEur: zero() };
    }
    case "SPLIT": {
      // Ratio stocké en quantity — pas de cash, pas de P&L
      return { grossAmountEur: zero(), feesEur: zero(), netCashImpactEur: zero() };
    }
    default:
      return { grossAmountEur: zero(), feesEur, netCashImpactEur: zero() };
  }
}
