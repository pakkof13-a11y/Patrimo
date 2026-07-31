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
import { cn } from "@/app/lib/utils";
import {
  PERF_RANGES,
  PERF_RANGE_LABEL,
  type PerfRange,
  type PerformancePoint,
} from "@/app/lib/life-insurance/performance";

/**
 * Courbe de performance de l'enveloppe.
 *
 * Elle trace un **rendement**, pas une valeur : l'axe est en pourcentage
 * depuis le début de la fenêtre, et un versement n'y produit aucun saut (voir
 * `performance.ts`). C'est ce qui permet de comparer deux périodes de tailles
 * différentes, ou son contrat à un fonds euro de marché.
 *
 * Quand aucun support n'a d'historique de cours — le cas d'un contrat tout en
 * fonds euro saisi à la main — il n'y a pas de courbe plate à montrer : il n'y
 * a pas de courbe. La carte le dit alors en toutes lettres.
 */

function formatSignedPct(v: number, digits = 2): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${d}/${m}/${y}`;
}

function PerfTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: PerformancePoint }[];
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
      <div
        style={{
          color:
            point.cumulativePct >= 0
              ? "var(--chart-positive)"
              : "var(--chart-negative)",
          fontWeight: 600,
        }}
      >
        {formatSignedPct(point.cumulativePct)}
      </div>
    </div>
  );
}

export function AvPerformanceCard({
  points,
  range,
  onRangeChange,
  performancePct,
  coveragePct,
  loading,
  className,
}: {
  points: PerformancePoint[];
  range: PerfRange;
  onRangeChange: (next: PerfRange) => void;
  performancePct: number | null;
  /** Part de l'encours couverte par un historique de cours. */
  coveragePct: number;
  loading?: boolean;
  className?: string;
}) {
  const up = (performancePct ?? 0) >= 0;
  const stroke = up ? "var(--chart-positive)" : "var(--chart-negative)";
  const hasCurve = points.length >= 2;

  return (
    <section
      className={cn("panel flex flex-col", className)}
      data-testid="av-performance-card"
      aria-labelledby="av-performance-heading"
    >
      <div className="panel-head flex-wrap gap-[var(--space-3)]">
        <div className="min-w-0">
          <h3 id="av-performance-heading" className="text-title">
            Performance
          </h3>
          {hasCurve && performancePct != null && (
            <p className="text-meta">
              <span className={up ? "val-positive" : "val-negative"}>
                {formatSignedPct(performancePct)}
              </span>{" "}
              sur la période — hors versements et rachats
            </p>
          )}
        </div>

        <div
          className="term-seg shrink-0"
          role="tablist"
          aria-label="Période de la performance"
        >
          {PERF_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              data-active={r === range ? "true" : "false"}
              className="term-seg-item"
              data-testid={`av-perf-range-${r}`}
              onClick={() => onRangeChange(r)}
            >
              {PERF_RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body flex-1">
        {loading ? (
          <div
            className="h-[13rem] w-full animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-sunken)]"
            aria-busy="true"
          />
        ) : !hasCurve ? (
          <div
            className="flex h-[13rem] flex-col items-center justify-center gap-[var(--space-2)] px-[var(--space-4)] text-center"
            data-testid="av-performance-unavailable"
          >
            <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
              Performance non mesurable sur cette période
            </p>
            <p className="text-meta max-w-[34rem]">
              Aucun support de l&apos;enveloppe n&apos;a d&apos;historique de
              cours : un fonds en euros valorisé à la main n&apos;a pas de
              valeur d&apos;hier, donc pas de rendement d&apos;aujourd&apos;hui.
              Les unités de compte cotées alimenteront cette courbe dès le
              premier relevé de cours.
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
                    <linearGradient id="avPerfFill" x1="0" y1="0" x2="0" y2="1">
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
                      const [, m, d] = String(day).split("-");
                      return `${d}/${m}`;
                    }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tick={{ fill: "var(--foreground-faint)", fontSize: 11 }}
                    tickFormatter={(v: number) => formatSignedPct(v, 0)}
                  />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Tooltip
                    content={<PerfTooltip />}
                    cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativePct"
                    stroke={stroke}
                    strokeWidth={1.5}
                    fill="url(#avPerfFill)"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {coveragePct < 99.5 && (
              <p className="text-meta mt-[var(--space-2)]">
                Cette courbe décrit{" "}
                {coveragePct.toLocaleString("fr-FR", {
                  maximumFractionDigits: 0,
                })}{" "}
                % de l&apos;encours — la part valorisée par des cours. Les
                supports saisis à la main en sont exclus plutôt que comptés à
                rendement nul.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
