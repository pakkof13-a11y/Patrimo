"use client";

/**
 * Courbe intraday du patrimoine — présentation pure.
 *
 * Ne calcule aucune valeur : elle trace ce que `/api/portfolio/intraday` a
 * renvoyé, et rien d'autre. Les extrêmes et le repli viennent du contrat, pas
 * d'un parcours de la série réduite — le refaire ici ferait dépendre le creux
 * du nombre de points affichés.
 *
 * Tracé **linéaire**, jamais incurvé, pour la même raison que la courbe
 * quotidienne : une spline dessinerait entre deux observations des valeurs que
 * le patrimoine n'a jamais prises. Sur une série creuse — et une collecte
 * horaire l'est par nature — cela inventerait exactement ce que le moteur
 * s'interdit de fabriquer.
 */

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/app/lib/utils";
import { yTick } from "@/components/dashboard/portfolio-evolution-charts";
import {
  dayBoundaryTicks,
  formatIntradayDay,
  toChartPoints,
  type IntradayApiExtremes,
  type IntradayApiPoint,
  type IntradayChartPoint,
} from "@/app/lib/portfolio/intraday-view";

const tooltipBoxStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--card)",
  fontSize: 12,
  padding: "8px 12px",
};

type TooltipEntry = { value?: unknown; payload?: IntradayChartPoint };

/**
 * Info-bulle : valeur, horodatage, et statut lorsqu'il mérite d'être dit.
 *
 * « Estimé » n'apparaît que sur un point estimé, et sans dramatiser : le report
 * d'un cours de vendredi soir un dimanche est une valeur juste, simplement pas
 * observée à cet instant. Un avertissement sur chaque point rendrait
 * l'information invisible à force d'être répétée.
 */
function IntradayTooltip({
  active,
  payload,
  baseCurrency,
  stroke,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  baseCurrency: string;
  stroke: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div style={tooltipBoxStyle} data-testid="intraday-tooltip">
      <div
        style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 2 }}
        data-testid="intraday-tooltip-stamp"
      >
        {point.fullLabel}
      </div>
      <div
        style={{ color: stroke, fontWeight: 600, whiteSpace: "nowrap" }}
        data-testid="intraday-tooltip-value"
      >
        {formatCurrency(point.netWorth, baseCurrency)}
      </div>
      {point.status === "ESTIMATED" ? (
        <div
          style={{ color: "var(--muted-foreground)", marginTop: 3 }}
          data-testid="intraday-tooltip-status"
        >
          Estimé
          {point.estimatedComponents.length > 0
            ? ` · ${point.estimatedComponents.join(", ")}`
            : null}
        </div>
      ) : null}
    </div>
  );
}

export function IntradayChart({
  points,
  extremes,
  baseCurrency,
}: {
  points: IntradayApiPoint[];
  extremes: IntradayApiExtremes | null;
  baseCurrency: string;
}) {
  /*
    Une seule transformation, mémorisée : le crosshair bouge à chaque pixel, et
    reconstruire 400 points à chaque mouvement rendrait le survol pâteux.
  */
  const data = useMemo(() => toChartPoints(points), [points]);
  const ticks = useMemo(() => dayBoundaryTicks(data), [data]);

  const first = data[0]?.netWorth ?? 0;
  const last = data[data.length - 1]?.netWorth ?? 0;
  const stroke = last >= first ? "var(--success)" : "var(--danger)";

  /*
    Sommet et creux sont repérés par leur horodatage, pas par une recherche de
    valeur : l'API les a mesurés sur la série complète, et deux points peuvent
    porter la même valeur.
  */
  const peak = useMemo(
    () => (extremes ? data.find((p) => p.at === extremes.max.at) ?? null : null),
    [data, extremes]
  );
  const trough = useMemo(
    () => (extremes ? data.find((p) => p.at === extremes.min.at) ?? null : null),
    [data, extremes]
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="intraday-value-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />

        {/*
          Axe temporel réel : `type="number"` sur l'horodatage, pas une
          catégorie. Un trou de six heures occupe alors six heures de large, au
          lieu d'être ramené au même pas que les autres.
        */}
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={ticks}
          tickFormatter={(v: number) => formatIntradayDay(new Date(v).toISOString())}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
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
          // Le trait vertical du crosshair : discret, pour ne pas masquer la
          // courbe qu'il sert à lire.
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
          content={(props: object) => (
            <IntradayTooltip
              {...(props as { active?: boolean; payload?: readonly TooltipEntry[] })}
              baseCurrency={baseCurrency}
              stroke={stroke}
            />
          )}
        />

        <Area
          type="linear"
          dataKey="netWorth"
          stroke={stroke}
          strokeWidth={1.75}
          fill="url(#intraday-value-fill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
        />

        {/* Sommet et creux : deux repères discrets, pas des annotations. */}
        {peak ? (
          <ReferenceDot
            x={peak.t}
            y={peak.netWorth}
            r={3}
            fill="var(--success)"
            stroke="var(--card)"
            strokeWidth={1.5}
          />
        ) : null}
        {trough ? (
          <ReferenceDot
            x={trough.t}
            y={trough.netWorth}
            r={3}
            fill="var(--danger)"
            stroke="var(--card)"
            strokeWidth={1.5}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
