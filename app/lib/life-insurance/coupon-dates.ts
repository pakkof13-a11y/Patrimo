/**
 * Dates de constatation d'un produit structuré.
 *
 * Module pur : ni Prisma, ni réseau, ni horloge implicite (`now` est injecté).
 *
 * ## Pourquoi pas `duePaymentDates`
 *
 * L'échéancier des loyers et des passifs repose sur un **jour du mois** et
 * avance de mois en mois. Un coupon suit l'anniversaire de la **constatation
 * initiale**, par pas de 1, 3, 6 ou 12 mois : un produit constaté le 20 mars et
 * versant trimestriellement constate les 20 juin, 20 septembre, 20 décembre.
 * Forcer le calcul mensuel aurait proposé douze échéances là où il en existe
 * quatre.
 *
 * La discipline, elle, est reprise telle quelle : bornes de début et de fin,
 * curseur de reprise, et rien avant la date du jour.
 */

import { startOfUtcDay } from "../liabilities/amortization";
import { couponsPerYear } from "./constants";

/** Garde-fou : au-delà, une saisie est erronée plutôt que longue. */
const MAX_OBSERVATIONS = 240;

/** Nombre de mois entre deux constatations — 0 si le produit n'en a pas. */
export function monthsBetweenObservations(frequency: string): number {
  const perYear = couponsPerYear(frequency);
  return perYear === 0 ? 0 : 12 / perYear;
}

/**
 * Même jour du mois, N mois plus tard, en UTC.
 *
 * Le jour est rogné sur la longueur du mois d'arrivée : une constatation du
 * 31 janvier tombe au 30 avril, pas au 1er mai. Laisser JavaScript déborder
 * décalerait la série entière d'un jour à chaque mois court.
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1, 12, 0, 0));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12, 0, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(d, lastDay),
      12,
      0,
      0
    )
  );
}

/**
 * Constatations échues et non encore réglées.
 *
 * Rend les dates strictement postérieures au curseur, atteintes à la date du
 * jour, et n'excédant pas l'échéance. La constatation initiale elle-même n'est
 * pas une échéance de coupon : c'est le point de départ de la série.
 *
 * Un produit versant uniquement à l'échéance (`MATURITY`) ne rend rien avant
 * son terme, puis cette seule date : proposer des coupons intermédiaires
 * annoncerait des revenus que le produit ne verse pas.
 */
export function couponObservationDates(opts: {
  strikeDate: Date | null;
  maturityDate: Date | null;
  couponFrequency: string;
  lastCouponAppliedAt: Date | null;
  now?: Date;
}): Date[] {
  const now = startOfUtcDay(opts.now ?? new Date());
  const maturity = opts.maturityDate ? startOfUtcDay(opts.maturityDate) : null;
  const cursor = opts.lastCouponAppliedAt
    ? startOfUtcDay(opts.lastCouponAppliedAt)
    : null;

  const step = monthsBetweenObservations(opts.couponFrequency);

  // Versement unique au terme : la seule échéance est l'échéance.
  if (step === 0) {
    if (!maturity) return [];
    if (maturity.getTime() > now.getTime()) return [];
    if (cursor && maturity.getTime() <= cursor.getTime()) return [];
    return [maturity];
  }

  // Sans constatation initiale, la série n'a pas d'origine : on préfère ne rien
  // proposer plutôt que d'inventer un point de départ.
  if (!opts.strikeDate) return [];
  const strike = startOfUtcDay(opts.strikeDate);

  const dates: Date[] = [];
  for (let i = 1; i <= MAX_OBSERVATIONS; i++) {
    const at = addMonthsUtc(strike, step * i);
    if (at.getTime() > now.getTime()) break;
    if (maturity && at.getTime() > maturity.getTime()) break;
    if (cursor && at.getTime() <= cursor.getTime()) continue;
    dates.push(at);
  }
  return dates;
}
