/**
 * Échéancier de coupons des produits structurés.
 *
 * Reprend la discipline de l'échéancier des loyers : une échéance est une
 * **proposition**, jamais une écriture d'office ; le curseur n'avance qu'à la
 * confirmation ; le marqueur porté par les notes sert de clé d'unicité.
 *
 * ## Un coupon n'est pas un loyer
 *
 * Un loyer impayé reste dû : le reproposer au passage suivant est correct. Un
 * coupon dont la barrière n'est pas franchie est en revanche **définitivement
 * perdu** — sauf effet mémoire, où il se rattrape à une constatation ultérieure.
 * Le reproposer indéfiniment ferait croire à un revenu en attente qui n'existe
 * pas.
 *
 * D'où deux réponses possibles, et non une seule : « versé » écrit un `COUPON`
 * au journal ; « non versé » avance le curseur sans rien écrire. Dans les deux
 * cas l'échéance cesse d'être proposée, parce que dans les deux cas elle est
 * tranchée.
 *
 * ## Le montant est conditionnel
 *
 * L'application ne connaît pas le niveau du sous-jacent aux dates de
 * constatation : elle ne peut donc pas savoir si le coupon est tombé. Le montant
 * proposé est celui qui **serait** versé, à l'utilisateur de confirmer ce qu'il
 * a réellement reçu. Décider à sa place inventerait des revenus.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { dateKey } from "../liabilities/amortization";
import { createTransaction } from "../transactions/service";
import { couponObservationDates } from "./coupon-dates";
import { periodicCouponEur } from "./constants";

/** Marqueur porté par les notes — reconnaît une échéance déjà tranchée. */
export const COUPON_NOTE_PREFIX = "[coupon:";

/**
 * Marqueur d'échéance, unique par support et par date.
 *
 * L'identifiant du support en fait partie : deux structurés dont les
 * constatations tombent le même jour se confondraient sans lui, et reconfirmer
 * l'un règlerait l'autre.
 */
export function couponNote(assetId: string, due: Date): string {
  return `${COUPON_NOTE_PREFIX}${dateKey(due)}:${assetId}]`;
}

export type PendingCoupon = {
  assetId: string;
  supportName: string;
  /** Contrat de rattachement, pour regrouper à l'affichage. */
  lifeInsuranceId: string | null;
  observedOn: string;
  /** Montant qui serait versé si la barrière est franchie. */
  amountEur: string;
  /** Barrière de coupon en % du niveau initial — null si sans condition. */
  couponBarrierPct: string | null;
  couponMemory: boolean;
  underlying: string | null;
  /** Note qui sera portée par la transaction — sert de clé d'unicité. */
  note: string;
};

/**
 * Constatations échues et non encore tranchées, tous supports confondus.
 *
 * Rien n'est enregistré ici : la fonction ne fait que proposer.
 */
export async function listPendingCoupons(
  userId: string,
  opts?: { now?: Date }
): Promise<PendingCoupon[]> {
  const now = opts?.now ?? new Date();

  const rows = await prisma.lifeInsuranceSupport.findMany({
    where: {
      kind: "STRUCTURED",
      asset: { is: { userId } },
    },
    include: { asset: { select: { name: true } } },
  });

  const pending: PendingCoupon[] = [];

  for (const row of rows) {
    const rate = row.couponRatePct ? Number(row.couponRatePct.toString()) : null;
    // Sans taux, il n'y a rien à proposer — un structuré peut être purement
    // participatif, sans coupon.
    if (rate == null || rate <= 0) continue;

    const nominal = row.nominalEur ? Number(row.nominalEur.toString()) : null;
    const amount = periodicCouponEur({
      nominalEur: nominal,
      couponRatePct: rate,
      couponFrequency: row.couponFrequency,
    });
    // `MATURITY` ne rend pas de coupon périodique : on prend alors le coupon
    // annuel, versé une fois au terme.
    const dueAmount =
      amount ??
      (nominal != null && nominal > 0 ? (nominal * rate) / 100 : null);
    if (dueAmount == null || dueAmount <= 0) continue;

    const dates = couponObservationDates({
      strikeDate: row.strikeDate,
      maturityDate: row.maturityDate,
      couponFrequency: row.couponFrequency,
      lastCouponAppliedAt: row.lastCouponAppliedAt,
      now,
    });

    for (const due of dates) {
      pending.push({
        assetId: row.assetId,
        supportName: row.asset.name,
        lifeInsuranceId: row.lifeInsuranceId,
        observedOn: due.toISOString(),
        amountEur: dueAmount.toFixed(2),
        couponBarrierPct: row.couponBarrierPct?.toString() ?? null,
        couponMemory: row.couponMemory,
        underlying: row.underlying,
        note: couponNote(row.assetId, due),
      });
    }
  }

  pending.sort((a, b) => a.observedOn.localeCompare(b.observedOn));
  return pending;
}

/** « Versé » écrit au journal ; « non versé » ne fait qu'avancer le curseur. */
export type CouponDecision = {
  assetId: string;
  observedOn: string;
  paid: boolean;
  /** Montant réellement reçu, s'il diffère du montant théorique. */
  amountEur?: string | null;
};

export type SettleResult = {
  /** Coupons écrits au journal. */
  created: number;
  /** Échéances marquées non versées — curseur avancé, rien au journal. */
  skipped: number;
  /** Déjà tranchées lors d'un passage précédent. */
  alreadySettled: number;
  errors: string[];
};

/**
 * Tranche les échéances confirmées par l'utilisateur.
 *
 * Le curseur n'avance que sur ce qui a été effectivement traité, et jamais
 * au-delà : régler la constatation de juin ne doit pas emporter celle de
 * septembre, encore indécise.
 */
export async function settleCoupons(
  userId: string,
  decisions: CouponDecision[]
): Promise<SettleResult> {
  const result: SettleResult = {
    created: 0,
    skipped: 0,
    alreadySettled: 0,
    errors: [],
  };

  for (const decision of decisions) {
    const support = await prisma.lifeInsuranceSupport.findFirst({
      where: { assetId: decision.assetId, asset: { is: { userId } } },
      include: {
        asset: { select: { name: true, platformId: true, currency: true } },
      },
    });
    if (!support) {
      result.errors.push(`Support introuvable (${decision.assetId})`);
      continue;
    }

    const due = new Date(decision.observedOn);
    if (Number.isNaN(due.getTime())) {
      result.errors.push(`Date de constatation invalide (${decision.observedOn})`);
      continue;
    }

    const note = couponNote(decision.assetId, due);

    // Contrôle de doublon sur la seule note : un coupon marqué « non versé »
    // n'a pas de transaction, c'est le curseur qui l'atteste — d'où la double
    // vérification ci-dessous.
    const already = await prisma.transaction.findFirst({
      where: { userId, notes: { contains: note } },
      select: { id: true },
    });
    const cursorPassed =
      support.lastCouponAppliedAt != null &&
      support.lastCouponAppliedAt.getTime() >= due.getTime();
    if (already || cursorPassed) {
      result.alreadySettled++;
      continue;
    }

    if (!decision.paid) {
      // Non versé : le curseur avance, aucune écriture. L'échéance cesse d'être
      // proposée parce qu'elle est tranchée, pas parce qu'elle est encaissée.
      await advanceCursor(decision.assetId, userId, due);
      result.skipped++;
      continue;
    }

    const rate = support.couponRatePct
      ? Number(support.couponRatePct.toString())
      : null;
    const nominal = support.nominalEur
      ? Number(support.nominalEur.toString())
      : null;
    const theoretical =
      periodicCouponEur({
        nominalEur: nominal,
        couponRatePct: rate,
        couponFrequency: support.couponFrequency,
      }) ?? (nominal != null && rate != null ? (nominal * rate) / 100 : null);

    // Le montant saisi prime : un coupon à mémoire peut rattraper les échéances
    // manquées et dépasser le montant théorique d'une période.
    const raw = decision.amountEur?.trim();
    const amount = raw ? d(raw.replace(",", ".")) : d(theoretical ?? 0);
    if (!amount.isFinite() || amount.lte(0)) {
      result.errors.push(
        `Montant de coupon invalide pour ${support.asset.name}`
      );
      continue;
    }

    try {
      await createTransaction({
        userId,
        type: "COUPON",
        platformId: support.asset.platformId,
        assetId: decision.assetId,
        cashAmount: amount.toFixed(2),
        fees: "0",
        currency: support.asset.currency || "EUR",
        fxRateToEur: "1",
        occurredAt: due.toISOString(),
        allowNegativeCash: true,
        notes: `${note} ${support.asset.name}`,
      } as Parameters<typeof createTransaction>[0]);

      await advanceCursor(decision.assetId, userId, due);
      result.created++;
    } catch (e) {
      result.errors.push(
        `${support.asset.name} : ${e instanceof Error ? e.message : "échec"}`
      );
    }
  }

  return result;
}

/**
 * Avance le curseur, sans jamais le faire reculer.
 *
 * Trancher une échéance ancienne après une plus récente ne doit pas rouvrir
 * celles déjà réglées entre les deux.
 */
async function advanceCursor(
  assetId: string,
  userId: string,
  due: Date
): Promise<void> {
  const current = await prisma.lifeInsuranceSupport.findFirst({
    where: { assetId, asset: { is: { userId } } },
    select: { id: true, lastCouponAppliedAt: true },
  });
  if (!current) return;
  if (
    current.lastCouponAppliedAt &&
    current.lastCouponAppliedAt.getTime() >= due.getTime()
  ) {
    return;
  }
  await prisma.lifeInsuranceSupport.update({
    where: { id: current.id },
    data: { lastCouponAppliedAt: due },
  });
}
