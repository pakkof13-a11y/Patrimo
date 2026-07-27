"use client";

import { Coins, Image as ImageIcon, Layers, TrendingUp } from "lucide-react";
import { cn } from "@/app/lib/utils";
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

/**
 * Onglet Crypto.
 *
 * Deux vues, parce qu'un jeton détenu et un jeton engagé dans un protocole ne
 * se lisent pas de la même façon :
 *
 * - **Comptant** — les soldes, dans le tableau Positions habituel. Rien à
 *   réinventer : une ligne de jetons se lit comme une ligne de titres.
 * - **DeFi** — ce que le tableau ne peut pas montrer : la contrepartie, le
 *   rendement servi, et la santé d'un prêt collatéralisé.
 *
 * Les deux ensembles sont disjoints par construction : Zerion est interrogé
 * avec `only_simple` pour le comptant et `only_complex` pour le DeFi, si bien
 * qu'un ETH staké ne peut pas être compté deux fois.
 *
 * - **NFT** — un NFT reste un actif détenu (comme le comptant et la DeFi) :
 *   sa valeur vient du journal, la galerie n'ajoute que le floor price estimé.
 * - **Futures** — à part des trois autres : une position à levier n'est pas
 *   un actif détenu, elle ne touche donc ni le journal ni le patrimoine
 *   coté. Ses totaux (marge engagée, exposition nette, P&L latent) sont
 *   propres à ce panneau.
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
