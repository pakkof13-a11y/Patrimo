"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  SPOT_RANGES,
  SPOT_RANGE_LABEL,
  type SpotRange,
} from "@/app/lib/crypto/spot-overview";
import type { SpotValuePoint } from "@/app/lib/crypto/spot-history-service";

/**
 * Évolution de la valeur de la poche comptant.
 *
 * Une courbe en euros, pas un indice : sur une poche crypto, la question est
 * « combien ça vaut, et depuis quand », et l'apport de capital se lit à côté
 * dans le capital investi. Le fil est fin et doré — la palette de l'application
 * réserve l'or à la valeur, le vert et le rouge au sens d'une variation.
 */

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${d}/${m}/${y}`;
}

function SpotTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: SpotValuePoint }[];
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
      <div style={{ color: "var(--foreground)", fontWeight: 600 }}>
        {formatCurrency(point.valueEur, "EUR")}
      </div>
      <div style={{ color: "var(--foreground-faint)" }}>
        {formatDayLabel(point.day)}
      </div>
    </div>
  );
}

export function SpotEvolutionCard({
  points,
  range,
  onRangeChange,
  coveragePct,
  hasAssets,
  loading,
  className,
}: {
  points: SpotValuePoint[];
  range: SpotRange;
  onRangeChange: (next: SpotRange) => void;
  /** Part des coins détenus dont l'historique est connu, en %. */
  coveragePct: number;
  /**
   * Y a-t-il seulement des positions ? Sans courbe, la cause n'est pas la même
   * — poche vide, ou poche pleine dont aucun cours n'est connu — et l'écran
   * doit nommer la bonne.
   */
  hasAssets: boolean;
  loading?: boolean;
  className?: string;
}) {
  const hasCurve = points.length >= 2;
  const first = points[0]?.valueEur ?? 0;
  const last = points[points.length - 1]?.valueEur ?? 0;
  // Le fil suit la pente de la fenêtre : doré quand la poche a progressé ou
  // stagné, rouge quand elle a reculé. Aucune autre couleur ne serait lisible
  // au premier coup d'œil.
  const stroke = last >= first ? "var(--chart-gold)" : "var(--chart-negative)";
  const partial = coveragePct > 0 && coveragePct < 99.5;

  return (
    <section
      className={cn("panel flex flex-col", className)}
      data-testid="spot-evolution-card"
      aria-labelledby="spot-evolution-heading"
    >
      <div className="panel-head flex-wrap gap-[var(--space-3)]">
        <div className="min-w-0">
          <h3 id="spot-evolution-heading" className="text-title">
            Évolution du portefeuille
          </h3>
          <p className="text-meta">
            Valeur de la poche comptant, clôture par clôture
          </p>
        </div>

        <div
          className="term-seg shrink-0"
          role="tablist"
          aria-label="Période affichée"
        >
          {SPOT_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              data-active={r === range ? "true" : "false"}
              className="term-seg-item"
              data-testid={`spot-range-${r}`}
              onClick={() => onRangeChange(r)}
            >
              {SPOT_RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body flex-1">
        {loading ? (
          <div
            className="h-[15rem] w-full animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-raised)]"
            aria-busy="true"
          />
        ) : !hasCurve ? (
          <div
            className="flex h-[15rem] flex-col items-center justify-center gap-[var(--space-2)] px-[var(--space-4)] text-center"
            data-testid="spot-evolution-unavailable"
          >
            <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
              Pas encore de quoi tracer une courbe
            </p>
            <p className="text-meta max-w-[34rem]">
              {hasAssets
                ? "Aucun de vos coins n'a de clôture journalière connue sur cette période. La courbe reviendra dès que les cours auront été récupérés — en attendant, mieux vaut ne rien tracer qu'une ligne à zéro."
                : "Elle se dessine à partir des clôtures journalières de vos coins. Il n'y a encore aucune position en comptant à suivre."}
            </p>
          </div>
        ) : (
          <>
            <div className="h-[15rem] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={points}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="spotEvolFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
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
                      const [y, m, d] = String(day).split("-");
                      // Sur une fenêtre courte, le mois seul ne distingue plus
                      // les points : on descend au jour.
                      return points.length <= 45
                        ? `${d}/${m}`
                        : `${m}/${y?.slice(2)}`;
                    }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    /*
                      Domaine resserré autour des valeurs observées : partir de
                      zéro écraserait la courbe d'une poche dont la valeur varie
                      de quelques pour cent, et l'écran ne montrerait plus qu'un
                      trait plat.
                    */
                    domain={[
                      (min: number) => min * 0.96,
                      (max: number) => max * 1.04,
                    ]}
                    tick={{ fill: "var(--foreground-faint)", fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      new Intl.NumberFormat("fr-FR", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(v)
                    }
                  />
                  <Tooltip
                    content={<SpotTooltip />}
                    cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                  />
                  {/*
                    Animation coupée : sous React 19, l'animation d'entrée de
                    Recharts laisse le tracé à longueur nulle — la courbe ne
                    se dessine jamais. Tout le dépôt fait ce choix.
                  */}
                  <Area
                    type="monotone"
                    dataKey="valueEur"
                    stroke={stroke}
                    strokeWidth={1.5}
                    fill="url(#spotEvolFill)"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {partial && (
              <p className="text-meta mt-[var(--space-2)]" data-testid="spot-evolution-coverage">
                La courbe décrit {Math.round(coveragePct)} % de vos coins : les
                autres n&apos;ont pas encore de clôture connue et sont absents du
                tracé, plutôt que comptés à zéro.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
