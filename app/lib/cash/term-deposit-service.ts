/**
 * Dépôt à terme (CAT) — service métier.
 *
 * Contrairement à un compte courant ou un livret, un CAT n'a pas de solde qui
 * évolue au jour le jour : le principal est bloqué jusqu'à l'échéance (ou
 * débloqué avec pénalité). Pas d'historique d'événements ici — il n'y a rien
 * à journaliser entre l'ouverture et l'échéance.
 */

import { d, type Decimal } from "../money/decimal";

export class TermDepositInputError extends Error {
  readonly code = "TERM_DEPOSIT_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "TermDepositInputError";
  }
}

/** Valide la cohérence des dates et montants d'un CAT — jetée dans les deux routes POST/PUT. */
export function validateTermDepositDates(
  openedAtRaw: string,
  maturityDateRaw: string
): { openedAt: Date; maturityDate: Date } {
  const openedAt = new Date(openedAtRaw);
  const maturityDate = new Date(maturityDateRaw);
  if (Number.isNaN(openedAt.getTime())) {
    throw new TermDepositInputError("Date d'ouverture invalide");
  }
  if (Number.isNaN(maturityDate.getTime())) {
    throw new TermDepositInputError("Date d'échéance invalide");
  }
  if (maturityDate.getTime() <= openedAt.getTime()) {
    throw new TermDepositInputError(
      "La date d'échéance doit être postérieure à la date d'ouverture"
    );
  }
  return { openedAt, maturityDate };
}

/**
 * Lit un décimal sans jamais lever autre chose qu'une erreur métier.
 *
 * `d("abc")` lève une `DecimalError`, et `new Prisma.Decimal("")` aussi :
 * deux exceptions qu'aucune route n'attrape, donc deux 500 muets là où la
 * saisie est simplement invalide. Le schéma en écarte déjà une partie, mais
 * s'y fier rendrait ce service dépendant d'un garde distant — c'est
 * exactement le raisonnement tenu sur le verrou d'accrual des livrets.
 *
 * `null` quand la chaîne ne décrit aucun nombre utilisable.
 */
function nombre(raw: string): Decimal | null {
  /*
    La chaîne vide est une absence, pas un zéro.

    `d("")` rend délibérément `0` — utile là où un champ vide vaut « rien à
    ajouter ». Ici c'est l'inverse : un taux non saisi n'est pas un taux nul, et
    le laisser passer pour 0 % écrirait un chiffre que personne n'a donné.
  */
  if (raw == null || raw.trim() === "") return null;
  try {
    const n = d(raw);
    return n.isFinite() ? n : null;
  } catch {
    return null;
  }
}

export function validatePrincipal(principal: string): void {
  const n = nombre(principal);
  if (!n || n.lte(0)) {
    throw new TermDepositInputError("Le principal doit être strictement positif");
  }
}

/**
 * Taux annoncé du dépôt, en pourcentage.
 *
 * Il partait nu vers `new Prisma.Decimal(...)`. `decimalString` accepte
 * explicitement la chaîne vide : `ratePercent: ""` levait donc une
 * `DecimalError` — ni une `TermDepositInputError`, ni rien que le `catch` de
 * la route sache traduire — et la création finissait en 500. `principal`
 * était protégé, `earlyWithdrawalPenaltyPct` aussi par son ternaire ; le taux
 * était le seul des trois à ne rien avoir.
 *
 * Les bornes : un taux négatif n'existe pas sur ce produit — on ne paie pas
 * pour prêter à terme —, et 100 % l'an est déjà hors de tout marché connu.
 * Le plafond n'est pas une vérité économique, c'est un garde-fou de saisie :
 * il attrape la virgule mal placée et l'import mal lu, pas une offre réelle.
 */
export function validateRatePercent(ratePercent: string): void {
  const n = nombre(ratePercent);
  if (!n || n.lt(0) || n.gt(100)) {
    throw new TermDepositInputError(
      "Le taux doit être un pourcentage compris entre 0 et 100"
    );
  }
}

/** Pénalité de retrait anticipé, en pourcentage du taux — mêmes bornes. */
export function validatePenaltyPct(penalty: string): void {
  const n = nombre(penalty);
  if (!n || n.lt(0) || n.gt(100)) {
    throw new TermDepositInputError(
      "La pénalité doit être un pourcentage compris entre 0 et 100"
    );
  }
}

export type TermDepositMaturityStatus = "ACTIVE" | "MATURED";

/** Statut d'échéance — pur, utilisé pour l'affichage (badge « échu ») sans autre effet. */
export function maturityStatus(
  maturityDate: Date,
  now: Date = new Date()
): TermDepositMaturityStatus {
  return maturityDate.getTime() <= now.getTime() ? "MATURED" : "ACTIVE";
}

/** Jours restants avant échéance — négatif si déjà échu. */
export function daysUntilMaturity(maturityDate: Date, now: Date = new Date()): number {
  const ms = maturityDate.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
