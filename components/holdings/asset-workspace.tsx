"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Button } from "@/components/ui/button";
import {
  sectionsForAsset,
  type AssetWorkspaceSectionId,
} from "@/app/lib/portfolio/asset-workspace-sections";
import {
  formatCurrency,
  getAssetClassLabel,
  getChangeColor,
  cn,
} from "@/app/lib/utils";
import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";
import { WorkspaceSection } from "@/components/holdings/asset-workspace-sections";
import type { AssetWorkspaceData } from "@/components/holdings/asset-workspace-sections";
import type { TxRow } from "@/app/lib/types/ui";

export type { AssetWorkspaceData };

/**
 * Espace de travail d'un actif.
 *
 * Ce n'est pas une fiche : c'est l'endroit où l'on *travaille* une ligne du
 * portefeuille. D'où le panneau latéral plutôt qu'une fenêtre modale — le
 * tableau reste visible derrière, on garde le contexte de la position dans
 * l'ensemble pendant qu'on l'examine, et passer d'un actif à l'autre ne
 * demande pas de refermer quoi que ce soit.
 *
 * Largeur : nettement plus que les 380 px d'un panneau de détail. Onze
 * sections, dont un graphique de cours et un journal de transactions, ne
 * tiennent pas dans une colonne étroite ; à 380 px l'espace de travail
 * redevient une fiche qu'on fait défiler.
 */
export function AssetWorkspace({
  open,
  loading,
  data,
  baseCurrency,
  onClose,
  onEditTx,
  onDeleteTx,
  onAddTransaction,
  onEditCategory,
}: {
  open: boolean;
  loading: boolean;
  data?: AssetWorkspaceData | null;
  baseCurrency: string;
  onClose: () => void;
  onEditTx: (t: TxRow) => void;
  onDeleteTx: (id: string) => void;
  onAddTransaction?: (type?: string) => void;
  onEditCategory?: () => void;
}) {
  const [section, setSection] = useState<AssetWorkspaceSectionId>("overview");
  const panelRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () => sectionsForAsset({ assetClass: data?.asset.assetClass }),
    [data?.asset.assetClass]
  );

  // Changer d'actif remet la vue d'ensemble : rester sur « Documents » parce
  // que c'est là qu'on avait laissé le précédent n'aide personne.
  const resetKey = `${open}:${data?.asset.id ?? ""}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (open && resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setSection("overview");
  } else if (!open && prevResetKey.startsWith("true:")) {
    setPrevResetKey(resetKey);
  }

  // La section courante peut disparaître si l'actif suivant n'est pas crypto.
  const activeSection = sections.some((s) => s.id === section)
    ? section
    : "overview";

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Le panneau prend le focus à l'ouverture : sans cela, la tabulation
  // continue de parcourir le tableau resté derrière.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, data?.asset.id]);

  if (!open) return null;

  const asset = data?.asset;
  const holding = data?.holding;
  const qty = holding ? Number(holding.quantity) : null;
  const marketValue = holding ? Number(holding.marketValueEur) : null;
  const costBasis =
    holding && qty != null ? qty * Number(holding.avgCostEur) : null;
  const pnl =
    marketValue != null && costBasis != null ? marketValue - costBasis : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="asset-workspace"
    >
      {/* Voile : ferme au clic, et assombrit sans masquer le tableau. */}
      <button
        type="button"
        aria-label="Fermer l'espace de travail"
        className="absolute inset-0 bg-[var(--overlay)]"
        onClick={onClose}
        data-testid="asset-workspace-scrim"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={asset ? `Espace de travail — ${asset.name}` : "Espace de travail"}
        className="workspace-panel"
        data-testid="asset-workspace-panel"
      >
        {/* ── En-tête ────────────────────────────────────────────── */}
        <header
          className="workspace-head"
          data-testid="asset-detail-header"
        >
          <div className="flex min-w-0 items-start gap-[var(--space-3)]">
            <PlatformLogo
              src={asset?.assetLogoUrl}
              name={asset?.name || "—"}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[length:var(--text-lg)] font-semibold text-[var(--foreground)]">
                {asset?.name || (loading ? "Chargement…" : "Actif")}
              </h2>
              <p className="text-meta flex min-w-0 flex-wrap items-center gap-x-[var(--space-2)]">
                {asset?.ticker && (
                  <span className="num">{asset.ticker}</span>
                )}
                {asset?.assetClass && (
                  <span>{getAssetClassLabel(asset.assetClass)}</span>
                )}
                {asset?.accountType && (
                  <span>
                    {ACCOUNT_TYPES[asset.accountType as AccountType] ??
                      asset.accountType}
                  </span>
                )}
                {asset?.isin && <span className="num">{asset.isin}</span>}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              onClick={onClose}
              aria-label="Fermer"
              data-testid="asset-workspace-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {holding && (
            <div
              className="mt-[var(--space-3)] flex flex-wrap items-baseline gap-x-[var(--space-5)] gap-y-[var(--space-1)]"
              data-testid="asset-detail-position-value"
            >
              <div>
                <div className="text-label">Valeur</div>
                <div className="num text-[length:var(--text-2xl)] font-semibold text-[var(--foreground)]">
                  {formatCurrency(marketValue ?? 0, baseCurrency)}
                </div>
              </div>
              {pnl != null && (
                <div>
                  <div className="text-label">P&amp;L latent</div>
                  <div
                    className={cn(
                      "num text-[length:var(--text-lg)] font-medium",
                      getChangeColor(pnl)
                    )}
                  >
                    {pnl >= 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(pnl), baseCurrency)}
                  </div>
                </div>
              )}
            </div>
          )}
        </header>

        {/* ── Onglets ────────────────────────────────────────────── */}
        <nav
          className="workspace-tabs"
          role="tablist"
          aria-label="Sections de l'actif"
          data-testid="asset-workspace-tabs"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeSection === s.id}
              className="workspace-tab"
              data-active={activeSection === s.id ? "true" : "false"}
              data-backing={s.backing}
              title={s.hint}
              data-testid={
                s.id === "transactions"
                  ? "asset-detail-tab-transactions"
                  : `asset-workspace-tab-${s.id}`
              }
              onClick={() => setSection(s.id)}
            >
              {s.label}
              {s.id === "transactions" &&
                (data?.transactions.length ?? 0) > 0 && (
                  <span className="num ml-[var(--space-1)] opacity-70">
                    {data!.transactions.length}
                  </span>
                )}
            </button>
          ))}
        </nav>

        {/* ── Corps ──────────────────────────────────────────────── */}
        <div className="workspace-body" data-testid="asset-workspace-body">
          {loading && !data ? (
            <div
              className="space-y-[var(--space-3)]"
              data-testid="asset-detail-loading"
              aria-busy="true"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface-sunken)]"
                />
              ))}
            </div>
          ) : data ? (
            <WorkspaceSection
              section={activeSection}
              data={data}
              baseCurrency={baseCurrency}
              onEditTx={onEditTx}
              onDeleteTx={onDeleteTx}
              onAddTransaction={onAddTransaction}
              onEditCategory={onEditCategory}
            />
          ) : (
            <p className="text-meta">Aucun détail disponible pour cet actif.</p>
          )}
        </div>
      </div>
    </div>
  );
}
