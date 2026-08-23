"use client";

/**
 * Fiscalité — vue d'analyse du patrimoine.
 *
 * ## Pourquoi cet écran change de nature
 *
 * Aurea calculait déjà beaucoup de fiscalité, mais dispersée : les plus-values
 * mobilières ici, l'IFI et l'arbitrage de régime locatif dans Immobilier, les
 * dispositifs de réduction ailleurs encore. Cet onglet n'en montrait qu'une
 * partie. Il devient le lieu qui les **rassemble**, sans en recalculer aucune :
 * chaque montant vient du moteur qui l'a produit.
 *
 * ## Ce que cet écran ne fera pas
 *
 * Il n'affiche pas d'impôt sur le revenu. Aurea ne connaît ni les salaires, ni
 * la composition du foyer, ni le nombre de parts, et ne porte aucun barème IR.
 * La « tranche marginale » du module immobilier est une hypothèse saisie par
 * l'utilisateur, pas une TMI déduite — l'écran le dit à chaque fois qu'il s'en
 * sert.
 *
 * Il n'affiche ni échéancier fiscal, ni succession, ni documents : rien dans
 * le modèle ne les porte.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { formatCurrency, cn } from "@/app/lib/utils";
import { PFU_TOTAL_RATE, ratePct } from "@/app/lib/tax/rates";
import type { FiscalYearReport } from "@/app/lib/tax/fiscal-year";
import type { RealEstateTaxBundlePayload } from "@/app/lib/real-estate/tax/payload";
import {
  buildFiscalHistory,
  buildFiscalKpis,
  buildFiscalLines,
  buildFiscalOpportunities,
  type FiscalKpi,
  type FiscalLineKind,
} from "@/app/lib/tax/overview";
import { FiscalLineList } from "./fiscal-line-list";
import { FiscalPanel } from "./fiscal-panel";
import { FiscalHistoryCard } from "./fiscal-history-card";

type FiscalYearPayload = FiscalYearReport & { history?: FiscalYearReport[] };

/** Profondeur d'historique demandée en un seul appel. */
const HISTORY_YEARS = 6;

type View = "overview" | "securities" | "realestate";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "securities", label: "Valeurs mobilières" },
  { id: "realestate", label: "Immobilier" },
];

/** Catégories retenues par chaque vue secondaire. */
const VIEW_KINDS: Record<View, FiscalLineKind[] | null> = {
  overview: null,
  securities: ["ENVELOPE"],
  realestate: ["IFI", "RENTAL", "SCHEME"],
};

function KpiTile({ kpi, currency }: { kpi: FiscalKpi; currency: string }) {
  return (
    <div className="card p-[var(--space-3)]" data-testid={`fiscal-kpi-${kpi.id}`}>
      <p className="text-label">{kpi.label}</p>
      {kpi.valueEur == null ? (
        /*
          Jamais « 0 € » pour une donnée absente : l'écran dit ce qu'il ne sait
          pas, plutôt que d'affirmer qu'il n'y a rien à payer.
        */
        <p
          className="mt-[var(--space-1)] text-[length:var(--text-base)] font-medium text-[var(--foreground-faint)]"
          data-testid={`fiscal-kpi-${kpi.id}-placeholder`}
        >
          {kpi.placeholder}
        </p>
      ) : (
        <p
          className={cn(
            "num mt-[var(--space-1)] text-[length:var(--text-lg)] font-semibold tracking-tight",
            kpi.tone === "positive" && kpi.valueEur > 0 && "val-positive",
            kpi.tone === "negative" && "val-negative",
            kpi.tone === "cost" && "text-[var(--foreground)]",
            kpi.tone === "neutral" && "text-[var(--foreground)]"
          )}
        >
          {formatCurrency(String(kpi.valueEur), currency)}
        </p>
      )}
      <p className="text-meta mt-[var(--space-px)]">{kpi.hint}</p>
    </div>
  );
}

export function FiscalTab({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: HISTORY_YEARS }, (_, i) => currentYear - i),
    [currentYear]
  );
  const [year, setYear] = useState(currentYear);
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const yearQ = useQuery({
    queryKey: ["fiscal-year", year, HISTORY_YEARS],
    queryFn: () =>
      fetchJson<FiscalYearPayload>(
        `/api/tax/fiscal-year?year=${encodeURIComponent(String(year))}&history=${HISTORY_YEARS}`
      ),
    staleTime: 60_000,
  });

  /*
    Le parc immobilier est chargé séparément et **sans bloquer** : un
    utilisateur qui n'en a pas doit voir sa fiscalité mobilière immédiatement,
    et une erreur de ce côté ne doit pas vider l'écran.
  */
  const realEstateQ = useQuery({
    queryKey: ["real-estate-tax", "fiscal-overview"],
    queryFn: () =>
      /*
        Sans `?tmi=`, la route applique la tranche déclarée par l'utilisateur.
        Passer une valeur en dur ici produisait un impôt foncier différent de
        celui qu'affichait l'onglet Immobilier pour le même bien.
      */
      fetchJson<RealEstateTaxBundlePayload>("/api/real-estate/tax"),
    staleTime: 60_000,
    retry: false,
  });

  const report = yearQ.data ?? null;
  const realEstate = realEstateQ.data ?? null;

  const kpis = useMemo(
    () => buildFiscalKpis(report, realEstate),
    [report, realEstate]
  );
  const allLines = useMemo(
    () => buildFiscalLines(report, realEstate),
    [report, realEstate]
  );
  const opportunities = useMemo(
    () => buildFiscalOpportunities(report, realEstate),
    [report, realEstate]
  );
  const history = useMemo(
    () => buildFiscalHistory(report?.history),
    [report?.history]
  );

  const lines = useMemo(() => {
    const kinds = VIEW_KINDS[view];
    return kinds ? allLines.filter((l) => kinds.includes(l.kind)) : allLines;
  }, [allLines, view]);

  /*
    La sélection est cherchée parmi les lignes visibles : changer de vue ne
    peut pas laisser le panneau détailler une ligne que la table ne porte plus.
  */
  const selected = lines.find((l) => l.id === selectedId) ?? null;

  const showSkeleton = yearQ.isPending && !yearQ.data;
  const hasAnything = allLines.length > 0;

  return (
    <section className="space-y-[var(--space-4)]" data-testid="fiscal-year-tab">
      <header className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="text-title">Fiscalité</h1>
          <p className="text-meta mt-[var(--space-1)]">
            Ce que votre patrimoine génère comme imposition, et d&apos;où cela
            vient — estimations de pilotage, pas un avis d&apos;imposition.
          </p>
        </div>
        <label className="flex flex-col gap-[var(--space-px)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
          Année civile
          <select
            className="input !w-auto min-w-[6rem]"
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setSelectedId(null);
            }}
            data-testid="fiscal-year-select"
            aria-label="Année fiscale"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </header>

      {yearQ.isError ? (
        <div
          className="panel p-[var(--space-4)]"
          data-testid="fiscal-error"
          role="alert"
        >
          <p className="text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
            Le rapport fiscal n&apos;a pas pu être chargé
          </p>
          <p className="text-meta mt-[var(--space-1)]">
            Réessayez dans un instant. Aucun chiffre n&apos;est affiché tant que
            le calcul n&apos;a pas abouti.
          </p>
        </div>
      ) : null}

      {showSkeleton ? (
        <div
          className="grid grid-cols-2 gap-[var(--space-2)] lg:grid-cols-4"
          data-testid="fiscal-skeleton"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[4.5rem] animate-pulse rounded-[var(--radius-md)] bg-[var(--surface-hover)]"
            />
          ))}
        </div>
      ) : (
        <div
          className="grid grid-cols-2 gap-[var(--space-2)] lg:grid-cols-4"
          data-testid="fiscal-kpis"
        >
          {kpis.map((k) => (
            <KpiTile key={k.id} kpi={k} currency={baseCurrency} />
          ))}
        </div>
      )}

      {report && report.totals.unresolvedSellCount > 0 ? (
        <div
          className="panel flex gap-[var(--space-3)] p-[var(--space-3)]"
          data-testid="fiscal-unresolved-cost-basis"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
              {report.totals.unresolvedSellCount} vente
              {report.totals.unresolvedSellCount > 1 ? "s" : ""} sans prix de
              revient connu
            </p>
            <p className="text-meta mt-[var(--space-px)]">
              Elles comptent pour 0 € de plus-value : le réalisé et le PFU
              estimé sont donc sous-évalués. Ajoutez les achats manquants ou
              importez l&apos;historique du courtier.
            </p>
          </div>
        </div>
      ) : null}

      <nav
        className="term-seg"
        role="tablist"
        aria-label="Domaines fiscaux"
        data-testid="fiscal-views"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            className="term-seg-item"
            data-active={view === v.id ? "true" : "false"}
            data-testid={`fiscal-view-${v.id}`}
            onClick={() => {
              setView(v.id);
              setSelectedId(null);
            }}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {view === "overview" && history.length > 0 ? (
        <FiscalHistoryCard points={history} currency={baseCurrency} />
      ) : null}

      <div className="panel">
        <div className="grid gap-[var(--space-4)] p-[var(--space-3)] xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="min-w-0">
            {showSkeleton ? (
              <div className="space-y-[var(--space-2)]">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[2.75rem] animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-hover)]"
                  />
                ))}
              </div>
            ) : lines.length === 0 ? (
              /*
                État vide **local** : n'avoir aucune opération imposable une
                année donnée est parfaitement normal, et n'a rien à voir avec
                un compte vierge — le cockpit d'accueil n'a pas sa place ici.
              */
              <div
                className="asset-panel-empty py-[var(--space-8)]"
                data-testid="fiscal-empty"
              >
                <p className="text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                  {hasAnything
                    ? "Aucune ligne dans ce domaine"
                    : `Aucune opération imposable en ${year}`}
                </p>
                <p className="text-meta max-w-[24rem]">
                  {hasAnything
                    ? "Les autres domaines fiscaux portent des lignes — utilisez la navigation ci-dessus."
                    : "Les ventes, dividendes et coupons du journal alimenteront cette synthèse. Le parc immobilier apporte l'IFI et les revenus fonciers."}
                </p>
              </div>
            ) : (
              <FiscalLineList
                lines={lines}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}

            {view !== "securities" && opportunities.length > 0 ? (
              <section
                className="mt-[var(--space-4)]"
                data-testid="fiscal-opportunities"
              >
                <h2 className="text-label mb-[var(--space-2)]">
                  Pistes d&apos;optimisation
                </h2>
                <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  {opportunities.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                    >
                      <div className="min-w-0">
                        <p className="text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                          {o.title}
                        </p>
                        <p className="text-meta">{o.description}</p>
                      </div>
                      {/*
                        Un montant n'apparaît que si un moteur l'a calculé.
                        Une opportunité réelle mais non chiffrable est
                        affichée sans chiffre — jamais avec une estimation
                        fabriquée.
                      */}
                      {o.savingEur != null ? (
                        <span className="num val-positive shrink-0 text-[length:var(--text-xs)] font-medium">
                          {formatCurrency(String(o.savingEur), baseCurrency)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <FiscalPanel
            line={selected}
            report={report}
            realEstate={realEstate}
            currency={baseCurrency}
            onClose={() => setSelectedId(null)}
          />
        </div>
      </div>

      {report ? (
        <div className="panel p-[var(--space-3)]" data-testid="fiscal-disclaimer">
          <p className="text-label">Cadre de lecture</p>
          <p className="text-meta mt-[var(--space-1)] leading-relaxed">
            {report.disclaimer}
          </p>
          <p className="text-meta mt-[var(--space-2)] leading-relaxed">
            Le PFU estimé applique {ratePct(PFU_TOTAL_RATE)} à{" "}
            {formatCurrency(String(report.totals.pfuBaseEur), baseCurrency)} de
            gains positifs sur les seules enveloppes CTO, crypto et CFD. Il
            ignore les abattements, l&apos;option pour le barème progressif et
            les crédits d&apos;impôt. Aucun impôt sur le revenu n&apos;est
            calculé : Aurea ne connaît ni vos salaires ni votre foyer fiscal.
          </p>
        </div>
      ) : null}
    </section>
  );
}
