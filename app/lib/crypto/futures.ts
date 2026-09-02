/**
 * Positions futures / perpétuelles — calculs purs, sans accès Prisma.
 *
 * Une position à levier n'est pas une position détenue : ce qui compte au
 * patrimoine n'est pas « quantité × prix » mais la marge engagée plus le P&L
 * latent — c'est ce qu'on récupérerait en clôturant maintenant. C'est pour
 * cette raison que ce module ne s'appuie pas sur `Asset` / le journal, à la
 * différence du spot et de la DeFi : il n'y a rien de « détenu », seulement un
 * contrat et un dépôt de garantie.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";

export type FuturesDirection = "LONG" | "SHORT";

export type FuturesPositionInput = {
  id: string;
  exchange: string;
  pair: string;
  direction: FuturesDirection;
  leverage: Decimal;
  sizeContracts: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal | null;
  marginUsed: Decimal | null;
  fundingPaid: Decimal | null;
  commissionPaid: Decimal | null;
};

/**
 * Taux de maintenance par défaut pour l'estimation du prix de liquidation.
 *
 * Chaque exchange a son propre barème par palier de notionnel — Aurea n'y a
 * pas accès. 0,5 % est une hypothèse conservatrice courante sur les paires
 * majeures à levier modéré : elle donne une distance de sécurité indicative,
 * pas une valeur contractuelle. D'où « estimé » partout où ce nombre apparaît.
 */
export const DEFAULT_MAINTENANCE_MARGIN_RATE = d("0.005");

/** Marge requise à l'ouverture — notionnel divisé par le levier. */
export function requiredMargin(notionalUsd: Decimal, leverage: Decimal): Decimal {
  if (leverage.lte(0)) return d(0);
  return notionalUsd.div(leverage);
}

export function notionalOf(sizeContracts: Decimal, price: Decimal): Decimal {
  return sizeContracts.abs().times(price);
}

/**
 * Prix de liquidation estimé (marge isolée, approximation linéaire standard) :
 *
 * - LONG  : entry × (1 − 1/levier + maintenance)
 * - SHORT : entry × (1 + 1/levier − maintenance)
 *
 * Une approximation, pas un calcul contractuel — un levier x100 avec une
 * maintenance nulle donnerait un prix de liquidation à 1 % de l'entrée, ce qui
 * correspond à l'ordre de grandeur réel sans prétendre reproduire le barème
 * exact de chaque exchange.
 */
export function estimatedLiquidationPrice(
  direction: FuturesDirection,
  entryPrice: Decimal,
  leverage: Decimal,
  maintenanceMarginRate: Decimal = DEFAULT_MAINTENANCE_MARGIN_RATE
): Decimal | null {
  if (leverage.lte(0) || entryPrice.lte(0)) return null;
  const inv = d(1).div(leverage);
  if (direction === "LONG") {
    const factor = d(1).minus(inv).plus(maintenanceMarginRate);
    return factor.lte(0) ? d(0) : entryPrice.times(factor);
  }
  const factor = d(1).plus(inv).minus(maintenanceMarginRate);
  return entryPrice.times(factor);
}

/** Distance au prix de liquidation, en % du prix actuel — jamais négative. */
export function distanceToLiquidationPct(
  markPrice: Decimal,
  liquidationPrice: Decimal | null
): Decimal | null {
  if (liquidationPrice == null || markPrice.lte(0)) return null;
  return markPrice.minus(liquidationPrice).abs().div(markPrice).times(100);
}

/** Seuil sous lequel la position est signalée proche de la liquidation. */
export const LIQUIDATION_ALERT_DISTANCE_PCT = 15;

/** Funding cumulé au-delà duquel il pèse significativement sur la marge. */
export const FUNDING_ALERT_RATIO_PCT = 1;

export function isLiquidationAlert(distancePct: number | null): boolean {
  return distancePct != null && distancePct < LIQUIDATION_ALERT_DISTANCE_PCT;
}

export function isFundingAlert(
  fundingPaid: Decimal | null,
  marginUsed: Decimal | null
): boolean {
  if (!fundingPaid || !marginUsed || marginUsed.lte(0)) return false;
  return fundingPaid.abs().div(marginUsed).times(100).gt(FUNDING_ALERT_RATIO_PCT);
}

/**
 * P&L latent d'une position ouverte.
 *
 * Signe selon le sens : un LONG gagne quand le marché monte, un SHORT quand il
 * baisse. Les deux formules sont symétriques — un LONG et un SHORT ouverts au
 * même prix, sur la même taille, avec le même mouvement de marché, donnent des
 * P&L opposés au signe près.
 */
export function unrealizedPnl(
  direction: FuturesDirection,
  sizeContracts: Decimal,
  entryPrice: Decimal,
  markPrice: Decimal
): Decimal {
  const size = sizeContracts.abs();
  return direction === "LONG"
    ? size.times(markPrice.minus(entryPrice))
    : size.times(entryPrice.minus(markPrice));
}

export type FuturesPositionView = {
  id: string;
  exchange: string;
  pair: string;
  direction: FuturesDirection;
  leverage: Decimal;
  notionalUsd: Decimal;
  marginUsed: Decimal;
  liquidationPrice: Decimal | null;
  distanceToLiquidationPct: number | null;
  unrealizedPnlEur: Decimal;
  liquidationAlert: boolean;
  fundingAlert: boolean;
  /** Contribution signée à l'exposition nette : + pour LONG, − pour SHORT. */
  signedNotional: Decimal;
};

/** Enrichit une position brute de tous les calculs dérivés. */
export function toFuturesView(p: FuturesPositionInput): FuturesPositionView {
  const notional = notionalOf(p.sizeContracts, p.entryPrice);
  const margin = p.marginUsed ?? requiredMargin(notional, p.leverage);
  const liqPrice = estimatedLiquidationPrice(p.direction, p.entryPrice, p.leverage);
  const distPct = p.markPrice
    ? distanceToLiquidationPct(p.markPrice, liqPrice)?.toNumber() ?? null
    : null;
  const pnl = p.markPrice
    ? unrealizedPnl(p.direction, p.sizeContracts, p.entryPrice, p.markPrice)
    : d(0);

  return {
    id: p.id,
    exchange: p.exchange,
    pair: p.pair,
    direction: p.direction,
    leverage: p.leverage,
    notionalUsd: notional,
    marginUsed: margin,
    liquidationPrice: liqPrice,
    distanceToLiquidationPct: distPct,
    unrealizedPnlEur: pnl,
    liquidationAlert: isLiquidationAlert(distPct),
    fundingAlert: isFundingAlert(p.fundingPaid, margin),
    signedNotional: p.direction === "LONG" ? notional : notional.neg(),
  };
}

export type FuturesSummary = {
  /** Somme des marges engagées sur les positions ouvertes. */
  totalMarginEur: Decimal;
  /** Exposition nette : notionnel long moins notionnel short. */
  netExposureEur: Decimal;
  /** Somme du P&L latent des positions ouvertes. */
  unrealizedPnlEur: Decimal;
  positionCount: number;
  liquidationAlerts: number;
};

export function summarizeFutures(positions: FuturesPositionInput[]): FuturesSummary {
  let margin = d(0);
  let netExposure = d(0);
  let pnl = d(0);
  let alerts = 0;

  for (const raw of positions) {
    const v = toFuturesView(raw);
    margin = margin.plus(v.marginUsed);
    netExposure = netExposure.plus(v.signedNotional);
    pnl = pnl.plus(v.unrealizedPnlEur);
    if (v.liquidationAlert) alerts += 1;
  }

  return {
    totalMarginEur: margin,
    netExposureEur: netExposure,
    unrealizedPnlEur: pnl,
    positionCount: positions.length,
    liquidationAlerts: alerts,
  };
}

/** P&L net d'une position clôturée : réalisé, funding et commissions inclus. */
export function realizedNetPnl(input: {
  realizedPnl: Decimal | null;
  fundingPaid: Decimal | null;
  commissionPaid: Decimal | null;
}): Decimal {
  const realized = input.realizedPnl ?? d(0);
  // Funding et commission sont des coûts : ils réduisent toujours le net,
  // qu'ils soient stockés en valeur positive (montant payé) ou déjà signés.
  const funding = input.fundingPaid ?? d(0);
  const commission = input.commissionPaid ?? d(0);
  return realized.minus(funding.abs()).minus(commission.abs());
}
