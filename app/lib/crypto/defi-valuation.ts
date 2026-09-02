/**
 * Valorisation d'une position DeFi — fonctions pures, sans accès Prisma.
 *
 * Un seul endroit décide de ce qui s'ajoute, de ce qui se retranche et de ce qui
 * ne compte pas du tout. Les services et les vues consomment ces résultats, ils
 * ne recalculent jamais — c'est la même règle que `defi.ts`, étendue aux jambes.
 *
 * Ce module ne stocke rien et ne décide pas de la valeur *vivante* d'une
 * position : celle-ci vient du journal (`getAssetValues`). Il décide de la
 * **décomposition** de cette valeur et de la méthode qui l'a produite.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import {
  isDebtLeg,
  isRepresentativeLeg,
  isValuableRewardType,
  isWeakValuation,
  VALUATION_METHOD_CONFIDENCE,
  type DefiLegType,
  type DefiValuationMethod,
} from "./defi-taxonomy";
import { HEALTH_FACTOR_CRITICAL, HEALTH_FACTOR_WARNING, LTV_WARNING_PCT } from "./constants";

/** Jambe telle que la valorisation la voit — un sous-ensemble de `DefiLeg`. */
export type ValuationLeg = {
  legType: DefiLegType | string;
  symbol: string;
  quantity: Decimal;
  /** Prix unitaire courant. `null` = pas de prix disponible pour cette jambe. */
  priceEur: Decimal | null;
  /** Coût unitaire d'acquisition — sert au repli quand le prix manque. */
  unitCostEur?: Decimal | null;
  isActive?: boolean;
};

/** Récompense telle que la valorisation la voit — sous-ensemble de `DefiReward`. */
export type ValuationReward = {
  symbol: string;
  rewardType: string;
  /** Accumulé non réclamé. Le réclamé est déjà au journal, il ne compte pas ici. */
  accruedQuantity: Decimal | null;
  valueEur: Decimal | null;
};

export type ValuationInput = {
  legs: ValuationLeg[];
  rewards?: ValuationReward[];
  /** Quote-part détenue en % — `null` vaut 100 %. */
  ownershipPct?: Decimal | null;
  /**
   * Snapshot manuel actif. Quand il est fourni, il **prévaut** : c'est un choix
   * délibéré de l'utilisateur sur une position dont aucun marché ne donne le
   * prix (vault opaque, receipt token non coté).
   */
  manualGrossValueEur?: Decimal | null;
  /**
   * Chiffre du fournisseur, utilisé si aucun prix de jambe n'est exploitable et
   * qu'il n'y a pas de saisie manuelle.
   */
  providerGrossValueEur?: Decimal | null;
  /**
   * Politique sur les récompenses non réclamées. Explicite et non implicite :
   * les inclure gonfle le patrimoine d'un montant pas encore encaissé, les
   * exclure sous-estime une position à fort rendement. Défaut : incluses dans
   * `gross` et `rewards`, jamais dans `net`.
   */
  includeUnclaimedRewards?: boolean;
  /**
   * Position sortie de la valorisation (fermée, liquidée, ignorée). Renvoie une
   * décomposition à zéro sans prétendre qu'elle vaut zéro — `isValuable` reste
   * `false` et `method` conserve la raison.
   */
  excluded?: boolean;
  excludedReason?: string | null;
};

export type ValuationBreakdown = {
  /** Somme des expositions positives, hors dette. */
  grossEur: Decimal;
  /** Somme des dettes, en positif. */
  debtEur: Decimal;
  /** Collatéral immobilisé — inclus dans `gross`, isolé pour le pilotage. */
  collateralEur: Decimal;
  /** Récompenses non réclamées et valorisables. */
  rewardsEur: Decimal;
  /** `gross − debt` : la seule grandeur à sens patrimonial avant quote-part. */
  netEur: Decimal;
  /** `net × ownershipPct` : ce qui entre réellement au patrimoine. */
  retainedEur: Decimal;
  /** Somme des sous-jacents, quand ils sont connus — sinon `null`. */
  underlyingEur: Decimal | null;
  method: DefiValuationMethod;
  confidenceScore: number;
  /** Renseigné dès que `method` est un repli. Jamais un repli silencieux. */
  fallbackReason: string | null;
  /**
   * `false` quand rien d'exploitable n'a permis de valoriser. Distinct d'une
   * valeur nulle : une position à 0 € est soldée, une position non valorisable
   * a une exposition inconnue.
   */
  isValuable: boolean;
  /** Jambes dont le prix manquait — utile pour expliquer un repli. */
  unpricedSymbols: string[];
};

const ZERO = d(0);

function activeLegs(legs: ValuationLeg[]): ValuationLeg[] {
  return legs.filter((l) => l.isActive !== false && l.quantity.abs().gt(0));
}

/**
 * Jambes retenues pour la valorisation, selon la méthode.
 *
 * **C'est ici que se joue l'anti-double-compte le plus fréquent.** Un dépôt et
 * son jeton de reçu représentent la même exposition sous deux formes ; une part
 * de pool et ses sous-jacents également. Additionner les deux double la valeur.
 *
 * - `UNDERLYING_ASSETS` : on garde les `ASSET`/`UNDERLYING`, on écarte les
 *   représentations (`RECEIPT`, `SHARE`).
 * - toute autre méthode : on garde la représentation quand elle existe (c'est
 *   elle que le portefeuille détient réellement) et on écarte les sous-jacents.
 *
 * `DEBT` et `COLLATERAL` traversent toujours : ils ne sont la représentation de
 * rien, et une dette omise gonflerait le patrimoine du montant exact du dû.
 */
export function selectValuationLegs(
  legs: ValuationLeg[],
  method: "UNDERLYING_ASSETS" | "REPRESENTATIVE"
): ValuationLeg[] {
  const active = activeLegs(legs);
  const hasRepresentative = active.some((l) => isRepresentativeLeg(String(l.legType)));

  return active.filter((l) => {
    const t = String(l.legType);
    if (t === "DEBT" || t === "COLLATERAL") return true;
    // Les récompenses sont comptées à part (`rewards`), pas comme exposition.
    if (t === "REWARD") return false;

    if (method === "UNDERLYING_ASSETS") return !isRepresentativeLeg(t);

    // Méthode « représentative » : si un reçu ou une part existe, les
    // sous-jacents en sont la décomposition — les compter en plus doublerait.
    if (t === "UNDERLYING") return !hasRepresentative;
    if (t === "ASSET") return !hasRepresentative;
    return true;
  });
}

function legValue(leg: ValuationLeg): { value: Decimal | null; priced: boolean } {
  if (leg.priceEur != null && leg.priceEur.gte(0)) {
    return { value: leg.quantity.abs().times(leg.priceEur), priced: true };
  }
  return { value: null, priced: false };
}

/**
 * Récompenses valorisables, non réclamées.
 *
 * Les points (`POINTS`) sont exclus par construction : aucun marché fiable ne
 * les cote, et leur attribuer une valeur inscrirait au patrimoine la
 * spéculation sur un airdrop futur. La valeur réelle reste celle de l'actif
 * engagé, déjà comptée dans les jambes.
 */
export function sumValuableRewards(rewards: ValuationReward[]): Decimal {
  let total = ZERO;
  for (const r of rewards) {
    if (!isValuableRewardType(r.rewardType)) continue;
    if (r.valueEur == null) continue;
    if (r.accruedQuantity != null && r.accruedQuantity.lte(0)) continue;
    total = total.plus(r.valueEur);
  }
  return total;
}

/**
 * Décomposition complète d'une position.
 *
 * Ordre des méthodes (cf. `docs/defi-backend-v1.md`) :
 * 1. saisie manuelle active → `MANUAL` ;
 * 2. jambes toutes cotées → `MARKET` ou `UNDERLYING_ASSETS` selon la forme ;
 * 3. chiffre du fournisseur → `PROVIDER_ESTIMATE` ;
 * 4. coût d'acquisition → `ACQUISITION_COST_FALLBACK` ;
 * 5. rien → `UNKNOWN`, `isValuable = false`.
 */
export function valuePosition(input: ValuationInput): ValuationBreakdown {
  const ownership = input.ownershipPct ?? null;
  const share =
    ownership != null && ownership.gt(0) && ownership.lte(100)
      ? ownership.div(100)
      : d(1);

  const rewardsList = input.rewards ?? [];
  const includeRewards = input.includeUnclaimedRewards !== false;
  const rewardsEur = includeRewards ? sumValuableRewards(rewardsList) : ZERO;

  if (input.excluded) {
    return {
      grossEur: ZERO,
      debtEur: ZERO,
      collateralEur: ZERO,
      rewardsEur: ZERO,
      netEur: ZERO,
      retainedEur: ZERO,
      underlyingEur: null,
      method: "UNKNOWN",
      confidenceScore: 0,
      fallbackReason: input.excludedReason ?? "Position exclue de la valorisation",
      isValuable: false,
      unpricedSymbols: [],
    };
  }

  // Dette et collatéral se calculent indépendamment de la méthode : ils sont
  // portés par des jambes propres, jamais déduits d'un total.
  const active = activeLegs(input.legs);
  let debtEur = ZERO;
  let collateralEur = ZERO;
  const unpriced: string[] = [];

  for (const leg of active) {
    const t = String(leg.legType);
    if (t !== "DEBT" && t !== "COLLATERAL") continue;
    const { value, priced } = legValue(leg);
    if (!priced) {
      // Une dette sans prix est le cas le plus dangereux : l'omettre revient à
      // effacer ce qu'on doit. On se replie sur son coût, jamais sur zéro.
      const fallback = leg.unitCostEur
        ? leg.quantity.abs().times(leg.unitCostEur)
        : null;
      if (fallback == null) {
        unpriced.push(leg.symbol);
      } else if (t === "DEBT") {
        debtEur = debtEur.plus(fallback);
      } else {
        collateralEur = collateralEur.plus(fallback);
      }
      continue;
    }
    if (isDebtLeg(t)) debtEur = debtEur.plus(value!);
    else collateralEur = collateralEur.plus(value!);
  }

  const underlyingLegs = selectValuationLegs(input.legs, "UNDERLYING_ASSETS");
  const representativeLegs = selectValuationLegs(input.legs, "REPRESENTATIVE");

  const sumLegs = (
    legs: ValuationLeg[]
  ): { total: Decimal; allPriced: boolean; missing: string[] } => {
    let total = ZERO;
    let allPriced = true;
    const missing: string[] = [];
    for (const leg of legs) {
      const t = String(leg.legType);
      // Dette et collatéral déjà totalisés ; le collatéral compte dans `gross`
      // (il est bien détenu), la dette non (elle se retranche à part).
      if (t === "DEBT") continue;
      if (t === "COLLATERAL") {
        continue;
      }
      const { value, priced } = legValue(leg);
      if (!priced) {
        allPriced = false;
        missing.push(leg.symbol);
        continue;
      }
      total = total.plus(value!);
    }
    return { total, allPriced, missing };
  };

  const rep = sumLegs(representativeLegs);
  const und = sumLegs(underlyingLegs);
  const underlyingEur = und.allPriced && underlyingLegs.length > 0 ? und.total : null;

  const finish = (
    exposure: Decimal,
    method: DefiValuationMethod,
    fallbackReason: string | null,
    isValuable: boolean,
    missing: string[]
  ): ValuationBreakdown => {
    // Le collatéral fait partie de ce qu'on détient : il entre dans `gross`.
    const grossEur = exposure.plus(collateralEur).plus(rewardsEur);
    // Les récompenses non réclamées ne sont pas encore encaissées : elles
    // comptent dans `gross` mais pas dans `net`. Politique explicite.
    const netEur = exposure.plus(collateralEur).minus(debtEur);
    return {
      grossEur,
      debtEur,
      collateralEur,
      rewardsEur,
      netEur,
      retainedEur: netEur.times(share),
      underlyingEur,
      method,
      confidenceScore: VALUATION_METHOD_CONFIDENCE[method],
      fallbackReason,
      isValuable,
      unpricedSymbols: [...new Set([...unpriced, ...missing])],
    };
  };

  // 1. Saisie manuelle — prévaut sur tout le reste.
  if (input.manualGrossValueEur != null && input.manualGrossValueEur.gte(0)) {
    return finish(input.manualGrossValueEur, "MANUAL", null, true, []);
  }

  // 2. Jambes cotées. `UNDERLYING_ASSETS` quand la position est décrite par ses
  //    sous-jacents (LP, vault transparent), `MARKET` quand elle l'est par un
  //    jeton coté. Les deux ne s'additionnent jamais (cf. `selectValuationLegs`).
  const describedByUnderlying =
    underlyingLegs.length > 0 &&
    underlyingLegs.some((l) => String(l.legType) === "UNDERLYING");

  if (describedByUnderlying && und.allPriced) {
    return finish(und.total, "UNDERLYING_ASSETS", null, true, []);
  }
  if (rep.allPriced && representativeLegs.some((l) => String(l.legType) !== "COLLATERAL")) {
    return finish(rep.total, "MARKET", null, true, []);
  }
  if (und.allPriced && underlyingLegs.length > 0) {
    return finish(und.total, "UNDERLYING_ASSETS", null, true, []);
  }

  // 3. Chiffre du fournisseur.
  if (input.providerGrossValueEur != null && input.providerGrossValueEur.gte(0)) {
    return finish(
      input.providerGrossValueEur,
      "PROVIDER_ESTIMATE",
      `Prix indisponible pour ${rep.missing.join(", ") || "certaines jambes"} — estimation du fournisseur retenue`,
      true,
      rep.missing
    );
  }

  // 4. Repli sur le coût d'acquisition.
  let costTotal = ZERO;
  let anyCost = false;
  for (const leg of representativeLegs) {
    const t = String(leg.legType);
    if (t === "DEBT" || t === "COLLATERAL") continue;
    if (leg.unitCostEur == null) continue;
    anyCost = true;
    costTotal = costTotal.plus(leg.quantity.abs().times(leg.unitCostEur));
  }
  if (anyCost) {
    return finish(
      costTotal,
      "ACQUISITION_COST_FALLBACK",
      `Aucun prix courant pour ${rep.missing.join(", ") || "cette position"} — repli sur le coût d'acquisition`,
      true,
      rep.missing
    );
  }

  // 5. Rien d'exploitable. Ne jamais renvoyer un zéro qui se confondrait avec
  //    une position soldée.
  return finish(
    ZERO,
    "UNKNOWN",
    `Aucun prix ni coût disponible pour ${rep.missing.join(", ") || "cette position"}`,
    false,
    rep.missing
  );
}

/**
 * Vétusté d'une valorisation.
 *
 * Une valeur de trois semaines affichée sans mention est un mensonge par
 * omission sur un marché qui bouge de 10 % par jour.
 */
export const STALE_VALUATION_HOURS = 24;

export function isStaleValuation(
  valuationDate: Date | string | null | undefined,
  now: Date = new Date(),
  thresholdHours: number = STALE_VALUATION_HOURS
): boolean {
  if (!valuationDate) return true;
  const at = valuationDate instanceof Date ? valuationDate : new Date(valuationDate);
  if (Number.isNaN(at.getTime())) return true;
  const ageHours = (now.getTime() - at.getTime()) / 36e5;
  return ageHours > thresholdHours;
}

export type DebtRatios = {
  /** Dette / collatéral, en % — `null` sans collatéral. */
  ltvPct: Decimal | null;
  /** Collatéral / dette — `null` sans dette. */
  collateralRatio: Decimal | null;
  /**
   * Health factor recalculé depuis le seuil de liquidation, quand il est connu.
   * `null` sinon : mieux vaut afficher celui du protocole que d'en inventer un.
   */
  healthFactor: Decimal | null;
};

/**
 * Ratios d'un prêt collatéralisé.
 *
 * Recalculés depuis les jambes plutôt que lus sur la position : un
 * `healthFactor` stocké vieillit dès que le prix du collatéral bouge, alors que
 * les jambes sont valorisées à l'instant.
 */
export function computeDebtRatios(
  debtEur: Decimal,
  collateralEur: Decimal,
  liqThresholdPct?: Decimal | null
): DebtRatios {
  const ltvPct = collateralEur.gt(0) ? debtEur.div(collateralEur).times(100) : null;
  const collateralRatio = debtEur.gt(0) ? collateralEur.div(debtEur) : null;

  let healthFactor: Decimal | null = null;
  if (
    liqThresholdPct != null &&
    liqThresholdPct.gt(0) &&
    debtEur.gt(0) &&
    collateralEur.gt(0)
  ) {
    healthFactor = collateralEur.times(liqThresholdPct.div(100)).div(debtEur);
  }

  return { ltvPct, collateralRatio, healthFactor };
}

export type RiskLevel = "CRITICAL" | "WARNING" | "OK";

/**
 * Niveau d'alerte d'un prêt, à partir des ratios recalculés.
 *
 * Réutilise les seuils de `constants.ts` — les dupliquer laisserait deux
 * vérités divergentes sur le moment où prévenir l'utilisateur.
 */
export function debtRiskLevel(ratios: DebtRatios): RiskLevel | null {
  const hf = ratios.healthFactor;
  if (hf != null && hf.isFinite()) {
    if (hf.lt(HEALTH_FACTOR_CRITICAL)) return "CRITICAL";
    if (hf.lt(HEALTH_FACTOR_WARNING)) return "WARNING";
    return "OK";
  }
  const ltv = ratios.ltvPct;
  if (ltv != null && ltv.isFinite()) {
    return ltv.gt(LTV_WARNING_PCT) ? "WARNING" : "OK";
  }
  return null;
}

/**
 * Décomposition d'une part en ses sous-jacents.
 *
 * Répond à « que contient réellement cette LP / ce vault ? ». Renvoie `null`
 * quand la composition n'est pas connue plutôt que de répartir à parts égales :
 * une répartition inventée sur une LP concentrée est fausse de plusieurs
 * dizaines de pourcents.
 */
export function decomposeUnderlying(
  legs: ValuationLeg[]
): Array<{ symbol: string; quantity: Decimal; valueEur: Decimal; sharePct: Decimal }> | null {
  const underlying = activeLegs(legs).filter(
    (l) => String(l.legType) === "UNDERLYING" || String(l.legType) === "ASSET"
  );
  if (underlying.length === 0) return null;
  if (underlying.some((l) => l.priceEur == null)) return null;

  const valued = underlying.map((l) => ({
    symbol: l.symbol,
    quantity: l.quantity.abs(),
    valueEur: l.quantity.abs().times(l.priceEur!),
  }));
  const total = valued.reduce((s, v) => s.plus(v.valueEur), ZERO);
  if (total.lte(0)) return null;

  return valued.map((v) => ({
    ...v,
    sharePct: v.valueEur.div(total).times(100),
  }));
}

/** Qualité de valorisation d'un ensemble de positions — pour les agrégats. */
export type ValuationQuality = {
  /** Valeur retenue par méthode. */
  byMethod: Array<{ method: DefiValuationMethod; count: number; retainedEur: Decimal }>;
  /** Part de la valeur adossée à une méthode faible (repli, inconnu), en %. */
  weakSharePct: Decimal;
  /** Positions qu'aucune méthode n'a pu valoriser. */
  unvaluableCount: number;
  /** Moyenne des scores, pondérée par la valeur — un chiffre de pilotage. */
  weightedConfidence: Decimal | null;
};

export function summarizeValuationQuality(
  breakdowns: ValuationBreakdown[]
): ValuationQuality {
  const byMethod = new Map<DefiValuationMethod, { count: number; retainedEur: Decimal }>();
  let weak = ZERO;
  let total = ZERO;
  let confWeighted = ZERO;
  let unvaluable = 0;

  for (const b of breakdowns) {
    const entry = byMethod.get(b.method) ?? { count: 0, retainedEur: ZERO };
    entry.count += 1;
    entry.retainedEur = entry.retainedEur.plus(b.retainedEur);
    byMethod.set(b.method, entry);

    if (!b.isValuable) unvaluable += 1;

    const weight = b.retainedEur.abs();
    total = total.plus(weight);
    confWeighted = confWeighted.plus(d(b.confidenceScore).times(weight));
    if (isWeakValuation(b.method)) weak = weak.plus(weight);
  }

  return {
    byMethod: [...byMethod.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.retainedEur.comparedTo(a.retainedEur)),
    weakSharePct: total.gt(0) ? weak.div(total).times(100) : ZERO,
    unvaluableCount: unvaluable,
    weightedConfidence: total.gt(0) ? confWeighted.div(total) : null,
  };
}
