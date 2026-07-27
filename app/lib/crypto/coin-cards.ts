/**
 * Consolidation par coin des positions crypto comptant — fonction pure.
 *
 * Le tableau Positions est structuré par *actif × plateforme* : un même BTC
 * détenu sur Binance, sur un Ledger et sur Coinbase y occupe trois lignes
 * distinctes. C'est le bon découpage pour la lecture comptable (chaque ligne
 * a son PRU, son lot fiscal, son historique), mais il rend impossible la
 * lecture patrimoniale : « combien de BTC ai-je au total, et quel poids
 * pèse-t-il dans ma poche crypto ? ».
 *
 * Ce module répond à cette seconde question en regroupant les jambes par
 * symbole. Il ne duplique aucune donnée : quantités, coûts et valeurs
 * viennent du journal via `platformSlices`, déjà calculées par
 * `holdings-platform-slice`. Une position consolidée n'est donc jamais
 * périmée — elle se recalcule à chaque lecture depuis la même source de
 * vérité que Positions, ce qui garantit que les deux vues ne peuvent pas
 * afficher des chiffres différents pour le même actif.
 */

export type CoinCardVenue = {
  platformId: string;
  platformName: string;
  platformLogoUrl?: string | null;
  blockchainLabel?: string | null;
  quantity: number;
  marketValueEur: number;
};

export type CoinCard = {
  /** Symbole normalisé majuscule (BTC, ETH…) — clé de regroupement. */
  symbol: string;
  /** Libellé lisible : nom de l'actif si connu, sinon le symbole. */
  name: string;
  logoUrl?: string | null;
  quantity: number;
  costBasisEur: number;
  marketValueEur: number;
  unrealizedPnlEur: number;
  /** Null si le coût de revient est nul (airdrop, reward) — pas de 0 % trompeur. */
  unrealizedPnlPct: number | null;
  /** PRU consolidé = coût total / quantité totale. Null si quantité nulle. */
  avgCostEur: number | null;
  currentPriceEur: number | null;
  /** Poids dans la poche comptant, en % (0–100). */
  allocationPct: number;
  /** Détail multi-custody, décroissant par valeur. */
  venues: CoinCardVenue[];
};

/** Champs lus sur un holding — sous-ensemble volontairement minimal de `Holding`. */
export type CoinCardHolding = {
  assetId: string;
  name: string;
  ticker?: string | null;
  assetLogoUrl?: string | null;
  logoUrl?: string | null;
  quantity: string;
  costBasisEur: string;
  marketValueEur: string;
  platformId: string;
  platformName: string;
  platformLogoUrl?: string | null;
  blockchainLabel?: string | null;
  platformSlices?: Array<{
    platformId: string;
    platformName: string;
    platformLogoUrl?: string | null;
    blockchainLabel?: string | null;
    quantity: string;
    costBasisEur: string;
    marketValueEur: string;
  }>;
};

function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Symbole de regroupement : le ticker quand il existe, sinon le nom.
 *
 * Les suffixes de place (« BTC.X », « ETH-EUR ») sont coupés : un même coin
 * acheté sur deux exchanges qui le nomment différemment doit se consolider
 * en une seule carte, sinon la vue patrimoniale reproduit exactement le
 * défaut qu'elle est censée corriger.
 */
export function coinSymbolOf(h: CoinCardHolding): string {
  const raw = (h.ticker || h.name || "").trim();
  if (!raw) return "?";
  const head = raw.split(/[.\-/:]/)[0] ?? raw;
  return head.toUpperCase();
}

/**
 * Regroupe des holdings comptant en cartes par coin, triées par valeur
 * décroissante. `allocationPct` est calculé sur le total des cartes.
 */
export function buildCoinCards(holdings: CoinCardHolding[]): CoinCard[] {
  const bySymbol = new Map<
    string,
    {
      symbol: string;
      name: string;
      logoUrl?: string | null;
      quantity: number;
      costBasisEur: number;
      marketValueEur: number;
      venues: Map<string, CoinCardVenue>;
    }
  >();

  for (const h of holdings) {
    const symbol = coinSymbolOf(h);
    let entry = bySymbol.get(symbol);
    if (!entry) {
      entry = {
        symbol,
        name: h.name || symbol,
        logoUrl: h.assetLogoUrl || h.logoUrl || null,
        quantity: 0,
        costBasisEur: 0,
        marketValueEur: 0,
        venues: new Map(),
      };
      bySymbol.set(symbol, entry);
    }
    if (!entry.logoUrl) entry.logoUrl = h.assetLogoUrl || h.logoUrl || null;

    entry.quantity += num(h.quantity);
    entry.costBasisEur += num(h.costBasisEur);
    entry.marketValueEur += num(h.marketValueEur);

    // Les slices portent déjà le détail par plateforme (crypto multi-custody).
    // Sans slice, le holding lui-même est sa propre unique jambe.
    const legs =
      h.platformSlices && h.platformSlices.length > 0
        ? h.platformSlices
        : [
            {
              platformId: h.platformId,
              platformName: h.platformName,
              platformLogoUrl: h.platformLogoUrl,
              blockchainLabel: h.blockchainLabel,
              quantity: h.quantity,
              costBasisEur: h.costBasisEur,
              marketValueEur: h.marketValueEur,
            },
          ];

    for (const leg of legs) {
      const prev = entry.venues.get(leg.platformId);
      if (prev) {
        prev.quantity += num(leg.quantity);
        prev.marketValueEur += num(leg.marketValueEur);
      } else {
        entry.venues.set(leg.platformId, {
          platformId: leg.platformId,
          platformName: leg.platformName,
          platformLogoUrl: leg.platformLogoUrl ?? null,
          blockchainLabel: leg.blockchainLabel ?? null,
          quantity: num(leg.quantity),
          marketValueEur: num(leg.marketValueEur),
        });
      }
    }
  }

  const totalValue = [...bySymbol.values()].reduce(
    (s, e) => s + e.marketValueEur,
    0
  );

  const cards: CoinCard[] = [...bySymbol.values()].map((e) => {
    const pnl = e.marketValueEur - e.costBasisEur;
    return {
      symbol: e.symbol,
      name: e.name,
      logoUrl: e.logoUrl,
      quantity: e.quantity,
      costBasisEur: e.costBasisEur,
      marketValueEur: e.marketValueEur,
      unrealizedPnlEur: pnl,
      // Un coût nul (airdrop, reward) rendrait le pourcentage infini : on
      // renvoie null plutôt qu'un chiffre qui ne veut rien dire.
      unrealizedPnlPct: e.costBasisEur > 0 ? (pnl / e.costBasisEur) * 100 : null,
      avgCostEur: e.quantity > 0 ? e.costBasisEur / e.quantity : null,
      currentPriceEur: e.quantity > 0 ? e.marketValueEur / e.quantity : null,
      allocationPct: totalValue > 0 ? (e.marketValueEur / totalValue) * 100 : 0,
      venues: [...e.venues.values()].sort(
        (a, b) => b.marketValueEur - a.marketValueEur
      ),
    };
  });

  return cards.sort((a, b) => b.marketValueEur - a.marketValueEur);
}

/**
 * Part du plus gros coin dans la poche comptant, en % — « dominance BTC »
 * quand BTC est en tête. Null si la poche est vide.
 */
export function topCoinDominancePct(cards: CoinCard[]): number | null {
  if (cards.length === 0) return null;
  return cards[0]!.allocationPct;
}
