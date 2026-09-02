"use client";

import {
  ArrowLeftRight,
  ArrowRight,
  Minus,
  Plus,
  Repeat,
  Wallet,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import type {
  AssetRow,
  SpotTotals,
  StableSplit,
} from "@/app/lib/crypto/spot-overview";

/**
 * Colonne contextuelle de la poche comptant.
 *
 * Elle accompagne la lecture sans la porter : aucun chiffre n'y est plus gros
 * que ceux des cartes de tête, et rien n'y apparaît qui ne soit déjà lisible
 * ailleurs. Ce qu'elle apporte est la mise en regard — l'encours face à sa part
 * de trésorerie, la journée face à ses deux extrêmes.
 */

export type SpotOperation = {
  id: string;
  type: string;
  occurredAt: string;
  label: string;
  /** Quantité signée, déjà formatée (« +0,234 BTC »). */
  amount: string;
};

function Panel({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="panel" data-testid={testId}>
      <div className="panel-head">
        <h3 className="text-title">{title}</h3>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)]">
      <span className="text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
        {label}
      </span>
      <span
        className={cn(
          "num shrink-0 text-[length:var(--text-xs)] font-medium",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-[var(--space-1)] rounded-[var(--radius-md)] px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-2xs)] text-[var(--foreground-secondary)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
      data-testid={testId}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

export function SpotContextColumn({
  totals,
  change24hPct,
  best,
  worst,
  stable,
  operations,
  onAddOperation,
  onOpenPositions,
  onOpenPlatforms,
  className,
}: {
  totals: SpotTotals;
  change24hPct: number | null;
  best: AssetRow | null;
  worst: AssetRow | null;
  stable: StableSplit;
  operations: SpotOperation[];
  onAddOperation?: () => void;
  onOpenPositions?: () => void;
  onOpenPlatforms?: () => void;
  className?: string;
}) {
  const stablePct = stable.stablePct;

  return (
    <aside
      className={cn("flex min-w-0 flex-col gap-[var(--gap-card)]", className)}
      data-testid="spot-context-column"
      aria-label="Contexte de la poche comptant"
    >
      <Panel title="Aperçu rapide" testId="spot-context-overview">
        <Line
          label="Valeur totale"
          value={formatCurrency(totals.totalValueEur, "EUR")}
        />
        <Line
          label="Performance (24 h)"
          value={change24hPct != null ? formatSignedPct(change24hPct) : "—"}
          tone={
            change24hPct == null
              ? undefined
              : change24hPct >= 0
                ? "positive"
                : "negative"
          }
        />
        <Line
          label="Gains non réalisés"
          value={`${totals.unrealizedPnlEur >= 0 ? "+" : "−"}${formatCurrency(Math.abs(totals.unrealizedPnlEur), "EUR")}`}
          tone={totals.unrealizedPnlEur >= 0 ? "positive" : "negative"}
        />

        {/* Meilleure et moins bonne ligne du jour : le détail que la mesure
            d'ensemble efface, et qui explique d'où vient la journée. */}
        {best && (
          <Line
            label={`Meilleure performance · ${best.card.symbol}`}
            value={formatSignedPct(best.change24hPct!)}
            tone={best.change24hPct! >= 0 ? "positive" : "negative"}
          />
        )}
        {worst && worst.card.symbol !== best?.card.symbol && (
          <Line
            label={`Moins bonne performance · ${worst.card.symbol}`}
            value={formatSignedPct(worst.change24hPct!)}
            tone={worst.change24hPct! >= 0 ? "positive" : "negative"}
          />
        )}
      </Panel>

      <Panel title="Stable et volatil" testId="spot-context-stable">
        {stablePct == null ? (
          <p className="text-meta">
            La répartition apparaîtra dès la première position détenue.
          </p>
        ) : (
          <>
            <div className="mb-[var(--space-2)] h-[0.35rem] w-full overflow-hidden rounded-full bg-[var(--surface-raised)]">
              <div
                className="h-full rounded-full bg-[var(--chart-positive)]"
                style={{ width: `${Math.min(100, stablePct)}%` }}
              />
            </div>
            <Line
              label={`Stablecoins · ${stablePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
              value={formatCurrency(stable.stableEur, "EUR")}
            />
            <Line
              label={`Actifs volatils · ${(100 - stablePct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}
              value={formatCurrency(stable.volatileEur, "EUR")}
            />
            {/*
              Les euros laissés sur un exchange ne figurent pas ici : ils sont
              du cash, comptés dans les comptes bancaires. Les additionner à
              cette poche les compterait deux fois.
            */}
            <p className="text-meta mt-[var(--space-2)]">
              Les euros laissés sur un exchange ne sont pas comptés ici — ils
              figurent avec vos liquidités.
            </p>
          </>
        )}
      </Panel>

      <Panel title="Dernières opérations" testId="spot-context-operations">
        {operations.length === 0 ? (
          <p className="text-meta">
            Aucune opération crypto enregistrée pour l&apos;instant.
          </p>
        ) : (
          <ul className="flex flex-col">
            {operations.map((op) => (
              <li
                key={op.id}
                className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)]"
                data-testid={`spot-operation-${op.id}`}
              >
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                  {op.label}
                </span>
                <span className="num shrink-0 text-[length:var(--text-xs)] text-[var(--foreground)]">
                  {op.amount}
                </span>
                <span className="text-meta shrink-0">
                  {formatDate(op.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {onOpenPositions && (
          <button
            type="button"
            onClick={onOpenPositions}
            className="mt-[var(--space-3)] inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--primary)] hover:underline"
            data-testid="spot-see-all-operations"
          >
            Voir toutes les opérations
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        )}
      </Panel>

      <Panel title="Actions rapides" testId="spot-context-actions">
        <div className="grid grid-cols-4 gap-[var(--space-1)]">
          <QuickAction
            icon={Plus}
            label="Acheter"
            onClick={() => onAddOperation?.()}
            testId="spot-action-buy"
          />
          <QuickAction
            icon={Minus}
            label="Vendre"
            onClick={() => onAddOperation?.()}
            testId="spot-action-sell"
          />
          <QuickAction
            icon={Repeat}
            label="Échanger"
            onClick={() => onAddOperation?.()}
            testId="spot-action-swap"
          />
          <QuickAction
            icon={ArrowLeftRight}
            label="Transférer"
            onClick={() => onAddOperation?.()}
            testId="spot-action-transfer"
          />
        </div>

        {onOpenPlatforms && (
          <button
            type="button"
            onClick={onOpenPlatforms}
            className="mt-[var(--space-2)] inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--primary)] hover:underline"
            data-testid="spot-action-wallets"
          >
            <Wallet className="h-3 w-3" aria-hidden />
            Voir mes plateformes et wallets
          </button>
        )}
      </Panel>
    </aside>
  );
}
