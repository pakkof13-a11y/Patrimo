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
  formatDate,
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
  const [txMenuOpen, setTxMenuOpen] = useState(false);
  const [whtOpen, setWhtOpen] = useState(false);
  const txMenuRef = useRef<HTMLDivElement>(null);

  // Reset filtres type à chaque changement d'actif / réouverture
  useEffect(() => {
    if (open) {
      setTypeFilter("all");
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
      .slice()
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      );
  }, [txs, typeFilter]);

  if (!open) return null;

  return (
    <Modal
      title={data?.asset.name || "Détail de l'actif"}
      onClose={onClose}
      wide
      panelClassName="w-[min(72vw,calc(100vw-2rem))] max-w-[900px]"
    >
      {loading && <p className="text-sm text-slate-400">Chargement du détail…</p>}
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
                  <CurrencyBadge code={data.asset.currency} className="!py-0 !text-[10px]" />
                </div>
              </div>
            </div>
            {data.holding && (
              <div className="shrink-0 text-right leading-tight">
                <div className="text-base font-semibold tabular-nums sm:text-lg">
                  {formatCurrency(data.holding.marketValueEur, "EUR")}
                </div>
                <div className="mt-0.5 max-w-[22rem] text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                  Qté{" "}
                  {Number(data.holding.quantity).toLocaleString("fr-FR", {
                    maximumFractionDigits: 6,
                  })}{" "}
                  · CUMP {formatCurrency(data.holding.avgCostEur, "EUR")}
                  {data.asset.priceQuote && (
                    <>
                      {" "}
                      · Cours{" "}
                      {formatCurrency(
                        data.asset.priceQuote.priceNative,
                        data.asset.priceQuote.nativeCurrency
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {data.holding && (
            <FxPnlPanel
              currency={
                data.asset.priceQuote?.nativeCurrency || data.asset.currency
              }
              qty={Number(data.holding.quantity)}
              avgCostEur={Number(data.holding.avgCostEur)}
              marketValueEur={Number(data.holding.marketValueEur)}
              priceNative={
                data.asset.priceQuote
                  ? Number(data.asset.priceQuote.priceNative)
                  : Number(data.holding.avgCostEur)
              }
              priceEur={
                data.asset.priceQuote
                  ? Number(data.asset.priceQuote.priceEur)
                  : Number(data.holding.marketValueEur) /
                    Math.max(Number(data.holding.quantity), 1e-12)
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
              <TxTypeFilters
                value={typeFilter}
                onChange={setTypeFilter}
                counts={typeCounts}
                className="min-w-0 flex-1"
              />
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

            <div className="max-h-80 overflow-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="table-head sticky top-0 text-[10px] font-medium tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Qté</th>
                    <th className="px-3 py-2 text-right">Prix unit.</th>
                    <th className="px-3 py-2 text-right">Frais</th>
                    <th className="px-3 py-2 text-right">Impact cash €</th>
                    <th className="w-16 px-2 py-2 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxs.map((t) => (
                    <tr
                      key={t.id}
                      className="group/row border-t border-[var(--border)] hover:bg-[var(--muted)]/30"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDate(t.occurredAt)}
                      </td>
                      <td className="px-3 py-2">
                        {TRANSACTION_TYPES[t.type as keyof typeof TRANSACTION_TYPES] ||
                          t.type}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {t.quantity != null && t.quantity !== ""
                          ? Number(t.quantity).toLocaleString("fr-FR", {
                              maximumFractionDigits: 6,
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {t.unitPrice != null
                          ? formatCurrency(t.unitPrice, t.currency)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(t.fees, t.currency)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          getChangeColor(t.netCashImpactEur)
                        )}
                      >
                        {formatCurrency(t.netCashImpactEur, "EUR")}
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <div
                          className={cn(
                            "inline-flex items-center justify-end gap-0.5",
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
                      </td>
                    </tr>
                  ))}
                  {filteredTxs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-[var(--muted-foreground)]">
                        {txs.length === 0
                          ? "Aucune transaction pour cet actif"
                          : `${txTypeFilterEmptyHint(typeFilter)} pour cette position`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
