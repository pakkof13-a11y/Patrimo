"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { cn, formatCurrency } from "@/app/lib/utils";
import type {
  AllocationSlice,
  SavingsBucket,
} from "@/app/lib/life-insurance/overview";

/**
 * Répartition de l'épargne entre fonds en euros, unités de compte et
 * structurés.
 *
 * C'est la seule information de cet écran qui décrive un **risque** plutôt
 * qu'un montant : la couleur y porte donc du sens et rien d'autre. L'or est le
 * capital garanti, le bleu ce qui est exposé aux marchés, le gris ce qui
 * dépend d'une barrière. Deux chiffres suffisent à lire la carte, et ils sont
 * assez grands pour se lire de loin — le reste est en légende.
 */

const BUCKET_TONE: Record<SavingsBucket, string> = {
  FONDS_EURO: "var(--chart-gold)",
  UC: "var(--chart-cyan)",
  STRUCTURED: "var(--chart-neutral)",
};

function formatPct(v: number): string {
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`;
}

export function SavingsAllocationCard({
  allocation,
  className,
}: {
  allocation: AllocationSlice[];
  className?: string;
}) {
  const drawable = allocation.filter((a) => a.valueEur > 0);
  const total = drawable.reduce((s, a) => s + a.valueEur, 0);

  return (
    <section
      className={cn("panel flex flex-col", className)}
      data-testid="av-allocation-card"
      aria-labelledby="av-allocation-heading"
    >
      <div className="panel-head">
        <h3 id="av-allocation-heading" className="text-title">
          Répartition de l&apos;épargne
        </h3>
      </div>

      <div className="panel-body flex flex-1 items-center">
        {drawable.length === 0 ? (
          <p className="text-meta w-full py-[var(--space-8)] text-center">
            Les poches d&apos;épargne apparaîtront dès le premier support saisi.
          </p>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-center gap-[var(--space-5)] sm:flex-nowrap sm:justify-between">
            <div
              className="relative h-[9.5rem] w-[9.5rem] shrink-0"
              aria-hidden
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={drawable}
                    dataKey="valueEur"
                    nameKey="label"
                    innerRadius="66%"
                    outerRadius="100%"
                    paddingAngle={1.5}
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {drawable.map((slice) => (
                      <Cell
                        key={slice.bucket}
                        fill={BUCKET_TONE[slice.bucket]}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/*
              La légende double le graphique en texte : un anneau seul n'est
              pas lisible au lecteur d'écran, et deux poches de teintes proches
              ne se distinguent pas sur un écran mal calibré.
            */}
            <ul
              className="flex min-w-0 flex-1 flex-col gap-[var(--space-3)]"
              data-testid="av-allocation-legend"
            >
              {drawable.map((slice) => (
                <li
                  key={slice.bucket}
                  className="flex min-w-0 items-baseline gap-[var(--space-3)]"
                  data-testid={`av-allocation-${slice.bucket.toLowerCase()}`}
                >
                  <span
                    className="mt-[0.35rem] h-[0.5rem] w-[0.5rem] shrink-0 rounded-full"
                    style={{ background: BUCKET_TONE[slice.bucket] }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-label truncate">{slice.label}</p>
                    <p className="num text-[length:var(--text-xs)] text-[var(--foreground-faint)]">
                      {formatCurrency(slice.valueEur, "EUR")}
                    </p>
                  </div>
                  <span
                    className="num shrink-0 text-[length:var(--text-lg)] font-semibold"
                    style={{ color: BUCKET_TONE[slice.bucket] }}
                  >
                    {slice.sharePct != null ? formatPct(slice.sharePct) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {total > 0 && (
        <p className="text-meta px-[var(--pad-card)] pb-[var(--pad-card)]">
          {formatCurrency(total, "EUR")} répartis sur{" "}
          {drawable.reduce((s, a) => s + a.supportCount, 0)} support
          {drawable.reduce((s, a) => s + a.supportCount, 0) > 1 ? "s" : ""}.
        </p>
      )}
    </section>
  );
}
