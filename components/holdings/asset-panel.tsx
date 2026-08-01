"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Blocks,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  Folder,
  Image as ImageIcon,
  Landmark,
  LineChart,
  Newspaper,
  Scale,
  X,
  type LucideIcon,
} from "lucide-react";
import { AssetLogo } from "@/components/ui/platform-logo";
import { Sparkline } from "@/components/ui/sparkline";
import {
  sectionsForAsset,
  type AssetWorkspaceSectionId,
} from "@/app/lib/portfolio/asset-workspace-sections";
import {
  formatCurrency,
  formatQuantity,
  formatSignedCurrency,
  formatSignedPercent,
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

/**
 * Fenêtres du graphique de tête.
 *
 * Ce sont des plages et non des unités de temps : « 3 mois » est une question
 * que l'on se pose, « bougies de 4 heures » un réglage. La séance intraday du
 * mockup n'y figure pas — un OPCVM, une SCPI ou un bien immobilier n'ont pas
 * de cours dans la journée, et une plage vide sur la moitié du portefeuille
 * n'est pas une fenêtre, c'est un piège.
 *
 * `1m` par défaut : c'est ce que le panneau chargeait déjà, donc ouvrir une
 * fiche ne coûte pas un aller-retour de plus qu'avant.
 */
const PANEL_RANGES = [
  { id: "7d", label: "7 J" },
  { id: "1m", label: "1 M" },
  { id: "3m", label: "3 M" },
  { id: "1y", label: "1 A" },
  { id: "all", label: "TOUT" },
] as const;

type PanelRange = (typeof PANEL_RANGES)[number]["id"];

const DEFAULT_RANGE: PanelRange = "1m";

/** Points du graphique de tête — au-delà, la courbe se tasse sans rien gagner. */
const MINI_POINTS = 120;

/**
 * Une icône par section. Elles vivent ici et non dans le registre : celui-ci
 * est une donnée pure, testée, et n'a pas à connaître de composants React.
 */
const SECTION_ICONS: Record<AssetWorkspaceSectionId, LucideIcon> = {
  overview: LineChart,
  performance: LineChart,
  transactions: ArrowLeftRight,
  platforms: Landmark,
  costBasis: Scale,
  income: Coins,
  tax: FileText,
  defi: Blocks,
  nfts: ImageIcon,
  news: Newspaper,
  documents: Folder,
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Une ligne du bloc « position ».
 *
 * Étiquette en capitales à gauche, valeur alignée à droite : le bloc se lit en
 * colonne, l'œil descend les valeurs sans relire les intitulés.
 */
function Fact({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  /** Seconde ligne sous la valeur — le pourcentage sous le montant. */
  sub?: React.ReactNode;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]">
      <dt className="text-label">{label}</dt>
      <dd
        className={cn(
          "shrink-0 text-right",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          !tone && "text-[var(--foreground)]"
        )}
      >
        <span className="num block text-[length:var(--text-xs)] font-medium">
          {value}
        </span>
        {sub != null && (
          <span className="num block text-[length:var(--text-2xs)]">{sub}</span>
        )}
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
    Courbe de tête et variation de séance.

    Les deux dernières clôtures donnent la variation, la fenêtre choisie donne
    la courbe : inutile d'ajouter une route pour cela.
  */
  const [range, setRange] = useState<PanelRange>(DEFAULT_RANGE);

  // Changer d'actif remet la fenêtre par défaut, comme pour la section : la
  // plage choisie sur la ligne précédente n'a pas de sens sur la suivante.
  const [seenRangeAsset, setSeenRangeAsset] = useState(assetId);
  if (assetId !== seenRangeAsset) {
    setSeenRangeAsset(assetId);
    setRange(DEFAULT_RANGE);
  }

  const historyQ = useQuery({
    queryKey: ["asset-history", assetId, "panel", `range:${range}`],
    enabled: Boolean(assetId),
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<PriceHistoryResult>(
        `/api/assets/${assetId}/history?range=${range}`
      ),
  });

  /*
    Une série `mock` est écartée, pas dessinée.

    Le service de cours en fabrique une quand aucun fournisseur ne répond, pour
    qu'un graphique d'illustration ne reste pas vide. Ici, elle produirait une
    courbe et une variation de séance qui ont toutes les apparences d'un cours
    réel — sur un écran patrimonial, c'est pire qu'une case vide. Le cache de
    clôtures applique déjà exactement cette règle.
  */
  const isMock = historyQ.data?.source === "mock";

  const mini = useMemo(() => {
    const closes = (isMock ? [] : historyQ.data?.points ?? [])
      .map((p) => Number(p.close))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(-MINI_POINTS);
    if (closes.length < 2) {
      return {
        closes,
        changePct: null as number | null,
        change: null as number | null,
      };
    }
    const last = closes[closes.length - 1]!;
    const prev = closes[closes.length - 2]!;
    return {
      closes,
      change: last - prev,
      changePct: prev > 0 ? ((last - prev) / prev) * 100 : null,
    };
  }, [historyQ.data?.points, isMock]);

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
      {/*
        Bandeau du panneau : il nomme la colonne et porte sa fermeture. Sans
        lui, la croix flottait au-dessus du nom de l'actif et se lisait comme
        « supprimer cet actif » plutôt que « refermer le détail ».
      */}
      <div className="asset-panel-bar">
        <span className="text-label">Détail</span>
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

      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="asset-panel-head" data-testid="asset-panel-head">
        <div className="flex min-w-0 items-center gap-[var(--space-3)]">
          <AssetLogo
            src={asset?.assetLogoUrl}
            name={asset?.name || "—"}
            ticker={asset?.ticker}
            isin={asset?.isin}
            assetClass={asset?.assetClass}
            size={36}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[length:var(--text-base)] font-semibold text-[var(--foreground)]">
              {asset?.name || (loading ? "Chargement…" : "Actif")}
            </h2>
            {/* « BTC · CRYPTO » : le ticker identifie, la classe situe. Le
                point médian les sépare sans peser comme un séparateur. */}
            <p className="text-label truncate">
              {[asset?.ticker, asset?.assetClass && getAssetClassLabel(asset.assetClass)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        {/* ── Cours et séance ────────────────────────────────────── */}
        {quote && (
          <div className="mt-[var(--space-3)]" data-testid="asset-panel-quote">
            <p className="flex items-baseline gap-[var(--space-2)] leading-none">
              <span className="num text-[length:var(--text-2xl)] font-semibold text-[var(--foreground)]">
                {formatCurrency(num(quote.priceNative), quote.nativeCurrency)}
              </span>
              <span className="text-label shrink-0">
                {quote.nativeCurrency}
              </span>
            </p>
            <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] leading-none">
              {mini.changePct != null && mini.change != null ? (
                <span
                  className={cn(
                    "num",
                    mini.changePct >= 0 ? "val-positive" : "val-negative"
                  )}
                >
                  {formatSignedCurrency(mini.change, quote.nativeCurrency)} (
                  {formatSignedPercent(mini.changePct)}){" "}
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

            <div className="mt-[var(--space-3)] h-[4rem] w-full">
              {mini.closes.length >= 2 ? (
                <Sparkline
                  values={mini.closes}
                  stroke="var(--chart-gold)"
                  fill
                  width={320}
                  height={64}
                  className="h-full w-full"
                />
              ) : (
                <span className="flex h-full items-center text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                  {historyQ.isPending
                    ? "Chargement de l'historique…"
                    : isMock
                      ? "Aucun cours réel pour cet actif — courbe non tracée"
                      : "Pas d'historique de cours sur cette période"}
                </span>
              )}
            </div>

            {/* Fenêtres du graphique — mêmes pastilles que partout ailleurs. */}
            <div
              className="term-seg mt-[var(--space-3)] w-full justify-between"
              role="group"
              aria-label="Fenêtre du graphique"
              data-testid="asset-panel-ranges"
            >
              {PANEL_RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="term-seg-item flex-1"
                  data-active={r.id === range}
                  aria-pressed={r.id === range}
                  onClick={() => setRange(r.id)}
                  data-testid={`asset-panel-range-${r.id}`}
                >
                  {r.label}
                </button>
              ))}
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
                label="PRU"
                value={
                  avgCost != null ? formatCurrency(avgCost, baseCurrency) : "—"
                }
              />
              <Fact
                label="Valeur totale"
                value={
                  marketValue != null
                    ? formatCurrency(marketValue, baseCurrency)
                    : "—"
                }
              />
              {/* Montant et proportion sur une seule ligne, comme la colonne
                  « Variation » du tableau : même donnée, même grammaire. */}
              <Fact
                label="P&L"
                value={
                  pnl != null ? formatSignedCurrency(pnl, baseCurrency) : "—"
                }
                sub={pnlPct != null ? formatSignedPercent(pnlPct) : undefined}
                tone={
                  pnl == null ? undefined : pnl >= 0 ? "positive" : "negative"
                }
              />

              {/* Le poids ne se calcule pas ici — le panneau ne connaît qu'un
                  actif. Il vient de l'écran, et vaut `null` s'il est inconnu. */}
              {portfolioSharePct != null && (
                <div
                  className="flex items-end justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                  data-testid="asset-panel-share"
                >
                  <dt className="min-w-0 flex-1">
                    <span className="text-label block">Répartition globale</span>
                    {/* La barre sous l'étiquette et non à côté du nombre : elle
                        illustre la part, elle ne la répète pas. */}
                    <span
                      className="mt-[var(--space-1)] block h-[0.25rem] w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
                      role="img"
                      aria-label={`${portfolioSharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du portefeuille`}
                    >
                      <span
                        className="block h-full rounded-full bg-[var(--chart-gold)]"
                        style={{
                          width: `${Math.min(100, Math.max(0, portfolioSharePct))}%`,
                        }}
                      />
                    </span>
                  </dt>
                  <dd className="num shrink-0 text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                    {portfolioSharePct.toLocaleString("fr-FR", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    %
                  </dd>
                </div>
              )}

              <Fact
                label="Mise à jour"
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
                .map((s) => {
                  const Icon = SECTION_ICONS[s.id];
                  return (
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
                    {/* L'icône se reconnaît avant que le mot ne se lise : sur
                        dix entrées, elle divise le temps de repérage. */}
                    <Icon
                      className="h-3.5 w-3.5 shrink-0 text-[var(--foreground-faint)]"
                      aria-hidden
                    />
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
                  );
                })}
            </nav>
          </>
        )}
      </div>
    </aside>
  );
}
