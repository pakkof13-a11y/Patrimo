"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { cn, formatCurrency } from "@/app/lib/utils";
import type { CategorySlice } from "@/app/lib/employee-savings/overview";
import type { FundCategory } from "@/app/lib/employee-savings/fund-category";

/**
 * Répartition de l'épargne par famille de support.
 *
 * La couleur porte ici du sens et rien d'autre : l'or pour les actions, le
 * bleu pour les diversifiés, le vert pour ce qui ne bouge presque pas, le gris
 * pour le reste. C'est une échelle de risque, pas une palette.
 *
 * Quand une famille a été déduite du nom du fonds plutôt que déclarée, la
 * carte le dit — l'utilisateur peut la corriger, et il doit savoir qu'il y a
 * quelque chose à corriger.
 */

/**
 * Teinte par famille de fonds.
 *
 * Exportée : le panneau d'un plan affiche la même répartition, et deux tables
 * de couleurs pour une même donnée finiraient par diverger — c'est la couleur
 * qu'on apprend à lire, elle doit être la même partout.
 */
export const FUND_CATEGORY_TONE: Record<FundCategory, string> = {
  EQUITY: "var(--chart-gold)",
  DIVERSIFIED: "var(--chart-cyan)",
  BOND: "var(--chart-neutral)",
  MONETARY: "var(--chart-positive)",
  OTHER: "var(--foreground-faint)",
};

export function EsAllocationCard({
  allocation,
  className,
}: {
  allocation: CategorySlice[];
  className?: string;
}) {
  const drawable = allocation.filter((a) => a.value > 0);
  const inferred = drawable.some((a) => a.hasInferred);

  return (
    <section
      className={cn("panel flex flex-col", className)}
      data-testid="es-allocation-card"
      aria-labelledby="es-allocation-heading"
    >
      <div className="panel-head">
        <h3 id="es-allocation-heading" className="text-title">
          Répartition par type de support
        </h3>
      </div>

      <div className="panel-body flex flex-1 items-center">
        {drawable.length === 0 ? (
          <p className="text-meta w-full py-[var(--space-8)] text-center">
            Les familles de supports apparaîtront dès le premier fonds saisi.
          </p>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-center gap-[var(--space-5)] sm:flex-nowrap sm:justify-between">
            <div className="relative h-[9.5rem] w-[9.5rem] shrink-0" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={drawable}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="64%"
                    outerRadius="100%"
                    paddingAngle={1.5}
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {drawable.map((slice) => (
                      <Cell key={slice.category} fill={FUND_CATEGORY_TONE[slice.category]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* La légende double le graphique en texte : un anneau seul n'est
                lisible ni au lecteur d'écran ni sur un écran mal calibré. */}
            <ul
              className="flex min-w-0 flex-1 flex-col gap-[var(--space-3)]"
              data-testid="es-allocation-legend"
            >
              {drawable.map((slice) => (
                <li
                  key={slice.category}
                  className="flex min-w-0 items-baseline gap-[var(--space-3)]"
                  data-testid={`es-allocation-${slice.category.toLowerCase()}`}
                >
                  <span
                    className="mt-[0.35rem] h-[0.5rem] w-[0.5rem] shrink-0 rounded-full"
                    style={{ background: FUND_CATEGORY_TONE[slice.category] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                    {slice.label}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                      {slice.sharePct != null
                        ? `${slice.sharePct.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`
                        : "—"}
                    </span>
                    <span className="num block text-[length:var(--text-xs)] text-[var(--foreground-faint)]">
                      {formatCurrency(slice.value, "EUR")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {inferred && (
        <p className="text-meta px-[var(--pad-card)] pb-[var(--pad-card)]">
          Certaines familles sont déduites du nom du fonds. Corrigez-les dans la
          gestion des supports si le classement ne convient pas.
        </p>
      )}
    </section>
  );
}
