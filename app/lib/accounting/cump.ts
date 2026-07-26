import { d, zero, type Decimal, type DecimalInput } from "../money/decimal";
// CUMP helpers — pure Decimal math
import { AccountingError } from "./types";

export type CumpPosition = {
  quantity: Decimal;
  /** Total cost basis remaining in EUR */
  costBasisEur: Decimal;
};

export function emptyPosition(): CumpPosition {
  return { quantity: zero(), costBasisEur: zero() };
}

/** Weighted average unit cost (CUMP) */
export function avgCost(pos: CumpPosition): Decimal {
  if (pos.quantity.isZero()) return zero();
  return pos.costBasisEur.div(pos.quantity);
}

/**
 * Purchase: fees increase acquisition cost.
 * costAdded = (qty * unitPrice + fees) in EUR
 */
export function applyBuy(
  pos: CumpPosition,
  quantity: DecimalInput,
  unitPriceEur: DecimalInput,
  feesEur: DecimalInput = 0
): CumpPosition {
  const qty = d(quantity);
  if (qty.lte(0)) {
    throw new AccountingError("INVALID_QTY", "La quantité d'achat doit être strictement positive");
  }
  const cost = qty.times(d(unitPriceEur)).plus(d(feesEur));
  return {
    quantity: pos.quantity.plus(qty),
    costBasisEur: pos.costBasisEur.plus(cost),
  };
}

/**
 * Dépense capitalisée sur une position existante : le coût de revient augmente,
 * la quantité ne bouge pas.
 *
 * Sert aux travaux immobiliers immobilisés. `applyBuy` ne peut pas s'en charger :
 * il exige une quantité strictement positive, à juste titre — un achat sans
 * quantité n'a pas de sens. Des travaux, si : on ne détient pas « plus de
 * maison » après avoir refait la toiture, mais elle a coûté davantage.
 *
 * Conséquence directe et voulue : le prix de revient unitaire monte, et la
 * plus-value calculée à la revente est diminuée d'autant — ce qui est
 * exactement le traitement attendu de travaux capitalisés.
 *
 * Une position inexistante est refusée. L'accepter créerait une ligne de
 * quantité nulle portant un coût positif : elle gonflerait le coût de revient
 * du portefeuille sans aucune contrepartie visible.
 */
export function applyCapitalisedCost(
  pos: CumpPosition,
  amountEur: DecimalInput
): CumpPosition {
  const amount = d(amountEur);
  if (amount.lte(0)) {
    throw new AccountingError(
      "INVALID_AMOUNT",
      "Le montant capitalisé doit être strictement positif"
    );
  }
  if (pos.quantity.lte(0)) {
    throw new AccountingError(
      "NO_POSITION",
      "Aucune position à laquelle rattacher cette dépense"
    );
  }
  return {
    quantity: pos.quantity,
    costBasisEur: pos.costBasisEur.plus(amount),
  };
}

export type SellResult = {
  position: CumpPosition;
  costReleasedEur: Decimal;
  proceedsEur: Decimal;
  realizedPnlEur: Decimal;
  feesEur: Decimal;
};

/**
 * Sale: fees reduce sale proceeds.
 * realized = (qty * unitPrice - fees) - costReleased
 * costReleased = CUMP * qty
 */
export function applySell(
  pos: CumpPosition,
  quantity: DecimalInput,
  unitPriceEur: DecimalInput,
  feesEur: DecimalInput = 0
): SellResult {
  const qty = d(quantity);
  if (qty.lte(0)) {
    throw new AccountingError("INVALID_QTY", "La quantité de vente doit être strictement positive");
  }
  if (pos.quantity.lt(qty)) {
    throw new AccountingError(
      "INSUFFICIENT_QTY",
      `Quantité insuffisante : disponible ${pos.quantity.toFixed(8)}, demandé ${qty.toFixed(8)}`
    );
  }

  const cump = avgCost(pos);
  const costReleased = cump.times(qty);
  const fees = d(feesEur);
  const proceeds = qty.times(d(unitPriceEur)).minus(fees);
  const realized = proceeds.minus(costReleased);

  const newQty = pos.quantity.minus(qty);
  const newCost = newQty.isZero() ? zero() : pos.costBasisEur.minus(costReleased);

  return {
    position: {
      quantity: newQty,
      costBasisEur: maxZero(newCost),
    },
    costReleasedEur: costReleased,
    proceedsEur: proceeds,
    realizedPnlEur: realized,
    feesEur: fees,
  };
}

/**
 * Transfer titles between platforms: move qty and proportional cost. No P&L.
 */
export function applyTransferOut(
  pos: CumpPosition,
  quantity: DecimalInput
): { remaining: CumpPosition; moved: CumpPosition } {
  const qty = d(quantity);
  if (qty.lte(0)) {
    throw new AccountingError("INVALID_QTY", "La quantité de transfert doit être strictement positive");
  }
  if (pos.quantity.lt(qty)) {
    throw new AccountingError(
      "INSUFFICIENT_QTY",
      `Quantité insuffisante pour transfert : disponible ${pos.quantity.toFixed(8)}`
    );
  }
  const cump = avgCost(pos);
  const movedCost = cump.times(qty);
  const newQty = pos.quantity.minus(qty);
  return {
    remaining: {
      quantity: newQty,
      costBasisEur: newQty.isZero() ? zero() : maxZero(pos.costBasisEur.minus(movedCost)),
    },
    moved: {
      quantity: qty,
      costBasisEur: movedCost,
    },
  };
}

export function applyTransferIn(pos: CumpPosition, incoming: CumpPosition): CumpPosition {
  return {
    quantity: pos.quantity.plus(incoming.quantity),
    costBasisEur: pos.costBasisEur.plus(incoming.costBasisEur),
  };
}

/**
 * Corporate action — split / reverse split.
 * `ratio` = facteur multiplicatif de quantité (2 = 2-for-1, 0.5 = reverse 1-for-2).
 * Coût total EUR inchangé → CUMP unitaire divisé par le ratio.
 */
export function applySplit(pos: CumpPosition, ratio: DecimalInput): CumpPosition {
  const r = d(ratio);
  if (r.lte(0)) {
    throw new AccountingError(
      "INVALID_QTY",
      "Le ratio de split doit être strictement positif (ex. 2 pour un 2-for-1)"
    );
  }
  if (pos.quantity.lte(0)) {
    throw new AccountingError(
      "INSUFFICIENT_QTY",
      "Aucune position à splitter sur cette plateforme"
    );
  }
  return {
    quantity: pos.quantity.times(r),
    costBasisEur: pos.costBasisEur,
  };
}

function maxZero(v: Decimal): Decimal {
  return v.lt(0) ? zero() : v;
}
