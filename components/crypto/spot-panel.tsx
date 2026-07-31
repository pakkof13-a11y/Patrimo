"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Coins } from "lucide-react";
import { AssetLogo, PlatformLogo } from "@/components/ui/platform-logo";
import { ModuleCard, ModuleCardHeader } from "@/components/ui/module-shell";
import { AltEmptyState, AltMiniKpi } from "@/components/tabs/alternatives-shell";
import { ModuleKpiStrip } from "@/components/ui/module-shell";
import { cn, formatCurrency, formatQuantity, getChangeColor } from "@/app/lib/utils";
import {
  buildCoinCards,
  topCoinDominancePct,
  type CoinCard,
  type CoinCardHolding,
} from "@/app/lib/crypto/coin-cards";

type SortMode = "value" | "pnl" | "allocation" | "name";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "value", label: "Valeur" },
  { id: "pnl", label: "P&L" },
  { id: "allocation", label: "Allocation" },
  { id: "name", label: "Nom" },
];

function sortCards(cards: CoinCard[], mode: SortMode): CoinCard[] {
  const out = [...cards];
  switch (mode) {
    case "pnl":
      return out.sort((a, b) => b.unrealizedPnlEur - a.unrealizedPnlEur);
    case "allocation":
      return out.sort((a, b) => b.allocationPct - a.allocationPct);
    case "name":
      return out.sort((a, b) => a.symbol.localeCompare(b.symbol, "fr"));
    case "value":
    default:
      return out.sort((a, b) => b.marketValueEur - a.marketValueEur);
  }
}

/**
 * Sous-onglet « Comptant » — lecture patrimoniale des cryptos détenues.
 *
 * Volontairement une galerie de cartes par coin, et non un tableau : le
 * tableau existe déjà dans Positions, où chaque ligne est un couple
 * actif × plateforme. Ici la question posée est l'inverse — « combien de BTC
 * au total, réparti où, et quel poids dans la poche ? » — d'où le
 * regroupement par symbole et la barre d'allocation, que Positions ne peut
 * structurellement pas afficher.
 *
 * Les chiffres viennent du journal (via `buildCoinCards`), donc les deux vues
 * ne peuvent pas diverger.
 */
export function SpotPanel({
  holdings,
  baseCurrency = "EUR",
  onOpenPositions,
  className,
}: {
  holdings: CoinCardHolding[];
  baseCurrency?: string;
  /** Renvoie vers Positions filtré crypto — la lecture comptable/fiscale. */
  onOpenPositions?: () => void;
  className?: string;
}) {
  const [sort, setSort] = useState<SortMode>("value");

  const cards = useMemo(() => buildCoinCards(holdings), [holdings]);
  const sorted = useMemo(() => sortCards(cards, sort), [cards, sort]);

  const totals = useMemo(() => {
    const value = cards.reduce((s, c) => s + c.marketValueEur, 0);
    const cost = cards.reduce((s, c) => s + c.costBasisEur, 0);
    return { value, cost, pnl: value - cost };
  }, [cards]);

  const dominance = topCoinDominancePct(cards);

  return (
    <ModuleCard testId="crypto-spot-panel" className={className}>
      <ModuleCardHeader
        title="Comptant"
        subtitle="Cryptos détenues, consolidées par coin toutes plateformes confondues. Le détail transaction par transaction reste dans Positions."
        actions={
          onOpenPositions ? (
            <button
              type="button"
              onClick={onOpenPositions}
              data-testid="crypto-spot-open-positions"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
            >
              Voir le détail dans Positions
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : undefined
        }
      />

      {cards.length > 0 && (
        <ModuleKpiStrip>
          <AltMiniKpi
            label="Valeur comptant"
            value={formatCurrency(String(totals.value), baseCurrency)}
          />
          <AltMiniKpi
            label="Coût de revient"
            value={formatCurrency(String(totals.cost), baseCurrency)}
            hint="Depuis le journal"
          />
          <AltMiniKpi
            label="P&L latent"
            value={formatCurrency(String(totals.pnl), baseCurrency)}
            tone={totals.pnl}
          />
          <AltMiniKpi
            label={`Dominance ${cards[0]?.symbol ?? ""}`.trim()}
            value={
              dominance != null
                ? `${dominance.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                : "—"
            }
            hint={`${cards.length} coin${cards.length !== 1 ? "s" : ""} distinct${cards.length !== 1 ? "s" : ""}`}
          />
        </ModuleKpiStrip>
      )}

      {cards.length === 0 ? (
        <AltEmptyState
          title="Aucune crypto en comptant"
          description="Les soldes détenus sur exchange ou en self-custody apparaîtront ici, regroupés par coin."
          bullets={[
            "Saisissez un achat depuis Opérations, ou importez un CSV d’exchange",
            "Synchronisez un wallet depuis Mes plateformes (Solana, EVM)",
            "Chaque coin est ensuite consolidé toutes plateformes confondues",
          ]}
          primaryLabel="Voir Positions"
          onPrimary={() => onOpenPositions?.()}
          primaryTestId="crypto-spot-empty-cta"
        />
      ) : (
        <div className="space-y-3 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Trier
            </span>
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                aria-pressed={sort === s.id}
                data-testid={`crypto-spot-sort-${s.id}`}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition",
                  sort === s.id
                    ? "bg-teal-700 text-white"
                    : "text-slate-500 hover:bg-[var(--muted)] hover:text-slate-800 dark:hover:text-slate-200"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <ul className="space-y-2" data-testid="crypto-coin-cards">
            {sorted.map((c) => (
              <li
                key={c.symbol}
                className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-3 transition hover:border-[var(--primary)]/25"
                data-testid={`crypto-coin-card-${c.symbol}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <AssetLogo
                      src={c.logoUrl}
                      name={c.name}
                      ticker={c.symbol}
                      assetClass="CRYPTO"
                      size={32}
                    />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold">{c.symbol}</span>
                        <span className="truncate text-[11px] text-[var(--muted-foreground)]">
                          {c.name}
                        </span>
                      </div>
                      <div className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
                        {formatQuantity(c.quantity)} {c.symbol}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatCurrency(String(c.marketValueEur), baseCurrency)}
                    </div>
                    <div
                      className={cn(
                        "text-[11px] font-medium tabular-nums",
                        getChangeColor(String(c.unrealizedPnlEur))
                      )}
                    >
                      {formatCurrency(String(c.unrealizedPnlEur), baseCurrency)}
                      {c.unrealizedPnlPct != null && (
                        <>
                          {" "}
                          ({c.unrealizedPnlPct > 0 ? "+" : ""}
                          {c.unrealizedPnlPct.toLocaleString("fr-FR", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          %)
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Barre d'allocation — le différenciateur visuel : la
                    concentration de la poche se lit d'un coup d'œil. */}
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${Math.min(100, c.allocationPct)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]">
                    {c.allocationPct.toLocaleString("fr-FR", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    % de la poche
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted-foreground)]">
                  {c.avgCostEur != null && (
                    <span className="tabular-nums">
                      PRU {formatCurrency(String(c.avgCostEur), baseCurrency)}
                    </span>
                  )}
                  {c.currentPriceEur != null && (
                    <span className="tabular-nums">
                      Cours{" "}
                      {formatCurrency(String(c.currentPriceEur), baseCurrency)}
                    </span>
                  )}
                </div>

                <div
                  className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px]"
                  data-testid={`crypto-coin-venues-${c.symbol}`}
                >
                  {c.venues.map((v) => (
                    <span
                      key={v.platformId}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)]/60 px-2 py-0.5"
                      title={`${v.platformName} · ${formatCurrency(String(v.marketValueEur), baseCurrency)}`}
                    >
                      <PlatformLogo
                        src={v.platformLogoUrl}
                        name={v.platformName}
                        size={12}
                      />
                      <span className="max-w-[9rem] truncate font-medium">
                        {v.platformName}
                      </span>
                      <span className="tabular-nums text-[var(--muted-foreground)]">
                        {formatQuantity(v.quantity)}
                      </span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ModuleCard>
  );
}

export { Coins as SpotIcon };
