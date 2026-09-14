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

export type BankAccountEventType =
  | "OPENING"
  | "DEPOSIT"
  | "WITHDRAWAL"
  /** Le compte change de devise : même nominal, autre unité. */
  | "REDENOMINATION";
export type SavingsAccountEventType =
  | "OPENING"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "INTEREST"
  /** Le livret change de devise : même nominal, autre unité. */
  | "REDENOMINATION";

/** Delta signé → DEPOSIT si positif, WITHDRAWAL si négatif. Jamais appelé pour un delta nul. */
function directionOf(delta: string): "DEPOSIT" | "WITHDRAWAL" {
  return d(delta).gte(0) ? "DEPOSIT" : "WITHDRAWAL";
}

/**
 * Ouverture — le solde d'où part l'histoire du compte.
 *
 * `currency` est celle du solde **à cet instant**, figée sur l'événement. Le
 * chargeur historique convertissait chaque événement avec la devise *courante*
 * du compte : changer la devise réécrivait rétroactivement la valeur en euros
 * de tout son passé. C'est le remède déjà appliqué à `EnvelopeCashEvent`.
 *
 * `occurredAt` est paramétrable pour la même raison qu'en D38 : une ouverture
 * posée après coup se date du dernier instant où le solde était connu, pas de
 * celui où on s'en aperçoit.
 */
export async function recordBankAccountOpening(
  tx: Tx,
  bankAccountId: string,
  balance: string,
  currency = "EUR",
  occurredAt: Date = new Date()
) {
  await tx.bankAccountEvent.create({
    data: {
      bankAccountId,
      type: "OPENING",
      amount: balance,
      balanceAfter: balance,
      currency,
      occurredAt,
    },
  });
}

/**
 * Le compte change de devise : même nominal, autre unité.
 *
 * Rien n'entre ni ne sort — `amount` vaut zéro, et c'est exact : l'utilisateur
 * n'a rien versé ni retiré. Mais la valeur en euros du compte, elle, change,
 * et l'événement est ce qui permet à la chronologie de le savoir sans réécrire
 * le passé : les faits antérieurs gardent leur devise, celui-ci porte la
 * nouvelle.
 *
 * Sans cet événement, la chaîne cessait de se rapprocher de la ligne : le
 * dernier `balanceAfter` était libellé dans une devise que le compte n'a plus.
 */
export async function recordBankAccountRedenomination(
  tx: Tx,
  bankAccountId: string,
  balance: string,
  from: string,
  to: string,
  occurredAt: Date = new Date()
) {
  await tx.bankAccountEvent.create({
    data: {
      bankAccountId,
      type: "REDENOMINATION",
      amount: "0",
      balanceAfter: balance,
      currency: to,
      occurredAt,
      notes: `${from} → ${to}`,
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
  currency = "EUR",
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
      currency,
      occurredAt,
    },
  });
}

/** Cf. `recordBankAccountOpening` — même rôle, même raison de dater. */
export async function recordSavingsAccountOpening(
  tx: Tx,
  savingsAccountId: string,
  balance: string,
  currency = "EUR",
  occurredAt: Date = new Date()
) {
  await tx.savingsAccountEvent.create({
    data: {
      savingsAccountId,
      type: "OPENING",
      amount: balance,
      balanceAfter: balance,
      currency,
      occurredAt,
    },
  });
}

/** Cf. `recordBankAccountRedenomination` — même fait, autre modèle. */
export async function recordSavingsAccountRedenomination(
  tx: Tx,
  savingsAccountId: string,
  balance: string,
  from: string,
  to: string,
  occurredAt: Date = new Date()
) {
  await tx.savingsAccountEvent.create({
    data: {
      savingsAccountId,
      type: "REDENOMINATION",
      amount: "0",
      balanceAfter: balance,
      currency: to,
      occurredAt,
      notes: `${from} → ${to}`,
    },
  });
}

/** Cf. `recordBankAccountBalanceChange` — même garde no-op sur delta nul. */
export async function recordSavingsAccountBalanceChange(
  tx: Tx,
  savingsAccountId: string,
  previousBalance: string,
  newBalance: string,
  currency = "EUR",
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
      currency,
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
  currency = "EUR",
  occurredAt: Date = new Date()
) {
  if (d(interestAmount).lte(0)) return;
  await tx.savingsAccountEvent.create({
    data: {
      savingsAccountId,
      type: "INTEREST",
      amount: interestAmount,
      balanceAfter,
      currency,
      occurredAt,
      notes:
        periodsCredited > 1
          ? `${periodsCredited} périodes créditées`
          : null,
    },
  });
}
