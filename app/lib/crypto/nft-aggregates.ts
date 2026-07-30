/**
 * Agrégats du portefeuille NFT — fonctions pures, sans accès Prisma.
 *
 * Même partage que `defi-aggregates.ts` : les règles de ce qui compte vivent
 * ici, testables sans base ; la couche service ne fait que charger les
 * données et appeler ces fonctions.
 *
 * Asymétrie déjà établie côté DeFi, reprise telle quelle :
 * - `isIgnoredInPortfolio` retire la détention des totaux (décision explicite) ;
 * - `isHidden` ne retire rien (cosmétique) ;
 * - un statut inactif (`BURNED`/`TRANSFERRED_OUT`/`SOLD`) retire la détention ;
 * - un statut non-possédé (`BORROWED_IN`) retire la détention — le NFT n'est
 *   pas la propriété de l'utilisateur, il doit être restitué ;
 * - un doublon écarté (`nft-dedup.ts`) évite de compter deux fois la même valeur.
 */

import type Decimal from "decimal.js";
import { d } from "@/app/lib/money/decimal";
import { isInactiveHoldingStatus, isNonOwnedStatus } from "./nft-taxonomy";

const ZERO = d(0);

export type AggregableHolding = {
  id: string;
  isHidden: boolean;
  isIgnoredInPortfolio: boolean;
  status: string;
  spamStatus: string;
  /** `true` quand la détention est un doublon écarté (cf. `nft-dedup.ts`). */
  isDuplicate: boolean;
};

export type AggregableNftValues = {
  retainedEur: Decimal;
  acquisitionCostEur: Decimal;
};

export type AggregableNftEntry<H extends AggregableHolding = AggregableHolding> = {
  holding: H;
  values: AggregableNftValues;
};

/**
 * `true` quand la détention doit peser dans les totaux patrimoniaux — seule
 * définition, utilisée par les totaux **et** par chaque agrégat.
 */
export function countsInTotals(h: AggregableHolding): boolean {
  if (h.isIgnoredInPortfolio) return false;
  if (h.isDuplicate) return false;
  if (isInactiveHoldingStatus(h.status)) return false;
  if (isNonOwnedStatus(h.status)) return false;
  return true;
}

export type NftTotals = {
  retainedEur: Decimal;
  acquisitionCostEur: Decimal;
  /** Écart latent estimé — jamais un P&L réalisé (cf. `getAssetValues`). */
  gainLossEur: Decimal;
  holdingCount: number;
  countedHoldingCount: number;
  spamCount: number;
  suspectedSpamCount: number;
};

export function computeTotals(entries: AggregableNftEntry[]): NftTotals {
  const counted = entries.filter((e) => countsInTotals(e.holding));

  let retained = ZERO;
  let cost = ZERO;
  for (const { values } of counted) {
    retained = retained.plus(values.retainedEur);
    cost = cost.plus(values.acquisitionCostEur);
  }

  return {
    retainedEur: retained,
    acquisitionCostEur: cost,
    gainLossEur: retained.minus(cost),
    holdingCount: entries.length,
    countedHoldingCount: counted.length,
    spamCount: entries.filter((e) => e.holding.spamStatus === "CONFIRMED_SPAM").length,
    suspectedSpamCount: entries.filter((e) => e.holding.spamStatus === "SUSPECTED").length,
  };
}

export type NftExclusions = {
  ignoredRetainedEur: Decimal;
  ignoredCount: number;
  hiddenCount: number;
  inactiveCount: number;
  nonOwnedCount: number;
  duplicateRetainedEur: Decimal;
  duplicateCount: number;
};

/**
 * Ce qui a été écarté, et pourquoi — exposé séparément des totaux, jamais
 * additionné (même raison que côté DeFi : l'exclusion est une décision de
 * l'utilisateur ou une propriété du NFT, pas une correction du total).
 */
export function computeExclusions(entries: AggregableNftEntry[]): NftExclusions {
  let ignored = ZERO;
  let duplicate = ZERO;
  let ignoredCount = 0;
  let hiddenCount = 0;
  let inactiveCount = 0;
  let nonOwnedCount = 0;
  let duplicateCount = 0;

  for (const { holding, values } of entries) {
    if (holding.isIgnoredInPortfolio) {
      ignored = ignored.plus(values.retainedEur);
      ignoredCount += 1;
    }
    if (holding.isHidden) hiddenCount += 1;
    if (isInactiveHoldingStatus(holding.status)) inactiveCount += 1;
    if (isNonOwnedStatus(holding.status)) nonOwnedCount += 1;
    if (holding.isDuplicate) {
      duplicate = duplicate.plus(values.retainedEur);
      duplicateCount += 1;
    }
  }

  return {
    ignoredRetainedEur: ignored,
    ignoredCount,
    hiddenCount,
    inactiveCount,
    nonOwnedCount,
    duplicateRetainedEur: duplicate,
    duplicateCount,
  };
}

export type NftAggregateBucket = {
  key: string;
  label: string;
  holdingCount: number;
  retainedEur: Decimal;
  acquisitionCostEur: Decimal;
};

/**
 * Regroupe les détentions **comptées** selon une clé quelconque (chaîne,
 * collection, catégorie…). Le filtrage par `countsInTotals` est appliqué ici,
 * pas laissé à l'appelant — même raison que côté DeFi : un agrégat qui
 * inclurait les détentions ignorées ne sommerait pas au total affiché.
 */
export function aggregateBy<H extends AggregableHolding>(
  entries: Array<AggregableNftEntry<H>>,
  keyOf: (h: H) => string,
  labelOf: (h: H) => string
): NftAggregateBucket[] {
  const map = new Map<string, NftAggregateBucket>();

  for (const { holding, values } of entries) {
    if (!countsInTotals(holding)) continue;

    const key = keyOf(holding);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: labelOf(holding),
        holdingCount: 0,
        retainedEur: ZERO,
        acquisitionCostEur: ZERO,
      };
      map.set(key, bucket);
    }

    bucket.holdingCount += 1;
    bucket.retainedEur = bucket.retainedEur.plus(values.retainedEur);
    bucket.acquisitionCostEur = bucket.acquisitionCostEur.plus(values.acquisitionCostEur);
  }

  return [...map.values()].sort((a, b) => b.retainedEur.comparedTo(a.retainedEur));
}
