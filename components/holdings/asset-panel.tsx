"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { AssetLogo } from "@/components/ui/platform-logo";
import { Sparkline } from "@/components/ui/sparkline";
import {
  sectionsForAsset,
  type AssetWorkspaceSectionId,
} from "@/app/lib/portfolio/asset-workspace-sections";
import {
  formatCurrency,
  formatQuantity,
  getAssetClassLabel,
  cn,
} from "@/app/lib/utils";
import { ACCOUNT_TYPES, type AccountType } from "@/app/lib/constants";
import { fetchJson } from "@/app/lib/api-client";
import type { PriceHistoryResult } from "@/app/lib/market/price-history-types";
import { WorkspaceSection } from "@/components/holdings/asset-workspace-sections";
import type { AssetWorkspaceData } from "@/components/holdings/asset-workspace-sections";
import { formatRelativeUpdate } from "@/components/holdings/holding-table-row";
import type { TxRow } from "@/app/lib/types/ui";

export type { AssetWorkspaceData };

/**
 * Colonne de détail de l'actif sélectionné.
 *
 * Ancrée dans la page, jamais en surimpression : le tableau reste lisible à
 * gauche, la sélection reste visible, et passer d'une ligne à l'autre ne
 * demande de refermer quoi que ce soit. C'était l'inverse auparavant — un
 * panneau modal, avec voile et piège à focus, qui masquait le portefeuille au
 * moment précis où l'on voulait y situer une position.
 *
 * La colonne n'a qu'une source : `data`, dérivée de l'actif sélectionné. Elle
 * ne décide de rien, ne navigue nulle part, ne connaît pas la liste.
 */

/** Un mois de clôtures : assez pour une pente, pas plus qu'une vignette. */
const MINI_POINTS = 30;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

function formatSignedCurrency(v: number, currency: string): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), currency)}`;
}

/** Une ligne du bloc « position ». */
function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]">
      <dt className="text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
        {label}
      </dt>
      <dd
        className={cn(
          "num shrink-0 text-[length:var(--text-xs)] font-medium",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function AssetPanel({
  loading,
  data,
  baseCurrency,
  portfolioSharePct,
  onClose,
  onEditTx,
  onDeleteTx,
  onAddTransaction,
  onEditCategory,
  className,
}: {
  loading: boolean;
  data?: AssetWorkspaceData | null;
  baseCurrency: string;
  /** Poids de l'actif dans le portefeuille, en %. `null` si inconnu. */
  portfolioSharePct?: number | null;
  /** Vide la sélection. */
  onClose: () => void;
  onEditTx: (t: TxRow) => void;
  onDeleteTx: (id: string) => void;
  onAddTransaction?: (type?: string) => void;
  onEditCategory?: () => void;
  className?: string;
}) {
  /** `null` = sommaire (informations + liste des sections). */
  const [section, setSection] = useState<AssetWorkspaceSectionId | null>(null);

  const assetId = data?.asset.id ?? null;
  const sections = useMemo(
    () => sectionsForAsset({ assetClass: data?.asset.assetClass }),
    [data?.asset.assetClass]
  );

  /*
    Changer d'actif ramène au sommaire. Rester sur « Fiscalité » parce que
    c'est là qu'on avait laissé le précédent ne rend service à personne, et la
    section ouverte peut ne pas exister sur le suivant (DeFi, NFT liés).

    Recalage pendant le rendu plutôt que dans un effet : React repart avec le
    bon état avant de peindre, là où un effet montrerait d'abord la mauvaise
    section.
  */
  const [seenAssetId, setSeenAssetId] = useState(assetId);
  if (assetId !== seenAssetId) {
    setSeenAssetId(assetId);
    setSection(null);
  }

  /*
    Vignette de tendance et variation de séance.

    Les deux dernières clôtures donnent la variation, les trente dernières la
    courbe : inutile d'ajouter une route pour cela. La requête partage sa clé
    avec le graphique complet de la section « Performance » — même cache, aucun
    aller-retour en double quand on ouvre celle-ci.
  */
  const historyQ = useQuery({
    queryKey: ["asset-history", assetId, "price", "tf:1d", null],
    enabled: Boolean(assetId),
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<PriceHistoryResult>(
        `/api/assets/${assetId}/history?interval=1d`
      ),
  });

  const mini = useMemo(() => {
    const closes = (historyQ.data?.points ?? [])
      .map((p) => Number(p.close))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(-MINI_POINTS);
    if (closes.length < 2) return { closes, changePct: null as number | null };
    const last = closes[closes.length - 1]!;
    const prev = closes[closes.length - 2]!;
    return {
      closes,
      changePct: prev > 0 ? ((last - prev) / prev) * 100 : null,
    };
  }, [historyQ.data?.points]);

  /* ── Aucun actif sélectionné ─────────────────────────────────────── */

  if (!data && !loading) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="asset-panel"
        /*
          Rien de sélectionné. En grand écran la colonne reste en place et
          invite au clic ; sous 1280 px, où elle se superpose au tableau, elle
          doit s'effacer — sinon elle recouvre le portefeuille en permanence.
          Le CSS décide, à partir de cet attribut.
        */
        data-open="false"
        aria-label="Détail de l'actif"
      >
        <div className="asset-panel-empty" data-testid="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucun actif sélectionné
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez une ligne du portefeuille pour afficher son détail ici. La
            liste reste en place.
          </p>
        </div>
      </aside>
    );
  }

  const asset = data?.asset;
  const holding = data?.holding;
  const qty = holding ? num(holding.quantity) : null;
  const avgCost = holding ? num(holding.avgCostEur) : null;
  const marketValue = holding ? num(holding.marketValueEur) : null;
  const costBasis = qty != null && avgCost != null ? qty * avgCost : null;
  const pnl =
    marketValue != null && costBasis != null ? marketValue - costBasis : null;
  const pnlPct =
    pnl != null && costBasis != null && costBasis > 0
      ? (pnl / costBasis) * 100
      : null;

  const quote = asset?.priceQuote ?? null;
  const openSection = section
    ? sections.find((s) => s.id === section) ?? null
    : null;

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="asset-panel"
      data-open="true"
      aria-label={asset ? `Détail — ${asset.name}` : "Détail de l'actif"}
      /*
        La clé change avec l'actif : React remonte le sous-arbre, ce qui rejoue
        l'animation d'entrée. Sans elle, passer d'une ligne à l'autre
        remplacerait les nombres sans que rien ne signale le changement.
      */
      key={assetId ?? "none"}
    >
      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="asset-panel-head" data-testid="asset-panel-head">
        <div className="flex min-w-0 items-start gap-[var(--space-3)]">
          <AssetLogo
            src={asset?.assetLogoUrl}
            name={asset?.name || "—"}
            ticker={asset?.ticker}
            isin={asset?.isin}
            assetClass={asset?.assetClass}
            size={32}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[length:var(--text-base)] font-semibold text-[var(--foreground)]">
              {asset?.name || (loading ? "Chargement…" : "Actif")}
            </h2>
            <p className="text-meta flex min-w-0 flex-wrap items-center gap-x-[var(--space-2)]">
              {asset?.ticker && <span className="num">{asset.ticker}</span>}
              {asset?.assetClass && (
                <span>{getAssetClassLabel(asset.assetClass)}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="asset-panel-close"
            onClick={onClose}
            aria-label="Fermer le détail"
            data-testid="asset-panel-close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* ── Cours et séance ────────────────────────────────────── */}
        {quote && (
          <div className="mt-[var(--space-3)]" data-testid="asset-panel-quote">
            <p className="flex items-baseline gap-[var(--space-2)] leading-none">
              <span className="num text-[length:var(--text-xl)] font-semibold text-[var(--foreground)]">
                {formatCurrency(num(quote.priceNative), quote.nativeCurrency)}
              </span>
              <span className="text-label shrink-0">
                {quote.nativeCurrency}
              </span>
            </p>
            <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] leading-none">
              {mini.changePct != null ? (
                <span
                  className={cn(
                    "num",
                    mini.changePct >= 0 ? "val-positive" : "val-negative"
                  )}
                >
                  {formatSignedPct(mini.changePct)}{" "}
                  <span className="text-[var(--foreground-faint)]">séance</span>
                </span>
              ) : (
                /* Sans deux clôtures la variation est inconnue — et un
                   « 0,00 % » se lirait « stable », ce qui serait faux. */
                <span className="text-[var(--foreground-faint)]">
                  Variation de séance indisponible
                </span>
              )}
            </p>

            <div className="mt-[var(--space-2)] h-[2.5rem] w-full">
              {mini.closes.length >= 2 && (
                <Sparkline
                  values={mini.closes}
                  stroke={
                    (mini.changePct ?? 0) >= 0
                      ? "var(--chart-positive)"
                      : "var(--chart-negative)"
                  }
                  width={320}
                  height={40}
                  className="h-full w-full"
                />
              )}
            </div>
          </div>
        )}
      </header>

      {/* ── Corps défilant ───────────────────────────────────────── */}
      <div className="asset-panel-body" data-testid="asset-panel-body">
        {loading && !data ? (
          <div
            className="space-y-[var(--space-3)]"
            data-testid="asset-detail-loading"
            aria-busy="true"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface-sunken)]"
              />
            ))}
          </div>
        ) : !data ? null : openSection ? (
          <>
            <button
              type="button"
              className="asset-panel-back"
              onClick={() => setSection(null)}
              data-testid="asset-panel-back"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Détail de la position
            </button>
            <WorkspaceSection
              section={openSection.id}
              data={data}
              baseCurrency={baseCurrency}
              onEditTx={onEditTx}
              onDeleteTx={onDeleteTx}
              onAddTransaction={onAddTransaction}
              onEditCategory={onEditCategory}
              portfolioSharePct={portfolioSharePct}
            />
          </>
        ) : (
          <>
            <dl className="asset-panel-facts" data-testid="asset-panel-facts">
              <Fact label="Plateforme" value={asset?.platformName || "—"} />
              <Fact
                label="Enveloppe"
                value={
                  asset?.accountType
                    ? ACCOUNT_TYPES[asset.accountType as AccountType] ??
                      asset.accountType
                    : "—"
                }
              />
              <Fact
                label="Quantité"
                value={qty != null ? formatQuantity(qty) : "—"}
              />
              <Fact
                label="Prix de revient"
                value={
                  avgCost != null ? formatCurrency(avgCost, baseCurrency) : "—"
                }
              />
              <Fact
                label="Valeur actuelle"
                value={
                  marketValue != null
                    ? formatCurrency(marketValue, baseCurrency)
                    : "—"
                }
              />
              <Fact
                label="Plus/moins-value"
                value={
                  pnl != null ? formatSignedCurrency(pnl, baseCurrency) : "—"
                }
                tone={
                  pnl == null ? undefined : pnl >= 0 ? "positive" : "negative"
                }
              />
              <Fact
                label="Performance"
                value={pnlPct != null ? formatSignedPct(pnlPct) : "—"}
                tone={
                  pnlPct == null
                    ? undefined
                    : pnlPct >= 0
                      ? "positive"
                      : "negative"
                }
              />

              {/* Le poids ne se calcule pas ici — le panneau ne connaît qu'un
                  actif. Il vient de l'écran, et vaut `null` s'il est inconnu. */}
              {portfolioSharePct != null && (
                <div
                  className="flex items-center justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                  data-testid="asset-panel-share"
                >
                  <dt className="text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                    Poids du portefeuille
                  </dt>
                  <dd className="flex min-w-0 flex-1 items-center justify-end gap-[var(--space-2)]">
                    <div
                      className="h-[0.3rem] w-[5rem] overflow-hidden rounded-full bg-[var(--surface-raised)]"
                      role="img"
                      aria-label={`${portfolioSharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du portefeuille`}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--chart-gold)]"
                        style={{
                          width: `${Math.min(100, Math.max(0, portfolioSharePct))}%`,
                        }}
                      />
                    </div>
                    <span className="num shrink-0 text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                      {portfolioSharePct.toLocaleString("fr-FR", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      %
                    </span>
                  </dd>
                </div>
              )}

              <Fact
                label="Dernière mise à jour"
                value={
                  quote?.lastUpdatedAt
                    ? formatRelativeUpdate(quote.lastUpdatedAt)
                    : "—"
                }
              />
            </dl>

            {/* ── Sections ─────────────────────────────────────── */}
            <nav
              className="asset-panel-sections"
              aria-label="Sections de l'actif"
              data-testid="asset-panel-sections"
            >
              {sections
                .filter((s) => s.id !== "overview")
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="asset-panel-section-link"
                    onClick={() => setSection(s.id)}
                    title={s.hint}
                    data-backing={s.backing}
                    data-testid={
                      s.id === "transactions"
                        ? "asset-detail-tab-transactions"
                        : `asset-panel-section-${s.id}`
                    }
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {s.label}
                    </span>
                    {s.id === "transactions" &&
                      data.transactions.length > 0 && (
                        <span className="num text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                          {data.transactions.length}
                        </span>
                      )}
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-[var(--foreground-faint)]"
                      aria-hidden
                    />
                  </button>
                ))}
            </nav>
          </>
        )}
      </div>
    </aside>
  );
}
