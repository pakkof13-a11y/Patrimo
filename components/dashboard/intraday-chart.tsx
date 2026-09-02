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
  isGap,
  signGradientStops,
  toChartPoints,
  toneAgainst,
  TONE_COLOR,
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
  reference,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  baseCurrency: string;
  /** Valeur de départ de la période — la référence des variations affichées. */
  reference: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const depuisDebut = point.netWorth - reference;
  const tone = toneAgainst(point.netWorth, reference);

  return (
    <div style={tooltipBoxStyle} data-testid="intraday-tooltip">
      <div
        style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 2 }}
        data-testid="intraday-tooltip-stamp"
      >
        {point.fullLabel}
      </div>

      <div style={{ color: "var(--muted-foreground)", fontSize: 11 }}>
        Patrimoine net
      </div>
      <div
        style={{ color: "var(--foreground)", fontWeight: 600, whiteSpace: "nowrap" }}
        data-testid="intraday-tooltip-value"
      >
        {formatCurrency(point.netWorth, baseCurrency)}
      </div>

      {/*
        Variation depuis le début de la période : c'est la grandeur que la
        couleur de la courbe exprime, et la voir chiffrée évite d'avoir à
        deviner ce que le vert ou le rouge veut dire.
      */}
      {reference !== point.netWorth ? (
        <div
          style={{ color: TONE_COLOR[tone], fontWeight: 600, marginTop: 3 }}
          data-testid="intraday-tooltip-change"
        >
          {depuisDebut >= 0 ? "+" : "−"}
          {formatCurrency(Math.abs(depuisDebut), baseCurrency)}
          <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
            {" "}
            depuis le début
          </span>
        </div>
      ) : null}

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
  stepMs,
}: {
  points: IntradayApiPoint[];
  extremes: IntradayApiExtremes | null;
  baseCurrency: string;
  /** Pas de la série, tel que l'API l'annonce — sert à reconnaître un trou. */
  stepMs: number;
}) {
  /*
    Une seule transformation, mémorisée : le crosshair bouge à chaque pixel, et
    reconstruire 400 points à chaque mouvement rendrait le survol pâteux.
  */
  const data = useMemo(() => toChartPoints(points), [points]);
  const ticks = useMemo(() => dayBoundaryTicks(data), [data]);

  /*
    La référence de couleur est la **valeur de départ de la période**.

    La courbe porte un patrimoine en valeur absolue, qui n'est jamais négatif :
    colorer la valeur elle-même n'aurait aucun sens. Ce qui se lit en vert ou
    en rouge est donc la position par rapport au point de départ — et jamais
    la valeur finale, qui peindrait toute la série d'une seule couleur.
  */
  const reference = data[0]?.netWorth ?? 0;

  const stops = useMemo(
    () => signGradientStops(data, reference),
    [data, reference]
  );

  /*
    Un trou n'est pas une observation.

    Recharts interrompt le tracé sur une valeur `null` : les points encadrant
    une absence prolongée reçoivent donc une série coupée, plutôt qu'un trait
    plein qui laisserait croire à une continuité observée. La donnée reçue
    n'est pas modifiée — seule la ligne s'interrompt.
  */
  const series = useMemo(() => {
    const out: Array<
      (IntradayChartPoint & { netWorth: number | null }) | { t: number; netWorth: null }
    > = [];
    for (let i = 0; i < data.length; i++) {
      const p = data[i]!;
      const previous = data[i - 1];
      if (previous && isGap(previous.t, p.t, stepMs)) {
        /*
          Une entrée sans valeur, posée au milieu de l'absence : Recharts
          interrompt le tracé dessus. Elle ne porte aucune donnée et n'est pas
          survolable — c'est une coupure de ligne, pas un point inventé.
        */
        out.push({ t: previous.t + (p.t - previous.t) / 2, netWorth: null });
      }
      out.push(p);
    }
    return out;
  }, [data, stepMs]);

  const tone = toneAgainst(
    data[data.length - 1]?.netWorth ?? reference,
    reference
  );

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
      <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {/*
            Dégradé **horizontal** : la couleur suit le temps, pas la hauteur.
            C'est ce qui permet à une même courbe d'être verte, puis rouge,
            puis verte, sans dédoubler la série ni changer de primitive.
          */}
          <linearGradient id="intraday-sign-stroke" x1="0" y1="0" x2="1" y2="0">
            {stops.map((s, i) => (
              <stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} />
            ))}
          </linearGradient>
          {/* L'aire garde la teinte d'ensemble, très atténuée : deux dégradés
              francs superposés rendraient la lecture confuse. */}
          <linearGradient id="intraday-value-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE_COLOR[tone]} stopOpacity={0.16} />
            <stop offset="100%" stopColor={TONE_COLOR[tone]} stopOpacity={0} />
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
              reference={reference}
            />
          )}
        />

        <Area
          type="linear"
          dataKey="netWorth"
          stroke="url(#intraday-sign-stroke)"
          strokeWidth={1.75}
          fill="url(#intraday-value-fill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
          // Une absence prolongée coupe la ligne au lieu de la relier.
          connectNulls={false}
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
