/**
 * Décomposition P&L latent : effet prix vs effet change (non-EUR).
 *
 * Formule (lot unique / CUMP) :
 *   MV  = qty × Pn × FXn
 *   CB  = qty × Pb × FXb   (estimé via achats ledger)
 *   pricePnl = qty × (Pn − Pb) × FXn
 *   fxPnl    = qty × Pb × (FXn − FXb)
 *   total    = pricePnl + fxPnl = MV − CB
 *
 * Si devise EUR : tout est « prix », fx = 0.
 */

export type FxPnlDecomposition = {
  currency: string;
  isEur: boolean;
  qty: number;
  /** CUMP / coût unitaire EUR */
  cumpEur: number;
  costBasisEur: number;
  marketValueEur: number;
  totalUnrealizedEur: number;
  /** Contribution variation de cours (devise native) */
  pricePnlEur: number;
  /** Contribution variation de change */
  fxPnlEur: number;
  /** FX spot (EUR par 1 unité native) — ex. USD 0.92 */
  fxNow: number;
  /** FX moyen pondéré à l'achat (si connu) */
  fxBuy: number | null;
  /** Prix unitaire natif estimé d'achat */
  buyPriceNative: number | null;
  priceNowNative: number;
  /** true si la décomposition est une estimation (FX d'achat manquant) */
  estimated: boolean;
  note: string;
};

function n(v: number | string | null | undefined): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export type BuyLotLite = {
  quantity: number;
  unitPriceNative: number;
  /** EUR per 1 native unit at purchase */
  fxRateToEur: number;
};

/**
 * FX d'achat moyen pondéré + prix natif moyen depuis les lots d'achat.
 */
export function weightedBuyFx(lots: BuyLotLite[]): {
  fxBuy: number;
  buyPriceNative: number;
  totalQty: number;
} | null {
  let qSum = 0;
  let fxNum = 0;
  let pxNum = 0;
  for (const lot of lots) {
    if (lot.quantity <= 0 || lot.fxRateToEur <= 0 || lot.unitPriceNative < 0) continue;
    qSum += lot.quantity;
    fxNum += lot.quantity * lot.fxRateToEur;
    pxNum += lot.quantity * lot.unitPriceNative;
  }
  if (qSum <= 1e-12) return null;
  return {
    fxBuy: fxNum / qSum,
    buyPriceNative: pxNum / qSum,
    totalQty: qSum,
  };
}

/**
 * Décompose la plus-value latente d'une position.
 */
export function decomposeUnrealizedPnl(input: {
  currency: string;
  qty: number;
  costBasisEur: number;
  priceNowNative: number;
  priceNowEur: number;
  /** Lots d'achat restants (idéalement) — sinon estimation */
  buyLots?: BuyLotLite[];
}): FxPnlDecomposition {
  const currency = (input.currency || "EUR").toUpperCase();
  const qty = n(input.qty);
  const costBasisEur = n(input.costBasisEur);
  const priceNowNative = n(input.priceNowNative);
  let priceNowEur = n(input.priceNowEur);
  const cumpEur = qty > 1e-12 ? costBasisEur / qty : 0;

  if (priceNowEur <= 0 && priceNowNative > 0 && currency === "EUR") {
    priceNowEur = priceNowNative;
  }

  const marketValueEur = qty * priceNowEur;
  const totalUnrealizedEur = marketValueEur - costBasisEur;
  const isEur = currency === "EUR" || priceNowNative <= 0;

  if (isEur || qty <= 1e-12) {
    return {
      currency,
      isEur: true,
      qty,
      cumpEur,
      costBasisEur,
      marketValueEur,
      totalUnrealizedEur,
      pricePnlEur: totalUnrealizedEur,
      fxPnlEur: 0,
      fxNow: 1,
      fxBuy: 1,
      buyPriceNative: cumpEur,
      priceNowNative: priceNowEur,
      estimated: false,
      note: "Devise EUR — tout le P&L latent est un effet prix.",
    };
  }

  const fxNow =
    priceNowNative > 1e-12 ? priceNowEur / priceNowNative : n(input.priceNowEur) > 0 ? 1 : 1;

  const w = weightedBuyFx(input.buyLots ?? []);
  if (w && w.fxBuy > 0 && w.buyPriceNative >= 0) {
    const pricePnlEur = qty * (priceNowNative - w.buyPriceNative) * fxNow;
    const fxPnlEur = qty * w.buyPriceNative * (fxNow - w.fxBuy);
    // Recaler pour coller exactement au total (arrondis / renforts)
    const raw = pricePnlEur + fxPnlEur;
    const scale =
      Math.abs(raw) > 1e-6 && Math.abs(totalUnrealizedEur) > 1e-6
        ? totalUnrealizedEur / raw
        : 1;
    const p = pricePnlEur * (Number.isFinite(scale) ? scale : 1);
    const f = totalUnrealizedEur - p;
    return {
      currency,
      isEur: false,
      qty,
      cumpEur,
      costBasisEur,
      marketValueEur,
      totalUnrealizedEur,
      pricePnlEur: p,
      fxPnlEur: f,
      fxNow,
      fxBuy: w.fxBuy,
      buyPriceNative: w.buyPriceNative,
      priceNowNative,
      estimated: false,
      note: "Décomposition prix / change à partir des lots d'achat (FX pondéré).",
    };
  }

  // Fallback : sans historique FX, on ne peut pas séparer proprement
  return {
    currency,
    isEur: false,
    qty,
    cumpEur,
    costBasisEur,
    marketValueEur,
    totalUnrealizedEur,
    pricePnlEur: totalUnrealizedEur,
    fxPnlEur: 0,
    fxNow,
    fxBuy: null,
    buyPriceNative: null,
    priceNowNative,
    estimated: true,
    note: "FX d'achat inconnu — P&L affiché en total (pas de split prix/change fiable).",
  };
}
