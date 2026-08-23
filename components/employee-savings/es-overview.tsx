"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { EsAllocationCard } from "@/components/employee-savings/es-allocation-card";
import { EsContextColumn } from "@/components/employee-savings/es-context-column";
import { EsEvolutionCard } from "@/components/employee-savings/es-evolution-card";
import { EsPlanRow } from "@/components/employee-savings/es-plan-row";
import {
  EsPlanPanel,
  LiquidityBar,
} from "@/components/employee-savings/es-plan-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiBandTile } from "@/components/ui/kpi-tiles";
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
import { cn, formatCurrency } from "@/app/lib/utils";

/**
 * Vue d'ensemble de l'épargne salariale.
 *
 * La lecture est celle qu'on fait réellement de cette poche :
 *
 *     combien → disponible combien → bloqué combien → où → quand
 *
 * Les plans étaient des cartes de dix-huit centimètres, deux par rangée, avec
 * un bouton « voir tous les plans » au-delà de six — on ne pouvait pas les
 * comparer. Ils deviennent des lignes, et le détail passe dans une colonne
 * ancrée, comme au Portefeuille, aux Banques, à l'Assurance-vie et à
 * l'Immobilier.
 *
 * Aucun calcul n'est refait ici : `computeTotals`, `computeAllocation`,
 * `groupIntoPlans`, `nextUnlock` et `recentContributions` restent les seules
 * sources.
 */

const VIEWS = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "plans", label: "Plans" },
  { id: "allocation", label: "Allocation" },
  { id: "contributions", label: "Versements" },
  { id: "liquidity", label: "Disponibilité" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
        maximumFractionDigits: digits,
      })} %`;

const dateFr = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";

export function EsOverview({
  onManage,
  className,
}: {
  onManage: (target?: string) => void;
  className?: string;
}) {
  const [range, setRange] = useState<EsRange>("all");
  const [view, setView] = useState<ViewId>("overview");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  const selectedPlan = useMemo(
    () => plans.find((p) => p.key === selectedKey) ?? null,
    [plans, selectedKey]
  );

  /** Gestionnaires distincts — deux plans chez le même n'en font qu'un. */
  const managerCount = useMemo(
    () =>
      new Set(
        plans.map((p) => p.manager.trim().toLocaleLowerCase("fr-FR")).filter(Boolean)
      ).size,
    [plans]
  );

  const loading = q.isLoading;

  return (
    <div className={cn("min-w-0", className)} data-testid="es-overview">
      {/* ── KPI ──────────────────────────────────────────────────── */}
      <div
        className="card grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5"
        data-testid="es-kpi-strip"
      >
        <KpiBandTile
          testId="es-kpi-value"
          label="Valeur totale"
          value={formatCurrency(String(totals.totalValue), "EUR")}
          secondary={`${totals.lineCount} support${totals.lineCount > 1 ? "s" : ""}`}
          loading={loading}
        />
        <KpiBandTile
          testId="es-kpi-available"
          label="Disponible"
          value={formatCurrency(String(totals.availableValue), "EUR")}
          secondary={
            totals.availablePct != null
              ? `${totals.availablePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de l'encours`
              : undefined
          }
          tone={totals.availableValue > 0 ? "positive" : undefined}
          loading={loading}
        />
        <KpiBandTile
          testId="es-kpi-blocked"
          label="Bloqué"
          value={formatCurrency(String(totals.blockedValue), "EUR")}
          secondary={
            unlock ? `Prochain déblocage dans ${unlock.daysAway} j` : undefined
          }
          loading={loading}
        />
        <KpiBandTile
          testId="es-kpi-gain"
          label="Performance"
          value={pctLabel(totals.gainPct)}
          secondary={
            totals.gain != null
              ? formatCurrency(String(totals.gain), "EUR")
              : "Versements non renseignés"
          }
          tone={
            totals.gainPct == null
              ? undefined
              : totals.gainPct >= 0
                ? "positive"
                : "negative"
          }
          loading={loading}
        />
        <KpiBandTile
          testId="es-kpi-plans"
          label="Plans"
          value={String(totals.planCount)}
          secondary={`${managerCount} gestionnaire${managerCount > 1 ? "s" : ""}`}
          loading={loading}
        />
      </div>

      {/* ── Navigation secondaire ────────────────────────────────── */}
      <div className="mt-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <div
          className="term-seg"
          role="tablist"
          aria-label="Vue de l'épargne salariale"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              data-active={view === v.id}
              className="term-seg-item"
              onClick={() => setView(v.id)}
              data-testid={`es-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="text-meta">
          {totals.planCount} plan{totals.planCount > 1 ? "s" : ""} ·{" "}
          {managerCount} gestionnaire{managerCount > 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Corps : liste + panneau ──────────────────────────────── */}
      <div className="mt-[var(--gap-card)] grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_var(--panel-width)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
          {/*
            Disponible / bloqué : la question centrale de cette poche, donc le
            premier bloc sous les KPI. Une seule barre, jamais deux jauges —
            ce sont les deux parts d'un même encours.
          */}
          {(view === "overview" || view === "liquidity") && (
            <section
              className="card min-w-0 p-[var(--space-4)]"
              data-testid="es-liquidity-summary"
            >
              <div className="mb-[var(--space-3)] flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                <h2 className="text-label">Disponibilité</h2>
                <span className="num text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
                  {formatCurrency(String(totals.totalValue), "EUR")}
                </span>
              </div>
              <LiquidityBar
                availableValue={totals.availableValue}
                blockedValue={totals.blockedValue}
              />
              {unlock ? (
                <div
                  className="mt-[var(--space-4)] border-t border-[var(--border)] pt-[var(--space-3)]"
                  data-testid="es-next-unlock"
                >
                  <p className="text-label">Prochain déblocage</p>
                  <p className="mt-[var(--space-1)] text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                    {dateFr(unlock.dateIso)}
                  </p>
                  <p className="text-meta">
                    <span className="num val-positive">
                      {formatCurrency(String(unlock.amount), "EUR")}
                    </span>{" "}
                    · {unlock.lineCount} lot{unlock.lineCount > 1 ? "s" : ""} ·
                    dans {unlock.daysAway} jour{unlock.daysAway > 1 ? "s" : ""}
                  </p>
                </div>
              ) : (
                <p className="text-meta mt-[var(--space-3)]">
                  Aucune échéance à venir : soit tout est déjà disponible, soit
                  tout est bloqué jusqu&apos;à la retraite.
                </p>
              )}
            </section>
          )}

          {(view === "overview" || view === "allocation") && (
            <EsAllocationCard allocation={allocation} />
          )}

          {(view === "overview" || view === "contributions") && (
            <EsEvolutionCard
              points={visibleSeries}
              range={range}
              onRangeChange={setRange}
              currentValue={totals.totalValue}
            />
          )}

          {/*
            La liste reste sous chaque vue : c'est le sujet de la page, et les
            vues secondaires décrivent les mêmes plans sous un autre angle. Le
            panneau de droite reste donc utilisable partout.
          */}
          <section className="card min-w-0 overflow-hidden" data-testid="es-plans">
            <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
              <h2 className="text-label">Plans</h2>
              <span className="text-meta num">
                {formatCurrency(String(totals.totalValue), "EUR")}
              </span>
            </div>

            {loading ? (
              <div className="space-y-[var(--space-2)] p-[var(--space-4)]">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : plans.length === 0 ? (
              <div className="p-[var(--space-4)]" data-testid="es-no-plan">
                <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                  Aucun support saisi
                </p>
                <p className="text-meta mt-[var(--space-1)] max-w-prose">
                  Un plan se forme dès qu&apos;un support est rattaché à une
                  enveloppe et à un gestionnaire. Saisissez-en un, ou importez
                  votre relevé au format CSV.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="term-table" data-testid="es-plan-table">
                  <thead>
                    <tr>
                      <th>Plan / compte</th>
                      <th className="text-right">Valeur</th>
                      <th className="text-right">Disponible</th>
                      <th className="text-right">Perf.</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((plan) => (
                      <EsPlanRow
                        key={plan.key}
                        plan={plan}
                        selected={selectedKey === plan.key}
                        onSelect={setSelectedKey}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/*
            Contexte global — aperçu, disponibilités, dernières opérations.

            Il occupait une colonne de droite, à côté du panneau de détail :
            deux colonnes latérales pour un écran, et le plan sélectionné se
            retrouvait décrit à deux endroits. Ce qui relève de l'ensemble
            descend ici ; ce qui relève d'un plan a rejoint son panneau.
          */}
          {view === "overview" && (
            <EsContextColumn
              totals={totals}
              unlock={unlock}
              operations={operations}
              className="es-context-inline"
            />
          )}
        </div>

        <EsPlanPanel
          plan={selectedPlan}
          onClose={() => setSelectedKey(null)}
          onManage={onManage}
        />
      </div>
    </div>
  );
}
