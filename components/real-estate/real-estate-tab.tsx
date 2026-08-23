"use client";

/**
 * Onglet Immobilier — vue patrimoniale du parc.
 *
 * L'écran empilait quatre listes de gestion : un échéancier de loyers en tête
 * de page, puis des cartes de bien portant chacune leurs formulaires de
 * valorisation, de régime fiscal et de caractéristiques physiques. Soixante
 * champs par bien, tous dépliables sur la vue principale — un formulaire de
 * gestion, pas une lecture de patrimoine.
 *
 * La hiérarchie devient celle du Portefeuille, des Banques et de
 * l'Assurance-vie :
 *
 *     patrimoine immobilier → biens → sélection → détail
 *
 * Rien n'est retiré. DVF, Géorisques, DPE, régimes fiscaux, IFI, simulateur de
 * plus-value, échéancier de loyers, SCPI et sociétés : tout reste, mais chaque
 * chose à sa place — la vue principale pour comprendre, le panneau et les vues
 * secondaires pour agir.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { cn, formatCurrency } from "@/app/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiBandTile } from "@/components/ui/kpi-tiles";
import { PropertyList } from "@/components/real-estate/property-list";
import {
  PropertyDetailPanel,
  type PropertyRow,
} from "@/components/real-estate/property-panel";
import { RentSchedulePanel } from "@/components/real-estate/rent-schedule-panel";
import { RealEstateTaxPanel } from "@/components/real-estate/tax-panel";
import { CapitalGainSimulator } from "@/components/real-estate/capital-gain-simulator";
import { AddressEstimatePanel } from "@/components/real-estate/address-estimate-panel";
import { IndirectPanel } from "@/components/real-estate/indirect-panel";
import {
  buildPropertyViews,
  computeRealEstateTotals,
  splitByStatus,
  type PropertyHolding,
} from "@/app/lib/real-estate/property-views";
import type { Holding } from "@/app/lib/types/ui";

const VIEWS = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "properties", label: "Biens" },
  { id: "financing", label: "Financements" },
  { id: "rents", label: "Loyers & charges" },
  { id: "estimation", label: "Estimation" },
  { id: "indirect", label: "SCPI & sociétés" },
  { id: "fiscal", label: "Fiscalité" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

type TaxProperty = {
  assetId: string;
  label: string;
  purchasePriceEur: string | null;
  purchaseDate: string | null;
  shareValueEur: string;
  isPrimaryResidence: boolean;
};

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;

export function RealEstateTab({
  holdings,
  className,
}: {
  holdings: Holding[];
  className?: string;
}) {
  const [view, setView] = useState<ViewId>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const propsQ = useQuery({
    queryKey: ["real-estate-properties"],
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<{ properties: PropertyRow[] }>("/api/real-estate/properties"),
  });

  // Chargé uniquement pour le simulateur, qui a besoin du prix de revient et
  // de la date d'acquisition — deux données que `holdings` ne porte pas.
  const taxQ = useQuery({
    queryKey: ["real-estate-tax", "simulator"],
    /*
      `?tmi=` a été retiré : cet appel ne lit que `properties`, dont le contenu
      ne dépend pas de la tranche. Le paramètre laissait croire à une hypothèse
      de calcul là où il n'y en avait aucune, et figeait 30 % dans un troisième
      endroit.
    */
    queryFn: () =>
      fetchJson<{ properties: TaxProperty[] }>("/api/real-estate/tax"),
    enabled: view === "fiscal",
  });

  const properties = useMemo(
    () => propsQ.data?.properties ?? [],
    [propsQ.data?.properties]
  );

  const holdingsById = useMemo(() => {
    const map = new Map<string, PropertyHolding>();
    for (const h of holdings) {
      map.set(h.assetId, {
        quantity: h.quantity,
        marketValueEur: h.marketValueEur,
        costBasisEur: h.costBasisEur,
      });
    }
    return map;
  }, [holdings]);

  const views = useMemo(
    () => buildPropertyViews(properties, holdingsById),
    [properties, holdingsById]
  );
  const totals = useMemo(
    () => computeRealEstateTotals(views, properties),
    [views, properties]
  );
  const statusSplit = useMemo(() => splitByStatus(views), [views]);

  const selected = useMemo(
    () => properties.find((p) => p.assetId === selectedId) ?? null,
    [properties, selectedId]
  );

  const loading = propsQ.isPending && !propsQ.data;

  /** Les vues qui listent des biens partagent la liste et le panneau. */
  const showsPropertyList =
    view === "overview" || view === "properties" || view === "financing";

  return (
    <div className={cn("min-w-0 space-y-[var(--space-4)]", className)} data-testid="real-estate-tab">
      <header className="module-page-header flex flex-wrap items-start justify-between gap-[var(--space-3)] px-0.5">
        <div className="min-w-0">
          <h1 className="text-title">Immobilier</h1>
          <p className="text-meta">
            Vue d&apos;ensemble de votre patrimoine immobilier
            {totals.propertyCount > 0 ? (
              <>
                <span className="mx-1 opacity-40">·</span>
                {totals.propertyCount} bien{totals.propertyCount > 1 ? "s" : ""}
                <span className="mx-1 opacity-40">·</span>
                {totals.rentedCount} loué{totals.rentedCount > 1 ? "s" : ""}
                <span className="mx-1 opacity-40">·</span>
                {totals.loanCount} emprunt{totals.loanCount > 1 ? "s" : ""}
              </>
            ) : null}
          </p>
        </div>

        <div className="relative flex shrink-0 items-center gap-[var(--space-2)]">
          <Button
            onClick={() => setAddOpen((o) => !o)}
            aria-expanded={addOpen}
            aria-haspopup="menu"
            data-testid="re-add-open"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Ajouter
            <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Button>

          {addOpen ? (
            <>
              {/* Cliquer ailleurs referme — moins coûteux qu'un écouteur global. */}
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Fermer le menu"
                onClick={() => setAddOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-[var(--space-1)] min-w-[14rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] py-[var(--space-1)] shadow-[var(--shadow-lg)]"
                data-testid="re-add-menu"
              >
                {(
                  [
                    ["estimation", "Estimer une adresse"],
                    ["indirect", "SCPI / société"],
                    ["rents", "Loyer ou charge"],
                  ] as const
                ).map(([target, label]) => (
                  <button
                    key={target}
                    type="button"
                    role="menuitem"
                    className="block w-full px-[var(--space-3)] py-[var(--space-2)] text-left text-[length:var(--text-xs)] text-[var(--foreground)] transition-[background-color] hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      setAddOpen(false);
                      setView(target);
                    }}
                    data-testid={`re-add-${target}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {/* ── KPI ──────────────────────────────────────────────────── */}
      <div
        className="card grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6"
        data-testid="re-kpi-strip"
      >
        <KpiBandTile
          testId="re-kpi-value"
          label="Valeur totale"
          value={formatCurrency(String(totals.valueEur), "EUR")}
          secondary="Vos parts"
          loading={loading}
        />
        <KpiBandTile
          testId="re-kpi-debt"
          label="Capital restant dû"
          value={formatCurrency(String(totals.debtEur), "EUR")}
          secondary={
            totals.debtRatioPct != null
              ? `${pctLabel(totals.debtRatioPct, 1)} de la valeur`
              : undefined
          }
          loading={loading}
        />
        <KpiBandTile
          testId="re-kpi-equity"
          label="Equity"
          value={formatCurrency(String(totals.equityEur), "EUR")}
          secondary="Valeur − dette"
          tone={totals.equityEur >= 0 ? "positive" : "negative"}
          loading={loading}
        />
        <KpiBandTile
          testId="re-kpi-yield"
          label="Rendement brut moy."
          value={pctLabel(totals.weightedGrossYieldPct)}
          secondary="Pondéré, biens loués"
          loading={loading}
        />
        <KpiBandTile
          testId="re-kpi-cashflow"
          label="Cash-flow mensuel"
          value={
            totals.monthlyCashFlowEur !== 0
              ? `${totals.monthlyCashFlowEur >= 0 ? "+" : "−"}${formatCurrency(String(Math.abs(totals.monthlyCashFlowEur)), "EUR")}`
              : "—"
          }
          secondary="Hors mensualités d'emprunt"
          tone={totals.monthlyCashFlowEur >= 0 ? "positive" : "negative"}
          loading={loading}
        />
        <KpiBandTile
          testId="re-kpi-count"
          label="Biens"
          value={String(totals.propertyCount)}
          secondary={`dont ${totals.rentedCount} loué${totals.rentedCount > 1 ? "s" : ""}`}
          loading={loading}
        />
      </div>

      {/* ── Navigation secondaire ────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <div className="term-seg" role="tablist" aria-label="Vues du module immobilier">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              data-active={view === v.id}
              className="term-seg-item"
              onClick={() => setView(v.id)}
              data-testid={`re-subtab-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Corps ────────────────────────────────────────────────── */}
      <div className="grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_var(--panel-width)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
          {view === "overview" && statusSplit.length > 0 && (
            <section className="card min-w-0 p-[var(--space-4)]" data-testid="re-split">
              <h2 className="text-label mb-[var(--space-2)]">Répartition du parc</h2>
              <div
                className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]"
                role="img"
                aria-label={statusSplit
                  .map((s) => `${s.label} ${Math.round(s.sharePct ?? 0)} %`)
                  .join(", ")}
              >
                {statusSplit.map((s, i) => (
                  <span
                    key={s.status}
                    style={{
                      width: `${s.sharePct ?? 0}%`,
                      background: `var(--chart-${(i % 5) + 1})`,
                    }}
                  />
                ))}
              </div>
              <ul className="mt-[var(--space-3)] grid gap-[var(--space-1)] sm:grid-cols-2">
                {statusSplit.map((s, i) => (
                  <li
                    key={s.status}
                    className="flex items-baseline justify-between gap-[var(--space-3)]"
                  >
                    <span className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: `var(--chart-${(i % 5) + 1})` }}
                        aria-hidden
                      />
                      {s.label}
                    </span>
                    <span className="num shrink-0 text-[length:var(--text-xs)]">
                      {formatCurrency(String(s.valueEur), "EUR")}
                      <span className="text-meta ml-[var(--space-2)]">
                        {pctLabel(s.sharePct, 1)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view === "financing" && (
            <section className="card min-w-0 p-[var(--space-4)]" data-testid="re-financing">
              <h2 className="text-label mb-[var(--space-2)]">Financements</h2>
              <dl className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-3">
                <div>
                  <dt className="text-label">Dette totale</dt>
                  <dd className="num text-[length:var(--text-sm)] font-semibold">
                    {formatCurrency(String(totals.debtEur), "EUR")}
                  </dd>
                </div>
                <div>
                  <dt className="text-label">Dette / valeur</dt>
                  <dd className="num text-[length:var(--text-sm)] font-semibold">
                    {pctLabel(totals.debtRatioPct, 1)}
                  </dd>
                </div>
                <div>
                  <dt className="text-label">Emprunts</dt>
                  <dd className="num text-[length:var(--text-sm)] font-semibold">
                    {totals.loanCount}
                  </dd>
                </div>
              </dl>
              <p className="text-meta mt-[var(--space-3)]">
                Le capital restant dû n&apos;est jamais réduit à votre quote-part
                de propriété : on peut détenir la moitié d&apos;un bien tout en
                étant solidaire de la totalité de l&apos;emprunt. Le détail des
                prêts d&apos;un bien se lit dans sa fiche, onglet Financement.
              </p>
            </section>
          )}

          {view === "rents" && (
            <>
              <section className="card min-w-0 p-[var(--space-4)]" data-testid="re-rents-summary">
                <h2 className="text-label mb-[var(--space-2)]">Loyers &amp; charges</h2>
                <dl className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
                  <div>
                    <dt className="text-label">Loyers annuels</dt>
                    <dd className="num text-[length:var(--text-sm)] font-semibold val-positive">
                      {formatCurrency(String(totals.annualRentEur), "EUR")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label">Charges annuelles</dt>
                    <dd className="num text-[length:var(--text-sm)] font-semibold val-negative">
                      {formatCurrency(String(totals.annualChargesEur), "EUR")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label">Cash-flow annuel</dt>
                    <dd className="num text-[length:var(--text-sm)] font-semibold">
                      {formatCurrency(
                        String(totals.annualRentEur - totals.annualChargesEur),
                        "EUR"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label">Biens loués</dt>
                    <dd className="num text-[length:var(--text-sm)] font-semibold">
                      {totals.rentedCount} / {totals.propertyCount}
                    </dd>
                  </div>
                </dl>
              </section>
              {/*
                L'échéancier ouvrait la page : il occupait le premier écran de
                la vue immobilière alors qu'il ne concerne que les loyers
                proposés, non encore comptabilisés. Il devient contextuel, dans
                la vue qui lui correspond, et garde exactement sa logique — une
                échéance proposée reste à confirmer.
              */}
              <RentSchedulePanel />
            </>
          )}

          {view === "estimation" && <AddressEstimatePanel />}
          {view === "indirect" && <IndirectPanel />}

          {view === "fiscal" && (
            <>
              <RealEstateTaxPanel />
              <CapitalGainSimulator properties={taxQ.data?.properties ?? []} />
            </>
          )}

          {showsPropertyList && (
            <section className="card min-w-0 overflow-hidden" data-testid="re-properties">
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
                <h2 className="text-label">Biens immobiliers</h2>
                <span className="text-meta num">
                  {formatCurrency(String(totals.valueEur), "EUR")}
                </span>
              </div>
              {loading ? (
                <div className="space-y-[var(--space-2)] p-[var(--space-4)]">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <PropertyList
                  views={views}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
            </section>
          )}
        </div>

        <PropertyDetailPanel
          property={selected}
          holdings={holdings}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  );
}
