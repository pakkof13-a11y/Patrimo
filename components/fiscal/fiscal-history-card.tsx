"use client";

/**
 * Évolution pluriannuelle de la base imposable.
 *
 * Le graphe répond à une question précise — « pourquoi ma fiscalité bouge ? »
 * — et non au vague « évolution fiscale ». D'où deux séries superposées plutôt
 * qu'une : les plus-values réalisées et les revenus encaissés, dont la somme
 * fait l'assiette. Une année chargée en ventes ne se lit pas comme une année
 * riche en dividendes, et la barre le montre.
 *
 * La courbe de PFU estimé se superpose en repère. Elle n'est **pas** l'impôt
 * total : elle ne couvre que CTO, crypto et CFD.
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/app/lib/utils";
import type { FiscalHistoryPoint } from "@/app/lib/tax/overview";

function HistoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: FiscalHistoryPoint }[];
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
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
      <div style={{ color: "var(--foreground-faint)", marginBottom: 4 }}>
        {p.year}
      </div>
      <div style={{ color: "var(--foreground)" }}>
        {formatCurrency(String(p.realizedPnlEur), "EUR")} de plus-values
      </div>
      <div style={{ color: "var(--foreground)" }}>
        {formatCurrency(String(p.dividendsNetEur), "EUR")} de revenus
      </div>
      <div style={{ color: "var(--foreground-faint)", marginTop: 4 }}>
        PFU estimé {formatCurrency(String(p.estimatedPfuEur), "EUR")}
      </div>
    </div>
  );
}

export function FiscalHistoryCard({
  points,
  currency,
}: {
  points: FiscalHistoryPoint[];
  currency: string;
}) {
  const compact = (v: number) =>
    Math.abs(v) >= 1000
      ? `${Math.round(v / 1000)} k€`
      : formatCurrency(String(v), currency);

  return (
    <section className="panel p-[var(--space-4)]" data-testid="fiscal-history">
      <header className="mb-[var(--space-3)]">
        <h2 className="text-label">D&apos;où vient la fiscalité, année par année</h2>
        <p className="text-meta mt-[var(--space-px)]">
          Plus-values réalisées et revenus encaissés — les deux composantes de
          l&apos;assiette. La ligne trace le PFU estimé, qui ne couvre que CTO,
          crypto et CFD.
        </p>
      </header>

      {points.length < 2 ? (
        <p
          className="text-meta py-[var(--space-6)] text-center"
          data-testid="fiscal-history-empty"
        >
          Une seule année d&apos;historique pour l&apos;instant — la comparaison
          apparaîtra dès qu&apos;une deuxième année portera des opérations.
        </p>
      ) : (
        <div className="h-[13rem] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: "var(--foreground-faint)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--foreground-faint)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={compact}
                width={56}
              />
              <Tooltip content={<HistoryTooltip />} cursor={false} />
              <Bar
                dataKey="realizedPnlEur"
                stackId="base"
                fill="var(--chart-1)"
                radius={[0, 0, 0, 0]}
                name="Plus-values"
              />
              <Bar
                dataKey="dividendsNetEur"
                stackId="base"
                fill="var(--chart-2)"
                radius={[3, 3, 0, 0]}
                name="Revenus"
              />
              <Line
                type="monotone"
                dataKey="estimatedPfuEur"
                stroke="var(--foreground-faint)"
                strokeWidth={1.5}
                dot={false}
                name="PFU estimé"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
