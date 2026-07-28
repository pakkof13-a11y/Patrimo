"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, LayoutDashboard, Landmark, TrendingUp } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { cn, formatCurrency } from "@/app/lib/utils";
import { FuturesPanel } from "@/components/trading/futures-panel";
import { TradingAccountsPanel } from "@/components/trading/trading-accounts-panel";
import { TradingJournalPanel } from "@/components/trading/trading-journal-panel";
import { AltDashKpi } from "@/components/tabs/alternatives-shell";

export type TradingSubTab = "dashboard" | "cfd" | "futures" | "journal";

const TRADING_SUBS = new Set<string>([
  "dashboard",
  "cfd",
  "futures",
  "journal",
]);

const SUB_NAV: {
  id: TradingSubTab;
  label: string;
  short: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "dashboard",
    label: "Vue d’ensemble",
    short: "Dashboard",
    icon: <LayoutDashboard className="h-3.5 w-3.5" />,
  },
  {
    id: "cfd",
    label: "Comptes & CFD",
    short: "CFD",
    icon: <Landmark className="h-3.5 w-3.5" />,
  },
  {
    id: "futures",
    label: "Futures crypto",
    short: "Futures",
    icon: <TrendingUp className="h-3.5 w-3.5" />,
  },
  {
    id: "journal",
    label: "Journal",
    short: "Journal",
    icon: <BookOpen className="h-3.5 w-3.5" />,
  },
];

type FuturesSummaryResponse = {
  summary: {
    totalMarginEur: string;
    netExposureEur: string;
    unrealizedPnlEur: string;
    positionCount: number;
    liquidationAlerts: number;
  };
};

/**
 * Onglet Trading — positions à levier et dérivés.
 *
 * Séparé des Cryptos parce qu'une position à levier ne se valorise pas comme
 * un actif détenu : elle ne pèse au patrimoine ni par sa taille ni par son
 * notionnel, mais par la marge engagée plus le P&L latent. Le total affiché
 * ici n'entre donc pas dans les mêmes additions que le comptant ou la DeFi.
 *
 * Pour l'instant un seul sous-module (futures crypto, déplacé depuis l'onglet
 * Crypto). Le shell est volontairement dimensionné pour en accueillir
 * d'autres (options, forex, CFD) sans réécriture.
 */
export function TradingTab({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const searchParams = useSearchParams();
  const [sub, setSub] = useState<TradingSubTab>(() => {
    const q = (searchParams.get("sub") || "").toLowerCase();
    return TRADING_SUBS.has(q) ? (q as TradingSubTab) : "dashboard";
  });

  // Sync depuis l'URL quand elle change (deep-link) — même motif que
  // l'onglet Actifs alternatifs.
  const subParamKey = searchParams.toString();
  const [prevSubParamKey, setPrevSubParamKey] = useState(subParamKey);
  if (subParamKey !== prevSubParamKey) {
    setPrevSubParamKey(subParamKey);
    const q = (searchParams.get("sub") || "").toLowerCase();
    if (TRADING_SUBS.has(q)) setSub(q as TradingSubTab);
  }

  const q = useQuery({
    queryKey: ["crypto-futures"],
    queryFn: () => fetchJson<FuturesSummaryResponse>("/api/crypto/futures"),
    enabled: sub === "dashboard",
    staleTime: 60_000,
  });

  const s = q.data?.summary;
  const margin = Number(s?.totalMarginEur ?? 0);
  const pnl = Number(s?.unrealizedPnlEur ?? 0);
  const count = s?.positionCount ?? 0;

  return (
    <div className="space-y-5" data-testid="trading-tab">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-snug">Trading</h1>
          <p className="module-intro max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Positions à levier et dérivés. Contrairement aux poches
            patrimoniales, ce qui compte ici n’est pas la taille de la position
            mais la marge engagée et le P&amp;L latent — ces montants n’entrent
            donc pas dans le patrimoine net comme un actif détenu.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-2 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Marge engagée
          </div>
          <div className="text-xl font-semibold tabular-nums tracking-tight text-teal-700 dark:text-teal-300">
            {formatCurrency(String(margin), baseCurrency)}
          </div>
        </div>
      </div>

      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2"
        aria-label="Sous-modules trading"
      >
        {SUB_NAV.map((item) => {
          const active = sub === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`trading-sub-${item.id}`}
              onClick={() => setSub(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                active
                  ? "bg-teal-50 text-teal-900 ring-1 ring-teal-500/25 dark:bg-teal-950/60 dark:text-teal-100"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
              <span className="sm:hidden">{item.short}</span>
            </button>
          );
        })}
      </nav>

      {sub === "dashboard" && (
        <section className="space-y-4" data-testid="trading-dashboard">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AltDashKpi
              label="Futures crypto"
              value={formatCurrency(String(margin), baseCurrency)}
              hint={
                count > 0
                  ? `${count} position(s) ouverte(s)`
                  : "Perpétuels et contrats à terme — non renseigné"
              }
              onClick={() => setSub("futures")}
            />
            <AltDashKpi
              label="P&L latent"
              value={formatCurrency(String(pnl), baseCurrency)}
              hint="Positions ouvertes, funding et commissions exclus"
              tone={pnl}
            />
            <AltDashKpi
              label="Exposition nette"
              value={formatCurrency(
                String(Number(s?.netExposureEur ?? 0)),
                baseCurrency
              )}
              hint="Notionnel long − notionnel short"
            />
            <AltDashKpi
              label="Alertes liquidation"
              value={String(s?.liquidationAlerts ?? 0)}
              hint={
                (s?.liquidationAlerts ?? 0) > 0
                  ? "Position(s) proche(s) du prix de liquidation"
                  : "Aucune position à risque immédiat"
              }
              tone={(s?.liquidationAlerts ?? 0) > 0 ? -1 : 0}
              onClick={() => setSub("futures")}
            />
          </div>

          <div className="card p-4">
            <h2 className="mb-0.5 text-sm font-semibold">
              {count > 0 ? "Modules de trading" : "Démarrer le suivi trading"}
            </h2>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
              {count > 0
                ? "Chaque module gère ses positions et ses imports de relevés."
                : "Un seul module pour l’instant : les futures crypto. D’autres instruments (options, forex) viendront s’ajouter ici."}
            </p>
            <button
              type="button"
              onClick={() => setSub("futures")}
              className={cn(
                "w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 text-left transition sm:w-1/2",
                "hover:border-teal-500/30 hover:bg-teal-500/[0.04]",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              )}
              data-testid="trading-goto-futures"
            >
              <div className="text-sm font-semibold">Futures crypto</div>
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                Perpétuels et contrats à terme — levier, marge, prix de
                liquidation et import de relevés exchange.
              </p>
            </button>
          </div>
        </section>
      )}

      {sub === "cfd" && <TradingAccountsPanel />}
      {sub === "futures" && <FuturesPanel />}
      {sub === "journal" && <TradingJournalPanel />}
    </div>
  );
}
