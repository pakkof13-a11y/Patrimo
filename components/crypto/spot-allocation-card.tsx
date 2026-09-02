"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { AssetLogo } from "@/components/ui/platform-logo";
import { cn, formatCurrency } from "@/app/lib/utils";
import type { AllocationSlice } from "@/app/lib/crypto/spot-overview";

/**
 * Répartition de la poche comptant par coin.
 *
 * La couleur suit le **rang**, pas le coin : la plus grosse part est toujours
 * dorée, la suivante bleue, et ainsi de suite. Attribuer une teinte fixe à
 * chaque jeton demanderait une table sans fin — il en naît chaque semaine — et
 * l'anneau y perdrait sa lecture, qui est celle d'une hiérarchie de poids.
 *
 * « Autres » reste gris quel que soit son rang : c'est un regroupement, pas un
 * actif, et il ne doit pas se confondre avec une position.
 */

/** Teintes par rang, du plus lourd au plus léger. */
const RANK_TONES = [
  "var(--chart-gold)",
  "var(--chart-cyan)",
  "var(--chart-positive)",
  "var(--chart-neutral)",
  "var(--chart-violet)",
];

const OTHERS_TONE = "var(--foreground-faint)";

function toneOf(slice: AllocationSlice, rank: number): string {
  return slice.isOthers ? OTHERS_TONE : (RANK_TONES[rank] ?? OTHERS_TONE);
}

export function SpotAllocationCard({
  slices,
  logoBySymbol,
  className,
}: {
  slices: AllocationSlice[];
  /** Logos des coins, pour que la légende reste reconnaissable d'un coup d'œil. */
  logoBySymbol?: Record<string, string | null | undefined>;
  className?: string;
}) {
  const drawable = slices.filter((s) => s.valueEur > 0);

  return (
    <section
      className={cn("panel flex flex-col", className)}
      data-testid="spot-allocation-card"
      aria-labelledby="spot-allocation-heading"
    >
      <div className="panel-head">
        <h3 id="spot-allocation-heading" className="text-title">
          Répartition par actif
        </h3>
      </div>

      <div className="panel-body flex flex-1 items-center">
        {drawable.length === 0 ? (
          <p className="text-meta w-full py-[var(--space-8)] text-center">
            La répartition apparaîtra dès la première position en comptant.
          </p>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-center gap-[var(--space-5)] sm:flex-nowrap sm:justify-between">
            <div className="relative h-[9.5rem] w-[9.5rem] shrink-0" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={drawable}
                    dataKey="valueEur"
                    nameKey="label"
                    innerRadius="64%"
                    outerRadius="100%"
                    paddingAngle={1.5}
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                  >
                    {drawable.map((slice, i) => (
                      <Cell key={slice.symbol} fill={toneOf(slice, i)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* La légende double le graphique en texte : un anneau seul n'est
                lisible ni au lecteur d'écran ni sur un écran mal calibré. */}
            <ul
              className="flex min-w-0 flex-1 flex-col gap-[var(--space-2)]"
              data-testid="spot-allocation-legend"
            >
              {drawable.map((slice, i) => (
                <li
                  key={slice.symbol}
                  className="flex min-w-0 items-center gap-[var(--space-2)]"
                  data-testid={`spot-allocation-${slice.symbol.toLowerCase()}`}
                >
                  <span
                    className="h-[0.5rem] w-[0.5rem] shrink-0 rounded-full"
                    style={{ background: toneOf(slice, i) }}
                    aria-hidden
                  />
                  {!slice.isOthers && (
                    <AssetLogo
                      src={logoBySymbol?.[slice.symbol]}
                      name={slice.label}
                      ticker={slice.symbol}
                      assetClass="CRYPTO"
                      size={16}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                    {slice.label}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                      {slice.sharePct != null
                        ? `${slice.sharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                        : "—"}
                    </span>
                    <span className="num block text-[length:var(--text-xs)] text-[var(--foreground-faint)]">
                      {formatCurrency(slice.valueEur, "EUR")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
