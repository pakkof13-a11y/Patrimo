"use client";

import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { LayoutGrid, PieChart as PieIcon } from "lucide-react";
import { CHART_COLORS } from "@/app/lib/types/ui";
import { formatCurrency, cn } from "@/app/lib/utils";
import {
  EmptyPlaceholder,
  PanelHeader,
  SegmentedControl,
  SegmentedItem,
} from "@/components/ui/panel";

type Slice = { name: string; value: number };

type LaidOutTile = {
  name: string;
  value: number;
  pct: number;
  amountLabel: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Item = {
  name: string;
  value: number;
  pct: number;
  amountLabel: string;
  color: string;
};

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Treemap squarifié (aire ∝ poids) — vue mosaïque de l’allocation.
 * Algorithme : Bruls, Huizing, van Wijk (Eurographics 2000).
 */
function squarify(items: Item[]): LaidOutTile[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const out: LaidOutTile[] = [];

  // Work in a unit square [0,1]×[0,1]
  let x = 0;
  let y = 0;
  let w = 1;
  let h = 1;
  let rest = sorted;
  let restSum = total;

  // Geometric approach: free rectangle in [0,1]², values map to area via scale = (w*h)/restSum
  while (rest.length > 0) {
    const freeArea = w * h;
    const scale = freeArea / restSum; // value → geometric area
    const vertical = w >= h; // pack row vertically along the shorter side? 
    // Convention: if width >= height, create vertical strip on the left (row stacks top→bottom)
    // else horizontal strip on top (row stacks left→right)
    const side = vertical ? h : w; // length of the edge we lay the row along

    const row: Item[] = [];
    let rowValue = 0;

    const aspectWorst = (r: Item[], rVal: number): number => {
      if (r.length === 0 || rVal <= 0) return Infinity;
      const rowGeoArea = rVal * scale;
      const thickness = rowGeoArea / side; // strip thickness
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

    // Place the row strip
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

  // Clamp floating-point bleed into the unit square
  return out.map((t) => ({
    ...t,
    x: Math.max(0, t.x),
    y: Math.max(0, t.y),
    w: Math.min(t.w, 1 - t.x),
    h: Math.min(t.h, 1 - t.y),
  }));
}

function AllocationTiles({
  data,
  baseCurrency,
}: {
  data: Slice[];
  baseCurrency: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  const tiles = useMemo(() => {
    const items: Item[] = [...data]
      .filter((d) => d.value > 0)
      .map((d, i) => ({
        name: d.name,
        value: d.value,
        pct: (d.value / total) * 100,
        amountLabel: formatCurrency(d.value, baseCurrency),
        color: CHART_COLORS[i % CHART_COLORS.length]!,
      }));
    // re-index colors after sort inside squarify — color by size rank instead
    const sorted = [...items].sort((a, b) => b.value - a.value);
    const colored = sorted.map((it, i) => ({
      ...it,
      color: CHART_COLORS[i % CHART_COLORS.length]!,
    }));
    return squarify(colored);
  }, [data, total, baseCurrency]);

  return (
    <div
      className="relative h-44 w-full overflow-hidden rounded-lg bg-black sm:h-48 lg:h-52"
      data-testid="allocation-tiles"
      role="img"
      aria-label="Allocation par classe d’actifs"
    >
      {tiles.map((t) => {
        const area = t.w * t.h;
        // Seuils de lisibilité (hauteur conteneur ~176–208px)
        const pxH = t.h * 192;
        const pxW = t.w * 260;

        let nameFs = 12;
        let pctFs = 15;
        let amtFs = 11;
        if (area > 0.28) {
          nameFs = 16;
          pctFs = 22;
          amtFs = 13;
        } else if (area > 0.14) {
          nameFs = 14;
          pctFs = 18;
          amtFs = 12;
        } else if (area > 0.06) {
          nameFs = 12;
          pctFs = 15;
          amtFs = 11;
        } else if (area < 0.03) {
          nameFs = 10;
          pctFs = 11;
          amtFs = 9;
        }

        const showAmount = pxH >= 42 && pxW >= 88;
        const showPct = pxH >= 24 && pxW >= 52;
        const showName = pxH >= 16 && pxW >= 40;
        const rowMode = pxH < 48;

        return (
          <div
            key={t.name}
            title={`${t.name} · ${t.pct.toFixed(1)} % · ${t.amountLabel}`}
            className="absolute box-border overflow-hidden text-white transition-[filter] duration-150 hover:brightness-110"
            style={{
              left: `${t.x * 100}%`,
              top: `${t.y * 100}%`,
              width: `${t.w * 100}%`,
              height: `${t.h * 100}%`,
              backgroundColor: t.color,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
              margin: 0,
              padding: rowMode ? "3px 7px" : "8px 10px",
              display: "flex",
              flexDirection: rowMode ? "row" : "column",
              alignItems: rowMode ? "center" : "flex-start",
              justifyContent: rowMode ? "space-between" : "center",
              gap: rowMode ? 6 : 3,
            }}
          >
            {showName && (
              <div
                className="min-w-0 font-semibold leading-tight"
                style={{
                  fontSize: nameFs,
                  textShadow: "0 1px 2px rgba(0,0,0,0.55)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}
              >
                {t.name}
              </div>
            )}
            <div
              className="min-w-0 shrink-0"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
            >
              {showPct && (
                <div
                  className="font-bold tabular-nums leading-none"
                  style={{ fontSize: pctFs }}
                >
                  {t.pct.toFixed(1)}&nbsp;%
                </div>
              )}
              {showAmount && (
                <div
                  className="tabular-nums opacity-90"
                  style={{
                    fontSize: amtFs,
                    marginTop: 3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.amountLabel}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AllocationClassPanel({
  data,
  baseCurrency,
  compact = false,
}: {
  data: Slice[];
  baseCurrency: string;
  /** Densité pour colonne latérale du dashboard */
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"pie" | "tiles">("tiles");

  return (
    <div
      className={cn("card p-3.5 sm:p-4", compact && "h-full")}
      data-testid="allocation-class-panel"
    >
      <PanelHeader
        title="Allocation par classe"
        subtitle={compact ? "Par type d’actif" : "Répartition par type d’actif"}
        actions={
          <SegmentedControl aria-label="Mode de visualisation">
            <SegmentedItem
              selected={mode === "pie"}
              testId="alloc-mode-pie"
              onClick={() => setMode("pie")}
            >
              <PieIcon className="h-3.5 w-3.5" />
              Camembert
            </SegmentedItem>
            <SegmentedItem
              selected={mode === "tiles"}
              testId="alloc-mode-tiles"
              onClick={() => setMode("tiles")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Mosaïque
            </SegmentedItem>
          </SegmentedControl>
        }
      />

      {data.length === 0 ? (
        <div className="flex h-44 items-center sm:h-48 lg:h-52">
          <EmptyPlaceholder
            compact
            title="Aucune allocation"
            description="Les classes d’actifs apparaîtront dès le premier achat."
          />
        </div>
      ) : mode === "tiles" ? (
        <AllocationTiles data={data} baseCurrency={baseCurrency} />
      ) : (
        <PieWithLegend
          data={data}
          baseCurrency={baseCurrency}
          compact={compact}
        />
      )}
    </div>
  );
}

/** Camembert + légende montants & % toujours visibles (hors hover). */
function PieWithLegend({
  data,
  baseCurrency,
  compact,
}: {
  data: Slice[];
  baseCurrency: string;
  compact?: boolean;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const rows = [...data]
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((d, i) => ({
      ...d,
      pct: (d.value / total) * 100,
      color: CHART_COLORS[i % CHART_COLORS.length]!,
    }));

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className={cn("w-full", compact ? "h-36" : "h-40 sm:h-44")}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={compact ? 64 : 78}
              innerRadius={compact ? 28 : 34}
              animationDuration={0}
              paddingAngle={1}
            >
              {rows.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, _n, item) => {
                const pct =
                  item && typeof item === "object" && "payload" in item
                    ? Number(
                        (item as { payload?: { pct?: number } }).payload?.pct ??
                          0
                      )
                    : 0;
                return [
                  `${formatCurrency(round2(Number(v ?? 0)), baseCurrency)} · ${pct.toFixed(1)} %`,
                  "Allocation",
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul
        className="max-h-28 space-y-1 overflow-y-auto pr-0.5"
        data-testid="allocation-pie-legend"
      >
        {rows.map((r) => (
          <li
            key={r.name}
            className="flex items-center gap-2 text-[11px] leading-tight"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: r.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]">
              {r.name}
            </span>
            <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">
              {r.pct.toFixed(1)}&nbsp;%
            </span>
            <span className="shrink-0 tabular-nums font-medium text-[var(--foreground)]">
              {formatCurrency(round2(r.value), baseCurrency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
