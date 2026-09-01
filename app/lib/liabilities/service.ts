/**
 * Crédits : qui projette, qui matérialise.
 *
 * ## La règle
 *
 * **Lire projette. Écrire matérialise.** Un lecteur calcule le capital restant
 * dû à la date demandée et n'écrit rien ; seule une mutation peut créer les
 * `LiabilityEvent` correspondants.
 *
 * ## Pourquoi elle existe
 *
 * `listLiabilities` amortissait en base avant de répondre. Ouvrir le module
 * Crédits écrivait 79 `LiabilityEvent` sur le compte de démonstration, et le
 * patrimoine net changeait de 64 020 € selon qu'on avait consulté cet écran ou
 * non. Le même montant n'était pas faux à un endroit et juste à l'autre : il
 * dépendait de l'instant où quelqu'un avait regardé. Un affichage qui modifie
 * ce qu'il affiche n'est pas un affichage.
 *
 * ## Ce que « matérialiser » veut dire
 *
 * Écrire les échéances passées comme événements, et avancer
 * `lastPaymentAppliedAt`. C'est utile quand une opération doit **raisonner sur
 * le solde** : `recordEarlyRepayment` impute un remboursement sur un capital
 * restant dû, qui doit donc exister en base avant d'être touché.
 *
 * Les deux autres mutations ne matérialisent pas, et c'est volontaire :
 * `changeMonthlyPayment` et `changeInterestRate` se contentent d'enregistrer un
 * événement daté, que la projection sait déjà consommer. Matérialiser « par
 * précaution » y ajouterait des écritures sans rien rendre plus juste.
 *
 * ## Les lecteurs
 *
 * Six chemins lisent une dette, tous par les fonctions pures de
 * `./amortization` : le module Crédits (`listLiabilities`), le patrimoine
 * (`portfolio/service`), l'historique (`portfolio/historical/load`), l'IFI
 * (`real-estate/tax/service`), la fiche bien (`api/real-estate/properties`) et
 * la suppression de plateforme (`api/platforms`). Aucun n'écrit.
 *
 * `tests/unit/liabilities-lecture-pure.test.ts` relit ces fichiers et refuse
 * qu'un lecteur rappelle une fonction de matérialisation ; le parcours complet
 * est vérifié de bout en bout par `e2e/passifs-lecture-pure.spec.ts`.
 */

import { Prisma } from "@/app/lib/prisma-client/client";
import { prisma } from "../prisma";
import { owned } from "../db/tenant-scope";
import { d, toFixed } from "../money/decimal";
import { toEurAmount } from "../market/fx";
import {
  applyEarlyRepayment,
  estimateRemainingInterest,
  estimateRemainingMonths,
  projectDuePayments,
  projectEndDate,
  remainingAmountAt,
  startOfUtcDay,
} from "./amortization";

export const LIABILITY_EVENT_TYPES = {
  MONTHLY_DEBIT: "MONTHLY_DEBIT",
  EARLY_REPAYMENT_PARTIAL: "EARLY_REPAYMENT_PARTIAL",
  EARLY_REPAYMENT_TOTAL: "EARLY_REPAYMENT_TOTAL",
  PAYMENT_CHANGE: "PAYMENT_CHANGE",
  RATE_CHANGE: "RATE_CHANGE",
} as const;

export type LiabilityEventType =
  (typeof LIABILITY_EVENT_TYPES)[keyof typeof LIABILITY_EVENT_TYPES];

/**
 * La dette a changé entre sa lecture et l'écriture de sa matérialisation.
 *
 * Levée plutôt que rendue : les événements de l'échéance sont créés avant
 * l'écriture du solde, dans la même transaction. Sortir par un `return`
 * validerait ces événements alors que le solde n'a pas bougé — l'exception
 * annule l'ensemble.
 */
class LiabilityStateChanged extends Error {}

/**
 * Apply all due monthly debits for one liability (idempotent via lastPaymentAppliedAt).
 * Requires userId — never loads/writes a liability by bare id alone.
 * Returns updated remaining if any debit ran.
 */
export async function applyDuePaymentsForLiability(
  userId: string,
  liabilityId: string,
  now: Date = new Date()
) {
  const liability = await prisma.liability.findFirst({
    where: owned(liabilityId, userId),
  });
  if (!liability) return null;
  if (!liability.paymentDay || !liability.monthlyPayment) return liability;

  const payment = liability.monthlyPayment.toString();

  /*
    La règle d'amortissement n'est pas écrite ici : elle vit dans
    `projectDuePayments`, que les lecteurs appellent aussi. Matérialiser, c'est
    donc écrire ce que la projection annonce — jamais la recalculer autrement,
    sans quoi le solde affiché et le solde stocké pourraient diverger, ce qui
    était précisément le défaut corrigé.
  */
  const projection = projectDuePayments({
    remainingAmount: liability.remainingAmount.toString(),
    monthlyPayment: payment,
    paymentDay: liability.paymentDay,
    startDate: liability.startDate,
    endDate: liability.endDate,
    lastPaymentAppliedAt: liability.lastPaymentAppliedAt,
    now,
  });

  const remaining = projection.remaining;
  const lastApplied = projection.lastAppliedAt;
  const events = projection.payments.map((p) => ({
    type: LIABILITY_EVENT_TYPES.MONTHLY_DEBIT,
    amount: p.debited,
    remainingAfter: p.remainingAfter,
    eventDate: p.eventDate,
    notes: `Prélèvement mensuel (jour ${liability.paymentDay})`,
  }));

  if (events.length === 0) return liability;

  const materialiser = () =>
    prisma.$transaction(async (tx) => {
    for (const e of events) {
      await tx.liabilityEvent.create({
        data: {
          liabilityId,
          type: e.type,
          amount: new Prisma.Decimal(e.amount),
          remainingAfter: new Prisma.Decimal(e.remainingAfter),
          eventDate: e.eventDate,
          notes: e.notes,
        },
      });
    }

    // Re-project end date if monthly payment still active
    let endDate = liability.endDate;
    if (d(remaining).gt(0) && d(payment).gt(0)) {
      const projected = projectEndDate(
        remaining,
        payment,
        liability.interestRate?.toString() || "0",
        now
      );
      if (projected) endDate = projected;
    } else if (d(remaining).lte(0)) {
      endDate = lastApplied || now;
    }

    /*
      Écriture conditionnée à l'état qui a servi à la projection.

      La dette est lue hors transaction, les échéances sont projetées à partir
      de `remainingAmount` et `lastPaymentAppliedAt`, puis écrites ici. Le
      filtre ne portait que sur l'identité : tout ce qui survenait entre la
      lecture et l'écriture était écrasé par un solde calculé sur une valeur
      périmée — une saisie de capital restant dû, notamment, que la route
      d'édition permet.

      Deux matérialisations concurrentes posaient par ailleurs le même
      problème que pour les livrets : parties du même `lastPaymentAppliedAt`,
      toutes deux créaient les mêmes `LiabilityEvent`, et la trace comptable
      comptait l'échéance deux fois.

      Exiger les deux champs lus transforme l'écriture en compare-and-set. Le
      SGBD évalue le filtre et applique la donnée en une seule instruction :
      si la dette a bougé, aucune ligne ne correspond, et la transaction est
      abandonnée — événements compris, puisqu'ils sont écrits dans le même
      `tx`.
    */
    const write = await tx.liability.updateMany({
      where: {
        ...owned(liabilityId, userId),
        remainingAmount: liability.remainingAmount,
        lastPaymentAppliedAt: liability.lastPaymentAppliedAt,
      },
      data: {
        remainingAmount: new Prisma.Decimal(remaining),
        lastPaymentAppliedAt: lastApplied,
        endDate,
      },
    });
    if (write.count === 0) {
      // La course est perdue : rien ne doit subsister, pas même les
      // événements créés plus haut dans cette transaction.
      throw new LiabilityStateChanged();
    }

    return tx.liability.findFirst({ where: owned(liabilityId, userId) });
    });

  try {
    return await materialiser();
  } catch (e) {
    /*
      Course perdue : une autre exécution, ou une saisie utilisateur, a modifié
      la dette entre sa lecture et cette écriture. Rien n'a été écrit — on rend
      `null`, comme lorsque la dette est introuvable, plutôt que d'écraser.
    */
    if (e instanceof LiabilityStateChanged) return null;
    throw e;
  }
}

/**
 * Matérialise les échéances dues de toutes les dettes d'un utilisateur.
 *
 * Elle était appelée par `listLiabilities`, donc par un GET — d'où le défaut
 * corrigé. Elle n'a plus de déclencheur automatique : les lecteurs projettent,
 * et `recordEarlyRepayment` matérialise sa propre dette avant d'y toucher.
 *
 * Elle reste le point d'entrée pour une matérialisation à l'échelle d'un
 * compte, comme `/api/savings/accrue` le fait pour les intérêts des livrets.
 * Les crédits n'ont pas encore d'équivalent planifié : la trace comptable ne
 * s'écrit donc, aujourd'hui, qu'au moment d'un remboursement anticipé.
 */
export async function applyDuePaymentsForUser(userId: string, now: Date = new Date()) {
  const rows = await prisma.liability.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const r of rows) {
    await applyDuePaymentsForLiability(userId, r.id, now);
  }
}

/**
 * Liste des dettes, capital restant dû projeté à aujourd'hui.
 *
 * Cette fonction amortissait en base avant de répondre : un simple GET du
 * module Crédits écrivait 79 `LiabilityEvent` sur le compte de démonstration,
 * et le patrimoine net changeait de 64 020 € selon qu'on avait ouvert cet
 * écran ou non. Elle projette désormais, comme les trois autres lecteurs.
 */
export async function listLiabilities(userId: string, now: Date = new Date()) {
  const liabilities = await prisma.liability.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: {
      events: {
        orderBy: { eventDate: "desc" },
        take: 50,
      },
      asset: {
        select: {
          id: true,
          name: true,
          category: true,
          accountType: true,
          manualPrice: true,
        },
      },
    },
  });

  let totalEur = d(0);
  const enriched = [];
  for (const l of liabilities) {
    const remaining = remainingAmountAt(l, now);
    const eur = await toEurAmount(remaining, l.currency);
    totalEur = totalEur.plus(d(eur));
    const monthly = l.monthlyPayment?.toString() || "0";
    const rate = l.interestRate?.toString() || "0";
    const monthsLeft = estimateRemainingMonths(remaining, monthly, rate);
    const interestLeft = estimateRemainingInterest(remaining, monthly, rate);

    enriched.push({
      id: l.id,
      name: l.name,
      initialAmount: l.initialAmount.toString(),
      remainingAmount: remaining,
      currency: l.currency,
      interestRate: l.interestRate?.toString() ?? null,
      monthlyPayment: l.monthlyPayment?.toString() ?? null,
      insuranceMonthly: l.insuranceMonthly?.toString() ?? null,
      startDate: l.startDate?.toISOString() ?? null,
      endDate: l.endDate?.toISOString() ?? null,
      paymentDay: l.paymentDay,
      lastPaymentAppliedAt: l.lastPaymentAppliedAt?.toISOString() ?? null,
      bankName: l.bankName,
      category: l.category,
      // assetId brut (nom de colonne Prisma) + linkedAssetId/linkedAsset :
      // alias de vocabulaire côté API/UI, même relation — voir décision
      // étape 11 (pas de 2ᵉ FK, réutilisation de Liability.assetId).
      assetId: l.assetId,
      linkedAssetId: l.assetId,
      linkedAsset: l.asset
        ? {
            id: l.asset.id,
            name: l.asset.name,
            category: l.asset.category,
            accountType: l.asset.accountType,
            manualPrice: l.asset.manualPrice?.toString() ?? null,
          }
        : null,
      notes: l.notes,
      remainingEur: eur,
      monthsRemaining: monthsLeft,
      estimatedInterestRemaining: interestLeft,
      events: l.events.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount?.toString() ?? null,
        remainingAfter: e.remainingAfter?.toString() ?? null,
        eventDate: e.eventDate.toISOString(),
        notes: e.notes,
      })),
    });
  }

  return {
    liabilities: enriched,
    totalRemainingEur: toFixed(totalEur, 8),
  };
}

export async function recordEarlyRepayment(opts: {
  userId: string;
  liabilityId: string;
  kind: "PARTIAL" | "TOTAL";
  amount?: string;
  eventDate?: string;
  notes?: string;
}) {
  /*
    Matérialiser avant d'écrire, et non plus au moment de lire.

    Un remboursement anticipé s'impute sur le capital réellement dû : si des
    mensualités en retard n'ont pas encore été inscrites, les solder d'abord
    évite d'amputer un solde périmé. C'est le déclencheur légitime de
    `applyDuePaymentsForLiability` — une mutation, pas un affichage.
  */
  await applyDuePaymentsForLiability(opts.userId, opts.liabilityId);

  const liability = await prisma.liability.findFirst({
    where: owned(opts.liabilityId, opts.userId),
  });
  if (!liability) throw new Error("Passif introuvable");

  const total = opts.kind === "TOTAL";
  const amount = total
    ? liability.remainingAmount.toString()
    : String(opts.amount || "0").replace(",", ".");
  if (!total && d(amount).lte(0)) throw new Error("Montant de remboursement invalide");

  const { remaining, debited } = applyEarlyRepayment(
    liability.remainingAmount.toString(),
    amount,
    total
  );
  const eventDate = opts.eventDate
    ? startOfUtcDay(new Date(opts.eventDate))
    : startOfUtcDay(new Date());

  const type =
    total || d(remaining).lte(0)
      ? LIABILITY_EVENT_TYPES.EARLY_REPAYMENT_TOTAL
      : LIABILITY_EVENT_TYPES.EARLY_REPAYMENT_PARTIAL;

  let endDate = liability.endDate;
  if (d(remaining).lte(0)) {
    endDate = eventDate;
  } else if (liability.monthlyPayment) {
    const projected = projectEndDate(
      remaining,
      liability.monthlyPayment.toString(),
      liability.interestRate?.toString() || "0",
      eventDate
    );
    if (projected) endDate = projected;
  }

  return prisma.$transaction(async (tx) => {
    await tx.liabilityEvent.create({
      data: {
        liabilityId: liability.id,
        type,
        amount: new Prisma.Decimal(debited),
        remainingAfter: new Prisma.Decimal(remaining),
        eventDate,
        notes:
          opts.notes ||
          (type === LIABILITY_EVENT_TYPES.EARLY_REPAYMENT_TOTAL
            ? "Remboursement anticipé total"
            : "Remboursement anticipé partiel"),
      },
    });
    const write = await tx.liability.updateMany({
      where: owned(liability.id, opts.userId),
      data: {
        remainingAmount: new Prisma.Decimal(remaining),
        endDate,
      },
    });
    if (write.count === 0) throw new Error("Passif introuvable");
    return tx.liability.findFirstOrThrow({ where: owned(liability.id, opts.userId) });
  });
}

export async function changeMonthlyPayment(opts: {
  userId: string;
  liabilityId: string;
  monthlyPayment: string;
  eventDate?: string;
  notes?: string;
}) {
  const liability = await prisma.liability.findFirst({
    where: owned(opts.liabilityId, opts.userId),
  });
  if (!liability) throw new Error("Passif introuvable");

  const newPayment = String(opts.monthlyPayment || "0").replace(",", ".");
  if (d(newPayment).lte(0)) throw new Error("Nouvelle mensualité invalide");

  const eventDate = opts.eventDate
    ? startOfUtcDay(new Date(opts.eventDate))
    : startOfUtcDay(new Date());

  const remaining = liability.remainingAmount.toString();
  const projected = projectEndDate(
    remaining,
    newPayment,
    liability.interestRate?.toString() || "0",
    eventDate
  );

  return prisma.$transaction(async (tx) => {
    await tx.liabilityEvent.create({
      data: {
        liabilityId: liability.id,
        type: LIABILITY_EVENT_TYPES.PAYMENT_CHANGE,
        amount: new Prisma.Decimal(newPayment),
        remainingAfter: new Prisma.Decimal(remaining),
        eventDate,
        notes:
          opts.notes ||
          `Avenant mensualité → ${newPayment} ${liability.currency}` +
            (projected
              ? ` · fin estimée ${projected.toISOString().slice(0, 10)}`
              : ""),
      },
    });
    const write = await tx.liability.updateMany({
      where: owned(liability.id, opts.userId),
      data: {
        monthlyPayment: new Prisma.Decimal(newPayment),
        endDate: projected,
      },
    });
    if (write.count === 0) throw new Error("Passif introuvable");
    return tx.liability.findFirstOrThrow({ where: owned(liability.id, opts.userId) });
  });
}

/**
 * Edit interest rate on the fly — logs RATE_CHANGE and re-projects end date.
 */
export async function changeInterestRate(opts: {
  userId: string;
  liabilityId: string;
  interestRate: string;
  eventDate?: string;
  notes?: string;
}) {
  const liability = await prisma.liability.findFirst({
    where: owned(opts.liabilityId, opts.userId),
  });
  if (!liability) throw new Error("Passif introuvable");

  const newRate = String(opts.interestRate || "0").replace(",", ".");
  if (d(newRate).lt(0)) throw new Error("Taux d'intérêt invalide");

  const eventDate = opts.eventDate
    ? startOfUtcDay(new Date(opts.eventDate))
    : startOfUtcDay(new Date());

  const remaining = liability.remainingAmount.toString();
  const monthly = liability.monthlyPayment?.toString() || "0";
  const projected =
    d(monthly).gt(0) && d(remaining).gt(0)
      ? projectEndDate(remaining, monthly, newRate, eventDate)
      : liability.endDate;

  const prev = liability.interestRate?.toString() ?? "0";

  return prisma.$transaction(async (tx) => {
    await tx.liabilityEvent.create({
      data: {
        liabilityId: liability.id,
        type: LIABILITY_EVENT_TYPES.RATE_CHANGE,
        amount: new Prisma.Decimal(newRate),
        remainingAfter: new Prisma.Decimal(remaining),
        eventDate,
        notes:
          opts.notes ||
          `Avenant taux ${prev}% → ${newRate}%` +
            (projected instanceof Date
              ? ` · fin estimée ${projected.toISOString().slice(0, 10)}`
              : ""),
      },
    });
    const write = await tx.liability.updateMany({
      where: owned(liability.id, opts.userId),
      data: {
        interestRate: new Prisma.Decimal(newRate),
        endDate: projected,
      },
    });
    if (write.count === 0) throw new Error("Passif introuvable");
    return tx.liability.findFirstOrThrow({ where: owned(liability.id, opts.userId) });
  });
}
