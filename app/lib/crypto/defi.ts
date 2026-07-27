/**
 * Agrégats d'un portefeuille DeFi — fonctions pures, sans accès Prisma.
 *
 * Testables sans base, et surtout : un seul endroit décide de ce qui s'ajoute
 * et de ce qui se retranche. Les vues consomment ces résultats, elles ne
 * recalculent jamais.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import {
  healthFactorRisk,
  isDebtPosition,
  ltvRisk,
  type DefiPositionType,
  type RiskLevel,
} from "./constants";

export type DefiPositionInput = {
  id: string;
  protocol: string;
  chain: string | null;
  positionType: DefiPositionType | string;
  assetSymbol: string;
  /** Valeur du dépôt en euros. Une dette porte sa valeur ici aussi, en positif. */
  valueEur: Decimal;
  /** Récompenses accumulées non réclamées, en euros. */
  rewardsValueEur?: Decimal | null;
  apyPct?: Decimal | null;
  healthFactor?: number | null;
  ltvPct?: number | null;
};

export type DefiPositionView = DefiPositionInput & {
  isDebt: boolean;
  /** Contribution signée au patrimoine : négative pour un emprunt. */
  netValueEur: Decimal;
  healthRisk: RiskLevel | null;
  ltvRisk: RiskLevel | null;
};

export type DefiSummary = {
  /** Somme des positions non-dette. */
  depositedEur: Decimal;
  /** Somme des emprunts, en positif. */
  borrowedEur: Decimal;
  /** Dépôts − emprunts : ce que le portefeuille pèse réellement. */
  netEur: Decimal;
  /** Récompenses accumulées, non encore réclamées. */
  pendingRewardsEur: Decimal;
  /**
   * APY moyen **pondéré par la valeur déposée**.
   *
   * Une moyenne simple donnerait le même poids à 50 € placés à 40 % et à
   * 50 000 € placés à 3 %, et afficherait un rendement que le portefeuille ne
   * touche pas.
   */
  weightedApyPct: Decimal | null;
  positionCount: number;
  protocolCount: number;
  /** Position la plus à risque, s'il y en a une. */
  worstHealthFactor: number | null;
};

/** Enrichit une position brute : signe, et niveaux d'alerte. */
export function toPositionView(p: DefiPositionInput): DefiPositionView {
  const isDebt = isDebtPosition(String(p.positionType));
  return {
    ...p,
    isDebt,
    netValueEur: isDebt ? p.valueEur.neg() : p.valueEur,
    healthRisk: healthFactorRisk(p.healthFactor),
    ltvRisk: ltvRisk(p.ltvPct),
  };
}

/**
 * Synthèse d'un ensemble de positions.
 *
 * Les emprunts ne sont jamais additionnés aux dépôts : `netEur` est la seule
 * grandeur qui a un sens patrimonial, `depositedEur` et `borrowedEur` sont
 * conservés séparément parce qu'un portefeuille à 100 k€ déposés / 60 k€
 * empruntés ne se pilote pas comme un portefeuille à 40 k€ sans levier, bien
 * que les deux pèsent 40 k€.
 */
export function summarizeDefi(positions: DefiPositionInput[]): DefiSummary {
  let deposited = d(0);
  let borrowed = d(0);
  let rewards = d(0);
  let apyWeightedSum = d(0);
  let apyWeightBase = d(0);
  let worstHf: number | null = null;

  const protocols = new Set<string>();

  for (const p of positions) {
    protocols.add(p.protocol.toLowerCase());

    if (isDebtPosition(String(p.positionType))) {
      borrowed = borrowed.plus(p.valueEur);
    } else {
      deposited = deposited.plus(p.valueEur);
      // Seuls les dépôts portent un rendement : pondérer l'APY d'un emprunt
      // (taux débiteur) avec celui des dépôts mélangerait deux signes.
      if (p.apyPct && p.valueEur.gt(0)) {
        apyWeightedSum = apyWeightedSum.plus(p.apyPct.times(p.valueEur));
        apyWeightBase = apyWeightBase.plus(p.valueEur);
      }
    }

    if (p.rewardsValueEur) rewards = rewards.plus(p.rewardsValueEur);

    if (
      p.healthFactor != null &&
      Number.isFinite(p.healthFactor) &&
      (worstHf == null || p.healthFactor < worstHf)
    ) {
      worstHf = p.healthFactor;
    }
  }

  return {
    depositedEur: deposited,
    borrowedEur: borrowed,
    netEur: deposited.minus(borrowed),
    pendingRewardsEur: rewards,
    weightedApyPct: apyWeightBase.gt(0)
      ? apyWeightedSum.div(apyWeightBase)
      : null,
    positionCount: positions.length,
    protocolCount: protocols.size,
    worstHealthFactor: worstHf,
  };
}

export type ProtocolGroup = {
  protocol: string;
  chains: string[];
  positions: DefiPositionView[];
  depositedEur: Decimal;
  borrowedEur: Decimal;
  netEur: Decimal;
};

/**
 * Regroupe par protocole.
 *
 * C'est la maille de lecture utile : le risque de contrepartie est celui du
 * protocole, pas celui de la ligne. Un dépôt et un emprunt chez Aave se
 * compensent partiellement — les voir séparés sur deux écrans masque le fait
 * qu'un seul incident les emporte tous les deux.
 */
export function groupByProtocol(
  positions: DefiPositionInput[]
): ProtocolGroup[] {
  const map = new Map<string, ProtocolGroup>();

  for (const raw of positions) {
    const view = toPositionView(raw);
    const key = raw.protocol.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = {
        protocol: raw.protocol,
        chains: [],
        positions: [],
        depositedEur: d(0),
        borrowedEur: d(0),
        netEur: d(0),
      };
      map.set(key, g);
    }
    g.positions.push(view);
    if (raw.chain && !g.chains.includes(raw.chain)) g.chains.push(raw.chain);
    if (view.isDebt) g.borrowedEur = g.borrowedEur.plus(raw.valueEur);
    else g.depositedEur = g.depositedEur.plus(raw.valueEur);
    g.netEur = g.depositedEur.minus(g.borrowedEur);
  }

  // Le plus gros engagement d'abord — c'est ce qu'on veut voir en ouvrant.
  return [...map.values()].sort((a, b) =>
    b.depositedEur.plus(b.borrowedEur).comparedTo(
      a.depositedEur.plus(a.borrowedEur)
    )
  );
}

/**
 * Regroupe par nature de position.
 *
 * Vue complémentaire de la précédente : « combien ai-je en staking, tous
 * protocoles confondus » est une question d'allocation, pas de contrepartie.
 */
export function groupByType(
  positions: DefiPositionInput[]
): Array<{
  positionType: string;
  positions: DefiPositionView[];
  totalEur: Decimal;
}> {
  const map = new Map<string, DefiPositionView[]>();
  for (const raw of positions) {
    const key = String(raw.positionType);
    const list = map.get(key) ?? [];
    list.push(toPositionView(raw));
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([positionType, list]) => ({
      positionType,
      positions: list,
      totalEur: list.reduce((s, p) => s.plus(p.valueEur), d(0)),
    }))
    .sort((a, b) => b.totalEur.comparedTo(a.totalEur));
}
