/**
 * Treemap squarifié (aire ∝ poids) — Bruls, Huizing, van Wijk (Eurographics 2000).
 *
 * Extrait de `allocation-class-panel.tsx` pour que le tableau de bord et le
 * panneau de classes posent les mêmes rectangles. Deux implémentations
 * divergeraient au premier ajustement de ratio.
 */

export type SquarifyItem = {
  name: string;
  value: number;
  [key: string]: unknown;
};

export type SquarifiedTile<T extends SquarifyItem = SquarifyItem> = T & {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Place `items` dans le carré unité [0,1]×[0,1]. Aire de chaque tuile
 * proportionnelle à sa valeur. Les items de valeur ≤ 0 sont ignorés.
 */
export function squarify<T extends SquarifyItem>(items: T[]): SquarifiedTile<T>[] {
  const positive = items.filter(
    (i) => typeof i.value === "number" && Number.isFinite(i.value) && i.value > 0
  );
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || positive.length === 0) return [];

  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const out: SquarifiedTile<T>[] = [];

  let x = 0;
  let y = 0;
  let w = 1;
  let h = 1;
  let rest = sorted;
  let restSum = total;

  while (rest.length > 0) {
    const freeArea = w * h;
    const scale = freeArea / restSum;
    const vertical = w >= h;
    const side = vertical ? h : w;

    const row: T[] = [];
    let rowValue = 0;

    const aspectWorst = (r: T[], rVal: number): number => {
      if (r.length === 0 || rVal <= 0) return Infinity;
      const rowGeoArea = rVal * scale;
      const thickness = rowGeoArea / side;
      if (thickness <= 0) return Infinity;
      let worstRatio = 0;
      for (const it of r) {
        const a = it.value * scale;
        const len = a / thickness;
        const ratio = Math.max(len / thickness, thickness / len);
        if (ratio > worstRatio) worstRatio = ratio;
      }
      return worstRatio;
    };

    while (rest.length > 0) {
      const candidate = rest[0]!;
      const nextRow = [...row, candidate];
      const nextVal = rowValue + candidate.value;
      if (row.length === 0) {
        row.push(candidate);
        rowValue = nextVal;
        rest = rest.slice(1);
        continue;
      }
      const before = aspectWorst(row, rowValue);
      const after = aspectWorst(nextRow, nextVal);
      if (after <= before) {
        row.push(candidate);
        rowValue = nextVal;
        rest = rest.slice(1);
      } else {
        break;
      }
    }

    const rowGeoArea = rowValue * scale;
    if (vertical) {
      const thickness = rowGeoArea / h;
      let cy = y;
      for (const it of row) {
        const a = it.value * scale;
        const th = a / thickness;
        out.push({ ...it, x, y: cy, w: thickness, h: th });
        cy += th;
      }
      x += thickness;
      w -= thickness;
    } else {
      const thickness = rowGeoArea / w;
      let cx = x;
      for (const it of row) {
        const a = it.value * scale;
        const tw = a / thickness;
        out.push({ ...it, x: cx, y, w: tw, h: thickness });
        cx += tw;
      }
      y += thickness;
      h -= thickness;
    }

    restSum -= rowValue;
    if (w < 1e-12 || h < 1e-12) break;
  }

  return out.map((t) => ({
    ...t,
    x: Math.max(0, t.x),
    y: Math.max(0, t.y),
    w: Math.min(t.w, 1 - t.x),
    h: Math.min(t.h, 1 - t.y),
  }));
}
