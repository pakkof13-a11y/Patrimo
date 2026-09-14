/**
 * Répartition de pourcentages qui somment exactement à 100.
 *
 * `toFixed(1)` indépendant sur chaque part produisait 100,1 % (ou 99,9 %)
 * dès que les restes s'accumulaient du même côté. La méthode de Hamilton
 * (plus fort reste) attribue les dixièmes restants aux parts dont la partie
 * fractionnaire est la plus grande : la somme affichée est 100,0, et l'écart
 * d'une part avec sa valeur exacte ne dépasse jamais un dixième.
 */

import { d } from "@/app/lib/money/decimal";

/**
 * Pourcentages à `decimals` décimales qui somment à 100.
 *
 * Les poids nuls ou non finis reçoivent 0. Un total nul rend une série de
 * zéros plutôt qu'une division par zéro.
 */
export function allocatePercents(
  weights: number[],
  decimals = 1
): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const safe = weights.map((w) =>
    typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 0
  );
  const total = safe.reduce((s, w) => s + w, 0);
  if (total <= 0) return safe.map(() => 0);

  const factor = 10 ** decimals;
  const target = 100 * factor;
  const exact = safe.map((w) =>
    d(w).div(total).mul(target).toNumber()
  );
  const floors = exact.map((x) => Math.floor(x));
  const remainder = target - floors.reduce((s, x) => s + x, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - floors[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (let k = 0; k < remainder; k++) {
    const slot = order[k];
    if (!slot) break;
    out[slot.i]! += 1;
  }
  return out.map((x) => x / factor);
}

export type WeightedItem<T> = T & { value: number };

/**
 * Regroupe les parts trop petites dans une ligne « Autres ».
 *
 * Seuil relatif au total des valeurs positives. Les items déjà nommés comme
 * la ligne d'agrégat y sont fondus plutôt que d'en produire une seconde.
 */
export function capTinyHoldings<T extends { name: string; value: number }>(
  items: readonly T[],
  opts?: {
    minShare?: number;
    otherLabel?: string;
  }
): T[] {
  const minShare = opts?.minShare ?? 0.01;
  const otherLabel = opts?.otherLabel ?? "Autres";
  const positive = items.filter(
    (it) => typeof it.value === "number" && Number.isFinite(it.value) && it.value > 0
  );
  const total = positive.reduce((s, it) => s + it.value, 0);
  if (total <= 0) return [];

  const kept: T[] = [];
  let otherValue = 0;
  let otherTemplate: T | undefined;

  for (const it of positive) {
    const isOther =
      it.name === otherLabel || it.name === "Autre" || it.name === "Autres";
    if (isOther || it.value / total < minShare) {
      otherValue += it.value;
      otherTemplate ??= it;
    } else {
      kept.push(it);
    }
  }

  if (otherValue <= 0) return kept;
  const template = otherTemplate ?? kept[0];
  if (!template) return kept;
  kept.push({ ...template, name: otherLabel, value: otherValue });
  return kept.sort((a, b) => b.value - a.value);
}
