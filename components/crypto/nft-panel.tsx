"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Grid3x3, List, Plus, RefreshCw, ShieldAlert, Upload } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { isInactiveHoldingStatus, type ClientNftPortfolioBundle } from "@/app/lib/crypto/nft-ui-rules";
import { NftKpis } from "./nft/nft-kpis";
import {
  EMPTY_NFT_FILTERS,
  NftFilters,
  matchesNftFilters,
  type NftFiltersValue,
} from "./nft/nft-filters";
import { NftGallery } from "./nft/nft-gallery";
import { NftTable } from "./nft/nft-table";
import { NftEmptyState } from "./nft/nft-empty-state";
import { NftDetailPanel } from "./nft/nft-detail-panel";
import { NftForm } from "./nft/nft-form";
import { NftSyncModal } from "./nft/nft-sync-modal";
import type { NftEmptyStateKind } from "@/app/lib/crypto/nft-ui-rules";

type PlatformsResponse = {
  platforms: Array<{ id: string; name: string; type: string | null; walletAddress: string | null }>;
};

/**
 * Sous-module NFT de l'onglet Cryptos (chantier G2 — frontend).
 *
 * Architecture : shell (ce fichier) → KPIs → barre d'actions → filtres →
 * galerie/tableau → détail (panneau). Aucune règle de visibilité/badge/action
 * n'est écrite ici : tout passe par `app/lib/crypto/nft-ui-rules.ts`.
 *
 * Source de données : `GET /api/crypto/nft/portfolio` (bundle enrichi du
 * chantier backend G) — un seul appel avec `includeInactive=true`, tout le
 * filtrage (masqués/ignorés/sortis/spam/...) se fait ensuite côté client pour
 * qu'aucune bascule de filtre ne redéclenche un aller-retour réseau (leçon du
 * chantier F2 : éviter le flash de chargement à chaque case cochée).
 */
export function NftPanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"gallery" | "table">("gallery");
  const [filters, setFilters] = useState<NftFiltersValue>(EMPTY_NFT_FILTERS);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showSync, setShowSync] = useState(false);

  const q = useQuery({
    queryKey: ["crypto-nft-portfolio"],
    queryFn: () => fetchJson<ClientNftPortfolioBundle>("/api/crypto/nft/portfolio?includeInactive=true"),
  });

  const platformsQ = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fetchJson<PlatformsResponse>("/api/platforms"),
  });

  const refresh = useMutation({
    mutationFn: () =>
      fetchJson<{ itemsUpdated: number; collectionsProcessed: number }>("/api/crypto/nft/estimate", {
        method: "POST",
      }),
    onSuccess: (r) => {
      if (r.itemsUpdated > 0) {
        toast.success(`${r.itemsUpdated} NFT réévalué(s) sur ${r.collectionsProcessed} collection(s)`);
      } else {
        toast.info("Aucune estimation appliquée — configurez une clé API de provider pour l'activer.");
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleHidden = useMutation({
    mutationFn: ({ assetId, hidden }: { assetId: string; hidden: boolean }) =>
      fetchJson(`/api/crypto/nft/positions/${assetId}/flags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden: hidden }),
      }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const platforms = platformsQ.data?.platforms ?? [];
  const rawHoldings = useMemo(() => q.data?.holdings ?? [], [q.data]);

  const chains = useMemo(() => [...new Set(rawHoldings.map((h) => h.chainId))], [rawHoldings]);
  const collections = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of rawHoldings) {
      if (h.collectionId) map.set(h.collectionId, h.collectionName || h.collectionId);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }, [rawHoldings]);

  const filtered = useMemo(
    () => rawHoldings.filter((h) => matchesNftFilters(h, filters)),
    [rawHoldings, filters]
  );

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["crypto-nft-portfolio"] });
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
    // « Total poche crypto » de l'en-tête de l'onglet : il agrège comptant +
    // DeFi + NFT et bouge donc dès qu'un NFT entre, sort ou est exclu du
    // patrimoine. Sans cette invalidation il restait figé jusqu'au rechargement.
    void qc.invalidateQueries({ queryKey: ["crypto-summary"] });
  }

  if (q.isPending) {
    return <Skeleton className={cn("h-64 w-full", className)} />;
  }
  if (q.isError || !q.data) {
    return (
      <section className={cn("card p-4", className)} data-testid="crypto-nft-panel">
        <p className="text-sm text-[var(--danger)]">Chargement du portefeuille NFT impossible pour le moment.</p>
        <Button type="button" size="sm" className="mt-2" onClick={() => void q.refetch()}>
          Réessayer
        </Button>
      </section>
    );
  }

  const bundle = q.data;
  const isEmpty = rawHoldings.length === 0;

  let emptyKind: NftEmptyStateKind | null = null;
  if (isEmpty) {
    emptyKind = "no-nft";
  } else if (filtered.length === 0) {
    const onlyHiddenIgnoredSpam = rawHoldings.every(
      (h) => h.isHidden || h.isIgnoredInPortfolio || h.isSpam || isInactiveHoldingStatus(h.status)
    );
    emptyKind =
      onlyHiddenIgnoredSpam && !filters.showHidden && !filters.showIgnored && !filters.showInactive
        ? "only-hidden-or-ignored-or-spam"
        : "no-match-filters";
  }

  const spamOrSuspectCount = bundle.totals.spamCount + bundle.totals.suspectedSpamCount;

  return (
    <section className={cn("card p-4", className)} data-testid="crypto-nft-panel">
      <PanelHeader
        title="NFT"
        subtitle="Identité, collection, valorisation et historique — valeur issue du journal"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={isEmpty ? "default" : "outline"}
              size="sm"
              onClick={() => setShowSync(true)}
              data-testid="nft-toolbar-sync"
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
                data-testid="nft-toolbar-refresh"
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                {refresh.isPending ? "Rafraîchissement…" : "Rafraîchir les floors"}
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => setShowForm(true)} data-testid="nft-toolbar-add">
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Ajouter un NFT
            </Button>
            {spamOrSuspectCount > 0 && (
              <Button
                type="button"
                variant={filters.spamOrSuspectOnly ? "danger" : "outline"}
                size="sm"
                onClick={() => setFilters((f) => ({ ...f, spamOrSuspectOnly: !f.spamOrSuspectOnly }))}
                data-testid="nft-toolbar-review-spam"
              >
                <ShieldAlert className="mr-1 h-3.5 w-3.5" aria-hidden />
                {spamOrSuspectCount} à revoir
              </Button>
            )}
            {!isEmpty && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn("btn btn-ghost h-8 w-8 p-0", view === "gallery" && "bg-[var(--primary-soft)]")}
                  onClick={() => setView("gallery")}
                  aria-label="Vue galerie"
                  aria-pressed={view === "gallery"}
                  data-testid="nft-view-gallery"
                >
                  <Grid3x3 className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className={cn("btn btn-ghost h-8 w-8 p-0", view === "table" && "bg-[var(--primary-soft)]")}
                  onClick={() => setView("table")}
                  aria-label="Vue tableau"
                  aria-pressed={view === "table"}
                  data-testid="nft-view-table"
                >
                  <List className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )}
          </div>
        }
      />

      {!isEmpty && (
        <div className="mt-3">
          <NftKpis bundle={bundle} />
        </div>
      )}

      {!isEmpty && (
        <div className="mt-3">
          <NftFilters value={filters} onChange={setFilters} chains={chains} platforms={platforms} collections={collections} />
        </div>
      )}

      <div className="mt-3">
        {emptyKind ? (
          <NftEmptyState
            kind={emptyKind}
            onAdd={() => setShowForm(true)}
            onSync={() => setShowSync(true)}
            onResetFilters={() => setFilters(EMPTY_NFT_FILTERS)}
            onShowHidden={() =>
              setFilters((f) => ({ ...f, showHidden: true, showIgnored: true, showInactive: true, spamOrSuspectOnly: false }))
            }
          />
        ) : view === "gallery" ? (
          <NftGallery
            holdings={filtered}
            onOpenDetail={setDetailAssetId}
            onToggleHidden={(assetId, hidden) => toggleHidden.mutate({ assetId, hidden })}
          />
        ) : (
          <NftTable holdings={filtered} onOpenDetail={setDetailAssetId} />
        )}
      </div>

      {detailAssetId && (
        <NftDetailPanel assetId={detailAssetId} onClose={() => setDetailAssetId(null)} onChanged={invalidate} />
      )}
      {showForm && (
        <NftForm
          platforms={platforms}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            invalidate();
          }}
          onSwitchToSync={() => {
            setShowForm(false);
            setShowSync(true);
          }}
        />
      )}
      {showSync && <NftSyncModal platforms={platforms} onClose={() => setShowSync(false)} onSynced={invalidate} />}
    </section>
  );
}
