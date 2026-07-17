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
          dot={data.length <= 20 ? { r: 2.5, fill: EVOLUTION_CHART_COLORS.total } : false}
          activeDot={{ r: 5 }}
        />
        {showBenchmark && (
          <Line
            type="monotone"
            dataKey="benchmark"
            name={benchmarkName || "RÃ©fÃ©rence"}
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

/** Colonnes cumulÃ©es (niveaux absolus) */
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
          fill={EVOLUTION_CHART_COLORS.total}
          radius={[3, 3, 0, 0]}
          maxBarSize={32}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** PÃ©riodique colonnes : zÃ©ro central, vert + / rouge âˆ’ */
export function PeriodColumnsChart({
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
        <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1.5} />
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
              fill={entry.chartValue >= 0 ? EVOLUTION_CHART_COLORS.pos : EVOLUTION_CHART_COLORS.neg}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** PÃ©riodique courbe : segments verts/rouges via pos/neg + ligne zÃ©ro */
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
  // pos/neg dÃ©jÃ  sur chartValue ; pour une courbe continue colorÃ©e on utilise chartValue unique
  // + dots colorÃ©s, et zone de rÃ©fÃ©rence 0
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
        />
        <ReferenceLine
          y={0}
          stroke="var(--foreground)"
          strokeOpacity={0.4}
          strokeWidth={1.5}
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
        {/* Aires pos/neg pour lire immÃ©diatement le signe autour de zÃ©ro */}
        <Area
          type="monotone"
          dataKey="pos"
          name="+ "
          stroke="none"
          fill={EVOLUTION_CHART_COLORS.pos}
          fillOpacity={0.12}
          legendType="none"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="neg"
          name="âˆ’ "
          stroke="none"
          fill={EVOLUTION_CHART_COLORS.neg}
          fillOpacity={0.12}
          legendType="none"
          isAnimationActive={false}
        />
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
                fill={up ? EVOLUTION_CHART_COLORS.pos : EVOLUTION_CHART_COLORS.neg}
                stroke={up ? EVOLUTION_CHART_COLORS.pos : EVOLUTION_CHART_COLORS.neg}
              />
            );
          }}
          activeDot={{ r: 5 }}
        />
        {showBenchmark && (
          <Line
            type="monotone"
            dataKey="benchmarkDelta"
            name={benchmarkName ? `Î” ${benchmarkName}` : "Î” RÃ©f."}
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

/** CumulÃ© dÃ©composÃ© : positions + cash + split revenus (aires). */
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

  const series = [
    { key: "dPositions", name: "Î” Positions", color: EVOLUTION_CHART_COLORS.positions },
    { key: "dCash", name: "Î” Cash", color: EVOLUTION_CHART_COLORS.cash },
    ...(hasSplit
      ? [
          { key: "dDividends", name: "Î” Dividendes", color: EVOLUTION_CHART_COLORS.dividends },
          { key: "dCoupons", name: "Î” Coupons", color: EVOLUTION_CHART_COLORS.coupons },
          { key: "dRents", name: "Î” Loyers", color: EVOLUTION_CHART_COLORS.rents },
        ]
      : [{ key: "dIncome", name: "Î” Revenus", color: EVOLUTION_CHART_COLORS.dividends }]),
    { key: "dRealized", name: "Î” RÃ©alisÃ©", color: EVOLUTION_CHART_COLORS.realized },
    { key: "dUnrealized", name: "Î” Latente", color: EVOLUTION_CHART_COLORS.unrealized },
  ] as const;

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
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            maxBarSize={24}
            stackId="delta"
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
