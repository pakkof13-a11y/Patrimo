/**
 * Séries de benchmark pour la courbe de performance personnelle.
 *
 * Modes de base :
 * - none  : pas de courbe
 * - cash0 : 0 € constant (point mort, déjà tracé via ReferenceLine)
 * - price : « cours seul » de l'actif, apports rejoués en DCA
 * - index : même logique DCA contre un indice de marché réel (closes fournis)
 *
 * ## Base de calcul — correctif DCA (renforts progressifs)
 * L'ancienne implémentation figeait la base sur le `cashInvestedNet` du **premier**
 * point investi : tout renfort ultérieur était ignoré → base sous-estimée, courbe
 * de comparaison faussée. On rejoue désormais **chaque apport net comme un achat
 * d'« unités »** au cours du jour :
 *
 *   unités(t)       = Σ_{τ ≤ t} ΔinvestiNet(τ) / cours(τ)
 *   benchmarkEur(t) = unités(t) × cours(t) − investiNet(t)
 *
 * Formule qui **généralise exactement** l'ancien calcul mono-apport
 * (`base × (close/close0 − 1)`) tout en restant correcte sous DCA et ventes.
 */

import type { TotalReturnPoint } from "./total-return";
import { MARKET_INDICES, type MarketIndex } from "./market-indices";

/** Nature du benchmark. */
export type BenchmarkKind = "none" | "cash0" | "price" | "index";

/**
 * @deprecated Littéral historique. Toujours accepté en entrée de
 * `buildBenchmarkSeries`, mais préférer `BenchmarkConfig` pour le multi-indice.
 */
export type BenchmarkMode = BenchmarkKind;

export type BenchmarkPoint = {
  date: string;
  label: string;
  /** Valeur € du benchmark (même échelle que totalPnlEur). */
  benchmarkEur: number;
};

export type IndexClosePoint = {
  date: string;
  close: number;
};

/**
 * Configuration riche : supporte dynamiquement N indices (symbole + clôtures).
 * Les littéraux `"none" | "cash0" | "price" | "index"` restent acceptés en
 * entrée de `buildBenchmarkSeries` pour rétrocompatibilité.
 */
export type BenchmarkConfig =
  | { kind: "none" }
  | { kind: "cash0" }
  | { kind: "price" }
  | {
      kind: "index";
      /** Symbole fournisseur (ex. "^GSPC", "URTH"). */
      symbol: string;
      /** Libellé UI (ex. "S&P 500"). */
      label: string;
      /** Clôtures de l'indice (ordre libre, trié en interne). */
      closes: IndexClosePoint[];
    };

/** Entrée acceptée : config riche OU littéral historique. */
export type BenchmarkInput = BenchmarkConfig | BenchmarkMode;

/**
 * @deprecated Liste historique (4 modes) — conservée pour les sélecteurs
 * existants. Utiliser `listBenchmarkOptions()` pour le catalogue multi-indice.
 */
export const BENCHMARK_MODES: {
  id: BenchmarkMode;
  label: string;
  title: string;
}[] = [
  { id: "none", label: "Aucun", title: "Pas de courbe de comparaison" },
  {
    id: "cash0",
    label: "Cash 0 %",
    title: "Référence plate à 0 € (point mort)",
  },
  {
    id: "price",
    label: "Cours seul",
    title:
      "Même capital investi, performance pure du cours (apports rejoués, sans frais ni dividendes)",
  },
  {
    id: "index",
    label: "CAC 40",
    title: "Même capital investi, performance de l'indice CAC 40 (Yahoo ^FCHI)",
  },
];

/** Option de benchmark pour un sélecteur UI (base + un item par indice). */
export type BenchmarkOption = {
  /** Id stable : "none" | "cash0" | "price" ou la clé d'indice (ex. "sp500"). */
  id: string;
  kind: BenchmarkKind;
  label: string;
  title: string;
  /** Présent si kind === "index". */
  index?: MarketIndex;
};

/**
 * Catalogue dynamique : 3 modes de base + un item par indice du registre partagé
 * (`market-indices`). Ajouter un indice au registre l'expose automatiquement ici.
 */
export function listBenchmarkOptions(): BenchmarkOption[] {
  const base: BenchmarkOption[] = [
    {
      id: "none",
      kind: "none",
      label: "Aucun",
      title: "Pas de courbe de comparaison",
    },
    {
      id: "cash0",
      kind: "cash0",
      label: "Cash 0 %",
      title: "Référence plate à 0 € (point mort)",
    },
    {
      id: "price",
      kind: "price",
      label: "Cours seul",
      title:
        "Performance pure du cours (apports rejoués, sans frais ni dividendes)",
    },
  ];
  const indices: BenchmarkOption[] = MARKET_INDICES.map((idx) => ({
    id: idx.key,
    kind: "index" as const,
    label: idx.label,
    title: `Même capital investi, performance de l'indice ${idx.label} (${idx.hint})`,
    index: idx,
  }));
  return [...base, ...indices];
}

/** Construit une `BenchmarkConfig` d'indice depuis un item du catalogue + closes. */
export function benchmarkConfigForIndex(
  index: MarketIndex,
  closes: IndexClosePoint[]
): BenchmarkConfig {
  return { kind: "index", symbol: index.yahoo, label: index.label, closes };
}

/** Normalise un littéral historique en `BenchmarkConfig`. */
export function normalizeBenchmarkConfig(
  input: BenchmarkInput,
  indexCloses?: IndexClosePoint[]
): BenchmarkConfig {
  if (typeof input !== "string") return input;
  switch (input) {
    case "none":
      return { kind: "none" };
    case "cash0":
      return { kind: "cash0" };
    case "price":
      return { kind: "price" };
    case "index":
      return {
        kind: "index",
        symbol: "^FCHI",
        label: "CAC 40",
        closes: indexCloses ?? [],
      };
  }
}

/** Dernière clôture d'indice ≤ barre (tolérance +1h pour les décalages TZ). */
function pickIndexClose(
  sorted: IndexClosePoint[],
  barDate: string
): number | null {
  const t = new Date(barDate).getTime();
  if (!Number.isFinite(t)) return null;
  let best: number | null = null;
  for (const c of sorted) {
    const ct = new Date(c.date).getTime();
    if (ct <= t + 36e5) best = c.close;
    else break;
  }
  return best != null && best > 0 ? best : null;
}

/**
 * Construit la série benchmark alignée sur les points de perf (déjà clip first-buy).
 *
 * Accepte une `BenchmarkConfig` riche ou un littéral historique
 * (`"none" | "cash0" | "price" | "index"`). Pour le littéral `"index"`, passer
 * les clôtures via `indexCloses` (3ᵉ argument, rétrocompatible).
 */
export function buildBenchmarkSeries(
  series: TotalReturnPoint[],
  config: BenchmarkInput,
  indexCloses?: IndexClosePoint[]
): BenchmarkPoint[] {
  const cfg = normalizeBenchmarkConfig(config, indexCloses);
  if (series.length === 0 || cfg.kind === "none") return [];

  const flat = (): BenchmarkPoint[] =>
    series.map((p) => ({ date: p.date, label: p.label, benchmarkEur: 0 }));

  if (cfg.kind === "cash0") return flat();

  // Cours du benchmark par barre : cours de l'actif (price) ou clôture d'indice.
  let priceAt: (p: TotalReturnPoint) => number | null;
  if (cfg.kind === "price") {
    priceAt = (p) => (p.close > 0 ? p.close : null);
  } else {
    if (cfg.closes.length === 0) return flat();
    const sorted = [...cfg.closes].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    priceAt = (p) => pickIndexClose(sorted, p.date);
  }

  // Rejoue chaque apport net comme un achat d'unités au cours du jour (DCA).
  let units = 0;
  let prevInvested = 0;
  let lastPrice: number | null = null;

  return series.map((p) => {
    const invested = p.cashInvestedNet > 0 ? p.cashInvestedNet : 0;
    const price = priceAt(p) ?? lastPrice;
    if (price != null && price > 0) {
      const delta = invested - prevInvested;
      if (Math.abs(delta) > 1e-9) units += delta / price;
      // N'avance la base d'apport que si un cours permet d'acheter des unités,
      // pour ne pas « perdre » un apport tombé sur une barre sans cours d'indice.
      prevInvested = invested;
      lastPrice = price;
    }
    const benchmarkEur =
      lastPrice != null && lastPrice > 0 ? units * lastPrice - invested : 0;
    return { date: p.date, label: p.label, benchmarkEur };
  });
}

/** Fusionne benchmark dans les points agrégés pour Recharts (même index). */
export function mergeBenchmarkIntoAggregated<
  T extends { date: string; label: string }
>(
  points: T[],
  benchmark: BenchmarkPoint[]
): Array<T & { benchmarkEur: number }> {
  if (benchmark.length === 0) {
    return points.map((p) => ({ ...p, benchmarkEur: 0 }));
  }
  // Index par date exacte puis par label
  const byDate = new Map(benchmark.map((b) => [b.date, b.benchmarkEur]));
  const byLabel = new Map(benchmark.map((b) => [b.label, b.benchmarkEur]));
  return points.map((p) => ({
    ...p,
    benchmarkEur: byDate.get(p.date) ?? byLabel.get(p.label) ?? 0,
  }));
}
