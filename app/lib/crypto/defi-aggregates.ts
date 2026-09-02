/**
 * Agrégats du portefeuille DeFi — fonctions pures, sans accès Prisma.
 *
 * Même partage que `defi.ts` / `defi-service.ts` : les règles de ce qui compte
 * vivent ici et sont testables sans base, la couche service ne fait que charger
 * les données et appeler ces fonctions.
 *
 * La règle centrale est celle de l'exclusion, et elle n'est pas symétrique :
 * - `isIgnoredInPortfolio` retire la position des totaux (décision explicite) ;
 * - `isHidden` ne retire **rien** (c'est cosmétique, la position pèse toujours) ;
 * - un statut `CLOSED`/`LIQUIDATED` retire la position (plus d'exposition) ;
 * - un doublon retiré évite de compter deux fois la même valeur.
 *
 * Confondre les deux premières ferait disparaître de l'argent d'un clic destiné
 * à ranger l'écran.
 */

import type Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import { isInactiveStatus } from "./defi-taxonomy";

const ZERO = d(0);

/** Ce dont un agrégat a besoin d'une position — rien de plus. */
export type AggregablePosition = {
  id: string;
  isHidden: boolean;
  isIgnoredInPortfolio: boolean;
  status: string;
  /** `true` quand la position est un doublon écarté (cf. `defi-dedup.ts`). */
  isDuplicate: boolean;
};

/** Décomposition monétaire attachée à une position. */
export type AggregableValues = {
  grossEur: Decimal;
  netEur: Decimal;
  debtEur: Decimal;
  collateralEur: Decimal;
  rewardsEur: Decimal;
  retainedEur: Decimal;
};

export type AggregableEntry<P extends AggregablePosition = AggregablePosition> = {
  position: P;
  values: AggregableValues;
};

/**
 * `true` quand la position doit peser dans les totaux patrimoniaux.
 *
 * Une seule définition, utilisée par les totaux **et** par chaque agrégat : deux
 * définitions divergentes produiraient un total qui ne serait pas la somme de
 * ses parts.
 */
export function countsInTotals(p: AggregablePosition): boolean {
  if (p.isIgnoredInPortfolio) return false;
  if (p.isDuplicate) return false;
  if (isInactiveStatus(p.status)) return false;
  return true;
}

export type DefiTotals = {
  grossEur: Decimal;
  netEur: Decimal;
  debtEur: Decimal;
  collateralEur: Decimal;
  rewardsEur: Decimal;
  /** Le seul chiffre qui entre au patrimoine net. */
  retainedEur: Decimal;
  positionCount: number;
  countedPositionCount: number;
};

export function computeTotals(entries: AggregableEntry[]): DefiTotals {
  const counted = entries.filter((e) => countsInTotals(e.position));

  let gross = ZERO;
  let net = ZERO;
  let debt = ZERO;
  let collateral = ZERO;
  let rewards = ZERO;
  let retained = ZERO;

  for (const { values } of counted) {
    gross = gross.plus(values.grossEur);
    net = net.plus(values.netEur);
    debt = debt.plus(values.debtEur);
    collateral = collateral.plus(values.collateralEur);
    rewards = rewards.plus(values.rewardsEur);
    retained = retained.plus(values.retainedEur);
  }

  return {
    grossEur: gross,
    netEur: net,
    debtEur: debt,
    collateralEur: collateral,
    rewardsEur: rewards,
    retainedEur: retained,
    positionCount: entries.length,
    countedPositionCount: counted.length,
  };
}

export type DefiExclusions = {
  /** Valeur écartée sur décision de l'utilisateur. */
  ignoredRetainedEur: Decimal;
  ignoredCount: number;
  /** Masquées de l'affichage mais **comptées** dans les totaux. */
  hiddenCount: number;
  inactiveCount: number;
  /** Valeur qui aurait été comptée deux fois. */
  duplicateRetainedEur: Decimal;
  duplicateCount: number;
};

/**
 * Ce qui a été écarté, et pourquoi.
 *
 * Exposé séparément des totaux et jamais additionné : afficher « 12 000 €
 * ignorés » à côté du total est une information de contrôle, l'ajouter au total
 * annulerait la décision de l'utilisateur.
 */
export function computeExclusions(entries: AggregableEntry[]): DefiExclusions {
  let ignored = ZERO;
  let duplicate = ZERO;
  let ignoredCount = 0;
  let hiddenCount = 0;
  let inactiveCount = 0;
  let duplicateCount = 0;

  for (const { position, values } of entries) {
    if (position.isIgnoredInPortfolio) {
      ignored = ignored.plus(values.retainedEur);
      ignoredCount += 1;
    }
    if (position.isHidden) hiddenCount += 1;
    if (isInactiveStatus(position.status)) inactiveCount += 1;
    if (position.isDuplicate) {
      duplicate = duplicate.plus(values.retainedEur);
      duplicateCount += 1;
    }
  }

  return {
    ignoredRetainedEur: ignored,
    ignoredCount,
    hiddenCount,
    inactiveCount,
    duplicateRetainedEur: duplicate,
    duplicateCount,
  };
}

export type DefiAggregateBucket = {
  key: string;
  label: string;
  positionCount: number;
  grossEur: Decimal;
  netEur: Decimal;
  debtEur: Decimal;
  collateralEur: Decimal;
  rewardsEur: Decimal;
  retainedEur: Decimal;
};

/**
 * Regroupe les positions **comptées** selon une clé quelconque.
 *
 * Le filtrage par `countsInTotals` est appliqué ici et non laissé à l'appelant :
 * un agrégat par chaîne qui inclurait les positions ignorées ne sommerait pas au
 * total affiché, et l'écart serait attribué à un bug de calcul plutôt qu'à une
 * exclusion volontaire.
 *
 * Tri par valeur retenue décroissante : le plus gros engagement d'abord, c'est
 * ce qu'on veut voir en ouvrant (même choix que `groupByProtocol`).
 */
export function aggregateBy<P extends AggregablePosition>(
  entries: Array<AggregableEntry<P>>,
  keyOf: (p: P) => string,
  labelOf: (p: P) => string
): DefiAggregateBucket[] {
  const map = new Map<string, DefiAggregateBucket>();

  for (const { position, values } of entries) {
    if (!countsInTotals(position)) continue;

    const key = keyOf(position);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: labelOf(position),
        positionCount: 0,
        grossEur: ZERO,
        netEur: ZERO,
        debtEur: ZERO,
        collateralEur: ZERO,
        rewardsEur: ZERO,
        retainedEur: ZERO,
      };
      map.set(key, bucket);
    }

    bucket.positionCount += 1;
    bucket.grossEur = bucket.grossEur.plus(values.grossEur);
    bucket.netEur = bucket.netEur.plus(values.netEur);
    bucket.debtEur = bucket.debtEur.plus(values.debtEur);
    bucket.collateralEur = bucket.collateralEur.plus(values.collateralEur);
    bucket.rewardsEur = bucket.rewardsEur.plus(values.rewardsEur);
    bucket.retainedEur = bucket.retainedEur.plus(values.retainedEur);
  }

  return [...map.values()].sort((a, b) =>
    b.retainedEur.comparedTo(a.retainedEur)
  );
}
