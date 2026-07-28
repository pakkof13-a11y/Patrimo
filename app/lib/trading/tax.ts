/**
 * Fiscalité des instruments financiers à terme — fonctions pures, sans Prisma.
 *
 * CFD, futures, options et warrants détenus à titre non professionnel relèvent
 * de l'**article 150 ter du CGI**. Ce régime a trois particularités qui le
 * distinguent nettement de celui d'un compte-titres ordinaire :
 *
 * 1. **L'assiette est annuelle et globale.** On ne taxe pas trade par trade :
 *    on additionne tous les gains et toutes les pertes de l'année civile, et
 *    seul le solde compte. Un trader qui gagne 50 000 € et en perd 45 000 € est
 *    imposé sur 5 000 €, pas sur 50 000 €.
 *
 * 2. **Les pertes sont cloisonnées.** Une moins-value nette ne s'impute
 *    **jamais** sur le revenu global, ni sur des plus-values d'actions : elle
 *    ne peut s'imputer que sur des gains **de même nature**, et se reporte
 *    10 ans. C'est ce cloisonnement qui rend le suivi du stock reportable
 *    indispensable — sans lui, une année perdante est simplement oubliée.
 *
 * 3. **L'option barème existe.** Contrairement à une idée répandue, le PFU
 *    n'est pas obligatoire : l'option globale pour le barème progressif
 *    (case 2OP de la 2042) couvre aussi ces gains. Elle porte sur l'ensemble
 *    des revenus du capital de l'année, jamais sur un produit isolé — d'où le
 *    fait que ce module la calcule à titre de comparaison, sans la
 *    recommander : l'arbitrage dépend de revenus que l'application ne connaît
 *    pas.
 *
 * Les taux viennent de `tax/rates.ts` : depuis 2026, PFU à 31,4 %.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import {
  PFU_INCOME_TAX_RATE,
  SOCIAL_CHARGES_RATE,
} from "@/app/lib/tax/rates";

/** Durée de report d'une moins-value nette, en années. */
export const LOSS_CARRY_FORWARD_YEARS = 10;

export type TradingYearInput = {
  year: number;
  /** Somme des gains bruts réalisés dans l'année. */
  grossGainsEur: Decimal;
  /** Somme des pertes réalisées dans l'année, en valeur absolue. */
  grossLossesEur: Decimal;
  /**
   * Frais déductibles de l'année : commissions, frais de financement
   * overnight, frais de garde. Ils viennent en diminution du résultat.
   */
  feesEur?: Decimal | null;
};

export type CarriedLoss = {
  /** Année d'origine de la moins-value. */
  year: number;
  /** Reliquat encore imputable. */
  remainingEur: Decimal;
};

export type TradingYearResult = {
  year: number;
  /** Gains − pertes − frais, avant imputation du stock reportable. */
  netBeforeCarryEur: Decimal;
  /** Moins-values antérieures effectivement imputées cette année. */
  carryUsedEur: Decimal;
  /** Assiette imposable, jamais négative. */
  taxableEur: Decimal;
  /** Moins-value née de l'année, qui vient grossir le stock reportable. */
  newLossEur: Decimal;
  /** Stock reportable après l'année, périmés exclus. */
  carryForward: CarriedLoss[];
  /** Moins-values périmées faute d'avoir été imputées en 10 ans. */
  expiredEur: Decimal;
};

/**
 * Résultat fiscal d'une année, stock reportable compris.
 *
 * Les moins-values les plus **anciennes** sont imputées en premier. Ce n'est
 * pas indifférent : elles sont les plus proches de la péremption, et les
 * garder en réserve reviendrait à en perdre le bénéfice.
 */
export function computeTradingYear(
  input: TradingYearInput,
  carriedLosses: readonly CarriedLoss[] = []
): TradingYearResult {
  const fees = input.feesEur ?? d(0);
  const netBeforeCarry = input.grossGainsEur
    .minus(input.grossLossesEur)
    .minus(fees);

  // Une moins-value se périme au terme du 10ᵉ exercice suivant celui de sa
  // réalisation : à l'année Y, tout ce qui date d'avant Y − 10 est perdu.
  const oldestUsableYear = input.year - LOSS_CARRY_FORWARD_YEARS;
  let expired = d(0);
  const usable: CarriedLoss[] = [];
  for (const loss of carriedLosses) {
    if (loss.remainingEur.lte(0)) continue;
    if (loss.year < oldestUsableYear) {
      expired = expired.plus(loss.remainingEur);
      continue;
    }
    usable.push({ year: loss.year, remainingEur: loss.remainingEur });
  }
  usable.sort((a, b) => a.year - b.year);

  let carryUsed = d(0);
  const carryForward: CarriedLoss[] = [];

  if (netBeforeCarry.gt(0)) {
    let remainingGain = netBeforeCarry;
    for (const loss of usable) {
      if (remainingGain.lte(0)) {
        carryForward.push(loss);
        continue;
      }
      const used = Decimal.min(loss.remainingEur, remainingGain);
      carryUsed = carryUsed.plus(used);
      remainingGain = remainingGain.minus(used);
      const left = loss.remainingEur.minus(used);
      if (left.gt(0)) carryForward.push({ year: loss.year, remainingEur: left });
    }
  } else {
    carryForward.push(...usable);
  }

  const newLoss = netBeforeCarry.lt(0) ? netBeforeCarry.neg() : d(0);
  if (newLoss.gt(0)) {
    carryForward.push({ year: input.year, remainingEur: newLoss });
  }

  const taxable = netBeforeCarry.gt(0)
    ? netBeforeCarry.minus(carryUsed)
    : d(0);

  return {
    year: input.year,
    netBeforeCarryEur: netBeforeCarry,
    carryUsedEur: carryUsed,
    taxableEur: taxable,
    newLossEur: newLoss,
    carryForward: carryForward.sort((a, b) => a.year - b.year),
    expiredEur: expired,
  };
}

export type TradingTaxComparison = {
  taxableEur: Decimal;
  /** PFU : 12,8 % d'IR + prélèvements sociaux. */
  pfu: {
    incomeTaxEur: Decimal;
    socialChargesEur: Decimal;
    totalEur: Decimal;
    effectiveRatePct: Decimal;
  };
  /**
   * Barème progressif : les prélèvements sociaux restent dus au même taux,
   * seule la part impôt sur le revenu change. `null` si aucun taux marginal
   * n'a été fourni — l'application ne connaît pas les revenus du foyer, et
   * inventer un taux produirait une comparaison trompeuse.
   */
  bareme: {
    marginalRatePct: Decimal;
    incomeTaxEur: Decimal;
    socialChargesEur: Decimal;
    totalEur: Decimal;
    effectiveRatePct: Decimal;
  } | null;
  /**
   * Régime le moins coûteux, `null` si la comparaison n'a pas pu être faite.
   * Purement indicatif : l'option barème est **globale**, elle engage tous les
   * revenus du capital de l'année et pas seulement ces gains.
   */
  cheaper: "PFU" | "BAREME" | "EQUAL" | null;
};

/**
 * Compare l'imposition au PFU et au barème progressif.
 *
 * `marginalRatePct` est la tranche marginale d'imposition du foyer (0, 11, 30,
 * 41 ou 45). Elle est demandée à l'utilisateur plutôt que déduite : le revenu
 * fiscal de référence, le quotient familial et les autres revenus du capital
 * n'existent pas dans l'application.
 */
export function compareTradingTax(
  taxableEur: Decimal,
  marginalRatePct?: Decimal | number | null
): TradingTaxComparison {
  const base = taxableEur.gt(0) ? taxableEur : d(0);
  const social = base.times(SOCIAL_CHARGES_RATE);

  const pfuIncome = base.times(PFU_INCOME_TAX_RATE);
  const pfuTotal = pfuIncome.plus(social);

  const pct = (total: Decimal) =>
    base.gt(0) ? total.div(base).times(100) : d(0);

  const pfu = {
    incomeTaxEur: pfuIncome,
    socialChargesEur: social,
    totalEur: pfuTotal,
    effectiveRatePct: pct(pfuTotal),
  };

  if (marginalRatePct == null) {
    return { taxableEur: base, pfu, bareme: null, cheaper: null };
  }

  const tmi = d(String(marginalRatePct));
  const baremeIncome = base.times(tmi).div(100);
  const baremeTotal = baremeIncome.plus(social);
  const bareme = {
    marginalRatePct: tmi,
    incomeTaxEur: baremeIncome,
    socialChargesEur: social,
    totalEur: baremeTotal,
    effectiveRatePct: pct(baremeTotal),
  };

  const diff = pfuTotal.comparedTo(baremeTotal);
  return {
    taxableEur: base,
    pfu,
    bareme,
    cheaper: diff === 0 ? "EQUAL" : diff < 0 ? "PFU" : "BAREME",
  };
}

/**
 * Total encore reportable, toutes années confondues.
 *
 * Sert à afficher ce qui reste imputable : un stock de moins-values est un
 * actif fiscal, invisible du patrimoine mais bien réel.
 */
export function totalCarryForward(losses: readonly CarriedLoss[]): Decimal {
  return losses.reduce((sum, l) => sum.plus(l.remainingEur), d(0));
}
