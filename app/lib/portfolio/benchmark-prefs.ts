/**
 * Benchmark de référence par défaut (préférences utilisateur).
 * Indépendant du module Évolution : le dashboard peut surcharger ponctuellement.
 */

import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";

export const DEFAULT_BENCHMARK_KEY = "defaultBenchmark.v1";

/** "cash" retiré (jugé inutile) — migré silencieusement vers "none". */
export type DefaultBenchmark = "none" | "inflation" | "index";

export const DEFAULT_BENCHMARK_OPTIONS: {
  id: DefaultBenchmark;
  label: string;
  hint: string;
}[] = [
  {
    id: "none",
    label: "Aucun",
    hint: "Pas de comparaison automatique",
  },
  {
    id: "inflation",
    label: "Inflation (IPC France)",
    hint: "Pouvoir d’achat — indice des prix INSEE",
  },
  {
    id: "index",
    label: "Indice",
    hint: "Comparaison à un indice de marché réel",
  },
];

const VALID = new Set<string>(["none", "inflation", "index"]);

export function loadDefaultBenchmark(): DefaultBenchmark {
  const raw = loadUiPref<unknown>(DEFAULT_BENCHMARK_KEY, "none");
  // Migration : ancien "cash" → "none"
  if (typeof raw === "string" && VALID.has(raw)) {
    return raw as DefaultBenchmark;
  }
  return "none";
}

export function saveDefaultBenchmark(value: DefaultBenchmark): void {
  if (!VALID.has(value)) {
    saveUiPref(DEFAULT_BENCHMARK_KEY, "none");
    return;
  }
  saveUiPref(DEFAULT_BENCHMARK_KEY, value);
}

export function defaultBenchmarkLabel(id: DefaultBenchmark): string {
  return (
    DEFAULT_BENCHMARK_OPTIONS.find((o) => o.id === id)?.label ?? "Aucun"
  );
}
