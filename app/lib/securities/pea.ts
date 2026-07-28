/**
 * Fiscalité du PEA et du PEA-PME — fonctions pures, sans accès Prisma.
 *
 * Un PEA ne s'impose pas comme un compte-titres, et c'est toute la raison
 * d'être de ce module. Sur un CTO, chaque vente est un fait générateur et la
 * plus-value se calcule ligne par ligne au prix de revient — c'est ce que fait
 * déjà `app/lib/tax/fiscal-year.ts`. Sur un PEA, **une vente interne n'est pas
 * imposable** : on peut arbitrer autant qu'on veut sans déclencher quoi que ce
 * soit. Le seul fait générateur est le **retrait**, et la plus-value est
 * globale, appréciée au niveau de l'enveloppe entière :
 *
 *     gain total     = valeur liquidative (titres + espèces) − versements cumulés
 *     gain imposable = montant du retrait × gain total / valeur liquidative
 *
 * Appliquer la logique du CTO à un PEA produirait donc un chiffre qui ne
 * correspond à aucune imposition réelle.
 *
 * ## Deux idées reçues que ce module corrige
 *
 * 1. **« Le PEA-PME est plafonné à 75 000 € »** — c'était vrai avant la loi
 *    PACTE (2019). Le plafond propre est désormais de 225 000 €, mais un
 *    plafond **commun** de 225 000 € s'applique à l'ensemble PEA + PEA-PME.
 *    C'est ce plafond croisé qui explique le chiffre de 75 000 € souvent cité :
 *    il ne s'agit pas du plafond du PEA-PME, mais de ce qu'il en reste quand le
 *    PEA est déjà rempli à 150 000 €. La place disponible ne se calcule donc
 *    jamais plan par plan isolément.
 *
 * 2. **« Après 5 ans, c'est exonéré »** — seulement de l'impôt sur le revenu.
 *    Les prélèvements sociaux de 17,2 % restent dus sur la totalité du gain,
 *    avant comme après 5 ans. Afficher « exonéré » sous-estimerait la note de
 *    17,2 % de la plus-value.
 *
 * ## Simplifications assumées
 *
 * - Les prélèvements sociaux sont appliqués au taux courant de 17,2 % sur tout
 *   le gain. Les gains acquis avant 2018 relèvent en principe des « taux
 *   historiques », règle dont l'application demanderait un historique de
 *   versements année par année que le journal ne porte pas. Même parti pris
 *   documenté que dans `life-insurance/redemption-tax.ts`.
 * - Un retrait avant 5 ans est présumé clôturer le plan. Des cas de sortie
 *   anticipée sans clôture existent (licenciement, invalidité, retraite
 *   anticipée, création d'entreprise) : ils relèvent de la situation
 *   personnelle et sont signalés à l'utilisateur, pas devinés ici.
 *
 * Ces valeurs sont fixées par la loi et révisées par voie législative : les
 * mettre à jour est un changement de code, jamais un appel réseau — même
 * raisonnement que `cash/regulated-products.ts`.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import type { SecuritiesEnvelopeType } from "./constants";

/** Durée au terme de laquelle le gain cesse d'être soumis à l'impôt sur le revenu. */
export const PEA_MATURITY_YEARS = 5;

/** Plafond de versements propre au PEA classique. */
export const PEA_CAP_EUR = "150000";
/** Plafond de versements propre au PEA-PME (loi PACTE, 2019). */
export const PEA_PME_CAP_EUR = "225000";
/**
 * Plafond commun aux deux plans. Égal au plafond propre du PEA-PME : c'est
 * donc toujours lui qui borne réellement un PEA-PME, et parfois le PEA.
 */
export const PEA_COMBINED_CAP_EUR = "225000";

/** Part « impôt sur le revenu » du prélèvement forfaitaire unique. */
export const PEA_INCOME_TAX_RATE = "0.128";
/** Prélèvements sociaux — dus quelle que soit l'antériorité du plan. */
export const PEA_SOCIAL_CHARGES_RATE = "0.172";

// ─── Antériorité ──────────────────────────────────────────────────────────────

export type PeaMaturityStatus = {
  openDate: Date;
  /** Date à laquelle le plan atteint 5 ans. */
  maturityDate: Date;
  isMatured: boolean;
  /** Antériorité en années, fractionnaire — affichage uniquement. */
  ageYears: number;
  /** Jours restants avant les 5 ans. `0` une fois le seuil franchi. */
  daysToMaturity: number;
};

const MS_PER_DAY = 86_400_000;

/**
 * Antériorité du plan.
 *
 * `maturityDate` est calculée en ajoutant 5 ans à la date d'ouverture par
 * arithmétique calendaire, et non en ajoutant 5 × 365 jours : un plan ouvert le
 * 1ᵉʳ mars 2019 mûrit le 1ᵉʳ mars 2024, quels que soient les 29 février
 * traversés.
 */
export function peaMaturityStatus(
  openDate: Date,
  at: Date = new Date()
): PeaMaturityStatus {
  const maturityDate = new Date(openDate);
  maturityDate.setFullYear(maturityDate.getFullYear() + PEA_MATURITY_YEARS);

  const elapsedMs = at.getTime() - openDate.getTime();
  const remainingMs = maturityDate.getTime() - at.getTime();

  return {
    openDate,
    maturityDate,
    isMatured: remainingMs <= 0,
    ageYears: elapsedMs / (MS_PER_DAY * 365.25),
    daysToMaturity: remainingMs <= 0 ? 0 : Math.ceil(remainingMs / MS_PER_DAY),
  };
}

// ─── Plafond de versements ────────────────────────────────────────────────────

export type PeaContributionRoom = {
  envelopeType: SecuritiesEnvelopeType;
  /** Plafond propre au plan. */
  ownCapEur: Decimal;
  /** Versements cumulés sur ce plan. */
  contributionsEur: Decimal;
  /** Versements cumulés sur les deux plans réunis. */
  combinedContributionsEur: Decimal;
  /** Place restante, jamais négative. */
  remainingEur: Decimal;
  /** Dépassement constaté, `0` tant qu'il n'y en a pas. */
  overCapEur: Decimal;
  /** Part du plafond contraignant déjà consommée, en %. */
  usedPct: Decimal;
  isOverCap: boolean;
  /**
   * Lequel des deux plafonds borne réellement le plan.
   *
   * Sert à expliquer un chiffre qui surprend : un PEA-PME vide dont la place
   * est limitée à 75 000 € l'est par le plafond commun, pas par le sien.
   */
  bindingCap: "OWN" | "COMBINED";
};

/**
 * Place restante sur un plan, plafond commun compris.
 *
 * Renvoie `null` pour un compte-titres ordinaire : il n'est soumis à aucun
 * plafond de versement, et retourner un objet avec des zéros laisserait croire
 * le contraire.
 *
 * Les versements s'entendent **bruts** : un retrait ne restaure pas de place.
 * C'est la lecture retenue du plafond, qui porte sur les sommes versées et non
 * sur l'encours — un plan vidé après avoir reçu 150 000 € reste plein.
 */
export function peaContributionRoom(input: {
  envelopeType: SecuritiesEnvelopeType;
  /** Versements cumulés sur le PEA classique. */
  peaContributionsEur: Decimal;
  /** Versements cumulés sur le PEA-PME. */
  peaPmeContributionsEur: Decimal;
}): PeaContributionRoom | null {
  const { envelopeType } = input;
  if (envelopeType === "CTO") return null;

  const isPme = envelopeType === "PEA_PME";
  const contributions = isPme
    ? input.peaPmeContributionsEur
    : input.peaContributionsEur;
  const combined = input.peaContributionsEur.plus(input.peaPmeContributionsEur);
  const ownCap = d(isPme ? PEA_PME_CAP_EUR : PEA_CAP_EUR);
  const combinedCap = d(PEA_COMBINED_CAP_EUR);

  // Deux contraintes simultanées : le plafond propre du plan, et ce que le
  // plafond commun laisse une fois l'autre plan déduit. La plus basse gagne.
  const roomFromOwn = ownCap.minus(contributions);
  const roomFromCombined = combinedCap.minus(combined);
  const bindingCap = roomFromCombined.lt(roomFromOwn) ? "COMBINED" : "OWN";
  const rawRemaining = Decimal.min(roomFromOwn, roomFromCombined);

  const effectiveCap = bindingCap === "COMBINED" ? combinedCap : ownCap;
  const effectiveUsed = bindingCap === "COMBINED" ? combined : contributions;

  return {
    envelopeType,
    ownCapEur: ownCap,
    contributionsEur: contributions,
    combinedContributionsEur: combined,
    remainingEur: rawRemaining.gt(0) ? rawRemaining : d(0),
    overCapEur: rawRemaining.lt(0) ? rawRemaining.neg() : d(0),
    usedPct: effectiveCap.gt(0)
      ? effectiveUsed.div(effectiveCap).times(100)
      : d(0),
    isOverCap: rawRemaining.lt(0),
    bindingCap,
  };
}

// ─── Retrait ──────────────────────────────────────────────────────────────────

export type PeaWithdrawalTax = {
  /** Gain latent de l'enveloppe entière. Négatif en cas de moins-value. */
  gainTotalEur: Decimal;
  /** Quote-part du gain contenue dans le retrait. */
  taxableGainEur: Decimal;
  /** Impôt sur le revenu — nul dès que le plan a 5 ans. */
  incomeTaxEur: Decimal;
  /** Prélèvements sociaux — dus dans tous les cas. */
  socialChargesEur: Decimal;
  totalTaxEur: Decimal;
  /** Ce qui reste effectivement disponible après imposition. */
  netWithdrawalEur: Decimal;
  /** Imposition rapportée au montant retiré, en %. */
  effectiveRatePct: Decimal;
  /**
   * Vrai si le retrait est présumé clôturer le plan — c'est-à-dire s'il
   * intervient avant 5 ans. Les cas de sortie anticipée sans clôture existent
   * mais dépendent de la situation personnelle : ils sont signalés à
   * l'utilisateur, jamais présumés ici.
   */
  closesPea: boolean;
};

/**
 * Imposition d'un retrait.
 *
 * Renvoie `null` sur une entrée qui n'a pas de sens — valeur liquidative nulle,
 * retrait nul, ou retrait supérieur à ce que le plan contient. Ne rien
 * calculer vaut mieux qu'afficher un montant faux : même parti pris que
 * `computeImpermanentLoss`.
 *
 * Une moins-value latente ne produit aucune imposition, mais n'ouvre pas non
 * plus de créance : le résultat est simplement à zéro, avec `gainTotalEur`
 * négatif conservé pour affichage.
 */
export function peaWithdrawalTax(input: {
  /** Valeur liquidative de l'enveloppe entière : titres + espèces. */
  liquidationValueEur: Decimal;
  /** Versements cumulés bruts. */
  contributionsEur: Decimal;
  withdrawalAmountEur: Decimal;
  isMatured: boolean;
}): PeaWithdrawalTax | null {
  const { liquidationValueEur, contributionsEur, withdrawalAmountEur } = input;

  if (!liquidationValueEur.isFinite() || liquidationValueEur.lte(0)) return null;
  if (!withdrawalAmountEur.isFinite() || withdrawalAmountEur.lte(0)) return null;
  if (withdrawalAmountEur.gt(liquidationValueEur)) return null;

  const gainTotal = liquidationValueEur.minus(contributionsEur);

  // Le retrait emporte la même proportion de gain que la part qu'il représente
  // dans le plan : retirer un quart du PEA, c'est retirer un quart du gain.
  const taxableGain = gainTotal.gt(0)
    ? withdrawalAmountEur.times(gainTotal).div(liquidationValueEur)
    : d(0);

  const incomeTax = input.isMatured
    ? d(0)
    : taxableGain.times(PEA_INCOME_TAX_RATE);
  const socialCharges = taxableGain.times(PEA_SOCIAL_CHARGES_RATE);
  const totalTax = incomeTax.plus(socialCharges);

  return {
    gainTotalEur: gainTotal,
    taxableGainEur: taxableGain,
    incomeTaxEur: incomeTax,
    socialChargesEur: socialCharges,
    totalTaxEur: totalTax,
    netWithdrawalEur: withdrawalAmountEur.minus(totalTax),
    effectiveRatePct: totalTax.div(withdrawalAmountEur).times(100),
    closesPea: !input.isMatured,
  };
}

/**
 * Libellé du régime applicable.
 *
 * Volontairement explicite sur les prélèvements sociaux : « exonéré » tout
 * court est le raccourci qui fait sous-estimer l'imposition de 17,2 %.
 */
export function peaTaxStatusLabel(isMatured: boolean): string {
  return isMatured
    ? "IR exonéré · prélèvements sociaux 17,2 % dus"
    : "Retrait imposable · 12,8 % IR + 17,2 % PS";
}
