"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { AvKpiCards } from "@/components/life-insurance/av-kpi-cards";
import { AvPerformanceCard } from "@/components/life-insurance/av-performance-card";
import { AvContextColumn } from "@/components/life-insurance/av-context-column";
import { ContractCard } from "@/components/life-insurance/contract-card";
import { ContractWorkspace } from "@/components/life-insurance/contract-workspace";
import { SavingsAllocationCard } from "@/components/life-insurance/savings-allocation-card";
import {
  buildContractViews,
  computeAllocation,
  computeTotals,
  type OverviewPolicy,
  type OverviewSupport,
} from "@/app/lib/life-insurance/overview";
import type { PerfRange } from "@/app/lib/life-insurance/performance";
import type { LifeInsurancePerformance } from "@/app/lib/life-insurance/performance-service";
import type { TaxHousehold } from "@/app/lib/life-insurance/fiscal";
import type { TxRow } from "@/app/lib/types/ui";
import { cn } from "@/app/lib/utils";

/**
 * Vue d'ensemble de l'assurance-vie.
 *
 * Une page, une lecture : ce que vaut l'épargne, comment elle est répartie,
 * comment elle se comporte, et de quels contrats elle est faite. Rien n'y est
 * dépliable ni paramétrable — la gestion des contrats vit dans son propre
 * repli, sous cette vue.
 *
 * Les contrats sont des **cartes** et non des lignes de tableau : un contrat
 * porte un âge, une fiscalité, une répartition et des échéances, quatre
 * informations de natures différentes qu'une grille de colonnes aplatirait au
 * profit de la seule qui s'aligne bien, le montant.
 */

type LifeInsuranceResponse = {
  policies: OverviewPolicy[];
  taxHousehold?: TaxHousehold;
};

export function AvOverview({
  onManage,
  onAddSupport,
  className,
}: {
  /** Ouvre le repli de gestion des contrats. */
  onManage: () => void;
  /** Ouvre la gestion, positionnée sur la saisie d'un support. */
  onAddSupport: () => void;
  className?: string;
}) {
  const [range, setRange] = useState<PerfRange>("ytd");
  const [openContractId, setOpenContractId] = useState<string | null>(null);

  const policiesQ = useQuery({
    queryKey: ["life-insurance"],
    queryFn: () => fetchJson<LifeInsuranceResponse>("/api/life-insurance"),
  });

  const supportsQ = useQuery({
    queryKey: ["life-insurance-supports"],
    queryFn: () =>
      fetchJson<{ supports: OverviewSupport[] }>("/api/life-insurance/supports"),
  });

  const performanceQ = useQuery({
    queryKey: ["life-insurance-performance", range],
    queryFn: () =>
      fetchJson<LifeInsurancePerformance>(
        `/api/life-insurance/performance?range=${range}`
      ),
    // Le calcul peut remplir le cache de clôtures : inutile de le relancer à
    // chaque retour sur l'onglet.
    staleTime: 5 * 60_000,
  });

  // Le journal de l'enveloppe sert deux endroits — les opérations récentes de
  // la colonne, et l'historique d'un contrat dans son panneau.
  const txQ = useQuery({
    queryKey: ["transactions", "AV", "overview"],
    queryFn: () =>
      fetchJson<{ transactions: TxRow[] }>(
        "/api/transactions?accountType=AV&pageSize=100"
      ),
  });

  const policies = useMemo(
    () => policiesQ.data?.policies ?? [],
    [policiesQ.data?.policies]
  );
  const supports = useMemo(
    () => supportsQ.data?.supports ?? [],
    [supportsQ.data?.supports]
  );
  const transactions = useMemo(
    () => txQ.data?.transactions ?? [],
    [txQ.data?.transactions]
  );

  const totals = useMemo(
    () => computeTotals(policies, supports),
    [policies, supports]
  );
  const allocation = useMemo(() => computeAllocation(supports), [supports]);
  const views = useMemo(
    () => buildContractViews(policies, supports),
    [policies, supports]
  );

  const seriesByContract = useMemo(() => {
    const map = new Map<string, LifeInsurancePerformance["byContract"][number]>();
    for (const s of performanceQ.data?.byContract ?? []) {
      if (s.lifeInsuranceId) map.set(s.lifeInsuranceId, s);
    }
    return map;
  }, [performanceQ.data?.byContract]);

  const openView = openContractId
    ? (views.find((v) => v.policy.id === openContractId) ?? null)
    : null;

  const openTransactions = useMemo(() => {
    if (!openView) return [];
    const ids = new Set(openView.supports.map((s) => s.assetId));
    return transactions.filter((t) => t.assetId && ids.has(t.assetId));
  }, [openView, transactions]);

  const total = performanceQ.data?.total;
  const taxHousehold: TaxHousehold = policiesQ.data?.taxHousehold ?? "SINGLE";
  const matureCount = views.filter((v) => v.isMature === true).length;
  const loading = policiesQ.isLoading || supportsQ.isLoading;

  return (
    <div className={cn("min-w-0", className)} data-testid="av-overview">
      <AvKpiCards
        totals={totals}
        series={total?.points}
        ytdPct={total?.ytdPct ?? null}
      />

      <div className="mt-[var(--gap-card)] grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ── Colonne principale ─────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
          <div className="grid min-w-0 gap-[var(--gap-card)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <SavingsAllocationCard allocation={allocation} />
            <AvPerformanceCard
              points={total?.points ?? []}
              range={range}
              onRangeChange={setRange}
              performancePct={total?.performancePct ?? null}
              coveragePct={total?.coveragePct ?? 0}
              loading={performanceQ.isLoading}
            />
          </div>

          <section data-testid="av-contracts">
            <div className="mb-[var(--space-3)] flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
              <h2 className="text-title">Vos contrats</h2>
              <span className="text-meta">
                {views.length} contrat{views.length > 1 ? "s" : ""}
              </span>
            </div>

            {loading ? (
              <div className="grid gap-[var(--gap-card)] lg:grid-cols-2">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="panel h-[13rem] animate-pulse"
                    aria-busy="true"
                  />
                ))}
              </div>
            ) : views.length === 0 ? (
              <div className="panel p-[var(--pad-card)]" data-testid="av-no-contract">
                <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                  Aucun contrat déclaré
                </p>
                <p className="text-meta mt-[var(--space-1)]">
                  Un contrat porte ce que le journal ne sait pas : l&apos;assureur
                  et la date d&apos;ouverture, dont dépend l&apos;antériorité des
                  huit ans. Déclarez-le dans la gestion des contrats, puis
                  rattachez-lui vos supports.
                </p>
              </div>
            ) : (
              <div className="grid min-w-0 gap-[var(--gap-card)] lg:grid-cols-2">
                {views.map((v) => (
                  <ContractCard
                    key={v.policy.id}
                    view={v}
                    series={seriesByContract.get(v.policy.id)}
                    onOpen={setOpenContractId}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Colonne contextuelle ───────────────────────────────── */}
        <AvContextColumn
          totals={totals}
          taxHousehold={taxHousehold}
          matureCount={matureCount}
          operations={transactions}
          operationsLoading={txQ.isLoading}
          onAddSupport={onAddSupport}
          onManage={onManage}
        />
      </div>

      <ContractWorkspace
        view={openView}
        series={openView ? seriesByContract.get(openView.policy.id) : undefined}
        transactions={openTransactions}
        transactionsLoading={txQ.isLoading}
        taxHousehold={taxHousehold}
        totalPremiumsEur={totals.totalPremiumsEur}
        onClose={() => setOpenContractId(null)}
      />
    </div>
  );
}
