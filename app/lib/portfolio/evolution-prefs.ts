/**
 * Préférences UI du module Évolution — localStorage versionné.
 * Reset silencieux si schéma obsolète ou corrompu.
 */

import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";
import {
  EVOLUTION_RANGES,
  type EvolutionChartStyle,
  type EvolutionMetric,
  type EvolutionRange,
  type EvolutionViewMode,
} from "@/app/lib/portfolio/evolution-aggregate";

/** Clé versionnée — incrémenter si le schéma change de façon incompatible. */
export const EVOLUTION_PREFS_KEY = "evolutionPrefs.v4";

export type EvolutionBenchmark = "none" | "cash" | "inflation" | "index";

/**
 * `default` = hériter du benchmark préférences utilisateur.
 * Toute autre valeur = override ponctuel dashboard.
 */
export type EvolutionBenchmarkChoice = EvolutionBenchmark | "default";

export type EvolutionPrefsV4 = {
  v: 4;
  range: EvolutionRange;
  metric: EvolutionMetric;
  style: EvolutionChartStyle;
  view: EvolutionViewMode;
  /** Override dashboard ou "default" → préférences utilisateur */
  benchmark: EvolutionBenchmarkChoice;
  /** Zone Style / Vue / Vs dépliée */
  advancedOpen: boolean;
};

/** @deprecated alias pour imports existants */
export type EvolutionPrefsV3 = EvolutionPrefsV4;

export const DEFAULT_EVOLUTION_PREFS: EvolutionPrefsV4 = {
  v: 4,
  range: "3m",
  metric: "cumul",
  style: "line",
  view: "global",
  benchmark: "default",
  advancedOpen: false,
};

const RANGES = new Set<string>(EVOLUTION_RANGES);
const METRICS = new Set(["period", "cumul"]);
const STYLES = new Set(["line", "columns"]);
const VIEWS = new Set(["global", "decomposed"]);
const BENCHMARKS = new Set([
  "none",
  "cash",
  "inflation",
  "index",
  "default",
]);

function isEvolutionPrefsV4(raw: unknown): raw is EvolutionPrefsV4 {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.v !== 4 && o.v !== 3) return false;
  if (typeof o.range !== "string" || !RANGES.has(o.range)) return false;
  if (typeof o.metric !== "string" || !METRICS.has(o.metric)) return false;
  if (typeof o.style !== "string" || !STYLES.has(o.style)) return false;
  if (typeof o.view !== "string" || !VIEWS.has(o.view)) return false;
  if (typeof o.benchmark !== "string" || !BENCHMARKS.has(o.benchmark))
    return false;
  if (typeof o.advancedOpen !== "boolean") return false;
  return true;
}

/** Charge les prefs ; fallback propre + purge si schéma obsolète. */
export function loadEvolutionPrefs(): EvolutionPrefsV4 {
  const raw = loadUiPref<unknown>(EVOLUTION_PREFS_KEY, null);
  // Migration v3 → v4 (même clé legacy)
  const legacy = loadUiPref<unknown>("evolutionPrefs.v3", null);
  const candidate = raw ?? legacy;
  if (candidate == null) return { ...DEFAULT_EVOLUTION_PREFS };
  if (isEvolutionPrefsV4(candidate)) {
    return {
      ...candidate,
      v: 4,
      benchmark:
        candidate.benchmark === "default" ||
        candidate.benchmark === "none" ||
        candidate.benchmark === "cash" ||
        candidate.benchmark === "inflation" ||
        candidate.benchmark === "index"
          ? candidate.benchmark
          : "default",
    };
  }
  saveUiPref(EVOLUTION_PREFS_KEY, DEFAULT_EVOLUTION_PREFS);
  return { ...DEFAULT_EVOLUTION_PREFS };
}

export function saveEvolutionPrefs(prefs: EvolutionPrefsV4): void {
  const payload: EvolutionPrefsV4 = {
    v: 4,
    range: prefs.range,
    metric: prefs.metric,
    style: prefs.style,
    view: prefs.view,
    benchmark: prefs.benchmark,
    advancedOpen: prefs.advancedOpen,
  };
  if (!isEvolutionPrefsV4(payload)) {
    saveUiPref(EVOLUTION_PREFS_KEY, DEFAULT_EVOLUTION_PREFS);
    return;
  }
  saveUiPref(EVOLUTION_PREFS_KEY, payload);
}

export function patchEvolutionPrefs(
  patch: Partial<Omit<EvolutionPrefsV4, "v">>
): EvolutionPrefsV4 {
  const next: EvolutionPrefsV4 = {
    ...loadEvolutionPrefs(),
    ...patch,
    v: 4,
  };
  saveEvolutionPrefs(next);
  return next;
}
