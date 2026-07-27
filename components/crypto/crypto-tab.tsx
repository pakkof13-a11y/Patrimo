"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins, Image as ImageIcon, Layers, TrendingUp } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { cn, formatCurrency } from "@/app/lib/utils";
import { DefiPanel } from "@/components/crypto/defi-panel";
import { FuturesPanel } from "@/components/crypto/futures-panel";
import { NftPanel } from "@/components/crypto/nft-panel";

export type CryptoSubTab = "SPOT" | "DEFI" | "NFT" | "FUTURES";

const SUB_NAV: { id: CryptoSubTab; label: string; icon: React.ReactNode }[] = [
  { id: "SPOT", label: "Comptant", icon: <Coins className="h-3.5 w-3.5" /> },
  { id: "DEFI", label: "DeFi", icon: <Layers className="h-3.5 w-3.5" /> },
  { id: "NFT", label: "NFT", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { id: "FUTURES", label: "Futures", icon: <TrendingUp className="h-3.5 w-3.5" /> },
];

type CryptoKpisResponse = {
  totalEur: string;
  unrealizedPnlEur: string;
  variation24hPct: string | null;
  walletCount: number;
};

/**
 * KPI strip permanent — affiché quel que soit le sous-onglet ouvert.
 *
 * Volontairement bon marché : aucun appel fournisseur, seulement le journal
 * et le cache de clôtures déjà rempli ailleurs. La variation 24h s'affiche
 * « — » plutôt qu'un chiffre quand la couverture du cache est insuffisante —
 * un trou assumé plutôt qu'un pourcentage inventé.
 */
function CryptoKpiStrip() {
  const q = useQuery({
    queryKey: ["crypto-summary"],
    queryFn: () => fetchJson<CryptoKpisResponse>("/api/crypto/summary"),
    staleTime: 60_000,
  });

  const data = q.data;
  const variation = data?.variation24hPct != null ? Number(data.variation24hPct) : null;

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      data-testid="crypto-kpi-strip"
    >
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/40 px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
          Valeur totale crypto
        </p>
        <p className="mt-0.5 text-sm font-semibold tabular-nums">
          {data ? formatCurrency(data.totalEur, "EUR") : "—"}
        </p>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
          Variation 24h
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs font-medium tabular-nums",
            variation != null && variation > 0 && "text-[var(--success)]",
            variation != null && variation < 0 && "text-[var(--danger)]"
          )}
          data-testid="crypto-kpi-variation24h"
        >
          {variation != null
            ? `${variation > 0 ? "+" : ""}${variation.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
            : "—"}
        </p>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
          PV / MV latente
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs font-medium tabular-nums",
            data && Number(data.unrealizedPnlEur) < 0 && "text-[var(--danger)]"
          )}
        >
          {data ? formatCurrency(data.unrealizedPnlEur, "EUR") : "—"}
        </p>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
          Wallets connectés
        </p>
        <p className="mt-0.5 text-xs font-medium tabular-nums">
          {data ? data.walletCount : "—"}
        </p>
      </div>
    </div>
  );
}

/**
 * Onglet Crypto.
 *
 * Un KPI strip permanent (valeur totale, variation 24h, PV latente, nombre de
 * wallets) domine les quatre sous-onglets — Spot + DeFi net + floor NFT, hors
 * Futures qui n'est pas un actif détenu.
 *
 * Quatre vues, parce qu'un jeton détenu, un jeton engagé dans un protocole,
 * un NFT et une position à levier ne se lisent pas de la même façon :
 *
 * - **Comptant** — les soldes, dans le tableau Positions habituel. Rien à
 *   réinventer : une ligne de jetons se lit comme une ligne de titres.
 * - **DeFi** — ce que le tableau ne peut pas montrer : la contrepartie, le
 *   rendement servi, et la santé d'un prêt collatéralisé.
 * - **NFT** — un NFT reste un actif détenu (comme le comptant et la DeFi) :
 *   sa valeur vient du journal, la galerie n'ajoute que le floor price estimé.
 * - **Futures** — à part des trois autres : une position à levier n'est pas
 *   un actif détenu, elle ne touche donc ni le journal ni le patrimoine
 *   coté. Ses totaux (marge engagée, exposition nette, P&L latent) sont
 *   propres à ce panneau.
 *
 * Comptant et DeFi sont disjoints par construction : Zerion est interrogé
 * avec `only_simple` pour l'un et `only_complex` pour l'autre, si bien qu'un
 * ETH staké ne peut pas être compté deux fois.
 */
export function CryptoTab({
  sub,
  onSubChange,
  className,
}: {
  sub: CryptoSubTab;
  onSubChange: (s: CryptoSubTab) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)} data-testid="crypto-tab">
      <CryptoKpiStrip />

      <nav className="flex flex-wrap gap-1.5" aria-label="Vues du module crypto">
        {SUB_NAV.map((item) => {
          const active = item.id === sub;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSubChange(item.id)}
              aria-current={active ? "page" : undefined}
              data-testid={`crypto-subtab-${item.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-[var(--primary)]/40 bg-[var(--primary-soft)] text-[var(--foreground)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Le comptant est rendu par le tableau Positions, en dessous. */}
      {sub === "DEFI" && <DefiPanel />}
      {sub === "NFT" && <NftPanel />}
      {sub === "FUTURES" && <FuturesPanel />}
    </div>
  );
}
