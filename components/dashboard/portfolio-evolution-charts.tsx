"use client";

/**
 * Graphiques évolution portefeuille — extraits du panel pour lisibilité.
 * Pure presentation (Recharts) ; prefs / séries restent dans le panel.
 */
import {
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  AreaChart,
  Area,
  Cell,
  ReferenceLine,
} from "recharts";
import { formatCurrency } from "@/app/lib/utils";
import type {
  EvolutionChartStyle,
  EvolutionSeriesPoint,
} from "@/app/lib/portfolio/evolution-aggregate";

export const EVOLUTION_CHART_COLORS = {
  total: "#0f766e",
  positions: "#0f766e",
  cash: "#0284c7",
  dividends: "#7c3aed",
  coupons: "#a855f7",
  rents: "#c084fc",
  realized: "#d97706",
  unrealized: "#059669",
  pos: "#10b981",
  neg: "#f43f5e",
  benchmark: "#94a3b8",
};
export function yTick(v: number) {
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(v);
}

export const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--card)",
  fontSize: 12,
};

/** Domaine Y symétrique autour de 0 (variations +/− lisibles). */
export function symmetricZeroDomain(
  values: number[],
  padRatio = 0.12
): [number, number] {
  let maxAbs = 0;
  for (const v of values) {
    if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  }
  const pad = Math.max(maxAbs * (1 + padRatio), 1);
  return [-pad, pad];
}

export function GlobalLineChart({
  data,
  baseCurrency,
  showBenchmark,
  benchmarkName,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
  showBenchmark?: boolean;
  benchmarkName?: string;
}) {
  // Courbe stock : points colorés gain (hausse vs précédent) / perte
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={52}
          domain={["auto", "auto"]}
        />
        <Tooltip
          formatter={(v, name) => [
            formatCurrency(Number(v ?? 0), baseCurrency),
            String(name ?? ""),
          ]}
          labelFormatter={(_, pl) => {
            const p = pl?.[0]?.payload as { periodLabel?: string } | undefined;
            return p?.periodLabel ?? "";
          }}
          contentStyle={tooltipStyle}
        />
        {showBenchmark && (
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        )}
        <Line
          type="monotone"
          dataKey="total"
          name="Patrimoine"
          stroke={EVOLUTION_CHART_COLORS.total}
          strokeWidth={2.5}
          dot={(props: {
            cx?: number;
            cy?: number;
            index?: number;
            payload?: EvolutionSeriesPoint;
          }) => {
            const { cx, cy, index, payload } = props;
            if (cx == null || cy == null || !payload || index == null) {
              return <g />;
            }
            const prev = index > 0 ? data[index - 1] : null;
            const up =
              prev == null
                ? true
                : (payload.total ?? 0) >= (prev.total ?? 0);
            const fill = up
              ? EVOLUTION_CHART_COLORS.pos
              : EVOLUTION_CHART_COLORS.neg;
            return (
              <circle
                cx={cx}
                cy={cy}
                r={data.length <= 24 ? 3 : 2}
                fill={fill}
                stroke={fill}
              />
            );
          }}
          activeDot={{ r: 5 }}
        />
        {showBenchmark && (
          <Line
            type="monotone"
            dataKey="benchmark"
            name={benchmarkName || "Référence"}
            stroke={EVOLUTION_CHART_COLORS.benchmark}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Colonnes cumulées (niveaux absolus) — couleur gain/perte vs période précédente */
export function GlobalColumnsChart({
  data,
  baseCurrency,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={52}
        />
        <Tooltip
          formatter={(v) => [
            formatCurrency(Number(v ?? 0), baseCurrency),
            "Valeur",
          ]}
          labelFormatter={(_, pl) => {
            const p = pl?.[0]?.payload as { periodLabel?: string } | undefined;
            return p?.periodLabel ?? "";
          }}
          contentStyle={tooltipStyle}
        />
        <Bar
          dataKey="total"
          name="Patrimoine"
          radius={[3, 3, 0, 0]}
          maxBarSize={32}
        >
          {data.map((entry, i) => {
            const prev = i > 0 ? data[i - 1] : null;
            const up =
              prev == null ? true : (entry.total ?? 0) >= (prev.total ?? 0);
            return (
              <Cell
                key={i}
                fill={
                  up ? EVOLUTION_CHART_COLORS.pos : EVOLUTION_CHART_COLORS.neg
                }
              />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Périodique colonnes : zéro central, vert + / rouge − */
export function PeriodColumnsChart({
  data,
  baseCurrency,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
}) {
  const yDomain = symmetricZeroDomain(data.map((d) => d.chartValue ?? 0));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={52}
          domain={yDomain}
          allowDataOverflow
        />
        <ReferenceLine
          y={0}
          stroke="var(--foreground)"
          strokeOpacity={0.45}
          strokeWidth={1.75}
        />
        <Tooltip
          formatter={(v) => [
            formatCurrency(Number(v ?? 0), baseCurrency),
            "Variation",
          ]}
          labelFormatter={(_, pl) => {
            const p = pl?.[0]?.payload as { periodLabel?: string } | undefined;
            return p?.periodLabel ?? "";
          }}
          contentStyle={tooltipStyle}
        />
        <Bar dataKey="chartValue" name="Variation" radius={[3, 3, 0, 0]} maxBarSize={32}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={
                entry.chartValue >= 0
                  ? EVOLUTION_CHART_COLORS.pos
                  : EVOLUTION_CHART_COLORS.neg
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Périodique courbe : 0 au milieu, points verts/rouges gain/perte */
export function PeriodLineChart({
  data,
  baseCurrency,
  showBenchmark,
  benchmarkName,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
  showBenchmark?: boolean;
  benchmarkName?: string;
}) {
  const yDomain = symmetricZeroDomain([
    ...data.map((d) => d.chartValue ?? 0),
    ...data.map((d) => d.benchmarkDelta ?? 0),
  ]);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={52}
          domain={yDomain}
          allowDataOverflow
        />
        <ReferenceLine
          y={0}
          stroke="var(--foreground)"
          strokeOpacity={0.5}
          strokeWidth={1.75}
        />
        <Tooltip
          formatter={(v, name) => [
            formatCurrency(Number(v ?? 0), baseCurrency),
            String(name ?? ""),
          ]}
          labelFormatter={(_, pl) => {
            const p = pl?.[0]?.payload as { periodLabel?: string } | undefined;
            return p?.periodLabel ?? "";
          }}
          contentStyle={tooltipStyle}
        />
        {showBenchmark && (
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        )}
        <Line
          type="monotone"
          dataKey="chartValue"
          name="Variation"
          stroke={EVOLUTION_CHART_COLORS.total}
          strokeWidth={2}
          dot={(props: {
            cx?: number;
            cy?: number;
            payload?: EvolutionSeriesPoint;
          }) => {
            const { cx, cy, payload } = props;
            if (cx == null || cy == null || !payload) return <g />;
            const up = (payload.chartValue ?? 0) >= 0;
            return (
              <circle
                cx={cx}
                cy={cy}
                r={3.5}
                fill={
                  up ? EVOLUTION_CHART_COLORS.pos : EVOLUTION_CHART_COLORS.neg
                }
                stroke={
                  up ? EVOLUTION_CHART_COLORS.pos : EVOLUTION_CHART_COLORS.neg
                }
              />
            );
          }}
          activeDot={{ r: 5 }}
        />
        {showBenchmark && (
          <Line
            type="monotone"
            dataKey="benchmarkDelta"
            name={benchmarkName ? `Δ ${benchmarkName}` : "Δ Réf."}
            stroke={EVOLUTION_CHART_COLORS.benchmark}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Cumulé décomposé : positions + cash + split revenus (aires). */
export function DecomposedCumulAreas({
  data,
  baseCurrency,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
}) {
  const hasIncomeSplit = data.some(
    (p) => p.dividends > 0 || p.coupons > 0 || p.rents > 0
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={52}
        />
        <Tooltip
          formatter={(v, name) => [
            formatCurrency(Number(v ?? 0), baseCurrency),
            String(name ?? ""),
          ]}
          labelFormatter={(_, pl) => {
            const p = pl?.[0]?.payload as { periodLabel?: string } | undefined;
            return p?.periodLabel ?? "";
          }}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
        <Area
          type="monotone"
          dataKey="positions"
          name="Positions"
          stackId="a"
          stroke={EVOLUTION_CHART_COLORS.positions}
          fill={EVOLUTION_CHART_COLORS.positions}
          fillOpacity={0.4}
        />
        <Area
          type="monotone"
          dataKey="cash"
          name="Cash"
          stackId="a"
          stroke={EVOLUTION_CHART_COLORS.cash}
          fill={EVOLUTION_CHART_COLORS.cash}
          fillOpacity={0.35}
        />
        {hasIncomeSplit && (
          <>
            <Area
              type="monotone"
              dataKey="dividends"
              name="Dividendes"
              stackId="b"
              stroke={EVOLUTION_CHART_COLORS.dividends}
              fill={EVOLUTION_CHART_COLORS.dividends}
              fillOpacity={0.25}
            />
            <Area
              type="monotone"
              dataKey="coupons"
              name="Coupons"
              stackId="b"
              stroke={EVOLUTION_CHART_COLORS.coupons}
              fill={EVOLUTION_CHART_COLORS.coupons}
              fillOpacity={0.25}
            />
            <Area
              type="monotone"
              dataKey="rents"
              name="Loyers"
              stackId="b"
              stroke={EVOLUTION_CHART_COLORS.rents}
              fill={EVOLUTION_CHART_COLORS.rents}
              fillOpacity={0.25}
            />
          </>
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DecomposedCumulColumns({
  data,
  baseCurrency,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={52}
        />
        <Tooltip
          formatter={(v, name) => [
            formatCurrency(Number(v ?? 0), baseCurrency),
            String(name ?? ""),
          ]}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        <Bar
          dataKey="positions"
          name="Positions"
          stackId="a"
          fill={EVOLUTION_CHART_COLORS.positions}
          maxBarSize={32}
        />
        <Bar
          dataKey="cash"
          name="Cash"
          stackId="a"
          fill={EVOLUTION_CHART_COLORS.cash}
          radius={[3, 3, 0, 0]}
          maxBarSize={32}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DecomposedPeriodChart({
  data,
  baseCurrency,
  style,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
  style: EvolutionChartStyle;
}) {
  const hasSplit = data.some(
    (p) =>
      Math.abs(p.dDividends) > 0.01 ||
      Math.abs(p.dCoupons) > 0.01 ||
      Math.abs(p.dRents) > 0.01
  );

  // Latente en premier (centrée sur le repère jour), puis les autres critères
  const series = [
    { key: "dUnrealized", name: "Δ Latente", color: EVOLUTION_CHART_COLORS.unrealized },
    { key: "dPositions", name: "Δ Positions", color: EVOLUTION_CHART_COLORS.positions },
    { key: "dCash", name: "Δ Cash", color: EVOLUTION_CHART_COLORS.cash },
    ...(hasSplit
      ? [
          { key: "dDividends", name: "Δ Dividendes", color: EVOLUTION_CHART_COLORS.dividends },
          { key: "dCoupons", name: "Δ Coupons", color: EVOLUTION_CHART_COLORS.coupons },
          { key: "dRents", name: "Δ Loyers", color: EVOLUTION_CHART_COLORS.rents },
        ]
      : [{ key: "dIncome", name: "Δ Revenus", color: EVOLUTION_CHART_COLORS.dividends }]),
    { key: "dRealized", name: "Δ Réalisé", color: EVOLUTION_CHART_COLORS.realized },
  ] as const;

  const yDomain = symmetricZeroDomain(
    data.flatMap((p) =>
      series.map((s) => Number((p as Record<string, unknown>)[s.key] ?? 0))
    )
  );

  if (style === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={yTick}
            width={52}
            domain={yDomain}
            allowDataOverflow
          />
          <ReferenceLine
            y={0}
            stroke="var(--foreground)"
            strokeOpacity={0.5}
            strokeWidth={1.75}
          />
          <Tooltip
            formatter={(v, name) => [
              formatCurrency(Number(v ?? 0), baseCurrency),
              String(name ?? ""),
            ]}
            contentStyle={tooltipStyle}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={1.6}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Colonnes côte à côte (pas stack) — 0 au milieu, signe via teinte
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={52}
          domain={yDomain}
          allowDataOverflow
        />
        <ReferenceLine
          y={0}
          stroke="var(--foreground)"
          strokeOpacity={0.5}
          strokeWidth={1.75}
        />
        <Tooltip
          formatter={(v, name) => [
            formatCurrency(Number(v ?? 0), baseCurrency),
            String(name ?? ""),
          ]}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            maxBarSize={18}
            radius={[2, 2, 0, 0]}
          >
            {data.map((entry, i) => {
              const raw = Number(
                (entry as Record<string, unknown>)[s.key] ?? 0
              );
              const up = raw >= 0;
              return (
                <Cell
                  key={i}
                  fill={
                    up
                      ? s.color
                      : EVOLUTION_CHART_COLORS.neg
                  }
                  fillOpacity={up ? 0.9 : 0.85}
                />
              );
            })}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
