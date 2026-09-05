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
  Bar,
  Cell,
} from "recharts";
import { formatCurrency } from "@/app/lib/utils";
import type {
  EvolutionPercentPoint,
  EvolutionSeriesPoint,
} from "@/app/lib/portfolio/evolution-aggregate";
import type { DailyNavChartPoint } from "@/app/lib/portfolio/daily-nav-view";

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tick d'un axe temporel — granularité selon l'étendue de la fenêtre. */
export function formatTimeTick(ms: number, spanMs: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (spanMs <= 45 * DAY_MS) {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "numeric",
      month: "short",
    }).format(d);
  }
  if (spanMs <= 400 * DAY_MS) {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "numeric",
      month: "short",
    }).format(d);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    month: "short",
    year: "2-digit",
  }).format(d);
}

function TimeXAxis({ data }: { data: Array<{ t?: number; date?: string }> }) {
  const times = data
    .map((p) => p.t ?? (p.date ? Date.parse(p.date) : NaN))
    .filter((t) => Number.isFinite(t));
  const span =
    times.length >= 2 ? times[times.length - 1]! - times[0]! : DAY_MS;
  return (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={["dataMin", "dataMax"]}
      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
      tickFormatter={(ms: number) => formatTimeTick(ms, span)}
      axisLine={false}
      tickLine={false}
      minTickGap={40}
    />
  );
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

/**
 * Fraction de la hauteur du cadre réservée au bandeau des barres Δ marché.
 * La NAV occupe les `1 − f` du haut, l'histogramme les `f` du bas ; les deux
 * axes ne partagent plus le même domaine vertical, donc plus une seule barre
 * ne traverse l'aire.
 */
export const DELTA_BAND_FRACTION = 0.28;

export type NavDeltaBandDomains = {
  /** Domaine de l'axe NAV — `[nMin − span·f/(1−f), nMax]`. Jamais calé à 0. */
  navDomain: [number, number];
  /** Domaine de l'axe Δ — `[−M, M·(2/f − 1)]`. Zéro à `f/2`, `+M` à `f`. */
  deltaDomain: [number, number];
  /** `max(|Δ|)` réellement observé — 0 quand la fenêtre ne bouge pas. */
  deltaMax: number;
};

/**
 * Deux domaines Y disjoints pour la vue NAV + Δ marché.
 *
 * Barres : valeurs dans `[−M, +M]`, `M = max(|Δ|)`. Poser
 * `deltaDomain = [−M, M(2/f − 1)]` amène `−M` en bas du cadre, `+M` à la
 * fraction `f` et le zéro à `f/2` : un bandeau bas centré sur zéro.
 * Aucune barre ne dépasse `M`, donc aucun écrêtage — pas de
 * `allowDataOverflow`, une barre tronquée serait un mensonge.
 *
 * NAV : `navDomain = [nMin − (nMax − nMin)·f/(1−f), nMax]` place `nMin` pile
 * à la fraction `f`. La courbe effleure le haut du bandeau sans y entrer.
 *
 * Échelle linéaire calée sur le max, jamais log ni percentile : sur les vraies
 * données `max|Δ| / médiane|Δ| ≈ ×6`, la barre médiane reste donc lisible.
 */
export function navDeltaBandDomains(
  points: readonly { total: number; delta: number }[],
  fraction: number = DELTA_BAND_FRACTION
): NavDeltaBandDomains {
  const f =
    Number.isFinite(fraction) && fraction > 0 && fraction < 1
      ? fraction
      : DELTA_BAND_FRACTION;

  let deltaMax = 0;
  let navMin = Number.POSITIVE_INFINITY;
  let navMax = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (Number.isFinite(p.delta)) {
      deltaMax = Math.max(deltaMax, Math.abs(p.delta));
    }
    if (Number.isFinite(p.total)) {
      navMin = Math.min(navMin, p.total);
      navMax = Math.max(navMax, p.total);
    }
  }

  // Fenêtre vide (ou sans NAV finie) : cadre unitaire, jamais NaN.
  if (navMin > navMax) {
    navMin = 0;
    navMax = 1;
  }
  // Série plate : un span nul écraserait l'axe. On en fabrique un, centré,
  // pour que le trait se pose au-dessus du bandeau au lieu de coller au bord.
  if (navMax === navMin) {
    const pad = Math.max(Math.abs(navMax), 1) * 0.02;
    navMin -= pad;
    navMax += pad;
  }

  // Aucun mouvement de marché : le bandeau existe quand même, barres à zéro.
  const bound = deltaMax > 0 ? deltaMax : 1;
  const navSpan = navMax - navMin;

  return {
    navDomain: [navMin - navSpan * (f / (1 - f)), navMax],
    deltaDomain: [-bound, bound * (2 / f - 1)],
    deltaMax,
  };
}

type DailyNavTooltipEntry = {
  value?: unknown;
  payload?: DailyNavChartPoint;
};

function signedMoney(value: number, currency: string): string {
  const abs = formatCurrency(Math.abs(value), currency);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

function DailyNavTooltip({
  active,
  payload,
  baseCurrency,
  stroke,
}: {
  active?: boolean;
  payload?: readonly DailyNavTooltipEntry[];
  baseCurrency: string;
  stroke: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload.find((e) => e.payload)?.payload;
  if (!point) return null;
  const showBreakdown = point.delta !== 0 || point.flux !== 0;
  return (
    <div style={tooltipBoxStyle} data-testid="evolution-daily-tooltip">
      {point.periodLabel ? (
        <div
          style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 2 }}
        >
          {point.periodLabel}
        </div>
      ) : null}
      <div style={{ color: stroke, fontWeight: 600, whiteSpace: "nowrap" }}>
        {formatCurrency(point.total, baseCurrency)}
      </div>
      {showBreakdown ? (
        <>
          <div
            data-testid="evolution-tooltip-market"
            style={{
              color:
                point.delta >= 0 ? "var(--success)" : "var(--danger)",
              fontWeight: 500,
              whiteSpace: "nowrap",
              marginTop: 4,
            }}
          >
            Performance {signedMoney(point.delta, baseCurrency)}
          </div>
          <div
            data-testid="evolution-tooltip-flux"
            style={{
              color: "var(--muted-foreground)",
              fontWeight: 500,
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
          >
            Capital investi {signedMoney(point.flux, baseCurrency)}
          </div>
        </>
      ) : null}
    </div>
  );
}

type ValueTooltipEntry = {
  value?: unknown;
  payload?: EvolutionSeriesPoint & { delta?: number; day?: string };
};

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
      {typeof point?.delta === "number" && point.delta !== 0 ? (
        <div
          style={{
            color:
              point.delta >= 0 ? "var(--success)" : "var(--danger)",
            fontWeight: 500,
            whiteSpace: "nowrap",
            marginTop: 2,
          }}
        >
          Δ jour {formatCurrency(point.delta, baseCurrency)}
        </div>
      ) : null}
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
        <TimeXAxis data={data} />
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
        <TimeXAxis data={data} />
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

/**
 * Courbe NAV dense (getDailyNav) + barres de Δ **marché**.
 *
 * Trait linéaire, closes réels seulement. Les barres somment (hors ancre) au
 * Δ marché d'en-tête, pas au Δ NAV brut : `sum(marché) ≈ (last−first) − Σ flux`.
 * Un APPORT crée du Flux au survol, pas une barre de performance.
 */
export function DailyNavChart({
  data,
  baseCurrency,
}: {
  data: DailyNavChartPoint[];
  baseCurrency: string;
}) {
  const first = data[0]?.total ?? 0;
  const last = data[data.length - 1]?.total ?? 0;
  const stroke = last >= first ? "var(--success)" : "var(--danger)";
  const { navDomain, deltaDomain, deltaMax } = navDeltaBandDomains(data);

  return (
    <div className="h-full w-full" data-testid="daily-nav-chart">
      <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="daily-nav-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <TimeXAxis data={data} />
        <YAxis
          yAxisId="nav"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={54}
          axisLine={false}
          tickLine={false}
          domain={navDomain}
        />
        <YAxis
          yAxisId="delta"
          orientation="right"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickFormatter={yTick}
          width={44}
          axisLine={false}
          tickLine={false}
          domain={deltaDomain}
          /*
            Trois graduations, et seulement trois : le haut du bandeau, son
            zéro, son bas. Les laisser en automatique aurait étalé des repères
            dans la moitié haute du domaine, là où aucune barre ne peut aller —
            l'axe aurait annoncé une échelle que l'histogramme n'occupe pas.
          */
          ticks={deltaMax > 0 ? [-deltaMax, 0, deltaMax] : [0]}
        />
        <Tooltip
          content={(props: object) => (
            <DailyNavTooltip
              {...(props as {
                active?: boolean;
                payload?: readonly DailyNavTooltipEntry[];
              })}
              baseCurrency={baseCurrency}
              stroke={stroke}
            />
          )}
        />
        {/*
          Le zéro des barres, tracé avant elles pour passer dessous.
          Sans ce repère, une barre courte vers le bas et une barre courte vers
          le haut se ressemblent : c'est lui qui donne son sens au signe.
        */}
        <ReferenceLine
          yAxisId="delta"
          y={0}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <Bar
          yAxisId="delta"
          dataKey="delta"
          name="Performance"
          isAnimationActive={false}
          maxBarSize={6}
        >
          {/*
            Une couleur par signe, et non un gris unique : une journée à
            −800 € et une à +800 € dessinaient la même barre, si bien que
            l'histogramme montrait l'amplitude du marché sans jamais dire
            dans quel sens il était allé.
          */}
          {data.map((p) => (
            <Cell
              key={p.periodLabel}
              fill={
                p.delta >= 0
                  ? "var(--chart-positive)"
                  : "var(--chart-negative)"
              }
              fillOpacity={0.75}
            />
          ))}
        </Bar>
        <Area
          yAxisId="nav"
          type="linear"
          dataKey="total"
          name="NAV"
          stroke={stroke}
          strokeWidth={1.75}
          fill="url(#daily-nav-fill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  );
}
