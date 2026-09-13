/**
 * PAS-02 — la date de reference des dettes anterieures a PAS-01.
 *
 * ## Le probleme
 *
 * `lastPaymentAppliedAt` dit jusqu'ou les echeances ont deja ete inscrites.
 * PAS-01 le pose a la creation et a toute resaisie du capital restant du, mais
 * seulement en avant : les `Liability` deja en base l'ont encore a `null`.
 *
 * Pour la projection, `null` ne veut pas dire « rien n'a jamais ete paye » — il
 * veut dire « on ne sait pas ». Or `duePaymentDates` traite l'inconnu comme un
 * zero : faute de borne, elle repart de `startDate`. La prochaine
 * materialisation ecrirait donc d'un seul coup toutes les mensualites depuis
 * l'origine du pret — des annees d'ecritures datees qui n'ont jamais ete
 * constatees, sur un solde qui, lui, est deja a jour. De l'historique invente.
 *
 * ## Ce qu'on pose, et ce qu'on ne pose pas
 *
 * On ne reconstitue aucun historique de paiement : la seule chose que la base
 * sache vraiment, c'est que `remainingAmount` etait vrai au dernier moment ou
 * la ligne a ete ecrite. C'est `updatedAt`, et c'est la borne retenue.
 *
 * Une exception, quand la ligne porte deja des prelevements mensuels : si le
 * plus recent est posterieur a `updatedAt` — un seed qui cree les evenements
 * apres la dette — c'est lui qui fait foi, sinon on rejouerait les mois qui les
 * separent. On prend donc la plus recente des deux dates connues. Dans les deux
 * cas, aucune echeance passee n'est materialisee.
 *
 * L'ecart de valorisation visible sur les donnees de demonstration est un
 * defaut de seed (D16), pas de ce correctif : il ne cherche pas a le rattraper.
 *
 * ## Idempotence
 *
 * L'ecriture est filtree sur `lastPaymentAppliedAt: null`. Rejouee, elle
 * n'affecte aucune ligne ; concurrente, une seule des executions ecrit, et
 * toutes observent la meme borne. Aucun `LiabilityEvent` n'est cree.
 */

import { prisma } from "../prisma";
import { owned } from "../db/tenant-scope";
import { effectivePaymentBaseline } from "./amortization";
import { LIABILITY_EVENT_TYPES } from "./event-types";

/** Les seuls champs dont depend le choix de la borne. */
export type BaselineLiability = {
  id: string;
  lastPaymentAppliedAt: Date | null;
  updatedAt: Date;
};

/**
 * Borne a poser sur une dette qui n'en a pas.
 *
 * Pure : elle n'ecrit rien et ne lit pas la base. `lastMonthlyDebitAt` est la
 * date du dernier prelevement mensuel deja inscrit, ou `null`.
 *
 * PAS-03 — la regle vit desormais dans `effectivePaymentBaseline`
 * (`amortization.ts`, module pur), parce que les lecteurs en ont besoin aussi
 * et qu'ils ne peuvent pas importer ce fichier-ci, qui parle a Prisma. Cette
 * fonction reste le nom du chemin d'ecriture : c'est lui, et lui seul, qui
 * affine la borne avec le dernier `MONTHLY_DEBIT`.
 */
export function paymentBaselineFor(
  liability: BaselineLiability,
  lastMonthlyDebitAt: Date | null
): Date {
  return effectivePaymentBaseline(liability, lastMonthlyDebitAt);
}

/**
 * Pose la borne manquante d'une dette, sans materialiser aucune echeance.
 *
 * Appelee sur le chemin d'ecriture (`applyDuePaymentsForLiability`) avant toute
 * projection : c'est la que le rattrapage massif se serait produit, donc c'est
 * la qu'il faut le couper. Les lecteurs, eux, n'appellent pas cette fonction —
 * ils n'ecrivent rien, comme le veut la doctrine du module — mais ils
 * appliquent la meme regle de borne, via `effectivePaymentBaseline`
 * (PAS-03) : sceller n'est pas la condition pour afficher juste.
 *
 * Rend la dette rafraichie, ou `null` si elle a disparu entre-temps. Une ligne
 * qui porte deja une borne est rendue telle quelle : la fonction est un
 * non-evenement pour tout ce qui a ete cree depuis PAS-01.
 */
export async function sealPaymentBaseline<T extends BaselineLiability>(
  userId: string,
  liability: T
): Promise<T | null> {
  if (liability.lastPaymentAppliedAt != null) return liability;

  const lastDebit = await prisma.liabilityEvent.findFirst({
    where: { liabilityId: liability.id, type: LIABILITY_EVENT_TYPES.MONTHLY_DEBIT },
    orderBy: { eventDate: "desc" },
    select: { eventDate: true },
  });

  const baseline = paymentBaselineFor(liability, lastDebit?.eventDate ?? null);

  /*
    Le filtre porte la condition, pas une lecture prealable : `null` est exige
    dans le `where`, donc deux executions concurrentes ne peuvent pas se
    contredire — la seconde n'affecte aucune ligne et se contente de relire la
    borne posee par la premiere.
  */
  await prisma.liability.updateMany({
    where: { ...owned(liability.id, userId), lastPaymentAppliedAt: null },
    data: { lastPaymentAppliedAt: baseline },
  });

  return (await prisma.liability.findFirst({
    where: owned(liability.id, userId),
  })) as T | null;
}

/**
 * Balayage a l'echelle d'un compte.
 *
 * Point d'entree explicite pour poser la borne sur toutes les dettes d'un
 * utilisateur d'un coup, sans attendre qu'une mutation passe sur chacune.
 * Idempotent : relance sans effet. Rend le nombre de lignes bornees.
 */
export async function backfillPaymentBaselines(userId: string): Promise<number> {
  const rows = await prisma.liability.findMany({
    where: { userId, lastPaymentAppliedAt: null },
    select: { id: true, lastPaymentAppliedAt: true, updatedAt: true },
  });
  let sealed = 0;
  for (const row of rows) {
    if (await sealPaymentBaseline(userId, row)) sealed += 1;
  }
  return sealed;
}
