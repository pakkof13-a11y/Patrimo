"use client";

import { formatCurrency, cn } from "@/app/lib/utils";
import type {
  AggregatedPerfPoint,
  AggregateInterval,
  PerfMetricMode,
} from "@/app/lib/portfolio/perf-aggregate";

const PERF_POS = "#10b981";
const PERF_NEG = "#f43f5e";

export function PerfAggTooltip({
  active,
  payload,
  intervalType,
  metricMode = "cumul",
}: {
  active?: boolean;
  payload?: Array<{ payload?: AggregatedPerfPoint }>;
  intervalType?: AggregateInterval;
  metricMode?: PerfMetricMode;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const value =
    metricMode === "period"
      ? p.periodPnlEur
      : metricMode === "dividends"
        ? p.dividendsNetCumEur
        : (p.totalPnlEur ?? p.chartValueEur);
  const pct =
    metricMode === "period" || metricMode === "dividends"
      ? p.chartValuePct
      : p.totalPnlPct;
  const up = value >= 0;
  const intervalHint =
    intervalType === "day"
      ? "agrégation journalière"
      : intervalType === "week"
        ? "agrégation hebdomadaire"
        : "agrégation mensuelle";
  const title =
    metricMode === "period"
      ? "Δ période"
      : metricMode === "dividends"
        ? "Dividendes nets cumulés"
        : "Σ cumulée";

  return (
    <div className="max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-semibold capitalize text-slate-800 dark:text-slate-100">
        {p.periodLabel}
      </div>
      <div
        className={cn(
          "tabular-nums font-semibold",
          up
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400"
        )}
      >
        {title} : {up ? "+" : ""}
        {formatCurrency(value, "EUR")}
        {(metricMode === "cumul" || metricMode === "dividends") && (
          <>
            {" "}
            ({up ? "+" : ""}
            {pct.toFixed(1)} % vs investi)
          </>
        )}
      </div>
      {metricMode === "period" && (
        <div className="mt-1 space-y-0.5 text-[10px] tabular-nums text-slate-500">
          <div>
            Prix (qty ouv.) : {p.pricePnlEur >= 0 ? "+" : ""}
            {formatCurrency(p.pricePnlEur, "EUR")}
          </div>
          {(p.periodRealizedEur !== 0 || p.incomePnlEur !== 0) && (
            <>
              <div>
                Réalisé : {p.periodRealizedEur >= 0 ? "+" : ""}
                {formatCurrency(p.periodRealizedEur, "EUR")}
              </div>
              <div>
                Div. nets : {p.incomePnlEur >= 0 ? "+" : ""}
                {formatCurrency(p.incomePnlEur, "EUR")}
              </div>
            </>
          )}
        </div>
      )}
      {metricMode === "dividends" && (
        <div className="mt-1 space-y-0.5 text-[10px] tabular-nums text-slate-500">
          <div>
            Brut cumulé : {formatCurrency(p.dividendsGrossCumEur ?? 0, "EUR")}
          </div>
          <div>
            WHT cumulé : {formatCurrency(p.withholdingCumEur ?? 0, "EUR")}
          </div>
          <div>
            Versé cette période : {formatCurrency(p.incomePnlEur ?? 0, "EUR")}
          </div>
        </div>
      )}
      <div className="mt-1 text-[10px] text-slate-400">
        Cours {formatCurrency(p.close, "EUR")}
        {p.cumpEur != null &&
          p.cumpEur > 0 &&
          ` · CUMP ${formatCurrency(p.cumpEur, "EUR")}`}
        {p.qty > 0 &&
          ` · qté ${p.qty.toLocaleString("fr-FR", { maximumFractionDigits: 6 })}`}
        {" · "}
        {intervalHint}
      </div>
    </div>
  );
}

/**
 * Colonne divergente : coins arrondis côté extrémité (haut si + / bas si −),
 * gap géré via barCategoryGap du chart parent.
 */
export function PerfColumnShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: AggregatedPerfPoint;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const value = payload?.chartValueEur ?? 0;
  if (!width || height === 0) return null;

  const fill = value >= 0 ? PERF_POS : PERF_NEG;
  const r = Math.min(5, Math.abs(width) / 2);

  // Recharts : height négative pour les valeurs < 0
  const bx = x;
  let by = y;
  const bw = width;
  let bh = height;
  if (bh < 0) {
    by = y + bh;
    bh = -bh;
  }
  if (bh < 1) bh = 1;

  const isPos = value >= 0;
  // Arrondi haut (pos) ou bas (neg)
  const tl = isPos ? r : 0;
  const tr = isPos ? r : 0;
  const br = isPos ? 0 : r;
  const bl = isPos ? 0 : r;

  const path = [
    `M${bx + tl},${by}`,
    `H${bx + bw - tr}`,
    tr ? `Q${bx + bw},${by} ${bx + bw},${by + tr}` : `L${bx + bw},${by}`,
    `V${by + bh - br}`,
    br ? `Q${bx + bw},${by + bh} ${bx + bw - br},${by + bh}` : `L${bx + bw},${by + bh}`,
    `H${bx + bl}`,
    bl ? `Q${bx},${by + bh} ${bx},${by + bh - bl}` : `L${bx},${by + bh}`,
    `V${by + tl}`,
    tl ? `Q${bx},${by} ${bx + tl},${by}` : `L${bx},${by}`,
    "Z",
  ].join(" ");

  return <path d={path} fill={fill} />;
}

/**
 * Chandeliers japonais — une bougie = une séance :
 * O = ouverture, H = plus haut, L = plus bas, C = clôture de ce jour.
 * Marqueurs tx rendus sur le même SVG (axe X partagé).
 */
