"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { CurrencyBadge } from "@/components/ui/currency-badge";
import { AssetPriceChart } from "@/components/assets/asset-price-chart";
import { AssetRelatedNews } from "@/components/assets/asset-related-news";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import {
  TxTypeFilters,
  matchesTxTypeFilter,
  txTypeFilterEmptyHint,
  type TxTypeFilterId,
  TX_TYPE_FILTERS,
} from "@/components/transactions/tx-type-filters";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import {
  formatCurrency,
  formatCurrencyPrecise,
  formatDate,
  formatQuantity,
  formatUnitPrice,
  getAssetClassLabel,
  getChangeColor,
  cn,
} from "@/app/lib/utils";
import { assetCategoryLabel } from "@/app/lib/assets/categories";
import {
  decomposeUnrealizedPnl,
  type BuyLotLite,
} from "@/app/lib/portfolio/fx-pnl";
import type { TxRow } from "@/app/lib/types/ui";

type CustodySlice = {
  platformId: string;
  platformName: string;
  platformLogoUrl: string | null;
  blockchainKey: string;
  blockchainLabel: string;
  assetId: string;
  quantity: number;
  marketValueEur: number;
  quantityPct: number;
  valuePct: number;
};

type AssetDetail = {
  asset: {
    id: string;
    name: string;
    ticker: string | null;
    assetClass: string;
    category?: string | null;
    currency: string;
    accountType?: string;
    countryCode?: string | null;
    withholdingTaxRate?: string | null;
    isin?: string | null;
    platformName: string;
    platformLogoUrl: string | null;
    blockchainKey?: string | null;
    blockchainLabel?: string | null;
    platformCount?: number;
    siblingAssetIds?: string[];
    assetLogoUrl: string | null;
    priceQuote: {
      priceNative: string;
      priceEur: string;
      nativeCurrency: string;
      source: string;
      status: string;
      lastUpdatedAt: string;
    } | null;
  };
  holding: {
    quantity: string;
    avgCostEur: string;
    marketValueEur: string;
  } | null;
  custodyDistribution?: CustodySlice[];
  platforms?: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    assetId: string;
  }>;
  transactions: Array<{
    id: string;
    type: string;
    occurredAt: string;
    quantity: string | null;
    unitPrice: string | null;
    fees: string;
    currency: string;
    fxRateToEur: string;
    grossAmountEur: string;
    feesEur?: string;
    netCashImpactEur: string;
    withholdingTaxEur?: string;
    withholdingTaxRate?: string | null;
    exDate?: string | null;
    paymentDate?: string | null;
    notes: string | null;
    platformId: string;
    platformName?: string | null;
    platformLogoUrl?: string | null;
    toPlatformId?: string | null;
    assetId?: string | null;
  }>;
};

const TX_QUICK: { type: string; label: string }[] = [
  { type: "ACHAT", label: "Achat" },
  { type: "VENTE", label: "Vente" },
  { type: "DIVIDENDE", label: "Dividende" },
  { type: "FRAIS", label: "Frais" },
];

export function AssetDetailModal({
  open,
  loading,
  data,
  onClose,
  onEditTx,
  onDeleteTx,
  onAddTransaction,
  onEditCategory,
}: {
  open: boolean;
  loading: boolean;
  data?: AssetDetail | null;
  onClose: () => void;
  onEditTx: (t: TxRow) => void;
  onDeleteTx: (id: string) => void;
  /** Nouvelle opération préremplie sur cet actif */
  onAddTransaction?: (type?: string) => void;
  onEditCategory?: () => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TxTypeFilterId>("all");
  /** Filtre historique par plateforme ("" = toutes) */
  const [platformFilter, setPlatformFilter] = useState("");
  const [txMenuOpen, setTxMenuOpen] = useState(false);
  const [whtOpen, setWhtOpen] = useState(false);
  const txMenuRef = useRef<HTMLDivElement>(null);

  // Reset filtres type à chaque changement d'actif / réouverture
  useEffect(() => {
    if (open) {
      setTypeFilter("all");
      setPlatformFilter("");
      setTxMenuOpen(false);
      setWhtOpen(false);
    }
  }, [open, data?.asset.id]);

  useEffect(() => {
    if (!txMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!txMenuRef.current?.contains(e.target as Node)) setTxMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [txMenuOpen]);

  const txs = useMemo(
    () => data?.transactions ?? [],
    [data?.transactions]
  );

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<TxTypeFilterId, number>> = { all: txs.length };
    for (const f of TX_TYPE_FILTERS) {
      if (f.id === "all") continue;
      counts[f.id] = txs.filter((t) => matchesTxTypeFilter(t.type, f.id)).length;
    }
    return counts;
  }, [txs]);

  const filteredTxs = useMemo(() => {
    return txs
      .filter((t) => matchesTxTypeFilter(t.type, typeFilter))
      .filter((t) => !platformFilter || t.platformId === platformFilter)
      .slice()
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      );
  }, [txs, typeFilter, platformFilter]);

  const platformOptions = useMemo(() => {
    if (data?.platforms && data.platforms.length > 0) return data.platforms;
    const byId = new Map<string, { id: string; name: string }>();
    for (const t of txs) {
      if (t.platformId && !byId.has(t.platformId)) {
        byId.set(t.platformId, {
          id: t.platformId,
          name: t.platformName || t.platformId,
        });
      }
    }
    return [...byId.values()];
  }, [data?.platforms, txs]);

  const multiPlatform = (data?.asset.platformCount ?? platformOptions.length) > 1;

  /** Valeur marché + repli si quote absente (qty × cours ou coût). */
  const positionValue = useMemo(() => {
    if (!data?.holding) return null;
    const qty = Number(data.holding.quantity);
    let mv = Number(data.holding.marketValueEur);
    if (!Number.isFinite(mv) || Math.abs(mv) < 1e-12) {
      const px = data.asset.priceQuote
        ? Number(data.asset.priceQuote.priceEur)
        : Number(data.holding.avgCostEur);
      if (Number.isFinite(qty) && Number.isFinite(px)) mv = qty * px;
    }
    return {
      qty,
      marketValueEur: Number.isFinite(mv) ? mv : 0,
      avgCostEur: Number(data.holding.avgCostEur) || 0,
    };
  }, [data]);

  /** Décomposition coût d’acquisition (achats du journal). */
  const acquisitionBreakdown = useMemo(() => {
    const buys = txs.filter((t) => t.type === "ACHAT");
    if (buys.length === 0) return null;
    let gross = 0;
    let fees = 0;
    for (const t of buys) {
      const q = Number(t.quantity || 0);
      const p = Number(t.unitPrice || 0);
      const fx = Number(t.fxRateToEur || 1) || 1;
      if (Number.isFinite(q) && Number.isFinite(p)) gross += q * p * fx;
      const fe = Number(t.feesEur ?? t.fees ?? 0);
      if (Number.isFinite(fe)) {
        // feesEur déjà en EUR ; sinon fees natifs × fx
        fees += t.feesEur != null ? fe : fe * fx;
      }
    }
    return {
      gross,
      fees,
      // « Moins les frais » → montant net acquis (valeur économique hors frais)
      net: gross - fees,
      buyCount: buys.length,
    };
  }, [txs]);

  const isCrypto = data?.asset.assetClass === "CRYPTO";

  if (!open) return null;

  return (
    <Modal
      title={data?.asset.name || "Détail de l'actif"}
      onClose={onClose}
      wide
      panelClassName="w-[min(72vw,calc(100vw-2rem))] max-w-[900px]"
    >
      {loading && (
        <div className="flex flex-col gap-3" data-testid="asset-detail-loading">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-2.5 py-2">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 animate-pulse rounded-full bg-[var(--muted)]" />
              <div className="space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-[var(--muted)]" />
                <div className="h-2.5 w-48 animate-pulse rounded bg-[var(--muted)]" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="ml-auto h-2.5 w-16 animate-pulse rounded bg-[var(--muted)]" />
              <div className="ml-auto h-5 w-24 animate-pulse rounded bg-[var(--muted)]" />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-[var(--muted)]"
              />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-lg bg-[var(--muted)]" />
          <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between gap-3">
                <div className="h-3 w-40 animate-pulse rounded bg-[var(--muted)]" />
                <div className="h-3 w-28 animate-pulse rounded bg-[var(--muted)]" />
              </div>
            ))}
          </div>
        </div>
      )}
      {data && (
        <div className="flex flex-col gap-3">
          {/* Header compact (~70–80px) */}
          <div
            className="flex min-h-0 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-2.5 py-1.5"
            data-testid="asset-detail-header"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <PlatformLogo
                src={data.asset.assetLogoUrl}
                name={data.asset.name}
                size={36}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-tight">
                  {data.asset.name}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums">
                    {data.asset.ticker || "—"}
                  </span>
                  <span>·</span>
                  <span>{getAssetClassLabel(data.asset.assetClass)}</span>
                  <span>·</span>
                  <span data-testid="asset-detail-category">
                    {assetCategoryLabel(data.asset.category)}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <PlatformLogo
                      src={data.asset.platformLogoUrl}
                      name={data.asset.platformName}
                      size={14}
                    />
                    {data.asset.platformName}
                  </span>
                  {isCrypto && data.asset.blockchainLabel && (
                    <>
                      <span>·</span>
                      <span
                        className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100"
                        data-testid="asset-detail-blockchain"
                      >
                        {data.asset.blockchainLabel}
                      </span>
                    </>
                  )}
                  {multiPlatform && (
                    <>
                      <span>·</span>
                      <span
                        className="rounded-full border border-teal-600/25 bg-teal-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-900 dark:text-teal-100"
                        data-testid="asset-detail-platform-count"
                        title={platformOptions.map((p) => p.name).join(" · ")}
                      >
                        {data.asset.platformCount ?? platformOptions.length}{" "}
                        plateformes
                      </span>
                    </>
                  )}
                  <CurrencyBadge code={data.asset.currency} className="!py-0 !text-[10px]" />
                </div>
              </div>
            </div>
            {positionValue && (
              <div
                className="shrink-0 text-right leading-tight"
                data-testid="asset-detail-position-value"
              >
                <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Valeur totale
                </div>
                <div className="text-base font-semibold tabular-nums sm:text-lg">
                  {formatCurrency(positionValue.marketValueEur, "EUR")}
                </div>
                <div className="mt-0.5 max-w-[22rem] text-[10px] tabular-nums text-[var(--muted-foreground)]">
                  Qté{" "}
                  <span className="font-medium text-[var(--foreground)]">
                    {formatQuantity(positionValue.qty)}
                  </span>
                  {" · "}
                  CUMP {formatCurrency(positionValue.avgCostEur, "EUR")}
                  {data.asset.priceQuote && (
                    <>
                      {" · "}
                      Cours{" "}
                      {formatUnitPrice(
                        data.asset.priceQuote.priceNative,
                        data.asset.priceQuote.nativeCurrency,
                        { crypto: isCrypto }
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {isCrypto &&
            (data.custodyDistribution?.length ?? 0) > 0 && (
              <div
                className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-2.5"
                data-testid="asset-detail-custody"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Répartition plateformes / blockchains
                    </h3>
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      Même ticker sur l&apos;enveloppe crypto — quantités et poids
                    </p>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {(data.custodyDistribution || []).map((slice) => (
                    <li
                      key={`${slice.assetId}-${slice.platformId}`}
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-transparent px-1 py-1 hover:border-[var(--border)] hover:bg-[var(--card)]"
                      data-testid="custody-slice"
                    >
                      <PlatformLogo
                        src={slice.platformLogoUrl}
                        name={slice.platformName}
                        size={20}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          {slice.platformName}
                        </div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">
                          {slice.blockchainLabel}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] tabular-nums">
                        <div className="font-medium">
                          {formatQuantity(slice.quantity)}
                          <span className="ml-1 text-[10px] font-normal text-[var(--muted-foreground)]">
                            ({slice.quantityPct.toFixed(1)} %)
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--muted-foreground)]">
                          {formatCurrency(slice.marketValueEur, "EUR")}
                          <span className="ml-1">
                            · {slice.valuePct.toFixed(1)} %
                          </span>
                        </div>
                      </div>
                      <div
                        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--muted)]"
                        title={`${slice.valuePct} % de la valeur`}
                      >
                        <div
                          className="h-full rounded-full bg-teal-600/80"
                          style={{
                            width: `${Math.min(100, Math.max(2, slice.valuePct))}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {acquisitionBreakdown && (
            <div
              className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5 sm:grid-cols-3"
              data-testid="asset-detail-cost-breakdown"
            >
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  Valeur dépensée brute
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                  {formatCurrency(acquisitionBreakdown.gross, "EUR")}
                </div>
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  Σ qty × prix ({acquisitionBreakdown.buyCount} achat
                  {acquisitionBreakdown.buyCount > 1 ? "s" : ""})
                </p>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                  Moins les frais
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
                  −{formatCurrency(acquisitionBreakdown.fees, "EUR")}
                </div>
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  Frais d’exécution cumulés
                </p>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  Montant net acquis
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(acquisitionBreakdown.net, "EUR")}
                </div>
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  Brut − frais (net acquis)
                </p>
              </div>
            </div>
          )}

          {data.holding && positionValue && (
            <FxPnlPanel
              currency={
                data.asset.priceQuote?.nativeCurrency || data.asset.currency
              }
              qty={positionValue.qty}
              avgCostEur={positionValue.avgCostEur}
              marketValueEur={positionValue.marketValueEur}
              priceNative={
                data.asset.priceQuote
                  ? Number(data.asset.priceQuote.priceNative)
                  : positionValue.avgCostEur
              }
              priceEur={
                data.asset.priceQuote
                  ? Number(data.asset.priceQuote.priceEur)
                  : positionValue.marketValueEur /
                    Math.max(positionValue.qty, 1e-12)
              }
              transactions={data.transactions}
            />
          )}

          <AssetPriceChart
            assetId={data.asset.id}
            enabled={open && Boolean(data.asset.id)}
            transactions={data.transactions.map((t) => ({
              type: t.type,
              occurredAt: t.occurredAt,
              quantity: t.quantity,
              unitPrice: t.unitPrice,
              fees: t.fees,
              fxRateToEur: t.fxRateToEur,
              grossAmountEur: t.grossAmountEur,
              feesEur: t.feesEur,
              netCashImpactEur: t.netCashImpactEur,
              withholdingTaxEur: t.withholdingTaxEur,
              withholdingTaxRate: t.withholdingTaxRate,
              paymentDate: t.paymentDate,
              exDate: t.exDate,
            }))}
            currentPriceEur={
              data.asset.priceQuote
                ? Number(data.asset.priceQuote.priceEur)
                : null
            }
            holdingQty={
              data.holding ? Number(data.holding.quantity) : null
            }
            holdingAvgCostEur={
              data.holding ? Number(data.holding.avgCostEur) : null
            }
          />

          <AssetRelatedNews
            ticker={data.asset.ticker}
            enabled={open && Boolean(data.asset.id)}
          />

          <div data-testid="asset-detail-history">
            {/* Ligne 1 — titre + compteur (+ catégorie discrète) */}
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold tracking-tight">
                  Historique des transactions
                </h4>
                <p className="text-meta">
                  {filteredTxs.length}/{txs.length} · le journal reste la source
                  de vérité
                </p>
              </div>
              {onEditCategory && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-[11px]"
                  data-testid="asset-detail-edit-category"
                  onClick={onEditCategory}
                  title="Classification UI (sans impact ledger)"
                >
                  <Tags className="h-3.5 w-3.5" />
                  Catégorie
                </Button>
              )}
            </div>

            {/* Ligne 2 — filtres (gauche) · action primaire Transaction (droite) */}
            <div
              className={cn(
                "mb-2 flex min-w-0 flex-col gap-2",
                "sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <TxTypeFilters
                  value={typeFilter}
                  onChange={setTypeFilter}
                  counts={typeCounts}
                  className="min-w-0 flex-1"
                />
                {multiPlatform && (
                  <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                    <span className="shrink-0 font-medium">Plateforme</span>
                    <select
                      className="input !w-auto min-w-[8rem] !py-1 text-[11px]"
                      value={platformFilter}
                      onChange={(e) => setPlatformFilter(e.target.value)}
                      data-testid="asset-detail-platform-filter"
                      aria-label="Filtrer l'historique par plateforme"
                    >
                      <option value="">Toutes ({txs.length})</option>
                      {platformOptions.map((p) => {
                        const n = txs.filter(
                          (t) => t.platformId === p.id
                        ).length;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {n > 0 ? ` (${n})` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                )}
              </div>
              {onAddTransaction && (
                <div
                  ref={txMenuRef}
                  className="relative inline-flex w-full shrink-0 shadow-sm sm:w-auto sm:justify-end"
                  data-testid="asset-detail-tx-actions"
                >
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 rounded-r-none sm:flex-initial"
                    data-testid="asset-detail-add-tx"
                    onClick={() => onAddTransaction("ACHAT")}
                    title="Nouvelle transaction sur cet actif"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Transaction
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-l-none border-l border-teal-900/20 px-1.5 dark:border-teal-950/40"
                    aria-expanded={txMenuOpen}
                    aria-haspopup="menu"
                    data-testid="asset-detail-add-tx-menu"
                    onClick={() => setTxMenuOpen((v) => !v)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  {txMenuOpen && (
                    <div
                      className="absolute right-0 top-full z-50 mt-1 min-w-[10rem] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] py-1 text-sm shadow-[var(--shadow-md)]"
                      role="menu"
                    >
                      {TX_QUICK.map((t) => (
                        <button
                          key={t.type}
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--muted)]"
                          onClick={() => {
                            setTxMenuOpen(false);
                            onAddTransaction(t.type);
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              className="max-h-80 space-y-0 overflow-auto rounded-lg border border-[var(--border)]"
              data-testid="asset-detail-tx-list"
            >
              {filteredTxs.map((t) => {
                const typeLabel =
                  TRANSACTION_TYPES[
                    t.type as keyof typeof TRANSACTION_TYPES
                  ] || t.type;
                const qtyStr =
                  t.quantity != null && t.quantity !== ""
                    ? formatQuantity(t.quantity)
                    : "—";
                const qtyN = Number(t.quantity);
                const pxN = Number(t.unitPrice);
                const feesN = Number(t.fees) || 0;
                const fx = Number(t.fxRateToEur) || 1;
                const hasTradeMath =
                  Number.isFinite(qtyN) &&
                  Number.isFinite(pxN) &&
                  Math.abs(qtyN) > 0 &&
                  ["ACHAT", "VENTE", "REWARD"].includes(t.type);
                const gross = hasTradeMath
                  ? Math.abs(qtyN * pxN) * fx
                  : null;
                const feesEur = hasTradeMath ? Math.abs(feesN) * fx : null;
                // UX consigne : brut (bleu) − frais (rouge) = net (vert)
                const net =
                  gross != null && feesEur != null
                    ? Math.max(0, gross - feesEur)
                    : null;

                return (
                  <div
                    key={t.id}
                    className="group/row flex items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2.5 first:border-t-0 hover:bg-[var(--muted)]/30"
                  >
                    <div className="min-w-0 flex-1 text-xs sm:text-sm">
                      <span className="font-medium text-[var(--foreground)]">
                        {typeLabel}
                      </span>
                      <span className="text-[var(--muted-foreground)]">
                        {" "}
                        - {formatDate(t.occurredAt)}
                      </span>
                      {multiPlatform && t.platformName && (
                        <span className="text-[var(--muted-foreground)]">
                          {" "}
                          · {t.platformName}
                        </span>
                      )}
                      <span className="text-[var(--muted-foreground)]">
                        {" "}
                        |{" "}
                      </span>
                      <span className="font-mono tabular-nums text-[var(--foreground)]">
                        {qtyStr}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {hasTradeMath && net != null ? (
                        <div
                          className="flex flex-wrap items-center justify-end gap-x-1 text-right text-[11px] tabular-nums sm:text-xs"
                          data-testid="asset-detail-tx-price-math"
                        >
                          <span className="font-medium text-sky-700 dark:text-sky-300">
                            {formatCurrencyPrecise(gross!, "EUR")}
                          </span>
                          <span className="text-[var(--muted-foreground)]">
                            −
                          </span>
                          <span className="font-medium text-red-600 dark:text-red-400">
                            {formatCurrencyPrecise(feesEur!, "EUR")}
                          </span>
                          <span className="text-[var(--muted-foreground)]">
                            =
                          </span>
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                            {formatCurrencyPrecise(net, "EUR")}
                          </span>
                        </div>
                      ) : (
                        <span
                          className={cn(
                            "text-xs font-medium tabular-nums",
                            getChangeColor(t.netCashImpactEur)
                          )}
                        >
                          {formatCurrencyPrecise(t.netCashImpactEur, "EUR")}
                        </span>
                      )}
                      <div
                        className={cn(
                          "inline-flex items-center gap-0.5",
                          "opacity-40 transition group-hover/row:opacity-100",
                          "focus-within:opacity-100"
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "rounded p-1.5 text-[var(--muted-foreground)] transition",
                            "hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                          )}
                          aria-label="Modifier la transaction"
                          title="Modifier"
                          onClick={() => {
                            onEditTx({
                              ...t,
                              asset: { name: data.asset.name },
                              platform: { name: data.asset.platformName },
                            });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "rounded p-1.5 text-[var(--muted-foreground)] transition",
                            "hover:bg-red-50 hover:text-red-600/90",
                            "dark:hover:bg-red-950/40 dark:hover:text-red-400",
                            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                          )}
                          aria-label="Supprimer la transaction"
                          title="Supprimer"
                          onClick={() => {
                            if (confirm("Supprimer cette transaction ?")) {
                              onDeleteTx(t.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredTxs.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
                  {txs.length === 0
                    ? "Aucune transaction pour cet actif"
                    : `${txTypeFilterEmptyHint(typeFilter)} pour cette position`}
                </div>
              )}
            </div>
          </div>

          {/* Fiscalité — secondaire, replié par défaut */}
          <details
            className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--muted)]/15 open:bg-[var(--muted)]/25"
            data-testid="asset-tax-fields"
            open={whtOpen}
            onToggle={(e) =>
              setWhtOpen((e.target as HTMLDetailsElement).open)
            }
          >
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--foreground)]",
                "marker:content-none [&::-webkit-details-marker]:hidden"
              )}
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform",
                  whtOpen && "rotate-90"
                )}
                aria-hidden
              />
              Fiscalité / retenue à la source
              <FinanceTip term="WHT" className="ml-0.5" />
            </summary>
            <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] px-3 py-2.5">
              <div className="min-w-[6.5rem]">
                <label
                  className="text-meta mb-0.5 block"
                  htmlFor="asset-country-code"
                >
                  Pays de l&apos;émetteur
                </label>
                <input
                  className="input py-1 font-mono uppercase"
                  maxLength={2}
                  placeholder="US"
                  defaultValue={data.asset.countryCode || ""}
                  key={`cc-${data.asset.id}-${data.asset.countryCode || ""}`}
                  id="asset-country-code"
                />
              </div>
              <div className="min-w-[7.5rem]">
                <label
                  className="text-meta mb-0.5 block"
                  htmlFor="asset-wht-rate"
                >
                  Taux de retenue (optionnel)
                </label>
                <input
                  className="input py-1"
                  placeholder="ex. 15 ou 0,15"
                  defaultValue={data.asset.withholdingTaxRate || ""}
                  key={`wht-${data.asset.id}-${data.asset.withholdingTaxRate || ""}`}
                  id="asset-wht-rate"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  const cc = (
                    document.getElementById(
                      "asset-country-code"
                    ) as HTMLInputElement
                  )?.value;
                  const wht = (
                    document.getElementById(
                      "asset-wht-rate"
                    ) as HTMLInputElement
                  )?.value;
                  try {
                    const res = await fetch(`/api/assets/${data.asset.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        countryCode: cc || null,
                        withholdingTaxRate: wht || null,
                      }),
                    });
                    if (!res.ok) {
                      const j = (await res.json().catch(() => ({}))) as {
                        error?: string;
                      };
                      throw new Error(
                        typeof j.error === "string" && j.error
                          ? j.error
                          : "Échec"
                      );
                    }
                    window.dispatchEvent(new Event("focus"));
                  } catch (e) {
                    alert(
                      e instanceof Error
                        ? e.message
                        : "Erreur d’enregistrement fiscal"
                    );
                  }
                }}
              >
                Enregistrer
              </Button>
            </div>
          </details>
        </div>
      )}
    </Modal>
  );
}

function FxPnlPanel({
  currency,
  qty,
  avgCostEur,
  priceNative,
  priceEur,
  transactions,
}: {
  currency: string;
  qty: number;
  avgCostEur: number;
  marketValueEur: number;
  priceNative: number;
  priceEur: number;
  transactions: AssetDetail["transactions"];
}) {
  const costBasisEur = qty * avgCostEur;
  const buyLots: BuyLotLite[] = [];
  for (const t of transactions) {
    if (t.type !== "ACHAT") continue;
    const q = Number(t.quantity ?? 0);
    const up = Number(t.unitPrice ?? 0);
    const fx = Number(t.fxRateToEur ?? 1) || 1;
    if (q > 0 && up >= 0 && fx > 0) {
      buyLots.push({
        quantity: q,
        unitPriceNative: up,
        fxRateToEur: fx,
      });
    }
  }

  const d = decomposeUnrealizedPnl({
    currency,
    qty,
    costBasisEur,
    priceNowNative: priceNative,
    priceNowEur: priceEur,
    buyLots,
  });

  if (Math.abs(d.totalUnrealizedEur) < 1e-9 && d.isEur) return null;

  const showFxSplit = !d.isEur && Math.abs(d.fxPnlEur) >= 1e-6;

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2"
      data-testid="fx-pnl-panel"
    >
      <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold tracking-tight text-[var(--foreground)]">
        Plus ou moins-value latente
        <FinanceTip term="P&L prix vs change" />
      </div>
      {showFxSplit ? (
        <div className="grid grid-cols-3 gap-2 text-center sm:text-left">
          <div>
            <div className="text-meta">Total</div>
            <div
              className={cn(
                "text-sm font-bold tabular-nums",
                getChangeColor(d.totalUnrealizedEur)
              )}
            >
              {formatCurrency(d.totalUnrealizedEur, "EUR")}
            </div>
          </div>
          <div>
            <div className="text-meta">Effet prix</div>
            <div
              className={cn(
                "text-sm font-semibold tabular-nums",
                getChangeColor(d.pricePnlEur)
              )}
            >
              {formatCurrency(d.pricePnlEur, "EUR")}
            </div>
          </div>
          <div>
            <div className="text-meta">Effet change</div>
            <div
              className={cn(
                "text-sm font-semibold tabular-nums",
                getChangeColor(d.fxPnlEur)
              )}
            >
              {formatCurrency(d.fxPnlEur, "EUR")}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <div
            className={cn(
              "text-base font-bold tabular-nums",
              getChangeColor(d.totalUnrealizedEur)
            )}
          >
            {formatCurrency(d.totalUnrealizedEur, "EUR")}
          </div>
          {!d.isEur && (
            <span className="text-meta">
              dont prix {formatCurrency(d.pricePnlEur, "EUR")}
            </span>
          )}
        </div>
      )}
      {d.note && (
        <p className="text-meta mt-1.5 leading-snug">{d.note}</p>
      )}
    </div>
  );
}
