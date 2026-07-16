// Quick sanity: areas sum to ~1, no overlap heavy
// Import is not exported — reimplement check inline by evaluating component file constants

type Item = { name: string; value: number; pct: number; amountLabel: string; color: string };
type LaidOut = Item & { x: number; y: number; w: number; h: number };

function squarify(items: Item[]): LaidOut[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const out: LaidOut[] = [];
  let x = 0, y = 0, w = 1, h = 1;
  let rest = sorted;
  let restSum = total;

  while (rest.length > 0) {
    const freeArea = w * h;
    const scale = freeArea / restSum;
    const vertical = w >= h;
    const side = vertical ? h : w;
    const row: Item[] = [];
    let rowValue = 0;

    const aspectWorst = (r: Item[], rVal: number): number => {
      if (r.length === 0 || rVal <= 0) return Infinity;
      const rowGeoArea = rVal * scale;
      const thickness = rowGeoArea / side;
      if (thickness <= 0) return Infinity;
      let worstRatio = 0;
      for (const it of r) {
        const a = it.value * scale;
        const len = a / thickness;
        worstRatio = Math.max(worstRatio, Math.max(len / thickness, thickness / len));
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
      if (aspectWorst(nextRow, nextVal) <= aspectWorst(row, rowValue)) {
        row.push(candidate);
        rowValue = nextVal;
        rest = rest.slice(1);
      } else break;
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
  return out;
}

const data = [
  { name: "Immo", value: 48.4 },
  { name: "Actions", value: 30 },
  { name: "Cash", value: 12 },
  { name: "Crypto", value: 1 },
  { name: "Autre", value: 8.6 },
];
const total = data.reduce((s, d) => s + d.value, 0);
const items = data.map((d, i) => ({
  ...d,
  pct: (d.value / total) * 100,
  amountLabel: "",
  color: "#000",
}));
const layout = squarify(items);
const area = layout.reduce((s, t) => s + t.w * t.h, 0);
console.log(
  layout.map((t) => `${t.name}: ${(t.w * t.h * 100).toFixed(1)}% area @ ${t.w.toFixed(2)}x${t.h.toFixed(2)}`)
);
console.log("total area", area.toFixed(4));
