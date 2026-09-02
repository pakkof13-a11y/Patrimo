/**
 * Dépôt à terme (CAT) — service métier.
 *
 * Contrairement à un compte courant ou un livret, un CAT n'a pas de solde qui
 * évolue au jour le jour : le principal est bloqué jusqu'à l'échéance (ou
 * débloqué avec pénalité). Pas d'historique d'événements ici — il n'y a rien
 * à journaliser entre l'ouverture et l'échéance.
 */

import { d } from "../money/decimal";

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

export function validatePrincipal(principal: string): void {
  if (!d(principal).isFinite() || d(principal).lte(0)) {
    throw new TermDepositInputError("Le principal doit être strictement positif");
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
