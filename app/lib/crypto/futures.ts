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
  /**
   * Toujours connu : la création manuelle valide un levier strictement
   * positif, et l'import CSV rejette une ligne dont le relevé n'en fournit
   * pas (TRA-02) plutôt que d'en fabriquer un.
   */
  leverage: Decimal;
  sizeContracts: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal | null;
  marginUsed: Decimal | null;
  fundingPaid: Decimal | null;
  commissionPaid: Decimal | null;
  /** USDT_M | COIN_M | undefined (CFD, spot-like) — absent = comportement linéaire historique. */
  marginType?: string | null;
  /**
   * Valeur d'un contrat COIN-M dans la devise de cotation (TRA-03).
   *
   * Un contrat inverse n'a pas un notionnel de `taille × prix` — c'est
   * `taille × valeur du contrat`, une constante par exchange/symbole qu'Aurea
   * ne connaît pas. `null` (le cas de toutes les positions aujourd'hui) rend
   * le notionnel et le P&L de cette position UNKNOWN plutôt qu'un chiffre
   * calculé avec la mauvaise formule.
   */
  contractValue?: Decimal | null;
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

/**
 * Marge requise à l'ouverture — notionnel divisé par le levier.
 *
 * `null` si le notionnel est inconnu (TRA-03, contrat COIN-M sans valeur de
 * contrat) : une marge calculée à partir d'une hypothèse serait une marge
 * fabriquée, pas calculée.
 */
export function requiredMargin(
  notionalUsd: Decimal | null,
  leverage: Decimal
): Decimal | null {
  if (notionalUsd == null) return null;
  if (leverage.lte(0)) return d(0);
  return notionalUsd.div(leverage);
}

/** Notionnel linéaire (USDT-M / CFD) : taille × prix. */
export function notionalOf(sizeContracts: Decimal, price: Decimal): Decimal {
  return sizeContracts.abs().times(price);
}

/**
 * Notionnel d'une position, en tenant compte du type de contrat (TRA-03).
 *
 * USDT-M / CFD (comportement historique, inchangé) : taille × prix d'entrée.
 * COIN-M : taille × valeur du contrat — si cette valeur n'est pas connue,
 * `null` (UNKNOWN), jamais la formule linéaire appliquée à tort (qui a produit
 * des notionnels jusqu'à ×600 le réel).
 */
export function notionalOfPosition(p: {
  sizeContracts: Decimal;
  entryPrice: Decimal;
  marginType?: string | null;
  contractValue?: Decimal | null;
}): Decimal | null {
  if (p.marginType === "COIN_M") {
    if (p.contractValue == null) return null;
    return p.sizeContracts.abs().times(p.contractValue);
  }
  return notionalOf(p.sizeContracts, p.entryPrice);
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

/**
 * L'alerte se déclenche sur l'**ampleur** du funding, payé comme perçu : c'est
 * un flux qui pèse sur la marge dans les deux sens. L'`abs()` est donc
 * volontaire ici, et ne contredit pas la convention signée de `fundingPaid`
 * (cf. bloc « Convention de signe » plus bas) : on mesure un poids, pas un
 * résultat.
 */
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

/**
 * P&L latent, en tenant compte du type de contrat (TRA-03).
 *
 * USDT-M / CFD (inchangé) : formule linéaire ci-dessus. COIN-M sans valeur de
 * contrat connue : `null` (UNKNOWN) — la formule linéaire appliquée à un
 * contrat inverse donne un P&L aussi faux que son notionnel.
 */
export function unrealizedPnlOfPosition(p: {
  direction: FuturesDirection;
  sizeContracts: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal;
  marginType?: string | null;
  contractValue?: Decimal | null;
}): Decimal | null {
  if (p.marginType === "COIN_M" && p.contractValue == null) return null;
  return unrealizedPnl(p.direction, p.sizeContracts, p.entryPrice, p.markPrice);
}

export type FuturesPositionView = {
  id: string;
  exchange: string;
  pair: string;
  direction: FuturesDirection;
  leverage: Decimal;
  /** `null` : notionnel non calculable pour cette position (TRA-03) — UNKNOWN, pas 0. */
  notionalUsd: Decimal | null;
  /** `null` : marge non calculable (levier ou notionnel inconnu). */
  marginUsed: Decimal | null;
  liquidationPrice: Decimal | null;
  distanceToLiquidationPct: number | null;
  /** `null` : P&L non calculable (contrat COIN-M sans valeur de contrat). */
  unrealizedPnlEur: Decimal | null;
  liquidationAlert: boolean;
  fundingAlert: boolean;
  /** Contribution signée à l'exposition nette : + pour LONG, − pour SHORT. `null` si le notionnel est inconnu. */
  signedNotional: Decimal | null;
};

/** Enrichit une position brute de tous les calculs dérivés. */
export function toFuturesView(p: FuturesPositionInput): FuturesPositionView {
  const notional = notionalOfPosition(p);
  const margin = p.marginUsed ?? requiredMargin(notional, p.leverage);
  const liqPrice = estimatedLiquidationPrice(p.direction, p.entryPrice, p.leverage);
  const distPct = p.markPrice
    ? distanceToLiquidationPct(p.markPrice, liqPrice)?.toNumber() ?? null
    : null;
  const pnl = p.markPrice
    ? unrealizedPnlOfPosition({
        direction: p.direction,
        sizeContracts: p.sizeContracts,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        marginType: p.marginType,
        contractValue: p.contractValue,
      })
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
    signedNotional:
      notional == null ? null : p.direction === "LONG" ? notional : notional.neg(),
  };
}

export type FuturesSummary = {
  /** Somme des marges engagées sur les positions ouvertes dont la marge est connue. */
  totalMarginEur: Decimal;
  /** Exposition nette : notionnel long moins notionnel short, positions valorisables seulement. */
  netExposureEur: Decimal;
  /** Somme du P&L latent des positions ouvertes valorisables. */
  unrealizedPnlEur: Decimal;
  positionCount: number;
  liquidationAlerts: number;
  /** Positions dont le notionnel/P&L est non calculable (TRA-03, COIN-M sans valeur de contrat) — écartées des sommes. */
  unvaluedCount: number;
};

export function summarizeFutures(positions: FuturesPositionInput[]): FuturesSummary {
  let margin = d(0);
  let netExposure = d(0);
  let pnl = d(0);
  let alerts = 0;
  let unvalued = 0;

  for (const raw of positions) {
    const v = toFuturesView(raw);
    if (v.notionalUsd == null) unvalued += 1;
    if (v.marginUsed != null) margin = margin.plus(v.marginUsed);
    if (v.signedNotional != null) netExposure = netExposure.plus(v.signedNotional);
    if (v.unrealizedPnlEur != null) pnl = pnl.plus(v.unrealizedPnlEur);
    if (v.liquidationAlert) alerts += 1;
  }

  return {
    totalMarginEur: margin,
    netExposureEur: netExposure,
    unrealizedPnlEur: pnl,
    positionCount: positions.length,
    liquidationAlerts: alerts,
    unvaluedCount: unvalued,
  };
}

/**
 * ═══ Convention de signe de `fundingPaid` / `commissionPaid` ══════════════
 *
 * **Source de vérité du dépôt.** Les trois lecteurs de ces deux colonnes
 * (`realizedNetPnl` ici, `closedNetPnl` dans `trading/positions-view.ts`,
 * bucket fiscal de `app/api/trading/route.ts`) doivent tous passer par
 * `deductibleCostsOf`, et l'import CSV (`futures-csv.ts`) normalise le signe
 * de l'exchange vers cette convention. Cf. aussi `prisma/schema.prisma`,
 * modèle `TradingPosition`.
 *
 * - `fundingPaid` est **signé** : **positif = funding payé** (une charge),
 *   **négatif = funding perçu** (un produit). Un perpétuel fait circuler le
 *   funding dans les deux sens selon le sens de la position et le signe du
 *   taux — le prendre en valeur absolue transformait un encaissement réel en
 *   charge, et le même fait économique devenait un produit à l'écran et une
 *   charge au fiscal (écart de 2 × funding).
 * - `commissionPaid` est **toujours ≥ 0** : une commission n'est jamais
 *   encaissée. L'`abs()` reste donc appliqué à elle seule, comme garde-fou —
 *   les lignes importées avant cette normalisation et l'API de saisie
 *   manuelle (`decimalString`, qui accepte un négatif) peuvent encore porter
 *   une commission négative, qui est un signe de cash-flow, pas un produit.
 *
 * Funding et commission ne sont **pas** de la variation de marché : ils ne se
 * mêlent jamais au P&L latent ni au `realizedPnl` stocké (brut, cf. FIN-03) —
 * ils sont déduits une seule fois, à la lecture, par la formule ci-dessous.
 */

/**
 * Coûts déductibles d'une position : funding signé + commission (≥ 0).
 *
 * Une seule définition pour les trois lecteurs — l'écran et le fiscal doivent
 * retenir le même montant. Un résultat **négatif** est possible et légitime :
 * un funding perçu supérieur aux commissions est un produit net.
 */
export function deductibleCostsOf(input: {
  fundingPaid: Decimal | null;
  commissionPaid: Decimal | null;
}): Decimal {
  const funding = input.fundingPaid ?? d(0);
  const commission = input.commissionPaid ?? d(0);
  return funding.plus(commission.abs());
}

/**
 * P&L net d'une position clôturée : réalisé moins les coûts déductibles.
 *
 * `net = realized − fundingPaid(signé) − |commissionPaid|`, cf. la convention
 * de signe documentée juste au-dessus.
 */
export function realizedNetPnl(input: {
  realizedPnl: Decimal | null;
  fundingPaid: Decimal | null;
  commissionPaid: Decimal | null;
}): Decimal {
  const realized = input.realizedPnl ?? d(0);
  return realized.minus(deductibleCostsOf(input));
}
