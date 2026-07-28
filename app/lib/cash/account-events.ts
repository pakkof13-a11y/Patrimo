/**
 * Historique des comptes courants et livrets — écriture, jamais saisie.
 *
 * Un événement se déduit toujours d'un changement de solde déjà décidé
 * ailleurs (création, PATCH, versement d'intérêts) : ce module n'expose que
 * des fonctions d'écriture, appelées par les services qui font réellement
 * bouger `balance`. Aucune route n'écrit un événement directement — sinon un
 * appel oublié désynchroniserait l'historique du solde réel, silencieusement.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { d } from "../money/decimal";

/** Client Prisma générique — singleton global ou `tx` d'une transaction interactive. */
type Tx = Prisma.TransactionClient;

export type BankAccountEventType = "OPENING" | "DEPOSIT" | "WITHDRAWAL";
export type SavingsAccountEventType =
  | "OPENING"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "INTEREST";

/** Delta signé → DEPOSIT si positif, WITHDRAWAL si négatif. Jamais appelé pour un delta nul. */
function directionOf(delta: string): "DEPOSIT" | "WITHDRAWAL" {
  return d(delta).gte(0) ? "DEPOSIT" : "WITHDRAWAL";
}

export async function recordBankAccountOpening(
  tx: Tx,
  bankAccountId: string,
  balance: string,
  occurredAt: Date = new Date()
) {
  await tx.bankAccountEvent.create({
    data: {
      bankAccountId,
      type: "OPENING",
      amount: balance,
      balanceAfter: balance,
      occurredAt,
    },
  });
}

/**
 * Enregistre le changement de solde d'un compte courant, s'il y en a un.
 * No-op silencieux si `previousBalance === newBalance` : un PATCH qui touche
 * un autre champ (nom, devise) ne doit pas produire un événement à 0 €.
 */
export async function recordBankAccountBalanceChange(
  tx: Tx,
  bankAccountId: string,
  previousBalance: string,
  newBalance: string,
  occurredAt: Date = new Date()
) {
  const delta = d(newBalance).minus(d(previousBalance));
  if (delta.eq(0)) return;
  await tx.bankAccountEvent.create({
    data: {
      bankAccountId,
      type: directionOf(delta.toString()),
      amount: delta.toString(),
      balanceAfter: newBalance,
      occurredAt,
    },
  });
}

export async function recordSavingsAccountOpening(
  tx: Tx,
  savingsAccountId: string,
  balance: string,
  occurredAt: Date = new Date()
) {
  await tx.savingsAccountEvent.create({
    data: {
      savingsAccountId,
      type: "OPENING",
      amount: balance,
      balanceAfter: balance,
      occurredAt,
    },
  });
}

/** Cf. `recordBankAccountBalanceChange` — même garde no-op sur delta nul. */
export async function recordSavingsAccountBalanceChange(
  tx: Tx,
  savingsAccountId: string,
  previousBalance: string,
  newBalance: string,
  occurredAt: Date = new Date()
) {
  const delta = d(newBalance).minus(d(previousBalance));
  if (delta.eq(0)) return;
  await tx.savingsAccountEvent.create({
    data: {
      savingsAccountId,
      type: directionOf(delta.toString()),
      amount: delta.toString(),
      balanceAfter: newBalance,
      occurredAt,
    },
  });
}

/**
 * Intérêts versés — jamais confondus avec un dépôt de l'utilisateur (cf. le
 * commentaire sur `SavingsAccountEvent` dans le schéma). `periodsCredited`
 * est noté en clair : un même événement peut regrouper plusieurs périodes
 * rattrapées d'un coup (compte non consulté depuis longtemps).
 */
export async function recordSavingsAccountInterest(
  tx: Tx,
  savingsAccountId: string,
  interestAmount: string,
  balanceAfter: string,
  periodsCredited: number,
  occurredAt: Date = new Date()
) {
  if (d(interestAmount).lte(0)) return;
  await tx.savingsAccountEvent.create({
    data: {
      savingsAccountId,
      type: "INTEREST",
      amount: interestAmount,
      balanceAfter,
      occurredAt,
      notes:
        periodsCredited > 1
          ? `${periodsCredited} périodes créditées`
          : null,
    },
  });
}
