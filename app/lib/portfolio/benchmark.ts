/**
 * Séries de benchmark pour la courbe de performance personnelle.
 *
 * - none     : pas de courbe
 * - cash0    : 0 € constant (ligne déjà présente via ReferenceLine)
 * - price    : même cash investi, performance « cours seul »
 *              cashInvested × (close(t)/close0 − 1)
 * - index    : même cash investi × performance d'un indice (closes fournis)
 */

import type { TotalReturnPoint } from "./total-return";

export type BenchmarkMode = "none" | "cash0" | "price" | "index";

export type BenchmarkPoint = {
  date: string;
  label: string;
  /** Valeur € du benchmark (même échelle que totalPnlEur) */
  benchmarkEur: number;
};

export type IndexClosePoint = {
  date: string;
  close: number;
};

export const BENCHMARK_MODES: {
  id: BenchmarkMode;
  label: string;
  title: string;
}[] = [
  {
    id: "none",
    label: "Aucun",
    title: "Pas de courbe de comparaison",
  },
  {
    id: "cash0",
    label: "Cash 0 %",
    title: "Référence plate à 0 € (point mort)",
  },
  {
    id: "price",
    label: "Cours seul",
    title:
      "Même capital investi, performance pure du cours (sans frais/renforts/div)",
  },
  {
    id: "index",
    label: "CAC 40",
    title:
      "Même capital investi, performance de l'indice CAC 40 (Yahoo ^FCHI)",
  },
];

function firstInvested(series: TotalReturnPoint[]): {
  baseClose: number;
  baseCash: number;
  startIdx: number;
} {
  for (let i = 0; i < series.length; i++) {
    const p = series[i]!;
    if (p.qty > 0 && p.close > 0) {
      return {
        baseClose: p.close,
        baseCash: p.cashInvestedNet > 0 ? p.cashInvestedNet : p.costBasisEur,
        startIdx: i,
      };
    }
  }
  return { baseClose: 0, baseCash: 0, startIdx: 0 };
}

/**
 * Construit la série benchmark alignée sur les points de perf (déjà clip first-buy).
 * Pour `index`, passer `indexCloses` (série brute d'indice).
 */
export function buildBenchmarkSeries(
  series: TotalReturnPoint[],
  mode: BenchmarkMode,
  indexCloses?: IndexClosePoint[]
): BenchmarkPoint[] {
  if (mode === "none" || series.length === 0) return [];

  if (mode === "cash0") {
    return series.map((p) => ({
      date: p.date,
      label: p.label,
      benchmarkEur: 0,
    }));
  }

  const { baseClose, baseCash, startIdx } = firstInvested(series);
  if (baseClose <= 0 || baseCash <= 0) {
    return series.map((p) => ({
      date: p.date,
      label: p.label,
      benchmarkEur: 0,
    }));
  }

  if (mode === "price") {
    return series.map((p) => {
      const close = p.close > 0 ? p.close : baseClose;
      return {
        date: p.date,
        label: p.label,
        benchmarkEur: baseCash * (close / baseClose - 1),
      };
    });
  }

  // index
  if (!indexCloses || indexCloses.length === 0) {
    return series.map((p) => ({
      date: p.date,
      label: p.label,
      benchmarkEur: 0,
    }));
  }

  const sortedIdx = [...indexCloses].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const pickIndexClose = (barDate: string): number | null => {
    const t = new Date(barDate).getTime();
    if (!Number.isFinite(t)) return null;
    // dernière clôture indice ≤ barre
    let best: number | null = null;
    for (const c of sortedIdx) {
      const ct = new Date(c.date).getTime();
      if (ct <= t + 36e5) best = c.close; // +1h tolérance timezone
      else break;
    }
    return best != null && best > 0 ? best : null;
  };

  const startDate = series[startIdx]!.date;
  const baseIdx = pickIndexClose(startDate);
  if (baseIdx == null || baseIdx <= 0) {
    return series.map((p) => ({
      date: p.date,
      label: p.label,
      benchmarkEur: 0,
    }));
  }

  return series.map((p, i) => {
    if (i < startIdx) {
      return { date: p.date, label: p.label, benchmarkEur: 0 };
    }
    const ic = pickIndexClose(p.date) ?? baseIdx;
    return {
      date: p.date,
      label: p.label,
      benchmarkEur: baseCash * (ic / baseIdx - 1),
    };
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
