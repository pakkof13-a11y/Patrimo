"use client";

/**
 * Onglet Trading — positions à levier et dérivés.
 *
 * ## Pourquoi ce module est séparé du patrimoine
 *
 * Une position à levier n'est pas un actif détenu : ce qu'elle pèse n'est ni
 * sa taille ni son notionnel, mais la marge engagée plus le P&L latent — ce
 * qu'on récupérerait en clôturant maintenant. Les montants affichés ici
 * n'entrent donc pas dans les mêmes additions que le comptant.
 *
 * ## Ce que cet écran ne montrera pas
 *
 * **Pas de P&L du jour.** Aucune photographie quotidienne des positions
 * n'existe : il n'y a rien à comparer à hier.
 *
 * **Pas d'exécutions.** Le modèle ne porte ni ordres ni fills.
 *
 * **Aucun ordre n'est transmis.** Aurea suit et analyse, il n'exécute pas :
 * « clôturer » enregistre une sortie dans le suivi, rien de plus.
 *
 * Les sous-modules existants — comptes CFD, saisie et import de futures,
 * journal fiscal — sont conservés intacts derrière la navigation secondaire.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { cn, formatCurrency } from "@/app/lib/utils";
import { FuturesPanel } from "@/components/trading/futures-panel";
import { TradingAccountsPanel } from "@/components/trading/trading-accounts-panel";
import { TradingJournalPanel } from "@/components/trading/trading-journal-panel";
import { exchangeLabel } from "@/app/lib/crypto/futures-constants";
import { UNDERLYING_TYPES } from "@/app/lib/trading/constants";
import {
  buildPositionViews,
  computeTradingOverview,
  filterPositions,
  sortPositions,
  EMPTY_FILTERS,
  type PositionFilters,
  type PositionSort,
} from "@/app/lib/trading/positions-view";
import type { TradingBundle } from "@/components/trading/types";
import { PositionList } from "./position-list";
import { PositionPanel } from "./position-panel";

export type TradingSubTab = "positions" | "cfd" | "futures" | "journal";

const TRADING_SUBS = new Set<string>([
  "positions",
  "cfd",
  "futures",
  "journal",
  // Ancien identifiant de la vue d'accueil — les liens existants doivent
  // continuer à ouvrir la bonne page.
  "dashboard",
]);

const SUB_NAV: Array<{ id: TradingSubTab; label: string }> = [
  { id: "positions", label: "Positions" },
  { id: "cfd", label: "Comptes" },
  { id: "futures", label: "Saisie & import" },
  { id: "journal", label: "Journal fiscal" },
];

const STATUS_TABS: Array<{ id: PositionFilters["status"]; label: string }> = [
  { id: "OPEN", label: "Ouvertes" },
  { id: "CLOSED", label: "Clôturées" },
  { id: "ALL", label: "Toutes" },
];

function Kpi({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: number;
  testId: string;
}) {
  return (
    <div className="card p-[var(--space-3)]" data-testid={testId}>
      <p className="text-label">{label}</p>
      <p
        className={cn(
          "num mt-[var(--space-1)] text-[length:var(--text-lg)] font-semibold tracking-tight",
          tone != null && tone > 0 && "val-positive",
          tone != null && tone < 0 && "val-negative",
          (tone == null || tone === 0) && "text-[var(--foreground)]"
        )}
      >
        {value}
      </p>
      <p className="text-meta mt-[var(--space-px)]">{hint}</p>
    </div>
  );
}

export function TradingTab({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const searchParams = useSearchParams();
  const [sub, setSub] = useState<TradingSubTab>(() => {
    const q = (searchParams.get("sub") || "").toLowerCase();
    if (q === "dashboard") return "positions";
    return TRADING_SUBS.has(q) ? (q as TradingSubTab) : "positions";
  });

  // Sync depuis l'URL quand elle change (deep-link).
  const subParamKey = searchParams.toString();
  const [prevSubParamKey, setPrevSubParamKey] = useState(subParamKey);
  if (subParamKey !== prevSubParamKey) {
    setPrevSubParamKey(subParamKey);
    const q = (searchParams.get("sub") || "").toLowerCase();
    if (q === "dashboard") setSub("positions");
    else if (TRADING_SUBS.has(q)) setSub(q as TradingSubTab);
  }

  const [filters, setFilters] = useState<PositionFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<PositionSort>("pnl");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["trading-bundle"],
    queryFn: () => fetchJson<TradingBundle>("/api/trading"),
    staleTime: 60_000,
  });

  /*
    Horloge figée au montage : l'ancienneté d'une observation se compare à un
    instant, et lire `Date.now()` pendant le rendu le rendrait impur.
  */
  const [clock] = useState(() => new Date());

  const views = useMemo(
    () => buildPositionViews(q.data?.positions ?? [], clock),
    [q.data?.positions, clock]
  );

  /*
    La synthèse porte sur **toutes** les positions, jamais sur la sélection
    filtrée : un compteur d'alertes qui tomberait à zéro parce qu'on a filtré
    sur « clôturées » ne signalerait plus rien.
  */
  const overview = useMemo(() => computeTradingOverview(views), [views]);

  const visible = useMemo(
    () => sortPositions(filterPositions(views, filters), sort),
    [views, filters, sort]
  );

  /*
    La sélection est cherchée parmi les lignes visibles : changer de filtre ne
    peut pas laisser le panneau détailler une position que la table ne porte
    plus.
  */
  const selected = visible.find((v) => v.id === selectedId) ?? null;

  const exchanges = useMemo(
    () => [...new Set(views.map((v) => v.exchange))].sort(),
    [views]
  );

  const showSkeleton = q.isPending && !q.data;
  const hasPositions = views.length > 0;

  function patch(next: Partial<PositionFilters>) {
    setFilters((f) => ({ ...f, ...next }));
    setSelectedId(null);
  }

  return (
    <section className="space-y-[var(--space-4)]" data-testid="trading-tab">
      <header className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="text-title">Trading</h1>
          <p className="text-meta mt-[var(--space-1)] max-w-2xl leading-relaxed">
            Suivi de vos positions et opérations à levier. Ce qui compte ici
            n&apos;est pas la taille de la position mais la marge engagée et le
            P&amp;L latent — ces montants n&apos;entrent pas dans le patrimoine
            net comme un actif détenu.
          </p>
        </div>
      </header>

      <nav
        className="term-seg"
        role="tablist"
        aria-label="Sous-modules trading"
        data-testid="trading-subnav"
      >
        {SUB_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={sub === item.id}
            className="term-seg-item"
            data-active={sub === item.id ? "true" : "false"}
            data-testid={`trading-sub-${item.id}`}
            onClick={() => setSub(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {sub === "positions" ? (
        <>
          {/*
            Cinq indicateurs, tous adossés au moteur `crypto/futures.ts`.

            Pas de « P&L du jour » : rien n'historise le prix de marque, donc
            rien ne permet de comparer à hier. Pas de Sharpe ni de VaR : ils
            demanderaient une série de rendements qui n'existe pas.
          */}
          {showSkeleton ? (
            <div
              className="grid grid-cols-2 gap-[var(--space-2)] lg:grid-cols-5"
              data-testid="trading-skeleton"
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[4.5rem] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-hover)]"
                />
              ))}
            </div>
          ) : (
            <div
              className="grid grid-cols-2 gap-[var(--space-2)] lg:grid-cols-5"
              data-testid="trading-kpis"
            >
              <Kpi
                label="P&L latent"
                value={formatCurrency(
                  String(overview.unrealizedPnlEur),
                  baseCurrency
                )}
                hint={`${overview.openCount} position${overview.openCount > 1 ? "s" : ""} ouverte${overview.openCount > 1 ? "s" : ""}`}
                tone={overview.unrealizedPnlEur}
                testId="trading-kpi-unrealized"
              />
              <Kpi
                label="P&L réalisé"
                value={formatCurrency(
                  String(overview.realizedPnlEur),
                  baseCurrency
                )}
                hint={`${overview.closedCount} clôturée${overview.closedCount > 1 ? "s" : ""} · frais déduits`}
                tone={overview.realizedPnlEur}
                testId="trading-kpi-realized"
              />
              <Kpi
                label="Exposition nette"
                value={formatCurrency(
                  String(overview.netExposureEur),
                  baseCurrency
                )}
                hint={`brute ${formatCurrency(String(overview.grossExposureEur), baseCurrency)}`}
                testId="trading-kpi-exposure"
              />
              <Kpi
                label="Marge engagée"
                value={formatCurrency(String(overview.marginEur), baseCurrency)}
                hint={
                  overview.exchangeCount > 0
                    ? `sur ${overview.exchangeCount} plateforme${overview.exchangeCount > 1 ? "s" : ""}`
                    : "capital immobilisé"
                }
                testId="trading-kpi-margin"
              />
              <Kpi
                label="Alertes liquidation"
                value={String(overview.liquidationAlerts)}
                hint={
                  overview.liquidationAlerts > 0
                    ? "position(s) proche(s) du seuil"
                    : "aucune position à risque immédiat"
                }
                tone={overview.liquidationAlerts > 0 ? -1 : 0}
                testId="trading-kpi-alerts"
              />
            </div>
          )}

          {/*
            Avertissement global de fraîcheur : sans prix de marque actualisé,
            le P&L latent affiché plus haut ne vaut rien. Le taire serait la
            pire des omissions de cet écran.
          */}
          {overview.unmarkedCount > 0 ? (
            <div
              className="panel flex gap-[var(--space-3)] p-[var(--space-3)]"
              data-testid="trading-unmarked-warning"
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                  {overview.unmarkedCount} position
                  {overview.unmarkedCount > 1 ? "s" : ""} sans prix de marque
                  actualisé
                </p>
                <p className="text-meta mt-[var(--space-px)]">
                  Aurea ne rafraîchit pas le prix des contrats à levier depuis
                  le marché : aucune source de prix de marque n&apos;existe pour
                  les plateformes suivies. Le prix reste celui que vous avez
                  saisi ou importé, et sa date figure dans chaque fiche.
                </p>
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div
              className="flex flex-wrap items-center gap-[var(--space-2)] border-b border-[var(--border)] p-[var(--space-3)]"
              data-testid="trading-toolbar"
            >
              <input
                className="input min-w-[13rem] flex-1"
                placeholder="Rechercher un instrument, une plateforme…"
                value={filters.search}
                onChange={(e) => patch({ search: e.target.value })}
                data-testid="trading-search"
                aria-label="Rechercher une position"
              />

              <div className="term-seg" role="group" aria-label="Statut">
                {STATUS_TABS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="term-seg-item"
                    data-active={filters.status === s.id ? "true" : "false"}
                    onClick={() => patch({ status: s.id })}
                    data-testid={`trading-status-${s.id.toLowerCase()}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <select
                className="input !w-auto"
                value={filters.direction}
                onChange={(e) =>
                  patch({
                    direction: e.target.value as PositionFilters["direction"],
                  })
                }
                data-testid="trading-direction-filter"
                aria-label="Filtrer par sens"
              >
                <option value="ALL">Tous sens</option>
                <option value="LONG">Long</option>
                <option value="SHORT">Short</option>
              </select>

              {exchanges.length > 1 ? (
                <select
                  className="input !w-auto"
                  value={filters.exchange}
                  onChange={(e) => patch({ exchange: e.target.value })}
                  data-testid="trading-exchange-filter"
                  aria-label="Filtrer par plateforme"
                >
                  <option value="ALL">Toutes plateformes</option>
                  {exchanges.map((x) => (
                    <option key={x} value={x}>
                      {exchangeLabel(x)}
                    </option>
                  ))}
                </select>
              ) : null}

              <select
                className="input !w-auto"
                value={filters.underlyingType}
                onChange={(e) => patch({ underlyingType: e.target.value })}
                data-testid="trading-underlying-filter"
                aria-label="Filtrer par sous-jacent"
              >
                <option value="ALL">Tous sous-jacents</option>
                {Object.entries(UNDERLYING_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                className="input !w-auto"
                value={sort}
                onChange={(e) => setSort(e.target.value as PositionSort)}
                data-testid="trading-sort"
                aria-label="Trier"
              >
                <option value="pnl">P&amp;L</option>
                <option value="exposure">Exposition</option>
                <option value="instrument">Instrument</option>
                <option value="date">Date</option>
              </select>
            </div>

            <div className="grid gap-[var(--space-4)] p-[var(--space-3)] xl:grid-cols-[minmax(0,1fr)_25rem]">
              <div className="min-w-0">
                {showSkeleton ? (
                  <div className="space-y-[var(--space-2)]">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-[3rem] animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-hover)]"
                      />
                    ))}
                  </div>
                ) : !hasPositions ? (
                  /*
                    État vide **local** : ne pas faire de trading à levier est
                    parfaitement normal pour un patrimoine, et n'a rien à voir
                    avec un compte vierge. Le cockpit d'accueil n'a pas sa
                    place ici.
                  */
                  <div
                    className="asset-panel-empty py-[var(--space-8)]"
                    data-testid="trading-empty"
                  >
                    <p className="text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                      Aucune position de trading
                    </p>
                    <p className="text-meta max-w-[24rem]">
                      Saisissez une position ou importez un relevé de trades
                      pour suivre votre activité à levier.
                    </p>
                    <button
                      type="button"
                      className="term-seg-item mt-[var(--space-3)]"
                      data-active="true"
                      onClick={() => setSub("futures")}
                      data-testid="trading-empty-cta"
                    >
                      Saisir ou importer
                    </button>
                  </div>
                ) : visible.length === 0 ? (
                  <div
                    className="asset-panel-empty py-[var(--space-8)]"
                    data-testid="trading-no-match"
                  >
                    <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
                      Aucune position ne correspond
                    </p>
                    <p className="text-meta">
                      Ajustez la recherche ou les filtres.
                    </p>
                  </div>
                ) : (
                  <PositionList
                    views={visible}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    baseCurrency={baseCurrency}
                  />
                )}
              </div>

              <PositionPanel
                view={selected}
                baseCurrency={baseCurrency}
                onClose={() => setSelectedId(null)}
                onEdit={() => setSub("futures")}
                onClosePosition={() => setSub("futures")}
              />
            </div>
          </div>
        </>
      ) : null}

      {sub === "cfd" && <TradingAccountsPanel />}
      {sub === "futures" && <FuturesPanel />}
      {sub === "journal" && <TradingJournalPanel />}
    </section>
  );
}
