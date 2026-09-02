"use client";

/**
 * Graphique évolution portefeuille — extrait du panel pour lisibilité.
 * Pure présentation (Recharts) ; agrégation et préférences restent dans le
 * panel. Deux modes seulement, jamais mélangés sur le même axe :
 * - valeur (devise) : `PortfolioValueChart`
 * - performance (%, portefeuille vs benchmark rebasés à 0) : `PortfolioPercentChart`
 */
import {
  ResponsiveContainer,
  Tooltip,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import { formatCurrency } from "@/app/lib/utils";
import type {
  EvolutionPercentPoint,
  EvolutionSeriesPoint,
} from "@/app/lib/portfolio/evolution-aggregate";

export function yTick(v: number) {
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(v);
}

export function formatSignedPct(v: number): string {
  const s = v.toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${v >= 0 ? "+" : ""}${s} %`;
}

/**
 * `0` n'est affiché que s'il est une vraie valeur. Une absence se dit
 * « indisponible », jamais « 0 % ».
 */
export function formatPctOrUnavailable(
  value: unknown,
  unavailableLabel: string
): string {
  if (value == null || value === "") return unavailableLabel;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return unavailableLabel;
  return formatSignedPct(n);
}

export function inflationUnavailableLabel(benchmarkName: string): string {
  return /inflation/i.test(benchmarkName)
    ? "Inflation indisponible"
    : `${benchmarkName} indisponible`;
}

const tooltipBoxStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--card)",
  fontSize: 12,
  padding: "8px 12px",
};

/**
 * Plus petit palier « lisible » ≥ v, sur l'échelle 1 / 2 / 2,5 / 5 × 10ⁿ.
 * Borner à `maxAbs × 1,12` donnait des graduations comme 219,2 k ou 80,8 k :
 * exactes, mais illisibles sur un axe monétaire ou en pourcentage.
 */
function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const pow = Math.pow(10, exp);
  const frac = v / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return step * pow;
}

/** Domaine Y symétrique autour de 0 — variations +/− lisibles, palier arrondi. */
export function symmetricZeroDomain(
  values: number[],
  padRatio = 0.12
): [number, number] {
  let maxAbs = 0;
  for (const v of values) {
    if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  }
  if (maxAbs <= 0) return [-1, 1];
  const nice = niceCeil(maxAbs);
  const bound = nice > maxAbs ? nice : niceCeil(maxAbs * (1 + padRatio));
  return [-bound, bound];
}

type ValueTooltipEntry = { value?: unknown; payload?: EvolutionSeriesPoint };

function ValueTooltip({
  active,
  payload,
  baseCurrency,
  stroke,
}: {
  active?: boolean;
  payload?: readonly ValueTooltipEntry[];
  baseCurrency: string;
  stroke: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  const value = Number(payload[0]?.value ?? 0);
  return (
    <div style={tooltipBoxStyle}>
      {point?.periodLabel ? (
        <div
          style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 2 }}
        >
          {point.periodLabel}
        </div>
      ) : null}
      <div style={{ color: stroke, fontWeight: 600, whiteSpace: "nowrap" }}>
        {formatCurrency(value, baseCurrency)}
      </div>
    </div>
  );
}

/**
 * Courbe de valeur — mode par défaut (Versus = Aucun). Ligne unique, teinte
 * dérivée du sens global de la période (hausse/baisse), aire dégradée en
 * dessous.
 *
 * Tracé **linéaire**, jamais incurvé : la courbe porte une valeur quotidienne
 * réelle par point, et une interpolation en spline dessinerait entre deux jours
 * des valeurs que le patrimoine n'a jamais prises. Sur une série dense c'est
 * imperceptible ; sur une série creuse, cela invente exactement ce que le
 * moteur s'interdit de fabriquer.
 */
export function PortfolioValueChart({
  data,
  baseCurrency,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
}) {
  const first = data[0]?.total ?? 0;
  const last = data[data.length - 1]?.total ?? 0;
  const stroke = last >= first ? "var(--success)" : "var(--danger)";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="evolution-value-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={54}
          axisLine={false}
          tickLine={false}
          domain={["auto", "auto"]}
        />
        <Tooltip
          content={(props: object) => (
            <ValueTooltip
              {...(props as { active?: boolean; payload?: readonly ValueTooltipEntry[] })}
              baseCurrency={baseCurrency}
              stroke={stroke}
            />
          )}
        />
        <Area
          type="linear"
          dataKey="total"
          stroke={stroke}
          // Trait fin : une série quotidienne compte des centaines de points,
          // un tracé épais les empâte en un ruban.
          strokeWidth={1.75}
          fill="url(#evolution-value-fill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

type PercentTooltipEntry = {
  value?: unknown;
  name?: unknown;
  color?: string;
  payload?: EvolutionPercentPoint;
};

function PercentTooltip({
  active,
  payload,
  benchmarkName,
}: {
  active?: boolean;
  payload?: readonly PercentTooltipEntry[];
  benchmarkName: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  const missing = inflationUnavailableLabel(benchmarkName);
  const portfolio = point?.portfolioPct;
  const inflation = point?.benchmarkPct;
  const gap =
    Number.isFinite(portfolio) && Number.isFinite(inflation)
      ? (portfolio as number) - (inflation as number)
      : null;
  return (
    <div style={tooltipBoxStyle} data-testid="evolution-percent-tooltip">
      {point?.periodLabel ? (
        <div
          style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 2 }}
        >
          {point.periodLabel}
        </div>
      ) : null}
      <div style={{ color: "var(--foreground)", whiteSpace: "nowrap" }}>
        Portefeuille : {formatPctOrUnavailable(portfolio, "indisponible")}
      </div>
      <div
        style={{ color: "var(--chart-inflation)", whiteSpace: "nowrap" }}
        data-testid="evolution-tooltip-inflation"
      >
        {benchmarkName} : {formatPctOrUnavailable(inflation, missing)}
      </div>
      {gap != null ? (
        <div
          style={{ color: "var(--muted-foreground)", whiteSpace: "nowrap" }}
          data-testid="evolution-tooltip-gap"
        >
          Écart : {formatSignedPct(gap)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Courbe de performance — mode Versus actif. Portefeuille et benchmark
 * rebasés à 0 % au premier point affiché, seul moyen de les comparer sans
 * mélanger devise et pourcentage sur le même axe.
 */
export function PortfolioPercentChart({
  data,
  benchmarkName,
}: {
  data: EvolutionPercentPoint[];
  benchmarkName: string;
}) {
  const hasBenchmark = data.some((p) => p.benchmarkPct != null);
  const first = data[0]?.portfolioPct ?? 0;
  const last = data[data.length - 1]?.portfolioPct ?? 0;
  const stroke = last >= first ? "var(--success)" : "var(--danger)";
  const yDomain = symmetricZeroDomain(
    data.flatMap((p) => [p.portfolioPct, p.benchmarkPct ?? 0])
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="evolution-percent-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.2} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={(v: number) => `${v.toFixed(0)} %`}
          width={48}
          axisLine={false}
          tickLine={false}
          domain={yDomain}
          allowDataOverflow
        />
        <ReferenceLine
          y={0}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.6}
          strokeDasharray="4 4"
        />
        <Tooltip
          content={(props: object) => (
            <PercentTooltip
              {...(props as { active?: boolean; payload?: readonly PercentTooltipEntry[] })}
              benchmarkName={benchmarkName}
            />
          )}
        />
        {hasBenchmark && (
          <Legend
            verticalAlign="top"
            height={28}
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11 }}
          />
        )}
        <Area
          type="linear"
          dataKey="portfolioPct"
          name="Portefeuille"
          stroke={stroke}
          strokeWidth={1.75}
          fill="url(#evolution-percent-fill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
        />
        {hasBenchmark && (
          <Line
            type="linear"
            dataKey="benchmarkPct"
            name={benchmarkName}
            stroke="var(--chart-inflation)"
            /* Plus fin que le portefeuille ; trait plein — les pointillés gris
               le faisaient passer pour une grille, pas pour une série. */
            strokeWidth={1.15}
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
