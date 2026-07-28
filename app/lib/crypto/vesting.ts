/**
 * Verrouillage / vesting d'une position DeFi — fonctions pures, sans accès
 * Prisma.
 *
 * Trois champs, tous optionnels et cumulables (`unlockAt`, `cliffAt`,
 * `vestingSchedule` sur `DefiPositionDetail`) :
 *
 *  - Aucun des trois : position librement disponible (comportement actuel
 *    inchangé) — c'est le cas de la quasi-totalité des positions existantes.
 *  - `unlockAt` seul : verrou binaire à une date (staking bloqué, CDP…) —
 *    rien avant, tout après.
 *  - `vestingSchedule` : déblocage par tranches, chacune pouvant avoir son
 *    propre `cliffAt` — vesting linéaire entre le cliff et l'échéance de la
 *    tranche (avant le cliff : 0 % de cette tranche, quelle que soit
 *    l'échéance). Une tranche sans `cliffAt` se débloque d'un coup à son
 *    échéance, comme `unlockAt`.
 */

import Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";

export type VestingTranche = {
  /** Début du déblocage linéaire de cette tranche. Absent = tout-ou-rien à `endAt`. */
  cliffAt?: string | Date | null;
  /** Échéance — 100 % de la tranche est débloqué à cette date. */
  endAt: string | Date;
  /** Quantité débloquée par cette tranche (unité du jeton, pas des euros). */
  amount: Decimal | string;
};

export type LockSummary = {
  isLocked: boolean;
  /** `null` si aucune contrainte n'est posée (position librement disponible). */
  vestedPct: Decimal | null;
  /** Prochaine date à laquelle une quantité additionnelle se débloque. */
  nextUnlockAt: Date | null;
  /** Renseignés uniquement quand `vestingSchedule` est fourni. */
  totalAmount: Decimal | null;
  vestedAmount: Decimal | null;
};

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const dt = v instanceof Date ? v : new Date(v);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Fraction déblocée (0–1) d'une tranche à l'instant `now`.
 *
 * Sans `cliffAt`, la tranche est tout-ou-rien : c'est le cas le plus courant
 * (un simple lock, pas un vesting linéaire). Avec `cliffAt`, la fraction
 * croît linéairement entre le cliff et l'échéance — avant le cliff, 0 % même
 * si l'échéance est proche, parce qu'un cliff existe précisément pour
 * interdire tout déblocage anticipé.
 */
function trancheVestedFraction(tranche: VestingTranche, now: Date): Decimal {
  const endAt = toDate(tranche.endAt);
  if (!endAt) return d(0);
  if (now >= endAt) return d(1);

  const cliffAt = toDate(tranche.cliffAt);
  if (!cliffAt) return d(0);
  if (now < cliffAt) return d(0);

  const span = endAt.getTime() - cliffAt.getTime();
  if (span <= 0) return d(1);
  const elapsed = now.getTime() - cliffAt.getTime();
  return d(elapsed).div(span);
}

/**
 * Progression d'un vesting multi-tranches.
 *
 * Renvoie `null` si `schedule` est vide — appelant doit alors se rabattre sur
 * `unlockAt`/`cliffAt` simples via `computeLockSummary`.
 */
export function computeVestingProgress(
  schedule: VestingTranche[],
  now: Date
): {
  totalAmount: Decimal;
  vestedAmount: Decimal;
  vestedPct: Decimal;
  nextUnlockAt: Date | null;
} | null {
  if (schedule.length === 0) return null;

  let totalAmount = d(0);
  let vestedAmount = d(0);
  let nextUnlockAt: Date | null = null;

  for (const tranche of schedule) {
    const amount = typeof tranche.amount === "string" ? d(tranche.amount) : tranche.amount;
    if (!amount.isFinite() || amount.lte(0)) continue;

    totalAmount = totalAmount.plus(amount);
    const fraction = trancheVestedFraction(tranche, now);
    vestedAmount = vestedAmount.plus(amount.times(fraction));

    if (fraction.lt(1)) {
      const endAt = toDate(tranche.endAt);
      if (endAt && (!nextUnlockAt || endAt < nextUnlockAt)) nextUnlockAt = endAt;
    }
  }

  return {
    totalAmount,
    vestedAmount,
    vestedPct: totalAmount.gt(0) ? vestedAmount.div(totalAmount).times(100) : d(0),
    nextUnlockAt,
  };
}

/**
 * Synthèse du verrouillage d'une position, tous champs combinés.
 *
 * `vestingSchedule` prime dès qu'il est renseigné (il porte l'information la
 * plus précise) ; sinon on retombe sur le verrou binaire `unlockAt`/`cliffAt`.
 */
export function computeLockSummary(
  input: {
    unlockAt?: string | Date | null;
    cliffAt?: string | Date | null;
    vestingSchedule?: VestingTranche[] | null;
  },
  now: Date = new Date()
): LockSummary {
  const schedule = input.vestingSchedule ?? [];
  if (schedule.length > 0) {
    const progress = computeVestingProgress(schedule, now)!;
    return {
      isLocked: progress.vestedPct.lt(100),
      vestedPct: progress.vestedPct,
      nextUnlockAt: progress.nextUnlockAt,
      totalAmount: progress.totalAmount,
      vestedAmount: progress.vestedAmount,
    };
  }

  const unlockAt = toDate(input.unlockAt);
  const cliffAt = toDate(input.cliffAt);
  if (!unlockAt && !cliffAt) {
    return {
      isLocked: false,
      vestedPct: null,
      nextUnlockAt: null,
      totalAmount: null,
      vestedAmount: null,
    };
  }

  // Sans tranches, il n'y a pas de phase linéaire : la position reste
  // verrouillée tant que la plus tardive des deux dates n'est pas atteinte
  // (au cas — normalement incohérent — où `cliffAt` dépasserait `unlockAt`).
  const candidates = [unlockAt, cliffAt].filter((dt): dt is Date => dt != null);
  const effectiveUnlock = candidates.reduce((latest, dt) => (dt > latest ? dt : latest));
  const isLocked = now < effectiveUnlock;

  return {
    isLocked,
    vestedPct: isLocked ? d(0) : d(100),
    nextUnlockAt: isLocked ? effectiveUnlock : null,
    totalAmount: null,
    vestedAmount: null,
  };
}
