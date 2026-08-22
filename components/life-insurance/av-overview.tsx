"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { AvPerformanceCard } from "@/components/life-insurance/av-performance-card";
import { AvContextColumn } from "@/components/life-insurance/av-context-column";
import { AvContractRow } from "@/components/life-insurance/av-contract-row";
import { ContractWorkspace } from "@/components/life-insurance/contract-workspace";
import { SavingsAllocationCard } from "@/components/life-insurance/savings-allocation-card";
import { Sparkline } from "@/components/ui/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildContractViews,
  computeAllocation,
  computeTotals,
  weightedManagementFeePct,
  type OverviewPolicy,
  type OverviewSupport,
  type OverviewTotals,
} from "@/app/lib/life-insurance/overview";
import type { PerfRange } from "@/app/lib/life-insurance/performance";
import type { LifeInsurancePerformance } from "@/app/lib/life-insurance/performance-service";
import type { TaxHousehold } from "@/app/lib/life-insurance/fiscal";
import type { TxRow } from "@/app/lib/types/ui";
import { formatCurrency, cn } from "@/app/lib/utils";

/**
 * Vue d'ensemble de l'assurance-vie.
 *
 * La page répond, dans cet ordre : ce que vaut l'épargne, de quels contrats
 * elle est faite, et ce que dit celui qu'on regarde. C'est la hiérarchie
 * adoptée par le Portefeuille et les Banques —
 *
 *     synthèse → liste → sélection → panneau droit
 *
 * — et non plus une mosaïque de cartes où le contrat sélectionné ouvrait une
 * modale par-dessus tout le reste.
 *
 * Aucun calcul n'est refait ici : `computeTotals`, `computeAllocation`,
 * `buildContractViews` et le service de performance restent les seules
 * sources. Cet écran choisit ce qu'il montre, pas ce qu'il vaut.
 */

type LifeInsuranceResponse = {
  policies: OverviewPolicy[];
  taxHousehold?: TaxHousehold;
};

const VIEWS = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "allocation", label: "Allocation" },
  { id: "performance", label: "Performances" },
  { id: "premiums", label: "Versements" },
  { id: "fees", label: "Frais" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })} %`;

/**
 * Tuile de tête.
 *
 * Grand chiffre, intitulé discret, courbe fine facultative — la grammaire des
 * Banques et du tableau de bord. Les cartes hautes et encadrées d'avant
 * occupaient un tiers de l'écran pour cinq nombres.
 */
function Kpi({
  label,
  value,
  secondary,
  tone,
  spark,
  loading,
  testId,
}: {
  label: string;
  value: string;
  secondary?: string;
  tone?: "positive" | "negative";
  spark?: number[];
  loading?: boolean;
  testId: string;
}) {
  return (
    <div
      className="min-w-0 px-[var(--space-4)] py-[var(--space-3)]"
      data-testid={testId}
    >
      {loading ? (
        <Skeleton className="h-6 w-24" />
      ) : (
        <p
          className={cn(
            "num truncate text-[length:var(--text-lg)] font-semibold tracking-tight",
            tone === "positive" && "val-positive",
            tone === "negative" && "val-negative",
            !tone && "text-[var(--foreground)]"
          )}
        >
          {value}
        </p>
      )}
      <p className="text-label mt-[var(--space-1)]">{label}</p>
      {secondary ? (
        <p className="text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
          {secondary}
        </p>
      ) : null}
      {spark && spark.length > 1 ? (
        <div className="mt-[var(--space-2)]">
          <Sparkline
            values={spark}
            width={92}
            height={18}
            stroke="var(--primary)"
          />
        </div>
      ) : null}
    </div>
  );
}

/* ── Vues secondaires ────────────────────────────────────────────────── */

function AllocationView({
  totals,
  allocation,
  supports,
}: {
  totals: OverviewTotals;
  allocation: ReturnType<typeof computeAllocation>;
  supports: OverviewSupport[];
}) {
  /*
    Répartition par classe d'actif, en plus des trois poches.

    Les poches disent la nature du support (fonds euro, UC, structuré), la
    classe dit ce qu'il y a dedans. Ce sont deux questions distinctes : un
    contrat 100 % UC peut être intégralement obligataire.
  */
  const byClass = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    for (const s of supports) {
      const v = Number(s.currentValueEur ?? 0);
      if (!Number.isFinite(v) || v <= 0) continue;
      const key = s.assetClass?.trim() || "Non classé";
      map.set(key, (map.get(key) ?? 0) + v);
      total += v;
    }
    return [...map.entries()]
      .map(([label, valueEur]) => ({
        label,
        valueEur,
        sharePct: total > 0 ? (valueEur / total) * 100 : null,
      }))
      .sort((a, b) => b.valueEur - a.valueEur);
  }, [supports]);

  return (
    <div className="grid min-w-0 gap-[var(--gap-card)] lg:grid-cols-2">
      <SavingsAllocationCard allocation={allocation} />

      <section className="panel min-w-0" data-testid="av-allocation-by-class">
        <div className="panel-head">
          <h3 className="text-title">Par classe d&apos;actifs</h3>
        </div>
        <div className="panel-body">
          {byClass.length === 0 ? (
            <p className="text-meta">
              Aucun support valorisé — la répartition par classe se remplit
              depuis le journal.
            </p>
          ) : (
            <ul className="min-w-0">
              {byClass.map((c) => (
                <li
                  key={c.label}
                  className="py-[var(--space-2)]"
                  data-testid="av-allocation-class-row"
                >
                  <div className="flex items-baseline justify-between gap-[var(--space-3)]">
                    <span className="truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                      {c.label}
                    </span>
                    <span className="num shrink-0 text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                      {c.sharePct != null
                        ? `${c.sharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-[var(--space-1)] flex items-center gap-[var(--space-2)]">
                    <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
                      <div
                        className="h-full rounded-full bg-[var(--chart-1)]"
                        style={{ width: `${c.sharePct ?? 0}%` }}
                      />
                    </div>
                    <span className="num shrink-0 text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                      {formatCurrency(c.valueEur, "EUR")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-meta mt-[var(--space-3)]">
            Encours réparti :{" "}
            <span className="num">
              {formatCurrency(totals.totalValueEur, "EUR")}
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}

function PremiumsView({
  totals,
  views,
}: {
  totals: OverviewTotals;
  views: ReturnType<typeof buildContractViews>;
}) {
  return (
    <section className="panel min-w-0" data-testid="av-premiums-view">
      <div className="panel-head">
        <h3 className="text-title">Versements par contrat</h3>
        <span className="text-meta num">
          {formatCurrency(totals.totalPremiumsEur, "EUR")} au total
        </span>
      </div>
      <div className="panel-body overflow-x-auto">
        <table className="term-table">
          <thead>
            <tr>
              <th>Contrat</th>
              <th className="text-right">Versements nets</th>
              <th className="text-right">Valeur</th>
              <th className="text-right">Gain</th>
              <th className="text-right">Gain %</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => {
              /*
                Gain depuis l'origine : encours − versements. Il n'a de sens
                que si les versements sont déclarés — sans eux, l'encours tout
                entier passerait pour une plus-value.
              */
              const gain =
                v.premiumsEur > 0 ? v.valueEur - v.premiumsEur : null;
              const gainPct =
                gain != null && v.premiumsEur > 0
                  ? (gain / v.premiumsEur) * 100
                  : null;
              return (
                <tr key={v.policy.id}>
                  <td className="font-medium text-[var(--foreground)]">
                    {v.title}
                  </td>
                  <td className="num text-right">
                    {v.premiumsEur > 0
                      ? formatCurrency(v.premiumsEur, "EUR")
                      : "—"}
                  </td>
                  <td className="num text-right">
                    {formatCurrency(v.valueEur, "EUR")}
                  </td>
                  <td
                    className={cn(
                      "num text-right",
                      gain != null && gain >= 0 && "val-positive",
                      gain != null && gain < 0 && "val-negative"
                    )}
                  >
                    {gain != null ? formatCurrency(gain, "EUR") : "—"}
                  </td>
                  <td
                    className={cn(
                      "num text-right",
                      gainPct != null && gainPct >= 0 && "val-positive",
                      gainPct != null && gainPct < 0 && "val-negative"
                    )}
                  >
                    {pctLabel(gainPct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totals.totalPremiumsEur === 0 ? (
          <p className="text-meta mt-[var(--space-3)]">
            Aucun versement déclaré. Sans eux, le gain depuis l&apos;origine
            reste incalculable — seule la plus-value latente des supports est
            connue.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FeesView({
  views,
}: {
  views: ReturnType<typeof buildContractViews>;
}) {
  return (
    <section className="panel min-w-0" data-testid="av-fees-view">
      <div className="panel-head">
        <h3 className="text-title">Frais de gestion</h3>
        <span className="text-meta">Pondérés par l&apos;encours</span>
      </div>
      <div className="panel-body overflow-x-auto">
        <table className="term-table">
          <thead>
            <tr>
              <th>Contrat</th>
              <th className="text-right">Encours</th>
              <th className="text-right">Frais moyens</th>
              <th className="text-right">Coût annuel estimé</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => {
              const feePct = weightedManagementFeePct(v.supports);
              const annualCost =
                feePct != null ? (v.valueEur * feePct) / 100 : null;
              return (
                <tr key={v.policy.id}>
                  <td className="font-medium text-[var(--foreground)]">
                    {v.title}
                  </td>
                  <td className="num text-right">
                    {formatCurrency(v.valueEur, "EUR")}
                  </td>
                  <td className="num text-right">
                    {feePct != null
                      ? `${feePct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                      : "—"}
                  </td>
                  <td className="num text-right text-[var(--foreground-secondary)]">
                    {annualCost != null
                      ? formatCurrency(annualCost, "EUR")
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-meta mt-[var(--space-3)]">
          Un tiret signale qu&apos;aucun support du contrat ne renseigne son
          taux : une moyenne sur rien afficherait « 0,00 % de frais », ce qui
          n&apos;existe pas.
        </p>
      </div>
    </section>
  );
}

/* ── Écran ───────────────────────────────────────────────────────────── */

export function AvOverview({ className }: { className?: string }) {
  const [range, setRange] = useState<PerfRange>("ytd");
  const [view, setView] = useState<ViewId>("overview");
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
    staleTime: 5 * 60_000,
  });

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

  /** Assureurs distincts — deux contrats chez le même n'en font qu'un. */
  const insurerCount = useMemo(
    () =>
      new Set(
        policies
          .map((p) => (p.insurer ?? "").trim().toLocaleLowerCase("fr-FR"))
          .filter(Boolean)
      ).size,
    [policies]
  );

  const sparkPoints = (total?.points ?? [])
    .map((p) => Number(p.valueEur))
    .filter((n) => Number.isFinite(n));

  return (
    <div className={cn("min-w-0", className)} data-testid="av-overview">
      {/* ── KPI ──────────────────────────────────────────────────── */}
      <div
        className="card grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6"
        data-testid="av-kpi-strip"
      >
        <Kpi
          testId="av-kpi-value"
          label="Valeur totale"
          value={formatCurrency(totals.totalValueEur, "EUR")}
          secondary="Encours au marché"
          spark={sparkPoints}
          loading={loading}
        />
        <Kpi
          testId="av-kpi-premiums"
          label="Versements nets"
          value={formatCurrency(totals.totalPremiumsEur, "EUR")}
          secondary="Primes déclarées"
          loading={loading}
        />
        <Kpi
          testId="av-kpi-gain"
          label="Gain latent"
          value={formatCurrency(totals.unrealizedGainEur, "EUR")}
          secondary="Supports au marché"
          tone={totals.unrealizedGainEur >= 0 ? "positive" : "negative"}
          loading={loading}
        />
        <Kpi
          testId="av-kpi-perf"
          label="Performance"
          value={pctLabel(total?.performancePct ?? null)}
          secondary={range.toUpperCase()}
          tone={
            (total?.performancePct ?? 0) >= 0 ? "positive" : "negative"
          }
          loading={performanceQ.isLoading}
        />
        <Kpi
          testId="av-kpi-contracts"
          label="Contrats"
          value={String(totals.contractCount)}
          secondary={`${totals.supportCount} support${totals.supportCount > 1 ? "s" : ""}`}
          loading={loading}
        />
        <Kpi
          testId="av-kpi-insurers"
          label="Assureurs"
          value={String(insurerCount)}
          secondary={`${matureCount} contrat${matureCount > 1 ? "s" : ""} +8 ans`}
          loading={loading}
        />
      </div>

      {/* ── Navigation secondaire ────────────────────────────────── */}
      <div
        className="mt-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-2)]"
        data-testid="av-tabs"
      >
        <div className="term-seg" role="tablist" aria-label="Vue de l'assurance-vie">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              data-active={view === v.id}
              className="term-seg-item"
              onClick={() => setView(v.id)}
              data-testid={`av-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="text-meta">
          {views.length} contrat{views.length > 1 ? "s" : ""} ·{" "}
          {insurerCount} assureur{insurerCount > 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Corps : liste + panneau ──────────────────────────────── */}
      <div className="mt-[var(--gap-card)] grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
          {view === "performance" && (
            <AvPerformanceCard
              points={total?.points ?? []}
              range={range}
              onRangeChange={setRange}
              performancePct={total?.performancePct ?? null}
              coveragePct={total?.coveragePct ?? 0}
              loading={performanceQ.isLoading}
            />
          )}

          {view === "allocation" && (
            <AllocationView
              totals={totals}
              allocation={allocation}
              supports={supports}
            />
          )}

          {view === "premiums" && (
            <PremiumsView totals={totals} views={views} />
          )}

          {view === "fees" && <FeesView views={views} />}

          {/*
            La liste des contrats reste sous chaque vue.

            C'est le sujet de la page : la masquer derrière un onglet ferait
            de « Allocation » ou « Frais » des écrans séparés, alors qu'ils
            décrivent les mêmes contrats sous un autre angle. Le panneau de
            droite reste donc utilisable quelle que soit la vue choisie.
          */}
          <section className="card min-w-0 overflow-hidden" data-testid="av-contracts">
            <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
              <h2 className="text-label">Contrats</h2>
              <span className="text-meta num">
                {formatCurrency(totals.totalValueEur, "EUR")}
              </span>
            </div>

            {loading ? (
              <div className="space-y-[var(--space-2)] p-[var(--space-4)]">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : views.length === 0 ? (
              <div className="p-[var(--space-4)]" data-testid="av-no-contract">
                <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                  Aucun contrat déclaré
                </p>
                <p className="text-meta mt-[var(--space-1)] max-w-prose">
                  Un contrat porte ce que le journal ne sait pas :
                  l&apos;assureur et la date d&apos;ouverture, dont dépend
                  l&apos;antériorité des huit ans. Déclarez-le, puis
                  rattachez-lui vos supports.
                </p>
              </div>
            ) : (
              <ul className="av-contract-list">
                {views.map((v) => (
                  <AvContractRow
                    key={v.policy.id}
                    view={v}
                    series={seriesByContract.get(v.policy.id)}
                    selected={openContractId === v.policy.id}
                    onSelect={setOpenContractId}
                  />
                ))}
              </ul>
            )}
          </section>

          {/*
            Contexte global — synthèse, statut fiscal, opérations récentes.

            Il vivait dans une colonne de droite, à côté d'une autre colonne de
            droite : deux colonnes latérales pour un seul écran. Ce qui relève
            de l'enveloppe entière descend ici, sous la liste ; ce qui relève
            d'un contrat a rejoint son panneau, et n'est plus dit deux fois.
          */}
          {view === "overview" && (
            <AvContextColumn
              totals={totals}
              taxHousehold={taxHousehold}
              matureCount={matureCount}
              operations={transactions}
              operationsLoading={txQ.isLoading}
              className="av-context-inline"
            />
          )}
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
    </div>
  );
}
