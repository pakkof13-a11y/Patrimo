"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  type PriceBarInterval,
  type PriceHistoryPoint,
  barIntervalLabel,
} from "@/app/lib/market/price-history-types";
import { formatCurrency, cn } from "@/app/lib/utils";
import {
  type ChartTxMarker,
  type MarkerKind,
  ensureSession,
  formatCompact,
  formatDateFr,
  markerTooltipText,
} from "./chart-markers";

type MarkerHoverTip = {
  marker: ChartTxMarker;
  x: number;
  y: number;
};

function MarkerHoverBubble({
  tip,
  containerW,
}: {
  tip: MarkerHoverTip;
  containerW: number;
}) {
  const text = markerTooltipText(tip.marker);
  const left = Math.min(Math.max(8, tip.x - 110), Math.max(8, containerW - 228));
  const top = Math.max(4, tip.y - 52);
  const kindColor =
    tip.marker.kind === "BUY"
      ? "border-emerald-500/40"
      : tip.marker.kind === "SELL"
        ? "border-rose-500/40"
        : "border-amber-500/40";

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-30 max-w-[220px] rounded-md border bg-[var(--card)] px-2 py-1.5 text-[10px] leading-snug text-slate-700 shadow-lg dark:text-slate-200",
        kindColor
      )}
      style={{ left, top }}
      role="tooltip"
      data-testid="tx-marker-tooltip"
    >
      {text}
    </div>
  );
}

/** Tooltip OHLC + transactions de la barre (courbe et chandeliers). */
function OhlcBarTooltip({
  point,
  barInterval,
  markersAtBar,
  left,
  top,
}: {
  point: PriceHistoryPoint;
  barInterval?: PriceBarInterval;
  markersAtBar: ChartTxMarker[];
  left: number;
  top: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 max-w-[240px] rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-xs shadow-lg"
      style={{ left, top }}
      data-testid="price-tooltip"
    >
      <div className="mb-1 font-semibold text-slate-800 dark:text-slate-100">
        {formatDateFr(point.date, barInterval)}
        {barInterval && (
          <span className="ml-1 font-normal text-slate-400">
            · {barIntervalLabel(barInterval)}
          </span>
        )}
      </div>
      <div className="space-y-0.5 tabular-nums text-slate-600 dark:text-slate-300">
        <div>O ouverture : {formatCurrency(point.open, "EUR")}</div>
        <div>H plus haut : {formatCurrency(point.high, "EUR")}</div>
        <div>L plus bas : {formatCurrency(point.low, "EUR")}</div>
        <div>
          C clôture :{" "}
          <strong className="text-slate-900 dark:text-slate-100">
            {formatCurrency(point.close, "EUR")}
          </strong>
        </div>
      </div>
      {markersAtBar.length > 0 && (
        <div className="mt-1.5 space-y-1 border-t border-[var(--border)] pt-1.5">
          {markersAtBar.map((m, i) => (
            <div
              key={`${m.kind}-${m.date}-${i}`}
              className={cn(
                "text-[11px] leading-snug",
                m.kind === "BUY" && "text-emerald-600 dark:text-emerald-400",
                m.kind === "SELL" && "text-rose-600 dark:text-rose-400",
                m.kind === "DIVIDEND" && "text-amber-600 dark:text-amber-400"
              )}
            >
              {markerTooltipText(m)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function markerFill(kind: MarkerKind): { fill: string; stroke: string; glyph: string } {
  if (kind === "BUY") return { fill: "#16a34a", stroke: "#052e16", glyph: "+" };
  if (kind === "SELL") return { fill: "#e11d48", stroke: "#4c0519", glyph: "−" };
  return { fill: "#f59e0b", stroke: "#78350f", glyph: "D" };
}

/** Icône SVG transaction (courbe + chandeliers) */
function TxMarkerIcon({
  m,
  cx,
  cy,
  hot,
  onEnter,
  onMove,
  onLeave,
}: {
  m: ChartTxMarker;
  cx: number;
  cy: number;
  hot: boolean;
  onEnter: (e: ReactMouseEvent) => void;
  onMove: (e: ReactMouseEvent) => void;
  onLeave: () => void;
}) {
  const { fill, stroke, glyph } = markerFill(m.kind);
  const r = hot ? 8 : 6;
  return (
    <g
      style={{ cursor: "pointer" }}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <circle cx={cx} cy={cy} r={r + 6} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.2}
        style={{
          filter: hot ? "drop-shadow(0 0 3px rgba(0,0,0,0.45))" : undefined,
        }}
      />
      <text
        x={cx}
        y={cy + (m.kind === "SELL" ? 4 : 3.5)}
        textAnchor="middle"
        fontSize={m.kind === "SELL" ? 11 : m.kind === "DIVIDEND" ? 8 : 9}
        fontWeight={700}
        fill="#fff"
        style={{ pointerEvents: "none" }}
      >
        {glyph}
      </text>
    </g>
  );
}

/**
 * Courbe de cours en SVG pur (même logique d'interaction que les chandeliers) :
 * curseur → index de barre exact, tooltip OHLC + tx, marqueurs collés à la clôture.
 */
export function SessionLineChart({
  points,
  barInterval,
  markers = [],
}: {
  points: PriceHistoryPoint[];
  barInterval?: PriceBarInterval;
  markers?: ChartTxMarker[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 224 });
  const [hover, setHover] = useState<number | null>(null);
  const [markerTip, setMarkerTip] = useState<MarkerHoverTip | null>(null);
  const [hotMarker, setHotMarker] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(0, r.width), h: Math.max(160, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data: PriceHistoryPoint[] = useMemo(
    () => points.map(ensureSession),
    [points]
  );
  const pad = { l: 52, r: 10, t: 12, b: 28 };
  const plotW = Math.max(1, size.w - pad.l - pad.r);
  const plotH = Math.max(1, size.h - pad.t - pad.b);

  const { minP, maxP } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of data) {
      lo = Math.min(lo, p.low, p.close, p.open);
      hi = Math.max(hi, p.high, p.close, p.open);
    }
    for (const m of markers) {
      lo = Math.min(lo, m.lineAnchorPrice, m.barLow);
      hi = Math.max(hi, m.lineAnchorPrice, m.barHigh);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { minP: 0, maxP: 1 };
    const span = hi - lo || Math.abs(hi) * 0.02 || 1;
    return { minP: lo - span * 0.04, maxP: hi + span * 0.04 };
  }, [data, markers]);

  const yScale = useCallback(
    (price: number) => pad.t + ((maxP - price) / (maxP - minP || 1)) * plotH,
    [maxP, minP, pad.t, plotH]
  );

  const n = data.length;
  const slot = plotW / Math.max(n, 1);
  const xAt = useCallback(
    (i: number) => pad.l + slot * i + slot / 2,
    [pad.l, slot]
  );

  const linePath = useMemo(() => {
    if (n === 0) return "";
    return data
      .map((p, i) => {
        const x = xAt(i);
        const y = yScale(p.close);
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data, n, xAt, yScale]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) ticks.push(minP + ((maxP - minP) * i) / 4);
    return ticks;
  }, [minP, maxP]);

  const xLabels = useMemo(() => {
    if (n === 0) return [];
    return Array.from(new Set([0, Math.floor(n / 2), n - 1])).map((i) => ({
      i,
      label: data[i]!.label,
    }));
  }, [data, n]);

  const active = hover != null ? data[hover] : null;
  const markersAtHover =
    hover != null ? markers.filter((m) => m.barIndex === hover) : [];

  const indexFromMouse = (clientX: number) => {
    if (n === 0 || !wrapRef.current) return null;
    const rect = wrapRef.current.getBoundingClientRect();
    const mx = clientX - rect.left;
    // Snap au centre de slot le plus proche (pas floor seul → date exacte)
    const raw = (mx - pad.l) / slot - 0.5;
    return Math.min(n - 1, Math.max(0, Math.round(raw)));
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full select-none"
      data-testid="line-chart"
      data-marker-root
    >
      {size.w > 0 && (
        <svg
          width={size.w}
          height={size.h}
          className="block"
          onMouseMove={(e) => {
            if (hotMarker != null) return;
            const idx = indexFromMouse(e.clientX);
            if (idx != null) setHover(idx);
          }}
          onMouseLeave={() => {
            setHover(null);
            setMarkerTip(null);
            setHotMarker(null);
          }}
        >
          {yTicks.map((t) => {
            const yy = yScale(t);
            return (
              <g key={`yl-${t}`}>
                <line
                  x1={pad.l}
                  x2={size.w - pad.r}
                  y1={yy}
                  y2={yy}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x={pad.l - 6}
                  y={yy + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="#38bdf8"
                >
                  {formatCompact(t)}
                </text>
              </g>
            );
          })}

          {/* Courbe monochrome bleue */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Curseur vertical + point actif */}
          {hover != null && active && (
            <>
              <line
                x1={xAt(hover)}
                x2={xAt(hover)}
                y1={pad.t}
                y2={pad.t + plotH}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
                opacity={0.55}
              />
              <circle
                cx={xAt(hover)}
                cy={yScale(active.close)}
                r={3.5}
                fill="#38bdf8"
                stroke="#0c4a6e"
                strokeWidth={1}
              />
            </>
          )}

          {xLabels.map(({ i, label }) => (
            <text
              key={`xl-${i}`}
              x={xAt(i)}
              y={size.h - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {label}
            </text>
          ))}

          {/* Marqueurs collés à la clôture (sur la courbe) */}
          {markers.map((m, mi) => {
            if (m.barIndex < 0 || m.barIndex >= n) return null;
            const cx = xAt(m.i);
            const cy = yScale(m.lineAnchorPrice);
            return (
              <TxMarkerIcon
                key={`lm-${m.kind}-${m.date}-${mi}`}
                m={m}
                cx={cx}
                cy={cy}
                hot={hotMarker === mi}
                onEnter={(e) => {
                  setHotMarker(mi);
                  setHover(m.barIndex);
                  const rect = wrapRef.current!.getBoundingClientRect();
                  setMarkerTip({
                    marker: m,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onMove={(e) => {
                  const rect = wrapRef.current!.getBoundingClientRect();
                  setMarkerTip({
                    marker: m,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onLeave={() => {
                  setHotMarker(null);
                  setMarkerTip(null);
                }}
              />
            );
          })}
        </svg>
      )}

      {markerTip && size.w > 0 && (
        <MarkerHoverBubble tip={markerTip} containerW={size.w} />
      )}

      {active && hover != null && !markerTip && size.w > 0 && (
        <OhlcBarTooltip
          point={active}
          barInterval={barInterval}
          markersAtBar={markersAtHover}
          left={Math.min(size.w - 200, Math.max(8, xAt(hover) + 12))}
          top={8}
        />
      )}
    </div>
  );
}


export function SessionCandleChart({
  points,
  barInterval,
  markers = [],
}: {
  points: PriceHistoryPoint[];
  barInterval?: PriceBarInterval;
  markers?: ChartTxMarker[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 224 });
  const [hover, setHover] = useState<number | null>(null);
  const [markerTip, setMarkerTip] = useState<MarkerHoverTip | null>(null);
  const [hotMarker, setHotMarker] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(0, r.width), h: Math.max(160, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => points.map(ensureSession), [points]);

  const pad = { l: 52, r: 10, t: 10, b: 28 };
  const plotW = Math.max(1, size.w - pad.l - pad.r);
  const plotH = Math.max(1, size.h - pad.t - pad.b);

  const { minP, maxP } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of data) {
      lo = Math.min(lo, p.low);
      hi = Math.max(hi, p.high);
    }
    for (const m of markers) {
      lo = Math.min(lo, m.candleAnchorPrice, m.barLow);
      hi = Math.max(hi, m.candleAnchorPrice, m.barHigh);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { minP: 0, maxP: 1 };
    const span = hi - lo || Math.abs(hi) * 0.02 || 1;
    // Marge pour icônes sous Low / au-dessus High
    return { minP: lo - span * 0.08, maxP: hi + span * 0.08 };
  }, [data, markers]);

  const yScale = useCallback(
    (price: number) => pad.t + ((maxP - price) / (maxP - minP || 1)) * plotH,
    [maxP, minP, pad.t, plotH]
  );

  const n = data.length;
  const slot = plotW / Math.max(n, 1);
  const bodyW = Math.max(2, Math.min(14, slot * 0.62));
  const xCenter = (i: number) => pad.l + slot * i + slot / 2;

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) ticks.push(minP + ((maxP - minP) * i) / 4);
    return ticks;
  }, [minP, maxP]);

  const xLabels = useMemo(() => {
    if (n === 0) return [];
    return Array.from(new Set([0, Math.floor(n / 2), n - 1])).map((i) => ({
      i,
      label: data[i]!.label,
    }));
  }, [data, n]);

  const active = hover != null ? data[hover] : null;
  const markersAtHover =
    hover != null ? markers.filter((m) => m.barIndex === hover) : [];

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none" data-testid="ohlc-chart">
      {size.w > 0 && (
        <svg
          width={size.w}
          height={size.h}
          className="block"
          onMouseMove={(e) => {
            if (n === 0 || hotMarker != null) return;
            const rect = wrapRef.current!.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            // Snap au centre de slot (aligné avec la courbe)
            const raw = (mx - pad.l) / slot - 0.5;
            setHover(Math.min(n - 1, Math.max(0, Math.round(raw))));
          }}
          onMouseLeave={() => {
            setHover(null);
            setMarkerTip(null);
            setHotMarker(null);
          }}
        >
          {yTicks.map((t) => {
            const yy = yScale(t);
            return (
              <g key={`yt-${t}`}>
                <line
                  x1={pad.l}
                  x2={size.w - pad.r}
                  y1={yy}
                  y2={yy}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x={pad.l - 6}
                  y={yy + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                >
                  {formatCompact(t)}
                </text>
              </g>
            );
          })}

          {data.map((p, i) => {
            const cx = xCenter(i);
            const yO = yScale(p.open);
            const yC = yScale(p.close);
            const yH = yScale(p.high);
            const yL = yScale(p.low);
            const bull = p.close >= p.open;
            const color = bull ? "#16a34a" : "#dc2626";
            const bodyTop = Math.min(yO, yC);
            const bodyH = Math.max(Math.abs(yC - yO), 1);
            const on = hover === i;

            return (
              <g key={`${p.date}-${i}`} opacity={hover == null || on ? 1 : 0.4}>
                {/* Mèche : high → low de la séance */}
                <line
                  x1={cx}
                  x2={cx}
                  y1={yH}
                  y2={yL}
                  stroke={color}
                  strokeWidth={on ? 1.5 : 1}
                />
                {/* Corps : open → close de la séance */}
                <rect
                  x={cx - bodyW / 2}
                  y={bodyTop}
                  width={bodyW}
                  height={bodyH}
                  fill={color}
                  stroke={color}
                  rx={0.5}
                />
                <rect
                  x={cx - slot / 2}
                  y={pad.t}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}

          {hover != null && (
            <line
              x1={xCenter(hover)}
              x2={xCenter(hover)}
              y1={pad.t}
              y2={pad.t + plotH}
              stroke="var(--muted-foreground)"
              strokeDasharray="3 3"
              opacity={0.55}
            />
          )}

          {xLabels.map(({ i, label }) => (
            <text
              key={`xl-${i}`}
              x={xCenter(i)}
              y={size.h - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {label}
            </text>
          ))}

          {/* Marqueurs transaction sur l'axe des bougies */}
          {markers.map((m, mi) => {
            if (m.barIndex < 0 || m.barIndex >= n) return null;
            const cx = pad.l + slot * m.i + slot / 2;
            const cy = yScale(m.candleAnchorPrice);
            return (
              <TxMarkerIcon
                key={`txm-${m.kind}-${m.date}-${mi}`}
                m={m}
                cx={cx}
                cy={cy}
                hot={hotMarker === mi}
                onEnter={(e) => {
                  setHotMarker(mi);
                  setHover(m.barIndex);
                  const rect = wrapRef.current!.getBoundingClientRect();
                  setMarkerTip({
                    marker: m,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onMove={(e) => {
                  const rect = wrapRef.current!.getBoundingClientRect();
                  setMarkerTip({
                    marker: m,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onLeave={() => {
                  setHotMarker(null);
                  setMarkerTip(null);
                }}
              />
            );
          })}
        </svg>
      )}

      {markerTip && size.w > 0 && (
        <MarkerHoverBubble tip={markerTip} containerW={size.w} />
      )}

      {active && hover != null && !markerTip && size.w > 0 && (
        <OhlcBarTooltip
          point={active}
          barInterval={barInterval}
          markersAtBar={markersAtHover}
          left={Math.min(size.w - 200, Math.max(8, xCenter(hover) + 12))}
          top={8}
        />
      )}
    </div>
  );
}
