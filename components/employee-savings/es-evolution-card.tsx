"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  ES_RANGES,
  ES_RANGE_LABEL,
  type ContributionPoint,
  type EsRange,
} from "@/app/lib/employee-savings/overview";

/**
 * Évolution de l'épargne.
 *
 * Ce que la courbe trace demande une explication, et l'écran la donne : ce
 * sont les **versements cumulés**, seule série datée que le module possède.
 * Les valeurs liquidatives passées des FCPE ne sont enregistrées nulle part —
 * une ligne de valorisation historique serait une invention.
 *
 * La valeur d'aujourd'hui figure donc en repère horizontal : l'écart entre la
 * courbe et ce trait, c'est le gain, et il se lit sans calcul.
 */

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${d}/${m}/${y}`;
}

function EsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: ContributionPoint }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--card)",
        fontSize: 12,
        padding: "8px 12px",
      }}
    >
      <div style={{ color: "var(--foreground-faint)", marginBottom: 2 }}>
        {formatDayLabel(point.day)}
      </div>
      <div style={{ color: "var(--foreground)", fontWeight: 600 }}>
        {formatCurrency(point.cumulative, "EUR")} versés
      </div>
      {point.amount > 0 && (
        <div style={{ color: "var(--foreground-faint)" }}>
          dont {formatCurrency(point.amount, "EUR")} ce jour-là
        </div>
      )}
    </div>
  );
}

export function EsEvolutionCard({
  points,
  range,
  onRangeChange,
  currentValue,
  className,
}: {
  points: ContributionPoint[];
  range: EsRange;
  onRangeChange: (next: EsRange) => void;
  /** Valeur d'aujourd'hui — le repère auquel comparer les versements. */
  currentValue: number;
  className?: string;
}) {
  const hasCurve = points.length >= 2;
  const contributed = points.length > 0 ? points[points.length - 1]!.cumulative : 0;
  const gain = contributed > 0 ? currentValue - contributed : null;
  const stroke =
    gain == null || gain >= 0 ? "var(--chart-gold)" : "var(--chart-negative)";

  return (
    <section
      className={cn("panel flex flex-col", className)}
      data-testid="es-evolution-card"
      aria-labelledby="es-evolution-heading"
    >
      <div className="panel-head flex-wrap gap-[var(--space-3)]">
        <div className="min-w-0">
          <h3 id="es-evolution-heading" className="text-title">
            Évolution de la valeur
          </h3>
          <p className="text-meta">
            Versements cumulés, comparés à la valeur d&apos;aujourd&apos;hui
          </p>
        </div>

        <div
          className="term-seg shrink-0"
          role="tablist"
          aria-label="Période affichée"
        >
          {ES_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              data-active={r === range ? "true" : "false"}
              className="term-seg-item"
              data-testid={`es-range-${r}`}
              onClick={() => onRangeChange(r)}
            >
              {ES_RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body flex-1">
        {!hasCurve ? (
          <div
            className="flex h-[13rem] flex-col items-center justify-center gap-[var(--space-2)] px-[var(--space-4)] text-center"
            data-testid="es-evolution-unavailable"
          >
            <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
              Pas encore de quoi tracer une courbe
            </p>
            <p className="text-meta max-w-[34rem]">
              Elle se dessine à partir des montants versés et de leurs dates. Il
              en faut au moins deux — renseignez-les sur vos supports, dans la
              gestion.
            </p>
          </div>
        ) : (
          <>
            <div className="h-[13rem] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={points}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="esEvolFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stroke} stopOpacity={0.16} />
                      <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--chart-grid)"
                    strokeDasharray="2 4"
                  />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={48}
                    tick={{ fill: "var(--foreground-faint)", fontSize: 11 }}
                    tickFormatter={(day: string) => {
                      const [y, m] = String(day).split("-");
                      return `${m}/${y?.slice(2)}`;
                    }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    /*
                      Le domaine inclut la valeur actuelle : sans cela, quand
                      elle dépasse le dernier versement cumulé — c'est-à-dire
                      dès qu'il y a du gain — son repère tombait hors du
                      graphique et disparaissait sans rien dire.
                    */
                    domain={[
                      0,
                      (max: number) => Math.max(max, currentValue) * 1.08,
                    ]}
                    tick={{ fill: "var(--foreground-faint)", fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      new Intl.NumberFormat("fr-FR", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(v)
                    }
                  />
                  {currentValue > 0 && (
                    <ReferenceLine
                      y={currentValue}
                      stroke="var(--chart-positive)"
                      strokeDasharray="4 4"
                      label={{
                        value: "Valeur actuelle",
                        position: "insideTopRight",
                        fill: "var(--foreground-faint)",
                        fontSize: 11,
                      }}
                    />
                  )}
                  <Tooltip
                    content={<EsTooltip />}
                    cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                  />
                  {/*
                    Animation coupée : sous React 19, l'animation d'entrée de
                    Recharts laisse le tracé à longueur nulle — les points
                    s'affichent, la courbe non. Tout le dépôt fait ce choix.
                  */}
                  <Area
                    type="stepAfter"
                    dataKey="cumulative"
                    stroke={stroke}
                    strokeWidth={1.5}
                    fill="url(#esEvolFill)"
                    dot={{ r: 2, strokeWidth: 0, fill: stroke }}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <p className="text-meta mt-[var(--space-2)]">
              La courbe monte à chaque versement — elle ne suit pas les marchés.
              Les valeurs liquidatives passées des FCPE ne sont pas enregistrées,
              et l&apos;écart avec la ligne « valeur actuelle » vaut{" "}
              {gain != null ? (
                <span
                  className={cn(
                    "num",
                    gain >= 0 ? "val-positive" : "val-negative"
                  )}
                >
                  {gain >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(gain), "EUR")}
                </span>
              ) : (
                "le gain"
              )}
              .
            </p>
          </>
        )}
      </div>
    </section>
  );
}
