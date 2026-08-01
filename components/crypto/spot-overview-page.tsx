"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { SpotKpiCards } from "@/components/crypto/spot-kpi-cards";
import { SpotEvolutionCard } from "@/components/crypto/spot-evolution-card";
import { SpotAllocationCard } from "@/components/crypto/spot-allocation-card";
import { SpotAssetsSection } from "@/components/crypto/spot-assets-section";
import {
  SpotContextColumn,
  type SpotOperation,
} from "@/components/crypto/spot-context-column";
import {
  bestWorst24h,
  buildAssetRows,
  computeSpotAllocation,
  computeSpotChange24h,
  computeSpotTotals,
  computeStableSplit,
  type SpotRange,
} from "@/app/lib/crypto/spot-overview";
import { buildCoinCards, type CoinCardHolding } from "@/app/lib/crypto/coin-cards";
import type { SpotHistory } from "@/app/lib/crypto/spot-history-service";
import type { TxRow } from "@/app/lib/types/ui";
import { cn, formatQuantity } from "@/app/lib/utils";

/**
 * Vue d'ensemble « Crypto — Comptant ».
 *
 * Une page, une lecture : ce que vaut la poche, comment elle a évolué, de quoi
 * elle est faite, et ce qui s'y est passé. Elle ne prétend pas être un terminal
 * de trading — aucun carnet d'ordres, aucun cours en temps réel — et n'en
 * emprunte pas les codes.
 *
 * Les chiffres viennent tous du journal, via `buildCoinCards` : cet écran et
 * Portefeuille ne peuvent donc pas afficher deux totaux différents pour le même
 * portefeuille.
 *
 * Le découpage en cartes autonomes est délibéré : DeFi, NFT, Futures, staking
 * et prêt poseront les mêmes questions, et reprendront ces mêmes briques plutôt
 * que d'inventer chacune leur langage visuel.
 */

/** Le contexte n'a pas la place d'en montrer davantage. */
const RECENT_OPERATIONS = 5;

function operationLabel(tx: TxRow): string {
  const asset = tx.asset?.ticker || tx.asset?.name || "—";
  const kind =
    tx.type === "BUY"
      ? "Achat"
      : tx.type === "SELL"
        ? "Vente"
        : tx.type === "SWAP"
          ? "Échange"
          : tx.type === "TRANSFER"
            ? "Transfert"
            : tx.type;
  return `${kind} · ${asset}`;
}

function operationAmount(tx: TxRow): string {
  const qty = Number(tx.quantity ?? 0);
  if (!Number.isFinite(qty) || qty === 0) return "—";
  const signed = tx.type === "SELL" ? -Math.abs(qty) : qty;
  const ticker = tx.asset?.ticker || "";
  return `${signed >= 0 ? "+" : "−"}${formatQuantity(Math.abs(signed))} ${ticker}`.trim();
}

export function SpotOverviewPage({
  holdings,
  baseCurrency = "EUR",
  onOpenPositions,
  onAddOperation,
  onOpenPlatforms,
  className,
}: {
  holdings: CoinCardHolding[];
  baseCurrency?: string;
  onOpenPositions?: () => void;
  onAddOperation?: () => void;
  onOpenPlatforms?: () => void;
  className?: string;
}) {
  const [range, setRange] = useState<SpotRange>("ytd");

  const history = useQuery({
    queryKey: ["crypto-spot-history", range],
    queryFn: () =>
      fetchJson<SpotHistory>(`/api/crypto/spot/history?range=${range}`),
    staleTime: 60_000,
  });

  const operationsQuery = useQuery({
    queryKey: ["crypto-spot-operations"],
    queryFn: () =>
      fetchJson<{ rows: TxRow[] }>(
        `/api/transactions?accountType=CRYPTO&pageSize=${RECENT_OPERATIONS}`
      ),
    staleTime: 60_000,
  });

  const cards = useMemo(() => buildCoinCards(holdings), [holdings]);

  const rows = useMemo(
    () => buildAssetRows(cards, history.data?.bySymbol ?? {}),
    [cards, history.data?.bySymbol]
  );

  const totals = useMemo(
    () => computeSpotTotals(cards, history.data?.btcPriceEur ?? null),
    [cards, history.data?.btcPriceEur]
  );
  const allocation = useMemo(() => computeSpotAllocation(cards), [cards]);
  const change24h = useMemo(() => computeSpotChange24h(rows), [rows]);
  const extremes = useMemo(() => bestWorst24h(rows), [rows]);
  const stable = useMemo(() => computeStableSplit(cards), [cards]);

  const logoBySymbol = useMemo(
    () =>
      Object.fromEntries(cards.map((c) => [c.symbol, c.logoUrl])) as Record<
        string,
        string | null | undefined
      >,
    [cards]
  );

  const spark = useMemo(() => {
    const points = history.data?.points ?? [];
    return points.length >= 2 ? points.map((p) => p.valueEur) : undefined;
  }, [history.data?.points]);

  const operations: SpotOperation[] = useMemo(
    () =>
      (operationsQuery.data?.rows ?? []).slice(0, RECENT_OPERATIONS).map((tx) => ({
        id: tx.id,
        type: tx.type,
        occurredAt: tx.occurredAt,
        label: operationLabel(tx),
        amount: operationAmount(tx),
      })),
    [operationsQuery.data?.rows]
  );

  return (
    <div className={cn("min-w-0", className)} data-testid="spot-overview">
      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="mb-[var(--gap-card)] flex flex-wrap items-start justify-between gap-[var(--space-3)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[var(--space-3)]">
            <h1 className="text-heading">Comptant</h1>
            <span
              className="num rounded-full border border-[var(--border)] px-[var(--space-2)] py-[0.1rem] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]"
              data-testid="spot-asset-count"
            >
              {totals.assetCount} actif{totals.assetCount > 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-meta mt-[var(--space-1)] max-w-[46rem]">
            Vos cryptos détenues en direct, consolidées par coin toutes
            plateformes confondues. Le détail opération par opération, avec son
            prix de revient et ses lots fiscaux, reste dans Portefeuille.
          </p>
        </div>

        {onOpenPositions && (
          <button
            type="button"
            onClick={onOpenPositions}
            data-testid="crypto-spot-open-positions"
            className="inline-flex shrink-0 items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--primary)] hover:underline"
          >
            Voir le détail dans Portefeuille
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        )}
      </header>

      <SpotKpiCards
        totals={totals}
        change24hPct={change24h.pct}
        change24hCoveragePct={change24h.coveragePct}
        spark={spark}
      />

      <div className="mt-[var(--gap-card)] grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ── Colonne principale ─────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
          <div className="grid min-w-0 gap-[var(--gap-card)] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <SpotEvolutionCard
              points={history.data?.points ?? []}
              range={range}
              onRangeChange={setRange}
              coveragePct={history.data?.coveragePct ?? 0}
              hasAssets={cards.length > 0}
              loading={history.isLoading}
            />
            <SpotAllocationCard
              slices={allocation}
              logoBySymbol={logoBySymbol}
            />
          </div>

          <SpotAssetsSection
            rows={rows}
            baseCurrency={baseCurrency}
            onOpenAsset={onOpenPositions ? () => onOpenPositions() : undefined}
          />
        </div>

        {/* ── Colonne contextuelle ───────────────────────────────── */}
        <SpotContextColumn
          totals={totals}
          change24hPct={change24h.pct}
          best={extremes.best}
          worst={extremes.worst}
          stable={stable}
          operations={operations}
          onAddOperation={onAddOperation}
          onOpenPositions={onOpenPositions}
          onOpenPlatforms={onOpenPlatforms}
        />
      </div>
    </div>
  );
}
