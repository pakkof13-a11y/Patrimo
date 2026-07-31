"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Plus, Tags } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { AssetPriceChart } from "@/components/assets/asset-price-chart";
import { AssetRelatedNews } from "@/components/assets/asset-related-news";
import { FxPnlPanel } from "@/components/assets/fx-pnl-panel";
import {
  PendingBackend,
  PendingControl,
} from "@/components/ui/pending-backend";
import {
  ASSET_WORKSPACE_SECTIONS,
  type AssetWorkspaceSectionId,
} from "@/app/lib/portfolio/asset-workspace-sections";
import {
  ACCOUNT_TYPES,
  TRANSACTION_TYPES,
  type AccountType,
} from "@/app/lib/constants";
import {
  formatCurrency,
  formatDate,
  formatQuantity,
  formatUnitPrice,
  getAssetClassLabel,
  getChangeColor,
  cn,
} from "@/app/lib/utils";
import { assetCategoryLabel } from "@/app/lib/assets/categories";
import { formatRelativeUpdate } from "@/components/holdings/holding-table-row";
import type { TxRow } from "@/app/lib/types/ui";

export type CustodySlice = {
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

export type AssetWorkspaceData = {
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

/** Types de transaction qui constituent un revenu encaissé. */
const INCOME_TYPES = new Set([
  "DIVIDENDE",
  "COUPON",
  "LOYER",
  "INTERET",
  "REWARD",
  "AIRDROP",
]);

function num(v: unknown): number {
  const n = Number(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)]">
      <dt className="text-meta min-w-0 truncate">{label}</dt>
      <dd className={cn("num shrink-0 text-right", tone)}>{value}</dd>
    </div>
  );
}

function SectionShell({
  id,
  children,
}: {
  id: AssetWorkspaceSectionId;
  children: React.ReactNode;
}) {
  const meta = ASSET_WORKSPACE_SECTIONS.find((s) => s.id === id)!;
  return (
    <section
      className="space-y-[var(--space-4)]"
      data-testid={`asset-workspace-section-${id}`}
    >
      <p className="text-meta">{meta.hint}</p>
      {children}
    </section>
  );
}

/** Aiguillage des sections — chaque corps reste petit et lisible. */
export function WorkspaceSection({
  section,
  data,
  baseCurrency,
  onEditTx,
  onDeleteTx,
  onAddTransaction,
  onEditCategory,
}: {
  section: AssetWorkspaceSectionId;
  data: AssetWorkspaceData;
  baseCurrency: string;
  onEditTx: (t: TxRow) => void;
  onDeleteTx: (id: string) => void;
  onAddTransaction?: (type?: string) => void;
  onEditCategory?: () => void;
}) {
  switch (section) {
    case "overview":
      return (
        <SectionShell id="overview">
          <Overview
            data={data}
            baseCurrency={baseCurrency}
            onEditCategory={onEditCategory}
          />
        </SectionShell>
      );
    case "performance":
      return (
        <SectionShell id="performance">
          <Performance data={data} />
        </SectionShell>
      );
    case "transactions":
      return (
        <SectionShell id="transactions">
          <Transactions
            data={data}
            onEditTx={onEditTx}
            onDeleteTx={onDeleteTx}
            onAddTransaction={onAddTransaction}
          />
        </SectionShell>
      );
    case "platforms":
      return (
        <SectionShell id="platforms">
          <Platforms data={data} baseCurrency={baseCurrency} />
        </SectionShell>
      );
    case "costBasis":
      return (
        <SectionShell id="costBasis">
          <CostBasis data={data} baseCurrency={baseCurrency} />
        </SectionShell>
      );
    case "income":
      return (
        <SectionShell id="income">
          <Income data={data} baseCurrency={baseCurrency} />
        </SectionShell>
      );
    case "tax":
      return (
        <SectionShell id="tax">
          <Tax data={data} baseCurrency={baseCurrency} />
        </SectionShell>
      );
    case "defi":
      return (
        <SectionShell id="defi">
          <DefiExposure data={data} baseCurrency={baseCurrency} />
        </SectionShell>
      );
    case "nfts":
      return (
        <SectionShell id="nfts">
          <LinkedNfts data={data} baseCurrency={baseCurrency} />
        </SectionShell>
      );
    case "news":
      return (
        <SectionShell id="news">
          <AssetRelatedNews
            ticker={data.asset.ticker}
            name={data.asset.name}
            enabled
          />
        </SectionShell>
      );
    case "documents":
      return (
        <SectionShell id="documents">
          <Documents />
        </SectionShell>
      );
  }
}

/* ── Vue d'ensemble ──────────────────────────────────────────────── */

function Overview({
  data,
  baseCurrency,
  onEditCategory,
}: {
  data: AssetWorkspaceData;
  baseCurrency: string;
  onEditCategory?: () => void;
}) {
  const { asset, holding } = data;
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

  return (
    <>
      <dl className="panel divide-y divide-[var(--border-subtle)] p-[var(--pad-card)]">
        <Row
          label="Quantité"
          value={qty != null ? formatQuantity(qty) : "—"}
        />
        <Row
          label="Prix de revient unitaire"
          value={avgCost != null ? formatUnitPrice(avgCost, "EUR") : "—"}
        />
        <Row
          label="Cours actuel"
          value={
            asset.priceQuote
              ? formatUnitPrice(
                  num(asset.priceQuote.priceNative),
                  asset.priceQuote.nativeCurrency
                )
              : "—"
          }
        />
        <Row
          label="Capital investi"
          value={
            costBasis != null ? formatCurrency(costBasis, baseCurrency) : "—"
          }
        />
        <Row
          label="Valeur de marché"
          value={
            marketValue != null
              ? formatCurrency(marketValue, baseCurrency)
              : "—"
          }
        />
        <Row
          label="P&L latent"
          tone={pnl != null ? getChangeColor(pnl) : undefined}
          value={
            pnl != null
              ? `${pnl >= 0 ? "+" : "−"}${formatCurrency(Math.abs(pnl), baseCurrency)}${
                  pnlPct != null
                    ? ` (${pnlPct >= 0 ? "+" : "−"}${Math.abs(pnlPct).toFixed(2)} %)`
                    : ""
                }`
              : "—"
          }
        />
      </dl>

      <dl className="panel divide-y divide-[var(--border-subtle)] p-[var(--pad-card)]">
        <Row label="Classe" value={getAssetClassLabel(asset.assetClass)} />
        <Row
          label="Sous-catégorie"
          value={
            <span className="flex items-center gap-[var(--space-2)]">
              {assetCategoryLabel(asset.category)}
              {onEditCategory && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1"
                  onClick={onEditCategory}
                  data-testid="asset-detail-edit-category"
                  aria-label="Modifier la sous-catégorie"
                >
                  <Tags className="h-3 w-3" />
                </Button>
              )}
            </span>
          }
        />
        <Row
          label="Enveloppe"
          value={
            asset.accountType
              ? (ACCOUNT_TYPES[asset.accountType as AccountType] ??
                asset.accountType)
              : "—"
          }
        />
        <Row label="Devise" value={asset.currency} />
        {asset.isin && <Row label="ISIN" value={asset.isin} />}
        {asset.blockchainLabel && (
          <Row label="Blockchain" value={asset.blockchainLabel} />
        )}
        <Row
          label="Cours mis à jour"
          value={
            asset.priceQuote
              ? formatRelativeUpdate(asset.priceQuote.lastUpdatedAt)
              : "—"
          }
        />
        <Row
          label="Source du cours"
          value={asset.priceQuote?.source ?? "—"}
        />
      </dl>
    </>
  );
}

/* ── Performance ─────────────────────────────────────────────────── */

function Performance({ data }: { data: AssetWorkspaceData }) {
  return (
    <AssetPriceChart
      assetId={data.asset.id}
      enabled
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
        data.asset.priceQuote ? num(data.asset.priceQuote.priceEur) : null
      }
      holdingQty={data.holding ? num(data.holding.quantity) : null}
      holdingAvgCostEur={data.holding ? num(data.holding.avgCostEur) : null}
    />
  );
}

/* ── Transactions ────────────────────────────────────────────────── */

function Transactions({
  data,
  onEditTx,
  onDeleteTx,
  onAddTransaction,
}: {
  data: AssetWorkspaceData;
  onEditTx: (t: TxRow) => void;
  onDeleteTx: (id: string) => void;
  onAddTransaction?: (type?: string) => void;
}) {
  const rows = useMemo(
    () =>
      [...data.transactions].sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      ),
    [data.transactions]
  );

  return (
    <div data-testid="asset-detail-history">
      {onAddTransaction && (
        <div className="mb-[var(--space-3)] flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => onAddTransaction()}
            data-testid="asset-detail-add-tx"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouvelle opération
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-meta">Aucune opération enregistrée sur cet actif.</p>
      ) : (
        <ul className="panel divide-y divide-[var(--border-subtle)]">
          {rows.map((t) => (
            <li
              key={t.id}
              className="flex min-w-0 items-center gap-[var(--space-3)] px-[var(--pad-card)] py-[var(--space-2)]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[length:var(--text-sm)] text-[var(--foreground)]">
                  {TRANSACTION_TYPES[
                    t.type as keyof typeof TRANSACTION_TYPES
                  ] ?? t.type}
                </div>
                <div className="text-meta num">
                  {formatDate(t.occurredAt)}
                  {t.platformName ? ` · ${t.platformName}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[length:var(--text-sm)]">
                  {t.quantity ? formatQuantity(num(t.quantity)) : "—"}
                </div>
                <div className="text-meta num">
                  {t.unitPrice
                    ? formatUnitPrice(num(t.unitPrice), t.currency)
                    : "—"}
                </div>
              </div>
              <div className="flex shrink-0 gap-[var(--space-1)]">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[length:var(--text-2xs)]"
                  onClick={() => onEditTx(t as unknown as TxRow)}
                >
                  Modifier
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[length:var(--text-2xs)]"
                  onClick={() => onDeleteTx(t.id)}
                >
                  Supprimer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Répartition par plateforme ──────────────────────────────────── */

function Platforms({
  data,
  baseCurrency,
}: {
  data: AssetWorkspaceData;
  baseCurrency: string;
}) {
  const slices = data.custodyDistribution ?? [];

  if (slices.length === 0) {
    return (
      <p className="text-meta" data-testid="asset-workspace-platforms-single">
        Cet actif est déposé sur une seule plateforme
        {data.asset.platformName ? ` : ${data.asset.platformName}` : ""}.
      </p>
    );
  }

  return (
    <ul className="panel divide-y divide-[var(--border-subtle)]">
      {slices.map((s) => (
        <li
          key={`${s.assetId}-${s.platformId}`}
          className="flex min-w-0 items-center gap-[var(--space-3)] px-[var(--pad-card)] py-[var(--space-2)]"
          data-testid="custody-slice"
        >
          <PlatformLogo src={s.platformLogoUrl} name={s.platformName} size={24} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[length:var(--text-sm)]">
              {s.platformName}
            </div>
            <div className="text-meta truncate">{s.blockchainLabel}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="num text-[length:var(--text-sm)]">
              {formatCurrency(s.marketValueEur, baseCurrency)}
            </div>
            <div className="text-meta num">
              {formatQuantity(s.quantity)} · {s.valuePct.toFixed(1)} %
            </div>
          </div>
          <div
            className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${Math.min(100, Math.max(2, s.valuePct))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── PRU & P&L ───────────────────────────────────────────────────── */

function CostBasis({
  data,
  baseCurrency,
}: {
  data: AssetWorkspaceData;
  baseCurrency: string;
}) {
  const breakdown = useMemo(() => {
    const buys = data.transactions.filter((t) => t.type === "ACHAT");
    if (buys.length === 0) return null;
    let gross = 0;
    let fees = 0;
    for (const t of buys) {
      const q = num(t.quantity);
      const p = num(t.unitPrice);
      const fx = num(t.fxRateToEur) || 1;
      gross += q * p * fx;
      const fe = num(t.feesEur ?? t.fees);
      fees += t.feesEur != null ? fe : fe * fx;
    }
    return { gross, fees, net: gross - fees, buyCount: buys.length };
  }, [data.transactions]);

  const qty = data.holding ? num(data.holding.quantity) : 0;
  const avgCost = data.holding ? num(data.holding.avgCostEur) : 0;
  const marketValue = data.holding ? num(data.holding.marketValueEur) : 0;

  return (
    <>
      {breakdown ? (
        <dl
          className="panel divide-y divide-[var(--border-subtle)] p-[var(--pad-card)]"
          data-testid="asset-detail-cost-breakdown"
        >
          <Row
            label={`Dépensé brut (${breakdown.buyCount} achat${breakdown.buyCount > 1 ? "s" : ""})`}
            value={formatCurrency(breakdown.gross, baseCurrency)}
          />
          <Row
            label="Frais d'exécution cumulés"
            tone="val-negative"
            value={`−${formatCurrency(breakdown.fees, baseCurrency)}`}
          />
          <Row
            label="Montant net acquis"
            value={formatCurrency(breakdown.net, baseCurrency)}
          />
          <Row
            label="Prix de revient unitaire"
            value={formatUnitPrice(avgCost, "EUR")}
          />
        </dl>
      ) : (
        <p className="text-meta">
          Aucun achat au journal : le prix de revient ne peut pas être décomposé.
        </p>
      )}

      {data.holding && (
        <FxPnlPanel
          currency={
            data.asset.priceQuote?.nativeCurrency || data.asset.currency
          }
          qty={qty}
          avgCostEur={avgCost}
          marketValueEur={marketValue}
          priceNative={
            data.asset.priceQuote
              ? num(data.asset.priceQuote.priceNative)
              : avgCost
          }
          priceEur={
            data.asset.priceQuote
              ? num(data.asset.priceQuote.priceEur)
              : marketValue / Math.max(qty, 1e-12)
          }
          transactions={data.transactions}
        />
      )}
    </>
  );
}

/* ── Revenus ─────────────────────────────────────────────────────── */

function Income({
  data,
  baseCurrency,
}: {
  data: AssetWorkspaceData;
  baseCurrency: string;
}) {
  const income = useMemo(() => {
    const rows = data.transactions.filter((t) => INCOME_TYPES.has(t.type));
    const byType = new Map<string, { gross: number; tax: number; count: number }>();
    let gross = 0;
    let tax = 0;
    for (const t of rows) {
      const g = num(t.grossAmountEur);
      const w = num(t.withholdingTaxEur);
      gross += g;
      tax += w;
      const prev = byType.get(t.type) ?? { gross: 0, tax: 0, count: 0 };
      byType.set(t.type, {
        gross: prev.gross + g,
        tax: prev.tax + w,
        count: prev.count + 1,
      });
    }
    return { rows, byType: [...byType.entries()], gross, tax, net: gross - tax };
  }, [data.transactions]);

  if (income.rows.length === 0) {
    return (
      <p className="text-meta" data-testid="asset-workspace-income-empty">
        Aucun revenu encaissé sur cet actif — ni dividende, ni coupon, ni loyer,
        ni récompense de staking.
      </p>
    );
  }

  return (
    <>
      <dl className="panel divide-y divide-[var(--border-subtle)] p-[var(--pad-card)]">
        <Row
          label="Revenus bruts encaissés"
          value={formatCurrency(income.gross, baseCurrency)}
        />
        <Row
          label="Retenue à la source"
          tone={income.tax > 0 ? "val-negative" : undefined}
          value={`−${formatCurrency(income.tax, baseCurrency)}`}
        />
        <Row
          label="Net perçu"
          tone="val-positive"
          value={formatCurrency(income.net, baseCurrency)}
        />
      </dl>

      <dl className="panel divide-y divide-[var(--border-subtle)] p-[var(--pad-card)]">
        {income.byType.map(([type, v]) => (
          <Row
            key={type}
            label={`${TRANSACTION_TYPES[type as keyof typeof TRANSACTION_TYPES] ?? type} (${v.count})`}
            value={formatCurrency(v.gross, baseCurrency)}
          />
        ))}
      </dl>
    </>
  );
}

/* ── Fiscalité ───────────────────────────────────────────────────── */

function Tax({
  data,
  baseCurrency,
}: {
  data: AssetWorkspaceData;
  baseCurrency: string;
}) {
  const withheld = useMemo(
    () =>
      data.transactions.reduce((acc, t) => acc + num(t.withholdingTaxEur), 0),
    [data.transactions]
  );
  const envelope = data.asset.accountType
    ? (ACCOUNT_TYPES[data.asset.accountType as AccountType] ??
      data.asset.accountType)
    : null;

  return (
    <>
      {/* Ce que l'application sait déjà, et qui est vrai. */}
      <dl
        className="panel divide-y divide-[var(--border-subtle)] p-[var(--pad-card)]"
        data-testid="asset-tax-fields"
      >
        <Row label="Enveloppe fiscale" value={envelope ?? "—"} />
        <Row
          label="Pays d'émission"
          value={data.asset.countryCode?.toUpperCase() ?? "—"}
        />
        <Row
          label="Taux de retenue à la source"
          value={
            data.asset.withholdingTaxRate
              ? `${num(data.asset.withholdingTaxRate).toFixed(2)} %`
              : "—"
          }
        />
        <Row
          label="Retenue déjà prélevée"
          value={formatCurrency(withheld, baseCurrency)}
        />
      </dl>

      <PendingBackend
        testId="asset-workspace-tax-pending"
        title="Traitement fiscal de la ligne"
        what="Régime applicable, assiette imposable, prélèvements sociaux, crédit d'impôt conventionnel et report des moins-values — calculés pour cette position et rattachés à l'année fiscale."
        missing="Le moteur fiscal par ligne fait l'objet d'un chantier dédié. Les seuls chiffres affichés ici viennent du journal et de la fiche actif ; aucun impôt n'est estimé tant que le calcul n'existe pas."
      >
        <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
          <PendingControl label="Régime d'imposition" hint="PFU · barème · exonéré" />
          <PendingControl label="Année fiscale" hint="Exercice de rattachement" />
          <PendingControl label="Assiette imposable" hint="Calculée à la cession" />
          <PendingControl
            label="Crédit d'impôt conventionnel"
            hint="Selon la convention du pays d'émission"
          />
        </div>
      </PendingBackend>
    </>
  );
}

/* ── DeFi ────────────────────────────────────────────────────────── */

type DefiPositionLite = {
  id: string;
  protocol?: string | null;
  platformId?: string | null;
  platformName?: string | null;
  kind?: string | null;
  valueEur?: string | number | null;
};

function DefiExposure({
  data,
  baseCurrency,
}: {
  data: AssetWorkspaceData;
  baseCurrency: string;
}) {
  const platformIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of data.custodyDistribution ?? []) ids.add(s.platformId);
    for (const p of data.platforms ?? []) ids.add(p.id);
    for (const t of data.transactions) if (t.platformId) ids.add(t.platformId);
    return ids;
  }, [data]);

  const q = useQuery({
    queryKey: ["asset-workspace-defi"],
    queryFn: () =>
      fetchJson<{ positions?: DefiPositionLite[] }>("/api/crypto/defi"),
    staleTime: 60_000,
    retry: 1,
  });

  const positions = useMemo(
    () =>
      (q.data?.positions ?? []).filter(
        (p) => p.platformId && platformIds.has(p.platformId)
      ),
    [q.data, platformIds]
  );

  if (q.isPending) {
    return <div className="h-20 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface-sunken)]" />;
  }
  if (q.isError) {
    return (
      <p className="text-meta">Impossible de charger les positions DeFi.</p>
    );
  }
  if (positions.length === 0) {
    return (
      <p className="text-meta" data-testid="asset-workspace-defi-empty">
        Aucune position DeFi ouverte sur les plateformes où cet actif est
        déposé.
      </p>
    );
  }

  return (
    <ul className="panel divide-y divide-[var(--border-subtle)]">
      {positions.map((p) => (
        <li
          key={p.id}
          className="flex min-w-0 items-center gap-[var(--space-3)] px-[var(--pad-card)] py-[var(--space-2)]"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[length:var(--text-sm)]">
              {p.protocol || "Protocole inconnu"}
            </div>
            <div className="text-meta truncate">
              {p.platformName || "—"}
              {p.kind ? ` · ${p.kind}` : ""}
            </div>
          </div>
          <div className="num shrink-0 text-[length:var(--text-sm)]">
            {p.valueEur != null
              ? formatCurrency(num(p.valueEur), baseCurrency)
              : "—"}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── NFT ─────────────────────────────────────────────────────────── */

type NftItemLite = {
  id: string;
  name?: string | null;
  collectionName?: string | null;
  chain?: string | null;
  platformId?: string | null;
  imageUrl?: string | null;
  valuationEur?: string | number | null;
};

function LinkedNfts({
  data,
  baseCurrency,
}: {
  data: AssetWorkspaceData;
  baseCurrency: string;
}) {
  const platformIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of data.custodyDistribution ?? []) ids.add(s.platformId);
    for (const p of data.platforms ?? []) ids.add(p.id);
    return ids;
  }, [data]);

  const q = useQuery({
    queryKey: ["asset-workspace-nfts"],
    queryFn: () => fetchJson<{ items?: NftItemLite[] }>("/api/crypto/nft"),
    staleTime: 60_000,
    retry: 1,
  });

  const items = useMemo(
    () =>
      (q.data?.items ?? []).filter(
        (n) => n.platformId && platformIds.has(n.platformId)
      ),
    [q.data, platformIds]
  );

  if (q.isPending) {
    return <div className="h-20 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface-sunken)]" />;
  }
  if (q.isError) {
    return <p className="text-meta">Impossible de charger les NFT.</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-meta" data-testid="asset-workspace-nfts-empty">
        Aucun NFT détenu sur les adresses où cet actif est déposé.
      </p>
    );
  }

  return (
    <ul className="panel divide-y divide-[var(--border-subtle)]">
      {items.map((n) => (
        <li
          key={n.id}
          className="flex min-w-0 items-center gap-[var(--space-3)] px-[var(--pad-card)] py-[var(--space-2)]"
        >
          <PlatformLogo
            src={n.imageUrl ?? null}
            name={n.name || "NFT"}
            size={28}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[length:var(--text-sm)]">
              {n.name || "Sans nom"}
            </div>
            <div className="text-meta truncate">
              {n.collectionName || "—"}
              {n.chain ? ` · ${n.chain}` : ""}
            </div>
          </div>
          <div className="num shrink-0 text-[length:var(--text-sm)]">
            {n.valuationEur != null
              ? formatCurrency(num(n.valuationEur), baseCurrency)
              : "—"}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Documents ───────────────────────────────────────────────────── */

function Documents() {
  return (
    <PendingBackend
      testId="asset-workspace-documents-pending"
      title="Documents rattachés à cet actif"
      what="Dépôt et consultation des IFU, relevés de compte, avis d'opéré et justificatifs d'acquisition, rattachés à la ligne et à l'année concernée."
      missing="Aucun modèle de document n'existe encore : ni stockage de fichier, ni rattachement à un actif. L'écran est en place pour que le branchement n'ait pas à le redessiner."
    >
      <div className="space-y-[var(--space-3)]">
        <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
          <PendingControl label="Type de document" hint="IFU · relevé · avis d'opéré" />
          <PendingControl label="Année" hint="Exercice concerné" />
        </div>
        <div
          aria-disabled
          className={cn(
            "flex h-24 flex-col items-center justify-center gap-[var(--space-1)] rounded-[var(--radius-lg)]",
            "border border-dashed border-[var(--border-strong)] bg-[var(--surface-sunken)]",
            "text-[length:var(--text-xs)] text-[var(--foreground-faint)]"
          )}
          data-testid="asset-workspace-documents-dropzone"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Zone de dépôt — inactive tant que le stockage n&apos;existe pas
        </div>
      </div>
    </PendingBackend>
  );
}
