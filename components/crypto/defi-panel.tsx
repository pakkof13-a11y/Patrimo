"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw, ShieldAlert, Upload } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { isIlliquidStatus, isInactiveStatus } from "@/app/lib/crypto/defi-taxonomy";
import {
  isProtocolUnknown,
  type ClientDefiPortfolioBundle,
} from "@/app/lib/crypto/defi-ui-rules";
import { DefiKpis } from "./defi/defi-kpis";
import {
  DefiFilters,
  EMPTY_DEFI_FILTERS,
  matchesDefiFilters,
  type DefiFiltersValue,
} from "./defi/defi-filters";
import { DefiTable } from "./defi/defi-table";
import { DefiEmptyState } from "./defi/defi-empty-state";
import { DefiDetailPanel } from "./defi/defi-detail-panel";
import { DefiPositionForm } from "./defi/defi-position-form";
import { DefiSyncModal } from "./defi/defi-sync-modal";
import type { EmptyStateKind } from "@/app/lib/crypto/defi-ui-rules";

type PlatformsResponse = {
  platforms: Array<{ id: string; name: string; type: string | null; walletAddress: string | null }>;
};

/**
 * Sous-module DeFi / CeFi / CeDeFi de l'onglet Cryptos.
 *
 * Architecture : shell (ce fichier) → KPIs → barre d'actions → filtres →
 * tableau analytique → détail (panneau). Aucune règle de visibilité/obligation
 * n'est écrite ici : tout passe par `app/lib/crypto/defi-ui-rules.ts`, appelé
 * depuis les sous-composants.
 *
 * Source de données : `GET /api/crypto/defi/portfolio`, le bundle enrichi du
 * chantier backend F1 (legs, méthode de valorisation, conflits, agrégats) —
 * distinct de `GET /api/crypto/defi` (vue historique simple, non touchée ici).
 */
export function DefiPanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<DefiFiltersValue>(EMPTY_DEFI_FILTERS);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showSync, setShowSync] = useState(false);

  // `includeInactive` est toujours demandé : les positions fermées/liquidées
  // sont filtrées côté client par `matchesDefiFilters`, exactement comme
  // masquées/ignorées — cohérent entre les trois bascules, et ça évite un
  // aller-retour serveur (donc un flash de chargement) au simple clic sur la
  // case « fermées / liquidées incluses ».
  const q = useQuery({
    queryKey: ["crypto-defi-portfolio"],
    queryFn: () =>
      fetchJson<ClientDefiPortfolioBundle>("/api/crypto/defi/portfolio?includeInactive=true"),
  });

  const platformsQ = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fetchJson<PlatformsResponse>("/api/platforms"),
  });

  const refresh = useMutation({
    mutationFn: () => fetchJson("/api/crypto/defi/valuations/refresh", { method: "POST" }),
    onSuccess: () => {
      toast.success("Valorisations rafraîchies");
      void qc.invalidateQueries({ queryKey: ["crypto-defi-portfolio"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const platforms = platformsQ.data?.platforms ?? [];
  const rawPositions = useMemo(() => q.data?.positions ?? [], [q.data]);

  const chains = useMemo(
    () => [...new Set(rawPositions.map((p) => p.chain).filter((c): c is string => !!c))],
    [rawPositions]
  );
  const protocols = useMemo(
    () => [...new Set(rawPositions.map((p) => p.protocol).filter((p) => p.trim()))],
    [rawPositions]
  );

  const filtered = useMemo(
    () =>
      rawPositions.filter((p) =>
        matchesDefiFilters(p, filters, isProtocolUnknown, isInactiveStatus, isIlliquidStatus)
      ),
    [rawPositions, filters]
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["crypto-defi-portfolio"] });
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
    // « Total poche crypto » de l'en-tête : agrège comptant + DeFi + NFT, il
    // bouge donc dès qu'une position DeFi change. Sans cette invalidation il
    // restait figé jusqu'au rechargement.
    void qc.invalidateQueries({ queryKey: ["crypto-summary"] });
  };

  if (q.isPending) {
    return <Skeleton className={cn("h-64 w-full", className)} />;
  }
  if (q.isError || !q.data) {
    return (
      <section className={cn("card p-4", className)} data-testid="crypto-defi-panel">
        <p className="text-sm text-[var(--danger)]">
          Chargement du portefeuille DeFi impossible pour le moment.
        </p>
        <Button type="button" size="sm" className="mt-2" onClick={() => void q.refetch()}>
          Réessayer
        </Button>
      </section>
    );
  }

  const bundle = q.data;
  const isEmpty = rawPositions.length === 0;

  let emptyKind: EmptyStateKind | null = null;
  if (isEmpty) {
    emptyKind = "no-position";
  } else if (filtered.length === 0) {
    const onlyHiddenOrIgnoredOrInactive = rawPositions.every(
      (p) => p.isHidden || p.isIgnoredInPortfolio || isInactiveStatus(p.status)
    );
    emptyKind =
      onlyHiddenOrIgnoredOrInactive && !filters.showHidden && !filters.showIgnored && !filters.showInactive
        ? "only-hidden-or-ignored"
        : "no-match-filters";
  }

  const allUnvaluable =
    filtered.length > 0 && filtered.every((p) => !p.valuation.isValuable);

  return (
    <section className={cn("card p-4", className)} data-testid="crypto-defi-panel">
      <PanelHeader
        title="Positions DeFi"
        subtitle="Staking, prêts, emprunts, liquidité et rendement CeFi — valeur issue du journal"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={isEmpty ? "default" : "outline"}
              size="sm"
              onClick={() => setShowSync(true)}
              data-testid="defi-toolbar-sync"
            >
              <Upload className="mr-1 h-3.5 w-3.5" aria-hidden />
              Synchroniser
            </Button>
            {!isEmpty && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
                data-testid="defi-toolbar-refresh"
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                {refresh.isPending ? "Rafraîchissement…" : "Rafraîchir"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setShowForm(true)}
              data-testid="defi-toolbar-add"
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Ajouter une position
            </Button>
            {bundle.debtAlerts.length > 0 && (
              <Button
                type="button"
                variant={filters.onlyAnomalies ? "danger" : "outline"}
                size="sm"
                onClick={() => setFilters((f) => ({ ...f, onlyAnomalies: !f.onlyAnomalies }))}
                data-testid="defi-toolbar-anomalies"
              >
                <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden />
                {bundle.debtAlerts.length} à risque
              </Button>
            )}
          </div>
        }
      />

      {!isEmpty && (
        <div className="mt-3">
          <DefiKpis bundle={bundle} />
        </div>
      )}

      {!isEmpty && (
        <div className="mt-3">
          <DefiFilters
            value={filters}
            onChange={setFilters}
            chains={chains}
            protocols={protocols}
            platforms={platforms}
          />
        </div>
      )}

      {allUnvaluable && (
        <p className="text-meta mt-3 rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-2.5 py-2 text-[var(--warning)]">
          Des positions sont présentes mais aucune valorisation fiable n&apos;est disponible pour
          l&apos;instant — ajoutez une valorisation manuelle depuis le détail de chacune.
        </p>
      )}

      <div className="mt-3">
        {emptyKind ? (
          <DefiEmptyState
            kind={emptyKind}
            onAdd={() => setShowForm(true)}
            onSync={() => setShowSync(true)}
            onResetFilters={() => setFilters(EMPTY_DEFI_FILTERS)}
            onShowHidden={() =>
              setFilters((f) => ({ ...f, showHidden: true, showIgnored: true, showInactive: true }))
            }
          />
        ) : (
          <DefiTable positions={filtered} onOpenDetail={setDetailId} />
        )}
      </div>

      {detailId && (
        <DefiDetailPanel
          positionId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={invalidate}
        />
      )}
      {showForm && (
        <DefiPositionForm
          platforms={platforms}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            invalidate();
          }}
        />
      )}
      {showSync && (
        <DefiSyncModal
          platforms={platforms}
          onClose={() => setShowSync(false)}
          onSynced={invalidate}
        />
      )}
    </section>
  );
}
