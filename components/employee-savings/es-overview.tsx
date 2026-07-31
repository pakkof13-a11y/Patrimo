"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { EsAllocationCard } from "@/components/employee-savings/es-allocation-card";
import { EsContextColumn } from "@/components/employee-savings/es-context-column";
import { EsEvolutionCard } from "@/components/employee-savings/es-evolution-card";
import { EsKpiCards } from "@/components/employee-savings/es-kpi-cards";
import { EsPlanCard } from "@/components/employee-savings/es-plan-card";
import {
  buildContributionSeries,
  computeAllocation,
  computeTotals,
  groupIntoPlans,
  nextUnlock,
  recentContributions,
  sliceSeries,
  type EsRange,
  type OverviewLine,
} from "@/app/lib/employee-savings/overview";
import { cn } from "@/app/lib/utils";

/**
 * Vue d'ensemble de l'épargne salariale.
 *
 * Une page, une lecture : ce que vaut l'épargne, comment elle est répartie,
 * comment elle s'est constituée, et de quels plans elle est faite. La saisie
 * — lignes, import CSV, déblocages — vit sous un repli, en bas de page.
 *
 * Le nombre de plans affiché en tête vient d'ici : un plan est un type
 * d'enveloppe chez un gestionnaire, pas une ligne de relevé.
 */

/** Au-delà, la grille de cartes devient un mur : on renvoie vers la gestion. */
const MAX_PLAN_CARDS = 6;

export function EsOverview({
  onManage,
  onAddLine,
  className,
}: {
  onManage: () => void;
  onAddLine: () => void;
  className?: string;
}) {
  const [range, setRange] = useState<EsRange>("all");

  const q = useQuery({
    queryKey: ["employee-savings"],
    queryFn: () => fetchJson<{ lines: OverviewLine[] }>("/api/employee-savings"),
  });

  const lines = useMemo(() => q.data?.lines ?? [], [q.data?.lines]);

  const totals = useMemo(() => computeTotals(lines), [lines]);
  const allocation = useMemo(() => computeAllocation(lines), [lines]);
  const plans = useMemo(() => groupIntoPlans(lines), [lines]);
  const series = useMemo(() => buildContributionSeries(lines), [lines]);
  const visibleSeries = useMemo(
    () => sliceSeries(series, range),
    [series, range]
  );
  const unlock = useMemo(() => nextUnlock(lines), [lines]);
  const operations = useMemo(() => recentContributions(lines), [lines]);

  const shownPlans = plans.slice(0, MAX_PLAN_CARDS);

  return (
    <div className={cn("min-w-0", className)} data-testid="es-overview">
      <EsKpiCards totals={totals} series={series} />

      <div className="mt-[var(--gap-card)] grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ── Colonne principale ─────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
          <div className="grid min-w-0 gap-[var(--gap-card)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <EsAllocationCard allocation={allocation} />
            <EsEvolutionCard
              points={visibleSeries}
              range={range}
              onRangeChange={setRange}
              currentValue={totals.totalValue}
            />
          </div>

          <section data-testid="es-plans">
            <div className="mb-[var(--space-3)] flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
              <h2 className="text-title">Mes plans d&apos;épargne salariale</h2>
              <span className="text-meta">
                {plans.length} plan{plans.length > 1 ? "s" : ""}
              </span>
            </div>

            {q.isLoading ? (
              <div className="grid gap-[var(--gap-card)] lg:grid-cols-2">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="panel h-[18rem] animate-pulse"
                    aria-busy="true"
                  />
                ))}
              </div>
            ) : plans.length === 0 ? (
              <div className="panel p-[var(--pad-card)]" data-testid="es-no-plan">
                <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                  Aucun support saisi
                </p>
                <p className="text-meta mt-[var(--space-1)]">
                  Un plan se forme dès qu&apos;un support est rattaché à une
                  enveloppe et à un gestionnaire. Saisissez-en un, ou importez
                  votre relevé au format CSV, dans la gestion des supports.
                </p>
              </div>
            ) : (
              <>
                <div className="grid min-w-0 gap-[var(--gap-card)] lg:grid-cols-2">
                  {shownPlans.map((plan) => (
                    <EsPlanCard
                      key={plan.key}
                      plan={plan}
                      onOpen={() => onManage()}
                    />
                  ))}
                </div>

                {plans.length > shownPlans.length && (
                  <button
                    type="button"
                    onClick={onManage}
                    className="panel panel--interactive mt-[var(--gap-card)] flex w-full items-center justify-center gap-[var(--space-2)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--foreground-secondary)]"
                    data-testid="es-see-all-plans"
                  >
                    Voir tous les plans ({plans.length})
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </>
            )}
          </section>
        </div>

        {/* ── Colonne contextuelle ───────────────────────────────── */}
        <EsContextColumn
          totals={totals}
          unlock={unlock}
          operations={operations}
          onAddLine={onAddLine}
          onManage={onManage}
        />
      </div>
    </div>
  );
}
