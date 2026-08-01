/**
 * Agrégats de la vue d'ensemble « Crypto — Comptant ».
 *
 * Fonctions pures, bâties sur `buildCoinCards` : celui-ci consolide les
 * positions par coin toutes plateformes confondues, ce module en tire ce que
 * l'écran affiche — mesures de tête, répartition, concentration.
 *
 * Un principe traverse le fichier : **ce qui n'est pas connu ressort à `null`**.
 * Une variation 24 h sans clôture de la veille, un équivalent BTC sans cours du
 * bitcoin, une performance sans prix de revient : dans chaque cas, l'écran doit
 * pouvoir dire « on ne sait pas » plutôt qu'afficher un zéro qui se lirait
 * « stable ».
 */

import { shiftDays, shiftMonths } from "../dates/day-window";
import type { CoinCard } from "./coin-cards";

/* ── Fenêtres de temps ────────────────────────────────────────────── */

/**
 * Fenêtres du sélecteur d'évolution.
 *
 * Plus courtes que celles des enveloppes de long terme (assurance-vie, épargne
 * salariale) : une poche crypto se regarde à la journée et à la semaine, pas à
 * cinq ans. « 1J » n'est pas de l'intrajournalier pour autant — la série reste
 * journalière, la fenêtre montre simplement la veille et le jour même.
 */
export const SPOT_RANGES = ["1d", "7d", "1m", "3m", "1y", "ytd", "all"] as const;
export type SpotRange = (typeof SPOT_RANGES)[number];

export const SPOT_RANGE_LABEL: Record<SpotRange, string> = {
  "1d": "1J",
  "7d": "7J",
  "1m": "1M",
  "3m": "3M",
  "1y": "1A",
  ytd: "YTD",
  all: "Tout",
};

export function isSpotRange(v: string): v is SpotRange {
  return (SPOT_RANGES as readonly string[]).includes(v);
}

/**
 * Premier jour d'une fenêtre. `all` rend `null` : c'est au service de retomber
 * sur la première opération connue, qu'aucune durée fixe ne saurait deviner.
 */
export function spotRangeStartDay(range: SpotRange, now: Date): string | null {
  switch (range) {
    case "1d":
      return shiftDays(now, -1);
    case "7d":
      return shiftDays(now, -7);
    case "1m":
      return shiftMonths(now, -1);
    case "3m":
      return shiftMonths(now, -3);
    case "1y":
      return shiftMonths(now, -12);
    case "ytd":
      return `${now.getUTCFullYear()}-01-01`;
    case "all":
      return null;
  }
}

export type SpotTotals = {
  totalValueEur: number;
  costBasisEur: number;
  unrealizedPnlEur: number;
  /** Rapporté au prix de revient, `null` si rien n'a été investi. */
  unrealizedPnlPct: number | null;
  /**
   * Équivalent en bitcoin de l'encours. `null` sans cours du BTC — et non 0,
   * qui laisserait croire à un portefeuille vide.
   */
  btcEquivalent: number | null;
  assetCount: number;
  venueCount: number;
};

export function computeSpotTotals(
  cards: CoinCard[],
  btcPriceEur: number | null
): SpotTotals {
  let totalValueEur = 0;
  let costBasisEur = 0;
  const venues = new Set<string>();

  for (const c of cards) {
    totalValueEur += c.marketValueEur;
    costBasisEur += c.costBasisEur;
    for (const v of c.venues) venues.add(v.platformId);
  }

  const unrealizedPnlEur = totalValueEur - costBasisEur;

  return {
    totalValueEur,
    costBasisEur,
    unrealizedPnlEur,
    unrealizedPnlPct:
      costBasisEur > 0 ? (unrealizedPnlEur / costBasisEur) * 100 : null,
    btcEquivalent:
      btcPriceEur != null && btcPriceEur > 0
        ? totalValueEur / btcPriceEur
        : null,
    assetCount: cards.length,
    venueCount: venues.size,
  };
}

/* ── Répartition ──────────────────────────────────────────────────── */

export type AllocationSlice = {
  symbol: string;
  label: string;
  valueEur: number;
  /** Part de la poche, `null` si la poche est vide. */
  sharePct: number | null;
  /** true pour la part d'agrégation « Autres ». */
  isOthers: boolean;
};

/** Au-delà, l'anneau devient illisible et les parts ne se distinguent plus. */
export const MAX_ALLOCATION_SLICES = 5;

/**
 * Répartition de la poche par coin, les plus petits regroupés sous « Autres ».
 *
 * Le regroupement n'est pas cosmétique : douze parts de 2 % rendent un anneau
 * illisible, et un utilisateur qui cherche son exposition Bitcoin ne la trouve
 * plus. Le détail complet reste dans le tableau, juste en dessous.
 */
export function computeSpotAllocation(
  cards: CoinCard[],
  maxSlices = MAX_ALLOCATION_SLICES
): AllocationSlice[] {
  const positive = cards.filter((c) => c.marketValueEur > 0);
  const total = positive.reduce((s, c) => s + c.marketValueEur, 0);
  if (positive.length === 0) return [];

  const sorted = [...positive].sort((a, b) => b.marketValueEur - a.marketValueEur);
  const head = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);

  const slices: AllocationSlice[] = head.map((c) => ({
    symbol: c.symbol,
    label: c.symbol,
    valueEur: c.marketValueEur,
    sharePct: total > 0 ? (c.marketValueEur / total) * 100 : null,
    isOthers: false,
  }));

  if (tail.length > 0) {
    const value = tail.reduce((s, c) => s + c.marketValueEur, 0);
    slices.push({
      symbol: "OTHERS",
      label: `Autres (${tail.length})`,
      valueEur: value,
      sharePct: total > 0 ? (value / total) * 100 : null,
      isOthers: true,
    });
  }

  return slices;
}

/* ── Concentration ────────────────────────────────────────────────── */

export type ConcentrationLevel = "low" | "moderate" | "high";

export type Concentration = {
  level: ConcentrationLevel;
  label: string;
  /** Poids du coin dans la poche, en %. */
  sharePct: number;
};

/**
 * Lecture du poids d'un coin dans la poche.
 *
 * Les seuils (25 % et 50 %) ne sont pas une règle de marché mais une convention
 * d'affichage, choisie pour être lisible : au-delà de la moitié, la poche
 * *est* ce coin ; en dessous du quart, il n'en décide pas le sort. Aucun
 * conseil n'en découle — l'écran signale une situation, il ne recommande rien.
 */
export const CONCENTRATION_HIGH_PCT = 50;
export const CONCENTRATION_MODERATE_PCT = 25;

export function concentrationOf(sharePct: number): Concentration {
  if (sharePct >= CONCENTRATION_HIGH_PCT) {
    return { level: "high", label: "Position dominante", sharePct };
  }
  if (sharePct >= CONCENTRATION_MODERATE_PCT) {
    return { level: "moderate", label: "Poids notable", sharePct };
  }
  return { level: "low", label: "Poids limité", sharePct };
}

/* ── Vue par actif ────────────────────────────────────────────────── */

export type AssetRow = {
  card: CoinCard;
  concentration: Concentration;
  /** Variation 24 h du coin, en %. `null` sans clôture de la veille. */
  change24hPct: number | null;
  /** Valeur gagnée ou perdue en 24 h, `null` pour la même raison. */
  change24hEur: number | null;
  /** Cours de clôture des 30 derniers jours, pour la sparkline. */
  spark: number[];
};

export type AssetSeries = {
  /** Variation 24 h en %, `null` si la veille n'est pas cotée. */
  change24hPct: number | null;
  /** Clôtures récentes, du plus ancien au plus récent. */
  closes: number[];
};

/**
 * Assemble la vue d'un actif : sa carte consolidée, son poids, sa variation.
 *
 * Les séries viennent d'ailleurs (cache de clôtures) et peuvent manquer : un
 * coin sans historique garde sa ligne, sans variation ni courbe. Le faire
 * disparaître du tableau serait pire — il est bien détenu.
 */
export function buildAssetRows(
  cards: CoinCard[],
  seriesBySymbol: Record<string, AssetSeries | undefined>
): AssetRow[] {
  return cards.map((card) => {
    const series = seriesBySymbol[card.symbol];
    const change24hPct = series?.change24hPct ?? null;
    return {
      card,
      concentration: concentrationOf(card.allocationPct),
      change24hPct,
      change24hEur:
        change24hPct != null
          ? card.marketValueEur -
            card.marketValueEur / (1 + change24hPct / 100)
          : null,
      spark: series?.closes ?? [],
    };
  });
}

/**
 * Variation 24 h de la poche entière, à quantités constantes.
 *
 * Ne comptent que les coins dont la veille est cotée : les autres sont absents
 * des deux termes du rapport, plutôt que d'y entrer avec une variation nulle
 * qui écraserait le pourcentage vers zéro. La couverture est rendue avec le
 * résultat pour que l'écran puisse nuancer.
 */
export function computeSpotChange24h(rows: AssetRow[]): {
  pct: number | null;
  coveragePct: number;
} {
  let covered = 0;
  let previous = 0;
  let total = 0;

  for (const r of rows) {
    total += r.card.marketValueEur;
    if (r.change24hPct == null) continue;
    covered += r.card.marketValueEur;
    previous += r.card.marketValueEur / (1 + r.change24hPct / 100);
  }

  const coveragePct = total > 0 ? (covered / total) * 100 : 0;
  if (previous <= 0 || coveragePct < 50) return { pct: null, coveragePct };
  return { pct: ((covered - previous) / previous) * 100, coveragePct };
}

/**
 * Meilleure et moins bonne variation 24 h de la poche.
 *
 * Seules les lignes cotées la veille concourent : un actif sans variation n'est
 * ni le meilleur ni le pire, il est simplement hors classement. À égalité, la
 * ligne la plus lourde l'emporte — c'est celle qui explique le mouvement de la
 * poche. `null` quand aucune ligne n'est cotée.
 */
export function bestWorst24h(rows: AssetRow[]): {
  best: AssetRow | null;
  worst: AssetRow | null;
} {
  const rated = rows.filter((r) => r.change24hPct != null);
  if (rated.length === 0) return { best: null, worst: null };

  let best = rated[0]!;
  let worst = rated[0]!;
  for (const r of rated) {
    const p = r.change24hPct!;
    if (
      p > best.change24hPct! ||
      (p === best.change24hPct! && r.card.marketValueEur > best.card.marketValueEur)
    ) {
      best = r;
    }
    if (
      p < worst.change24hPct! ||
      (p === worst.change24hPct! && r.card.marketValueEur > worst.card.marketValueEur)
    ) {
      worst = r;
    }
  }
  return { best, worst };
}

/* ── Stablecoins ──────────────────────────────────────────────────── */

/**
 * Stablecoins usuels.
 *
 * La liste est explicite plutôt que déduite d'un nom : « USDC » et « USDT »
 * sont des stablecoins, « USDD » aussi, mais « SUSHI » ne l'est pas malgré ses
 * lettres communes. Se tromper ici ferait passer pour de la trésorerie une
 * position exposée.
 */
export const STABLECOIN_SYMBOLS = new Set([
  "USDT", "USDC", "DAI", "BUSD", "TUSD", "USDP", "FDUSD", "PYUSD",
  "EURC", "EURT", "EURS", "USDD", "GUSD", "LUSD", "FRAX", "USDE",
]);

export function isStablecoin(symbol: string): boolean {
  return STABLECOIN_SYMBOLS.has(symbol.trim().toUpperCase());
}

export type StableSplit = {
  stableEur: number;
  volatileEur: number;
  /** Part de stablecoins dans la poche, `null` si la poche est vide. */
  stablePct: number | null;
};

/**
 * Partage entre stablecoins et actifs volatils.
 *
 * C'est la seule « répartition fiat » que le journal permette : les euros
 * laissés sur un exchange sont du cash, comptés ailleurs dans l'application,
 * et les additionner ici les compterait deux fois.
 */
export function computeStableSplit(cards: CoinCard[]): StableSplit {
  let stableEur = 0;
  let volatileEur = 0;

  for (const c of cards) {
    if (isStablecoin(c.symbol)) stableEur += c.marketValueEur;
    else volatileEur += c.marketValueEur;
  }

  const total = stableEur + volatileEur;
  return {
    stableEur,
    volatileEur,
    stablePct: total > 0 ? (stableEur / total) * 100 : null,
  };
}

/* ── Bascule cartes / tableau ─────────────────────────────────────── */

/**
 * Nombre d'actifs au-delà duquel le tableau l'emporte.
 *
 * En dessous, les cartes donnent à voir chaque position — logo, poids, courbe —
 * ce qu'un investisseur particulier lit mieux qu'une grille. Au-delà, les
 * cartes deviennent un mur et le tableau reprend l'avantage : il compare, il
 * trie, il aligne les nombres.
 */
export const CARDS_THRESHOLD = 12;

export function defaultAssetView(assetCount: number): "cards" | "table" {
  return assetCount < CARDS_THRESHOLD ? "cards" : "table";
}
