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
import {
  assetClassChartColor,
  assetClassLabel,
} from "@/app/lib/constants";
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

/** Couleur du texte de valeur : vert si positif, rouge si négatif, bleu si neutre (0). */
function signColor(v: number): string {
  if (v > 0) return "var(--success)";
  if (v < 0) return "var(--danger)";
  return "var(--accent)";
}

type EvolutionTooltipPayloadEntry = {
  value?: unknown;
  name?: unknown;
  payload?: EvolutionSeriesPoint;
};

/**
 * Tooltip custom (remplace le rendu par défaut de Recharts) : le texte reste
 * lisible en dark mode (couleurs pilotées par variables CSS thémées, pas de
 * couleur figée), et chaque valeur est colorée selon son signe.
 * Props volontairement typées large : reçoit tel quel l'objet que Recharts
 * passe au render-prop `content` du Tooltip.
 */
function EvolutionTooltipContent(props: {
  active?: boolean;
  payload?: readonly EvolutionTooltipPayloadEntry[];
  label?: unknown;
  baseCurrency: string;
}) {
  const { active, payload, label, baseCurrency } = props;
  if (!active || !payload || payload.length === 0) return null;
  const periodLabel = payload[0]?.payload?.periodLabel ?? label ?? "";
  return (
    <div style={{ ...tooltipStyle, padding: "8px 12px" }}>
      {periodLabel ? (
        <div
          style={{
            color: "var(--foreground)",
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          {String(periodLabel)}
        </div>
      ) : null}
      {payload.map((entry, i) => {
        const num = Number(entry.value ?? 0);
        return (
          <div key={i} style={{ color: signColor(num), whiteSpace: "nowrap" }}>
            {String(entry.name ?? "")}: {formatCurrency(num, baseCurrency)}
          </div>
        );
      })}
    </div>
  );
}

/** Domaine Y symétrique autour de 0 (variations +/− lisibles). */
/**
 * Plus petit palier « lisible » ≥ v, sur l'échelle 1 / 2 / 2,5 / 5 × 10ⁿ.
 * Borner à `maxAbs × 1,12` donnait des graduations comme 219,2 k ou 80,8 k :
 * exactes, mais illisibles sur un axe monétaire.
 */
function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const pow = Math.pow(10, exp);
  const frac = v / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return step * pow;
}

export function symmetricZeroDomain(
  values: number[],
  padRatio = 0.12
): [number, number] {
  let maxAbs = 0;
  for (const v of values) {
    if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
  }
  if (maxAbs <= 0) return [-1, 1];
  // Le palier arrondi englobe déjà les données ; il ne sert à rien d'y ajouter
  // la marge relative, sauf s'il tombe pile sur la valeur extrême.
  const nice = niceCeil(maxAbs);
  const bound = nice > maxAbs ? nice : niceCeil(maxAbs * (1 + padRatio));
  return [-bound, bound];
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
          content={(props: object) => (
            <EvolutionTooltipContent {...(props as { active?: boolean; payload?: readonly EvolutionTooltipPayloadEntry[]; label?: unknown })} baseCurrency={baseCurrency} />
          )}
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
          content={(props: object) => (
            <EvolutionTooltipContent {...(props as { active?: boolean; payload?: readonly EvolutionTooltipPayloadEntry[]; label?: unknown })} baseCurrency={baseCurrency} />
          )}
        />
        <Bar
          dataKey="total"
          name="Valeur"
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
          content={(props: object) => (
            <EvolutionTooltipContent {...(props as { active?: boolean; payload?: readonly EvolutionTooltipPayloadEntry[]; label?: unknown })} baseCurrency={baseCurrency} />
          )}
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
          content={(props: object) => (
            <EvolutionTooltipContent {...(props as { active?: boolean; payload?: readonly EvolutionTooltipPayloadEntry[]; label?: unknown })} baseCurrency={baseCurrency} />
          )}
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
          content={(props: object) => (
            <EvolutionTooltipContent {...(props as { active?: boolean; payload?: readonly EvolutionTooltipPayloadEntry[]; label?: unknown })} baseCurrency={baseCurrency} />
          )}
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
          content={(props: object) => (
            <EvolutionTooltipContent {...(props as { active?: boolean; payload?: readonly EvolutionTooltipPayloadEntry[]; label?: unknown })} baseCurrency={baseCurrency} />
          )}
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

/** Préfixe des clés de P&L par classe injectées dans les points du graphique. */
export const CLASS_PNL_KEY_PREFIX = "cls_";

export function classPnlKey(assetClass: string): string {
  return `${CLASS_PNL_KEY_PREFIX}${assetClass}`;
}

export function DecomposedPeriodChart({
  data,
  baseCurrency,
  style,
  /**
   * Classes d'actifs à empiler, par poids décroissant. Quand elle est fournie,
   * la décomposition se fait **par classe** (« −21 k actions, +30 k cryptos »)
   * plutôt que par contributeur comptable (Δ positions / Δ cash / Δ réalisé).
   *
   * C'est la lecture que demande un tableau de bord patrimonial : savoir *où*
   * la journée s'est jouée. La décomposition comptable reste le repli quand
   * les cours journaliers manquent — mieux vaut un découpage exact et moins
   * parlant qu'un découpage parlant et faux.
   */
  classes,
}: {
  data: EvolutionSeriesPoint[];
  baseCurrency: string;
  style: EvolutionChartStyle;
  classes?: string[];
}) {
  const hasSplit = data.some(
    (p) =>
      Math.abs(p.dDividends) > 0.01 ||
      Math.abs(p.dCoupons) > 0.01 ||
      Math.abs(p.dRents) > 0.01
  );

  const byClass = (classes ?? []).map((cls) => ({
    key: classPnlKey(cls),
    name: assetClassLabel(cls),
    color: assetClassChartColor(cls),
  }));

  // Latente en premier (centrée sur le repère jour), puis les autres critères
  const accountingSeries = [
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
  ];

  const series = byClass.length > 0 ? byClass : accountingSeries;

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
            content={(props: object) => (
              <EvolutionTooltipContent
                {...(props as {
                  active?: boolean;
                  payload?: readonly EvolutionTooltipPayloadEntry[];
                  label?: unknown;
                })}
                baseCurrency={baseCurrency}
              />
            )}
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

  // Colonnes empilées par signe — 0 au milieu, positifs au-dessus / négatifs en dessous
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/*
        `stackOffset="sign"` est indispensable : l'empilement par défaut somme
        les valeurs signées, donc un Δ Cash de −178 k venait s'annuler avec les
        Δ positifs et disparaissait du graphe (les rectangles se superposaient
        sur une hauteur nette). Avec "sign", les positifs s'empilent au-dessus de
        zéro et les négatifs en dessous : chaque composante reste visible et la
        lecture du signe est immédiate.
      */}
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
        stackOffset="sign"
      >
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
          content={(props: object) => (
            <EvolutionTooltipContent {...(props as { active?: boolean; payload?: readonly EvolutionTooltipPayloadEntry[]; label?: unknown })} baseCurrency={baseCurrency} />
          )}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        {/*
          Colonnes **empilées**, et non côte à côte.
          Auparavant chaque critère avait sa propre colonne : jusqu'à 7 barres
          par jour, groupe forcément décalé du repère et largeur qui s'effondrait
          à 1 px dès 3 mois (7 séries dans une bande de 110 px) — les barres
          devenaient des filets illisibles et débordaient sur le jour voisin.

          L'empilement rétablit une colonne unique par jour, centrée sur son
          repère par construction et de largeur indépendante du nombre de
          critères. C'est aussi le bon encodage pour une décomposition de P&L :
          les segments s'additionnent à la variation du jour. Recharts empile les
          valeurs positives au-dessus de zéro et les négatives en dessous, donc
          le signe reste lisible sans recolorier chaque cellule.
        */}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            stackId="pnl"
            maxBarSize={26}
            fillOpacity={0.9}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
