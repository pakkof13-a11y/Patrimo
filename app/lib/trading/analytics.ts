/**
 * Analytique du journal de trading — fonctions pures, sans accès Prisma.
 *
 * Ces indicateurs ne portent que sur les positions **clôturées**. Une position
 * ouverte n'a pas de résultat, seulement un P&L latent qui peut encore
 * s'inverser : la compter fausserait le taux de réussite dans le sens le plus
 * flatteur, puisqu'un trader coupe ses gains et laisse courir ses pertes bien
 * plus souvent que l'inverse.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";

export type ClosedTrade = {
  /** Résultat net de l'opération, négatif pour une perte. */
  realizedPnlEur: Decimal;
  openedAt: Date | null;
  closedAt: Date | null;
};

export type TradingAnalytics = {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  /** Opérations closes exactement à l'équilibre — ni gain ni perte. */
  breakEvenCount: number;

  /**
   * Part d'opérations gagnantes, en %. `null` sans aucune opération close —
   * afficher 0 % laisserait croire à une série perdante.
   */
  winRatePct: Decimal | null;

  grossProfitEur: Decimal;
  /** Somme des pertes, en valeur absolue. */
  grossLossEur: Decimal;
  netPnlEur: Decimal;

  averageWinEur: Decimal | null;
  averageLossEur: Decimal | null;
  /**
   * Rapport gain moyen / perte moyenne. `null` en l'absence de perte : le
   * ratio serait infini, ce qui n'est pas une information exploitable.
   */
  riskRewardRatio: Decimal | null;

  /**
   * Profit brut rapporté aux pertes brutes. Au-dessus de 1, la stratégie
   * gagne. `null` sans aucune perte, pour la même raison que ci-dessus.
   */
  profitFactor: Decimal | null;

  /**
   * Plus forte baisse cumulée depuis un sommet, en euros, sur la courbe des
   * résultats pris dans l'ordre de clôture. Toujours positive ou nulle.
   */
  maxDrawdownEur: Decimal;

  bestTradeEur: Decimal | null;
  worstTradeEur: Decimal | null;
  /** Durée moyenne de détention, en jours. */
  averageHoldingDays: number | null;
};

/**
 * Statistiques d'un ensemble d'opérations clôturées.
 *
 * Les opérations sont triées par date de clôture avant le calcul du drawdown :
 * celui-ci mesure un enchaînement dans le temps, l'ordre de lecture en base
 * n'aurait aucun sens ici.
 */
export function computeTradingAnalytics(
  trades: readonly ClosedTrade[]
): TradingAnalytics {
  const empty: TradingAnalytics = {
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    breakEvenCount: 0,
    winRatePct: null,
    grossProfitEur: d(0),
    grossLossEur: d(0),
    netPnlEur: d(0),
    averageWinEur: null,
    averageLossEur: null,
    riskRewardRatio: null,
    profitFactor: null,
    maxDrawdownEur: d(0),
    bestTradeEur: null,
    worstTradeEur: null,
    averageHoldingDays: null,
  };
  if (trades.length === 0) return empty;

  let grossProfit = d(0);
  let grossLoss = d(0);
  let winCount = 0;
  let lossCount = 0;
  let breakEvenCount = 0;
  let best: Decimal | null = null;
  let worst: Decimal | null = null;

  let holdingDaysSum = 0;
  let holdingCount = 0;

  for (const t of trades) {
    const pnl = t.realizedPnlEur;
    if (pnl.gt(0)) {
      winCount += 1;
      grossProfit = grossProfit.plus(pnl);
    } else if (pnl.lt(0)) {
      lossCount += 1;
      grossLoss = grossLoss.plus(pnl.abs());
    } else {
      breakEvenCount += 1;
    }

    if (best == null || pnl.gt(best)) best = pnl;
    if (worst == null || pnl.lt(worst)) worst = pnl;

    if (t.openedAt && t.closedAt) {
      const ms = t.closedAt.getTime() - t.openedAt.getTime();
      if (ms >= 0) {
        holdingDaysSum += ms / 86_400_000;
        holdingCount += 1;
      }
    }
  }

  // Le drawdown suit la chronologie de clôture : une position soldée en
  // janvier ne peut pas creuser un creux de décembre.
  const ordered = [...trades].sort((a, b) => {
    const ta = a.closedAt?.getTime() ?? 0;
    const tb = b.closedAt?.getTime() ?? 0;
    return ta - tb;
  });
  let equity = d(0);
  let peak = d(0);
  let maxDrawdown = d(0);
  for (const t of ordered) {
    equity = equity.plus(t.realizedPnlEur);
    if (equity.gt(peak)) peak = equity;
    const drawdown = peak.minus(equity);
    if (drawdown.gt(maxDrawdown)) maxDrawdown = drawdown;
  }

  const averageWin = winCount > 0 ? grossProfit.div(winCount) : null;
  const averageLoss = lossCount > 0 ? grossLoss.div(lossCount) : null;

  return {
    tradeCount: trades.length,
    winCount,
    lossCount,
    breakEvenCount,
    winRatePct: d(winCount).div(trades.length).times(100),
    grossProfitEur: grossProfit,
    grossLossEur: grossLoss,
    netPnlEur: grossProfit.minus(grossLoss),
    averageWinEur: averageWin,
    averageLossEur: averageLoss,
    riskRewardRatio:
      averageWin && averageLoss && averageLoss.gt(0)
        ? averageWin.div(averageLoss)
        : null,
    profitFactor: grossLoss.gt(0) ? grossProfit.div(grossLoss) : null,
    maxDrawdownEur: maxDrawdown,
    bestTradeEur: best,
    worstTradeEur: worst,
    averageHoldingDays:
      holdingCount > 0 ? holdingDaysSum / holdingCount : null,
  };
}
