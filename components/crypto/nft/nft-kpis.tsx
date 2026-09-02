"use client";

import {
  AlertTriangle,
  EyeOff,
  Gem,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Kpi } from "@/components/ui/kpi";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { cn, formatCurrency } from "@/app/lib/utils";
import { d } from "@/app/lib/money/decimal";
import type { ClientNftAggregate, ClientNftPortfolioBundle } from "@/app/lib/crypto/nft-ui-rules";

/**
 * Bandeau KPI NFT — explicite ce que chaque chiffre veut dire une seule fois,
 * pour que galerie/tableau/détail n'inventent jamais une explication
 * concurrente (règle : ne jamais confondre valeur retenue, floor, valeur
 * inconnue, masqué/ignoré).
 */
export function NftKpis({ bundle }: { bundle: ClientNftPortfolioBundle }) {
  const t = bundle.totals;
  const unvaluableCount = bundle.valuationQuality.unvaluableCount;
  const weakCount = bundle.valuationQuality.weakCount;
  const staleCount = bundle.valuationQuality.staleCount;

  const floorBackedTotal = bundle.holdings
    .filter((h) => h.retainedValueMethod === "FLOOR_PRICE")
    .reduce((s, h) => s.plus(d(h.retainedValueEur)), d(0));

  return (
    <div className="space-y-3" data-testid="nft-kpis">
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
          testId="nft-kpi-retained"
        />
        <Kpi
          icon={<Layers aria-hidden />}
          label="NFT actifs"
          value={String(t.countedHoldingCount)}
          testId="nft-kpi-count"
        />
        <Kpi
          icon={<Gem aria-hidden />}
          label="Floor agrégée"
          value={formatCurrency(floorBackedTotal.toFixed(2), "EUR")}
          testId="nft-kpi-floor"
        />
        <Kpi
          icon={<HelpCircle aria-hidden />}
          label="Valeur inconnue"
          value={String(unvaluableCount)}
          tone={unvaluableCount > 0 ? "down" : undefined}
          muted={unvaluableCount === 0}
          testId="nft-kpi-unvaluable"
        />
        <Kpi
          icon={<AlertTriangle aria-hidden />}
          label="Sans estimation fiable"
          value={String(weakCount)}
          tone={weakCount > 0 ? "down" : undefined}
          muted={weakCount === 0}
          testId="nft-kpi-weak"
        />
        <Kpi
          icon={<ShieldAlert aria-hidden />}
          label="Spam confirmé"
          value={String(t.spamCount)}
          tone={t.spamCount > 0 ? "down" : undefined}
          muted={t.spamCount === 0}
          testId="nft-kpi-spam"
        />
        <Kpi
          icon={<EyeOff aria-hidden />}
          label="Masqués"
          value={String(bundle.excluded.hiddenCount)}
          muted={bundle.excluded.hiddenCount === 0}
          testId="nft-kpi-hidden"
        />
        <Kpi
          icon={<EyeOff aria-hidden />}
          label="Ignorés du patrimoine"
          value={String(bundle.excluded.ignoredCount)}
          muted={bundle.excluded.ignoredCount === 0}
          testId="nft-kpi-ignored"
        />
        <Kpi
          icon={<ImageIcon aria-hidden />}
          label="Collections"
          value={String(bundle.byCollection.length)}
          testId="nft-kpi-collections"
        />
        <Kpi
          icon={<AlertTriangle aria-hidden />}
          label="Valorisation périmée"
          value={String(staleCount)}
          tone={staleCount > 0 ? "down" : undefined}
          muted={staleCount === 0}
          testId="nft-kpi-stale"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <BreakdownList title="Par chaîne" items={bundle.byChain} />
        <BreakdownList title="Par collection" items={bundle.byCollection} />
        <BreakdownList title="Par catégorie" items={bundle.byCategory} />
      </div>

      <p className="text-meta">
        Valeur retenue = ce qui entre dans le patrimoine · floor = indicateur de marché, jamais une
        garantie · valeur inconnue ≠ 0 € · masqué = retiré de l&apos;affichage mais compté ; ignoré =
        retiré des agrégats mais historisé.
      </p>
    </div>
  );
}

function BreakdownList({ title, items }: { title: string; items: ClientNftAggregate[] }) {
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
                  <span className="text-meta ml-1">· {i.holdingCount}</span>
                </span>
                <span className={cn("shrink-0 tabular-nums font-medium")}>
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
