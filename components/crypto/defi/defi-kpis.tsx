"use client";

import {
  AlertTriangle,
  Coins,
  Gift,
  HandCoins,
  HelpCircle,
  Layers,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Kpi } from "@/components/ui/kpi";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { cn, formatCurrency } from "@/app/lib/utils";
import type { ClientDefiAggregate, ClientDefiPortfolioBundle } from "@/app/lib/crypto/defi-ui-rules";

/**
 * Bandeau KPI DeFi — un seul endroit qui explique ce que chaque montant veut
 * dire, pour que le tableau et le détail n'aient jamais à réinventer une
 * explication concurrente du même chiffre (règle : ne jamais confondre valeur
 * brute, nette, dette, collatéral, rewards, valeur retenue).
 */
export function DefiKpis({ bundle }: { bundle: ClientDefiPortfolioBundle }) {
  const t = bundle.totals;
  const staleCount = bundle.valuationQuality.staleCount;
  const unvaluableCount = bundle.valuationQuality.unvaluableCount;
  const riskCount = bundle.debtAlerts.length;

  return (
    <div className="space-y-3" data-testid="defi-kpis">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          icon={<Wallet aria-hidden />}
          label={
            <span className="inline-flex items-center gap-1">
              Valeur retenue
              <FinanceTip term="valeur retenue" />
            </span>
          }
          value={formatCurrency(t.retainedEur, "EUR")}
          accent
          testId="defi-kpi-retained"
        />
        <Kpi
          icon={<Coins aria-hidden />}
          label="Valeur brute"
          value={formatCurrency(t.grossEur, "EUR")}
          testId="defi-kpi-gross"
        />
        <Kpi
          icon={<HandCoins aria-hidden />}
          label="Dette totale"
          value={formatCurrency(t.debtEur, "EUR")}
          tone={Number(t.debtEur) > 0 ? "down" : undefined}
          testId="defi-kpi-debt"
        />
        <Kpi
          icon={<ShieldAlert aria-hidden />}
          label="Collatéral total"
          value={formatCurrency(t.collateralEur, "EUR")}
          testId="defi-kpi-collateral"
        />
        <Kpi
          icon={<Gift aria-hidden />}
          label="Rewards estimées"
          value={formatCurrency(t.rewardsEur, "EUR")}
          testId="defi-kpi-rewards"
        />
        <Kpi
          icon={<Layers aria-hidden />}
          label="Positions"
          value={String(t.countedPositionCount)}
          testId="defi-kpi-count"
        />
        <Kpi
          icon={<HelpCircle aria-hidden />}
          label="Valeur inconnue"
          value={String(unvaluableCount)}
          tone={unvaluableCount > 0 ? "down" : undefined}
          muted={unvaluableCount === 0}
          testId="defi-kpi-unvaluable"
        />
        <Kpi
          icon={<AlertTriangle aria-hidden />}
          label="Valorisation périmée"
          value={String(staleCount)}
          tone={staleCount > 0 ? "down" : undefined}
          muted={staleCount === 0}
          testId="defi-kpi-stale"
        />
        <Kpi
          icon={<ShieldAlert aria-hidden />}
          label="Positions à risque"
          value={String(riskCount)}
          tone={riskCount > 0 ? "down" : undefined}
          muted={riskCount === 0}
          testId="defi-kpi-risk"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <BreakdownList title="Par chaîne" items={bundle.byChain} />
        <BreakdownList title="Par protocole" items={bundle.byProtocol} />
        <BreakdownList title="Par type de position" items={bundle.byPositionType} />
      </div>

      <p className="text-meta">
        Valeur brute = exposition positive avant dette · valeur nette = après
        dette · rewards = gains non nécessairement réclamés · APR/APY =
        indicatif, jamais une vérité comptable · valeur retenue = ce qui entre
        dans le patrimoine.
      </p>
    </div>
  );
}

function BreakdownList({
  title,
  items,
}: {
  title: string;
  items: ClientDefiAggregate[];
}) {
  const top = items.slice(0, 5);
  const total = items.reduce((s, i) => s + Number(i.retainedEur), 0);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </p>
      {top.length === 0 ? (
        <p className="text-meta mt-1.5">—</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {top.map((i) => {
            const pct = total > 0 ? (Number(i.retainedEur) / total) * 100 : 0;
            return (
              <li key={i.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate" title={i.label}>
                  {i.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums font-medium",
                    Number(i.retainedEur) < 0 && "text-[var(--danger)]"
                  )}
                >
                  {formatCurrency(i.retainedEur, "EUR")}
                  <span className="ml-1 font-normal text-[var(--muted-foreground)]">
                    {pct.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
