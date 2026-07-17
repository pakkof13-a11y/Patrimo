/**
 * Benchmark de référence par défaut (préférences utilisateur).
 * Indépendant du module Évolution : le dashboard peut surcharger ponctuellement.
 */

import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";

export const DEFAULT_BENCHMARK_KEY = "defaultBenchmark.v1";

export type DefaultBenchmark = "none" | "cash" | "inflation" | "index";

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
    id: "cash",
    label: "Cash",
    hint: "Référence liquidités (capital constant)",
  },
  {
    id: "inflation",
    label: "Inflation ~2 %",
    hint: "Pouvoir d’achat (indicatif)",
  },
  {
    id: "index",
    label: "Indice ~7 %",
    hint: "Proxy actions (indicatif)",
  },
];

const VALID = new Set<string>(["none", "cash", "inflation", "index"]);

export function loadDefaultBenchmark(): DefaultBenchmark {
  const raw = loadUiPref<unknown>(DEFAULT_BENCHMARK_KEY, "none");
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
