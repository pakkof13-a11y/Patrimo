"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Coins,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { fetchJson } from "@/app/lib/api-client";
import { cn, formatCurrency } from "@/app/lib/utils";
import { CHART_COLORS } from "@/app/lib/types/ui";
import { DefiPanel } from "@/components/crypto/defi-panel";
import { NftPanel } from "@/components/crypto/nft-panel";
import { SpotPanel } from "@/components/crypto/spot-panel";
import { AltDashKpi } from "@/components/tabs/alternatives-shell";
import type { CoinCardHolding } from "@/app/lib/crypto/coin-cards";

/**
 * Sous-onglets du module Cryptos.
 *
 * `FUTURES` a disparu : une position à levier n'est pas un actif détenu, elle
 * vit désormais dans l'onglet Trading. `DASHBOARD` est le nouveau défaut,
 * aligné sur l'onglet Actifs alternatifs.
 */
export type CryptoSubTab = "DASHBOARD" | "SPOT" | "DEFI" | "NFT";

const SUB_NAV: {
  id: CryptoSubTab;
  label: string;
  short: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "DASHBOARD",
    label: "Vue d’ensemble",
    short: "Dashboard",
    icon: <LayoutDashboard className="h-3.5 w-3.5" />,
  },
  {
    id: "SPOT",
    label: "Comptant",
    short: "Comptant",
    icon: <Coins className="h-3.5 w-3.5" />,
  },
  {
    id: "DEFI",
    label: "DeFi",
    short: "DeFi",
    icon: <Layers className="h-3.5 w-3.5" />,
  },
  {
    id: "NFT",
    label: "NFTs",
    short: "NFT",
    icon: <ImageIcon className="h-3.5 w-3.5" />,
  },
];

type CryptoKpisResponse = {
  spotEur: string;
  defiNetEur: string;
  nftFloorEur: string;
  totalEur: string;
  unrealizedPnlEur: string;
  variation24hPct: string | null;
  walletCount: number;
};

const MODULE_GUIDES: Record<
  Exclude<CryptoSubTab, "DASHBOARD">,
  { title: string; blurb: string }
> = {
  SPOT: {
    title: "Comptant",
    blurb:
      "Jetons détenus sur exchange ou en self-custody — consolidés par coin, toutes plateformes confondues.",
  },
  DEFI: {
    title: "DeFi",
    blurb:
      "Staking, pools de liquidité, prêts — rendement servi et santé des positions collatéralisées.",
  },
  NFT: {
    title: "NFTs",
    blurb: "Collections et art numérique — floor price estimé et rareté.",
  },
};

/**
 * Onglet Cryptos.
 *
 * Calqué sur l'onglet Actifs alternatifs : une vue d'ensemble qui synthétise
 * et oriente, puis un sous-module par nature d'actif, chacun avec sa propre
 * saisie experte.
 *
 * Trois sous-catégories, parce qu'un jeton détenu, un jeton engagé dans un
 * protocole et un NFT ne se lisent pas de la même façon — mais les trois sont
 * des actifs détenus, valorisés depuis le journal. Les futures, eux, sont
 * partis dans l'onglet Trading : un pari collatéralisé par une marge ne
 * s'additionne pas au patrimoine comme les trois autres.
 *
 * Comptant et DeFi sont disjoints par construction : Zerion est interrogé
 * avec `only_simple` pour l'un et `only_complex` pour l'autre, si bien qu'un
 * ETH staké ne peut pas être compté deux fois.
 */
export function CryptosTab({
  sub,
  onSubChange,
  holdings = [],
  baseCurrency = "EUR",
  onOpenPositions,
  className,
}: {
  sub: CryptoSubTab;
  onSubChange: (s: CryptoSubTab) => void;
  /** Positions crypto comptant issues du journal (source de vérité). */
  holdings?: CoinCardHolding[];
  baseCurrency?: string;
  onOpenPositions?: () => void;
  className?: string;
}) {
  const q = useQuery({
    queryKey: ["crypto-summary"],
    queryFn: () => fetchJson<CryptoKpisResponse>("/api/crypto/summary"),
    staleTime: 60_000,
  });

  const data = q.data;
  const variation =
    data?.variation24hPct != null ? Number(data.variation24hPct) : null;
  const spot = Number(data?.spotEur ?? 0);
  const defi = Number(data?.defiNetEur ?? 0);
  const nft = Number(data?.nftFloorEur ?? 0);
  const total = Number(data?.totalEur ?? 0);
  const pnl = Number(data?.unrealizedPnlEur ?? 0);

  const pieData = useMemo(
    () =>
      [
        { id: "SPOT", name: "Comptant", value: spot },
        { id: "DEFI", name: "DeFi", value: defi },
        { id: "NFT", name: "NFTs", value: nft },
      ]
        .filter((s) => s.value > 0)
        .map((s, i) => ({ ...s, fill: CHART_COLORS[i % CHART_COLORS.length] })),
    [spot, defi, nft]
  );

  const hasAny = total !== 0 || pieData.length > 0;

  return (
    <div className={cn("space-y-5", className)} data-testid="cryptos-tab">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-snug">Cryptos</h1>
          <p className="module-intro max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Poche crypto — comptant, DeFi et NFTs. La vue d’ensemble
            synthétise ; chaque sous-module gère sa lecture propre. Les
            positions à levier sont dans l’onglet Trading.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-4 py-2 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Total poche crypto
          </div>
          <div className="text-xl font-semibold tabular-nums tracking-tight text-teal-700 dark:text-teal-300">
            {formatCurrency(String(total), baseCurrency)}
          </div>
          {variation != null && (
            <div
              className={cn(
                "text-[11px] font-medium tabular-nums",
                variation > 0 && "text-[var(--success)]",
                variation < 0 && "text-[var(--danger)]"
              )}
              data-testid="crypto-kpi-variation24h"
            >
              {variation > 0 ? "+" : ""}
              {variation.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %
              <span className="ml-1 font-normal text-[var(--muted-foreground)]">
                24 h
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Sub-nav ── */}
      <nav
        className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2"
        aria-label="Sous-modules crypto"
      >
        {SUB_NAV.map((item) => {
          const active = sub === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSubChange(item.id)}
              aria-current={active ? "page" : undefined}
              data-testid={`crypto-subtab-${item.id}`}
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

      {/* ── Vue d'ensemble ── */}
      {sub === "DASHBOARD" && (
        <section className="space-y-4" data-testid="crypto-dashboard">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AltDashKpi
              label="Comptant"
              value={formatCurrency(String(spot), baseCurrency)}
              hint={
                spot > 0
                  ? "Jetons détenus, consolidés par coin"
                  : "Exchange et self-custody — non renseigné"
              }
              onClick={() => onSubChange("SPOT")}
            />
            <AltDashKpi
              label="DeFi (net)"
              value={formatCurrency(String(defi), baseCurrency)}
              hint={
                defi !== 0
                  ? "Dépôts moins emprunts"
                  : "Staking, pools, prêts — non renseigné"
              }
              onClick={() => onSubChange("DEFI")}
            />
            <AltDashKpi
              label="NFTs (floor)"
              value={formatCurrency(String(nft), baseCurrency)}
              hint={
                nft > 0
                  ? "Estimation floor price"
                  : "Collections — non renseigné"
              }
              onClick={() => onSubChange("NFT")}
            />
            <AltDashKpi
              label="P&L latent"
              value={formatCurrency(String(pnl), baseCurrency)}
              hint={`${data?.walletCount ?? 0} wallet(s) connecté(s)`}
              tone={pnl}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card overflow-hidden p-4">
              <h2 className="mb-0.5 text-sm font-semibold">
                Répartition de la poche
              </h2>
              <p className="mb-3 text-[11px] text-slate-400">
                Poids du comptant, de la DeFi et des NFTs
              </p>
              {pieData.length === 0 ? (
                <div className="flex min-h-[14rem] flex-col items-center justify-center gap-2 px-2 py-6 text-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--muted)] text-slate-400">
                    <PieChartIcon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    La répartition apparaîtra ici
                  </p>
                  <p className="max-w-xs text-[11px] leading-relaxed text-slate-400">
                    Enregistrez un achat ou synchronisez un wallet pour
                    visualiser le poids de chaque poche.
                  </p>
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {pieData.map((e) => (
                          <Cell key={e.id} fill={e.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) =>
                          formatCurrency(String(v ?? 0), baseCurrency)
                        }
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-0.5 text-sm font-semibold">
                {hasAny ? "Détail par module" : "Démarrer la poche crypto"}
              </h2>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                {hasAny
                  ? "Total intégré au patrimoine net global. Cliquez une carte ou un module pour explorer."
                  : "Choisissez la nature d’actif à consulter. Les positions viennent du journal — saisissez une opération ou synchronisez un wallet."}
              </p>

              {hasAny ? (
                <ul className="space-y-2 text-sm">
                  {pieData.map((s) => {
                    const pct =
                      total > 0
                        ? Math.round((s.value / total) * 1000) / 10
                        : 0;
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between border-t border-[var(--border)] pt-2"
                      >
                        <button
                          type="button"
                          className="text-left font-medium text-slate-700 hover:text-teal-700 dark:text-slate-200 dark:hover:text-teal-300"
                          onClick={() => onSubChange(s.id as CryptoSubTab)}
                        >
                          {s.name}
                        </button>
                        <span className="tabular-nums font-medium">
                          {formatCurrency(String(s.value), baseCurrency)}
                          <span className="ml-2 text-xs text-slate-400">
                            {pct} %
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    Object.keys(MODULE_GUIDES) as Array<
                      keyof typeof MODULE_GUIDES
                    >
                  ).map((id) => {
                    const g = MODULE_GUIDES[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onSubChange(id)}
                        className={cn(
                          "rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 text-left transition",
                          "hover:border-teal-500/30 hover:bg-teal-500/[0.04]",
                          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                        )}
                      >
                        <div className="text-sm font-semibold">{g.title}</div>
                        <p className="mt-1 text-[11px] leading-snug text-slate-400">
                          {g.blurb}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {sub === "SPOT" && (
        <SpotPanel
          holdings={holdings}
          baseCurrency={baseCurrency}
          onOpenPositions={onOpenPositions}
        />
      )}
      {sub === "DEFI" && <DefiPanel />}
      {sub === "NFT" && <NftPanel />}
    </div>
  );
}
