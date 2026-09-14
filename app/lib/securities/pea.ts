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
 *    Les prélèvements sociaux restent dus sur la totalité du gain, avant comme
 *    après 5 ans. Afficher « exonéré » sous-estimerait la note de tout le taux
 *    des prélèvements sociaux.
 *
 * ## Simplifications assumées
 *
 * - Les prélèvements sociaux sont appliqués au taux courant (18,6 % depuis le
 *   1ᵉʳ janvier 2026) sur tout le gain. Deux découpages historiques existent
 *   pourtant : les gains constatés avant 2026 relèvent de 17,2 %, et ceux
 *   acquis avant 2018 des « taux historiques ». Les appliquer demanderait un
 *   historique de valorisation année par année que le journal ne porte pas.
 *   L'approximation est **majorante**, donc prudente : elle ne fait jamais
 *   sous-estimer l'impôt. Même parti pris documenté que dans
 *   `life-insurance/redemption-tax.ts`.
 * - Un retrait avant 5 ans est présumé clôturer le plan (art. L221-32 II du
 *   Code monétaire et financier : « tout retrait […] entraîne la clôture »).
 *   Des cas de sortie anticipée sans clôture existent — affectation à la
 *   création ou reprise d'entreprise, licenciement, invalidité, mise à la
 *   retraite anticipée du titulaire ou de son conjoint, retrait de titres
 *   d'une société en liquidation judiciaire — mais ils relèvent de la
 *   situation personnelle, que le journal `SecuritiesAccountContribution` ne
 *   porte pas (aucun motif sur un retrait). Ils sont signalés à l'utilisateur,
 *   pas devinés ici. Ce qui ne dépend pas du motif : dans tous ces cas, **plus
 *   aucun versement n'est possible** après le premier retrait — la place de
 *   versement tombe donc à zéro sans qu'il y ait à trancher (voir
 *   `peaMaturityStatus`, `peaContributionRoom`).
 *
 * Ces valeurs sont fixées par la loi et révisées par voie législative : les
 * mettre à jour est un changement de code, jamais un appel réseau — même
 * raisonnement que `cash/regulated-products.ts`.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import {
  PFU_INCOME_TAX_RATE,
  ratePct,
  SOCIAL_CHARGES_RATE,
} from "@/app/lib/tax/rates";
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

/**
 * Taux du PEA — repris de `tax/rates.ts`, source unique du dépôt.
 *
 * Ré-exportés sous un nom local plutôt que dupliqués : le PEA suit exactement
 * les taux du capital, y compris la hausse des prélèvements sociaux de 2026
 * (contrairement à l'assurance-vie, restée à 17,2 %).
 */
export const PEA_INCOME_TAX_RATE = PFU_INCOME_TAX_RATE;
/** Prélèvements sociaux — dus quelle que soit l'antériorité du plan. */
export const PEA_SOCIAL_CHARGES_RATE = SOCIAL_CHARGES_RATE;

// ─── Antériorité ──────────────────────────────────────────────────────────────

/**
 * État du plan, au-delà de la seule date.
 *
 * - `RUNNING` : ouvert, en route vers ses 5 ans.
 * - `MATURED` : ouvert, 5 ans atteints.
 * - `CLOSED` : présumé clos — un retrait est enregistré avant la date de
 *   maturité. La maturité ne progresse plus et aucun versement n'est plus
 *   possible. « Présumé » parce que les exceptions légales (création
 *   d'entreprise, licenciement, invalidité, retraite anticipée, liquidation
 *   judiciaire) ne se lisent pas dans le journal ; l'écran le dit.
 * - `UNKNOWN` : le journal ne permet pas d'établir que le plan n'a **pas** été
 *   clos — retrait à date illisible, antérieur à l'ouverture, postérieur à la
 *   date d'évaluation, ou versement daté après un retrait qui aurait dû
 *   clôturer. Rien n'est présumé ouvert dans cet état.
 */
export type PeaPlanStatus = "RUNNING" | "MATURED" | "CLOSED" | "UNKNOWN";

export type PeaMaturityStatus = {
  openDate: Date;
  /** Date à laquelle le plan atteindrait 5 ans. */
  maturityDate: Date;
  /**
   * 5 ans atteints **sur un plan ouvert**. Toujours `false` sur un plan
   * `CLOSED` ou `UNKNOWN`, même si la date de maturité est passée : la
   * maturité d'un plan clos ne court plus, et sur un statut indéterminé on ne
   * présume pas l'exonération.
   */
  isMatured: boolean;
  /**
   * Antériorité en années, fractionnaire — affichage uniquement. Arrêtée à
   * la date de clôture sur un plan `CLOSED`.
   */
  ageYears: number;
  /**
   * Jours restants avant les 5 ans. `0` une fois le seuil franchi — et `0`
   * aussi sur un plan `CLOSED` ou `UNKNOWN`, où aucun compte à rebours n'a de
   * sens : un consommateur doit lire `planStatus` avant d'afficher un délai.
   */
  daysToMaturity: number;
  planStatus: PeaPlanStatus;
  /** Date du premier retrait avant maturité — `null` hors `CLOSED`. */
  closedAt: Date | null;
};

const MS_PER_DAY = 86_400_000;

/**
 * Ajoute des années civiles à une date UTC, en plafonnant au dernier jour du
 * mois cible plutôt que de déborder sur le mois suivant.
 *
 * `Date.setFullYear` ne le fait pas nativement : un 29 février additionné vers
 * une année non bissextile déborde sur le 1ᵉʳ mars. Le calcul passe donc par
 * `Date.UTC`, jamais par les accesseurs locaux, pour ne pas faire glisser une
 * date déjà en UTC — celles que rend Prisma.
 */
function addYearsClampedUtc(date: Date, years: number): Date {
  const targetYear = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  // Jour 0 du mois suivant = dernier jour du mois cible.
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayOfTargetMonth);

  return new Date(
    Date.UTC(
      targetYear,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

/**
 * Antériorité du plan.
 *
 * `maturityDate` est calculée en ajoutant 5 ans à la date d'ouverture par
 * arithmétique calendaire, et non en ajoutant 5 × 365 jours : un plan ouvert le
 * 1ᵉʳ mars 2019 mûrit le 1ᵉʳ mars 2024, quels que soient les 29 février
 * traversés.
 *
 * `Date.setFullYear` ne plafonne pas : un 29 février qui tombe sur une année
 * non bissextile déborde sur le mois suivant — mesuré,
 * `new Date("2020-02-29").setFullYear(2025)` rend le **1ᵉʳ mars 2025**, pas le
 * 28 février. Un PEA ouvert un 29 février serait donc annoncé non mûr un jour
 * de trop, sous le commentaire ci-dessus qui promet justement le contraire. On
 * calcule donc la date cible via `Date.UTC` avec le jour d'ouverture, puis on
 * revient au dernier jour du mois cible s'il a débordé — ce qui couvre aussi
 * une ouverture un 31 dans un mois cible plus court. Les dates viennent de
 * Prisma en UTC : tout ce calcul reste en UTC pour ne pas les faire glisser
 * d'un jour.
 *
 * ## Clôture anticipée (TIT-06)
 *
 * La date seule ne suffit pas : un retrait enregistré avant la date de
 * maturité clôture le plan (art. L221-32 II CMF), et un plan clos n'a ni
 * maturité qui progresse ni place de versement. Sans le journal, cette
 * fonction annonçait un compte à rebours et une exonération à venir sur un
 * plan qui n'existait plus. `movements` est donc lu ici :
 *
 * - premier `WITHDRAWAL` daté **avant** `maturityDate` → `CLOSED`, à cette
 *   date. Le jour même de la maturité ne clôture pas, par symétrie avec
 *   `isMatured`, vrai ce jour-là ;
 * - un retrait après maturité ne change rien : retraits partiels libres et
 *   versements toujours possibles après 5 ans (loi PACTE) ;
 * - `UNKNOWN` dès que le journal empêche d'établir que le plan reste ouvert :
 *   date d'ouverture ou d'évaluation illisible, retrait à date illisible ou
 *   montant non fini, retrait daté avant l'ouverture, retrait daté après `at`
 *   (mêmes refus que `peaContributionBase`), ou versement daté après le
 *   retrait qui aurait dû clôturer — le journal se contredit, et choisir un
 *   des deux serait deviner.
 *
 * Omettre `movements` vaut « aucun mouvement connu » et rend l'ancien calcul
 * calendaire : c'est un choix d'appelant, pas une inférence sur des données.
 */
export function peaMaturityStatus(
  openDate: Date,
  at: Date = new Date(),
  movements: ReadonlyArray<PeaMovement> = []
): PeaMaturityStatus {
  const maturityDate = addYearsClampedUtc(openDate, PEA_MATURITY_YEARS);
  const closure = peaClosure({ openDate, maturityDate, at, movements });

  const unknown: PeaMaturityStatus = {
    openDate,
    maturityDate,
    isMatured: false,
    ageYears: 0,
    daysToMaturity: 0,
    planStatus: "UNKNOWN",
    closedAt: null,
  };
  if (closure.status === "UNKNOWN") return unknown;

  if (closure.status === "CLOSED") {
    const elapsedMs = closure.closedAt.getTime() - openDate.getTime();
    return {
      openDate,
      maturityDate,
      isMatured: false,
      ageYears: elapsedMs / (MS_PER_DAY * 365.25),
      daysToMaturity: 0,
      planStatus: "CLOSED",
      closedAt: closure.closedAt,
    };
  }

  const elapsedMs = at.getTime() - openDate.getTime();
  const remainingMs = maturityDate.getTime() - at.getTime();
  const isMatured = remainingMs <= 0;

  return {
    openDate,
    maturityDate,
    isMatured,
    ageYears: elapsedMs / (MS_PER_DAY * 365.25),
    daysToMaturity: isMatured ? 0 : Math.ceil(remainingMs / MS_PER_DAY),
    planStatus: isMatured ? "MATURED" : "RUNNING",
    closedAt: null,
  };
}

/**
 * Lecture du journal pour `peaMaturityStatus` : le plan a-t-il été clos par un
 * retrait, ou le journal interdit-il de le dire ?
 *
 * `OPEN` signifie seulement « aucun retrait avant maturité » — c'est
 * l'appelant qui départage `RUNNING` et `MATURED` par la date.
 */
function peaClosure(input: {
  openDate: Date;
  maturityDate: Date;
  at: Date;
  movements: ReadonlyArray<PeaMovement>;
}):
  | { status: "OPEN" }
  | { status: "CLOSED"; closedAt: Date }
  | { status: "UNKNOWN" } {
  const { openDate, maturityDate, at, movements } = input;
  if (Number.isNaN(openDate.getTime()) || Number.isNaN(at.getTime())) {
    return { status: "UNKNOWN" };
  }

  let closedAt: Date | null = null;
  for (const m of movements) {
    if (!m.amountEur.isFinite() || Number.isNaN(m.occurredAt.getTime())) {
      return { status: "UNKNOWN" };
    }
    if (m.type !== "WITHDRAWAL") continue;
    if (m.occurredAt < openDate) return { status: "UNKNOWN" };
    if (m.occurredAt > at) return { status: "UNKNOWN" };
    if (m.occurredAt < maturityDate && (!closedAt || m.occurredAt < closedAt)) {
      closedAt = m.occurredAt;
    }
  }
  if (!closedAt) return { status: "OPEN" };

  // Un versement daté après le retrait qui clôture : soit une exception légale
  // où le plan a survécu — mais même alors aucun versement n'est possible —,
  // soit une erreur de saisie. Dans les deux cas le journal se contredit.
  for (const m of movements) {
    if (m.type === "DEPOSIT" && m.occurredAt > closedAt) {
      return { status: "UNKNOWN" };
    }
  }
  return { status: "CLOSED", closedAt };
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
  /**
   * Place restante, jamais négative. `0` dès que `blockedReason` est renseigné,
   * quelle que soit la place que le plafond laisserait : un plan clos ne reçoit
   * plus rien.
   */
  remainingEur: Decimal;
  /** Dépassement constaté, `0` tant qu'il n'y en a pas. */
  overCapEur: Decimal;
  /** Part du plafond contraignant déjà consommée, en %. */
  usedPct: Decimal;
  isOverCap: boolean;
  /**
   * Pourquoi aucun versement n'est possible, indépendamment du plafond.
   *
   * - `PLAN_CLOSED` : un retrait avant 5 ans a clôturé le plan — et même
   *   dans les cas d'exception où il survit, la loi interdit tout versement
   *   après ce retrait. Le zéro ne dépend donc pas du motif.
   * - `PLAN_STATUS_UNKNOWN` : le journal ne permet pas d'établir que le plan
   *   reste ouvert ; on n'offre pas de place sur une présomption.
   * - `null` : la place est celle du plafond.
   */
  blockedReason: PeaRoomBlockReason | null;
  /**
   * Lequel des deux plafonds borne réellement le plan.
   *
   * Sert à expliquer un chiffre qui surprend : un PEA-PME vide dont la place
   * est limitée à 75 000 € l'est par le plafond commun, pas par le sien.
   */
  bindingCap: "OWN" | "COMBINED";
};

export type PeaRoomBlockReason = "PLAN_CLOSED" | "PLAN_STATUS_UNKNOWN";

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
 *
 * Le plafond n'est pas la seule borne : `planStatus` (de `peaMaturityStatus`)
 * dit si le plan reçoit encore des versements. Un plan `CLOSED` ou `UNKNOWN`
 * rend une place nulle et le motif dans `blockedReason` ; les grandeurs du
 * plafond (versements, part consommée, dépassement) restent des faits et sont
 * rendues telles quelles. Le paramètre est obligatoire pour qu'aucun appelant
 * ne puisse offrir de place par oubli.
 *
 * Les versements d'un plan clos continuent de compter dans le plafond commun
 * de l'autre plan : c'est la lecture prudente — elle sous-estime la place du
 * PEA-PME plutôt que de la surestimer —, et la règle exacte après clôture
 * d'un des deux plans n'est pas tranchée ici.
 */
export function peaContributionRoom(input: {
  envelopeType: SecuritiesEnvelopeType;
  /** Versements cumulés sur le PEA classique. */
  peaContributionsEur: Decimal;
  /** Versements cumulés sur le PEA-PME. */
  peaPmeContributionsEur: Decimal;
  /** État du plan évalué — `peaMaturityStatus(...).planStatus`. */
  planStatus: PeaPlanStatus;
}): PeaContributionRoom | null {
  const { envelopeType } = input;
  if (envelopeType === "CTO") return null;

  const blockedReason: PeaRoomBlockReason | null =
    input.planStatus === "CLOSED"
      ? "PLAN_CLOSED"
      : input.planStatus === "UNKNOWN"
        ? "PLAN_STATUS_UNKNOWN"
        : null;

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
    remainingEur: blockedReason || rawRemaining.lte(0) ? d(0) : rawRemaining,
    overCapEur: rawRemaining.lt(0) ? rawRemaining.neg() : d(0),
    usedPct: effectiveCap.gt(0)
      ? effectiveUsed.div(effectiveCap).times(100)
      : d(0),
    isOverCap: rawRemaining.lt(0),
    bindingCap,
    blockedReason,
  };
}

// ─── Assiette de versements après retraits ────────────────────────────────────

export type PeaMovement = {
  type: "DEPOSIT" | "WITHDRAWAL";
  amountEur: Decimal;
  occurredAt: Date;
};

/**
 * Comment l'assiette de versements a été obtenue.
 *
 * - `EXACT` : aucun retrait, l'assiette est la somme des versements.
 * - `PRORATA` : au moins un retrait antérieur ; la quote-part de versements
 *   qu'il a emportée est répartie au prorata (voir `peaContributionBase`).
 * - `UNKNOWN` : une donnée manque ou se contredit ; aucune assiette n'est
 *   rendue, et rien ne remplace ce vide par un zéro.
 */
export type PeaContributionBaseStatus = "EXACT" | "PRORATA" | "UNKNOWN";

export type PeaContributionBase = {
  status: Exclude<PeaContributionBaseStatus, "UNKNOWN">;
  /** Versements bruts — ce que le plafond consomme, retraits ou non. */
  grossContributionsEur: Decimal;
  withdrawalsEur: Decimal;
  /** Quote-part de versements sortie du plan avec les retraits. */
  withdrawnContributionsEur: Decimal;
  /** Versements encore dans le plan : l'assiette du gain. `0 ≤ … ≤ bruts`. */
  remainingContributionsEur: Decimal;
  /** Valeur liquidative − versements restants. Négatif en cas de moins-value. */
  gainEur: Decimal;
};

/**
 * Assiette de versements restant dans le plan après les retraits déjà
 * enregistrés (BOI-RPPM-RCM-40-50-50).
 *
 * La doctrine veut qu'un retrait partiel `w` emporte une quote-part de
 * versements `w × R / VL`, où `VL` est la valeur liquidative du plan **au jour
 * du retrait**, et que l'assiette `R` diminue d'autant. Le journal
 * `SecuritiesAccountContribution` n'a pas cette valeur historique : il ne porte
 * que le type, le montant et la date de chaque mouvement.
 *
 * Choix retenu (décision utilisateur, lot B / TIT-01) : la seule
 * reconstitution qui n'invente pas de mouvement de marché est `VL₀ = V + W` —
 * la valeur actuelle du plan augmentée de tout ce qui en est sorti, soit ce
 * qu'il vaudrait si rien n'en était sorti. Chaque retrait `wᵢ` emporte alors
 * `wᵢ × D / (V + W)` de versements, d'où en forme close :
 *
 *     restants = D − W × D / (V + W) = D × V / (V + W)
 *     gain     = V − restants        = V × (V + W − D) / (V + W)
 *
 * Propriétés : `0 ≤ restants ≤ D` ; le résultat ne dépend pas de l'ordre des
 * retraits (deux retraits de `w` valent un retrait de `2w`) ; le signe du gain
 * est celui de `V + W − D` et ne bascule pas d'un retrait à l'autre ; sans
 * retrait, `restants = D` exactement. Sans mouvement de marché entre le retrait
 * et aujourd'hui, `VL₀` est la vraie valeur au jour du retrait et la formule
 * est celle de la doctrine à l'euro près. Avec mouvement de marché, c'est une
 * estimation : `status` le dit (`PRORATA`) et l'écran doit le répéter.
 *
 * L'option « forfait 17,2 % sur tout le retrait » a été refusée : elle n'est
 * ni implémentée ni proposée.
 *
 * `null` — UNKNOWN — dès qu'une donnée manque ou se contredit, sans jamais
 * remplacer par zéro :
 * - compte-titres ordinaire avec un retrait : la règle du PEA ne s'y applique
 *   pas, et aucune autre ne dit ce qu'un retrait emporte ;
 * - montant non fini, ou date invalide ;
 * - retrait daté avant l'ouverture du plan, avant le premier versement, ou
 *   après la date d'évaluation : il n'a pas pu emporter de versements ;
 * - `V + W ≤ 0` avec un retrait : la proportion n'a pas de sens.
 */
export function peaContributionBase(input: {
  envelopeType: SecuritiesEnvelopeType;
  openDate: Date;
  at: Date;
  /** Valeur liquidative actuelle de l'enveloppe entière : titres + espèces. */
  liquidationValueEur: Decimal;
  movements: ReadonlyArray<PeaMovement>;
}): PeaContributionBase | null {
  const { liquidationValueEur: value, movements } = input;
  if (!value.isFinite()) return null;
  if (Number.isNaN(input.openDate.getTime()) || Number.isNaN(input.at.getTime())) {
    return null;
  }

  let deposits = d(0);
  let withdrawals = d(0);
  let firstDeposit: Date | null = null;
  for (const m of movements) {
    if (!m.amountEur.isFinite() || Number.isNaN(m.occurredAt.getTime())) {
      return null;
    }
    if (m.type === "WITHDRAWAL") {
      withdrawals = withdrawals.plus(m.amountEur);
    } else {
      deposits = deposits.plus(m.amountEur);
      if (!firstDeposit || m.occurredAt < firstDeposit) firstDeposit = m.occurredAt;
    }
  }

  if (withdrawals.isZero()) {
    return {
      status: "EXACT",
      grossContributionsEur: deposits,
      withdrawalsEur: withdrawals,
      withdrawnContributionsEur: d(0),
      remainingContributionsEur: deposits,
      gainEur: value.minus(deposits),
    };
  }

  // À partir d'ici, au moins un retrait : la règle du PEA, et elle seule.
  if (input.envelopeType === "CTO") return null;
  if (!firstDeposit) return null;
  for (const m of movements) {
    if (m.type !== "WITHDRAWAL") continue;
    if (m.occurredAt < input.openDate) return null;
    if (m.occurredAt < firstDeposit) return null;
    if (m.occurredAt > input.at) return null;
  }

  const reconstituted = value.plus(withdrawals);
  if (reconstituted.lte(0)) return null;

  const withdrawn = withdrawals.times(deposits).div(reconstituted);
  const remaining = deposits.minus(withdrawn);

  return {
    status: "PRORATA",
    grossContributionsEur: deposits,
    withdrawalsEur: withdrawals,
    withdrawnContributionsEur: withdrawn,
    remainingContributionsEur: remaining,
    gainEur: value.minus(remaining),
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
  /**
   * Versements **restant dans le plan** — `remainingContributionsEur` de
   * `peaContributionBase`, pas les versements bruts : après un retrait
   * partiel, une part des versements est déjà sortie et ne peut plus venir
   * en déduction du gain.
   */
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
 * court est le raccourci qui fait sous-estimer l'imposition de tout leur taux.
 *
 * Les taux sont interpolés depuis les constantes plutôt qu'écrits dans la
 * phrase : une révision législative ne doit pas laisser un libellé annoncer un
 * taux que le calcul n'applique plus.
 */
export function peaTaxStatusLabel(isMatured: boolean): string {
  const ps = ratePct(PEA_SOCIAL_CHARGES_RATE);
  return isMatured
    ? `IR exonéré · prélèvements sociaux ${ps} dus`
    : `Retrait imposable · ${ratePct(PEA_INCOME_TAX_RATE)} IR + ${ps} PS`;
}

/**
 * Libellé du régime selon l'état du plan — `peaTaxStatusLabel` ne connaît que
 * la date, et sur un plan clos ou indéterminé son libellé mentirait : il
 * annoncerait un retrait imposable ou exonéré sur un plan qui ne reçoit plus
 * de retrait, ou dont on ne sait pas s'il existe encore.
 */
export function peaPlanStatusLabel(status: PeaMaturityStatus): string {
  switch (status.planStatus) {
    case "CLOSED":
      return "Plan présumé clos · retrait enregistré avant 5 ans";
    case "UNKNOWN":
      return "État du plan indéterminé · vérifiez les retraits enregistrés";
    default:
      return peaTaxStatusLabel(status.isMatured);
  }
}
