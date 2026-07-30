/**
 * Préférences UI du module Évolution — localStorage versionné.
 * Reset silencieux si schéma obsolète ou corrompu.
 *
 * v5 : écran simplifié à deux contrôles (période, comparaison). Les anciens
 * réglages metric / style / view (cumul vs période, courbe vs colonnes, vue
 * décomposée) ont disparu du produit — v4 les stockait, v5 ne les lit plus.
 */

import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";
import {
  EVOLUTION_RANGES,
  type EvolutionRange,
} from "@/app/lib/portfolio/evolution-aggregate";
import {
  isMarketIndexKey,
  type MarketIndexKey,
} from "@/app/lib/portfolio/market-indices";
import { loadDefaultBenchmark } from "@/app/lib/portfolio/benchmark-prefs";

export const EVOLUTION_PREFS_KEY = "evolutionPrefs.v5";

/** "cash" retiré (jugé inutile) — jamais réintroduit. */
export type EvolutionBenchmark = "none" | "inflation" | "index";

export type EvolutionPrefsV5 = {
  v: 5;
  range: EvolutionRange;
  /** Comparaison affichée : Aucun (valeur €) / Inflation / Indice (% rebasé à 0). */
  versus: EvolutionBenchmark;
  /** Indice choisi quand versus = "index". */
  indexKey: MarketIndexKey;
};

export const DEFAULT_EVOLUTION_PREFS: EvolutionPrefsV5 = {
  v: 5,
  range: "3m",
  versus: "none",
  indexKey: "cac40",
};

const RANGES = new Set<string>(EVOLUTION_RANGES);
const VERSUS = new Set(["none", "inflation", "index"]);

function isEvolutionPrefsV5(raw: unknown): raw is EvolutionPrefsV5 {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.v !== 5) return false;
  if (typeof o.range !== "string" || !RANGES.has(o.range)) return false;
  if (typeof o.versus !== "string" || !VERSUS.has(o.versus)) return false;
  if (!isMarketIndexKey(o.indexKey)) return false;
  return true;
}

/**
 * Charge les prefs ; fallback propre si absentes ou de schéma obsolète (v3/v4).
 * Premier chargement : hérite du benchmark par défaut défini dans Préférences,
 * exactement comme le faisait le mode "default" de l'ancien schéma.
 */
export function loadEvolutionPrefs(): EvolutionPrefsV5 {
  const raw = loadUiPref<unknown>(EVOLUTION_PREFS_KEY, null);
  if (isEvolutionPrefsV5(raw)) return raw;
  return { ...DEFAULT_EVOLUTION_PREFS, versus: loadDefaultBenchmark() };
}

export function saveEvolutionPrefs(prefs: EvolutionPrefsV5): void {
  const payload: EvolutionPrefsV5 = {
    v: 5,
    range: prefs.range,
    versus: VERSUS.has(prefs.versus) ? prefs.versus : "none",
    indexKey: isMarketIndexKey(prefs.indexKey) ? prefs.indexKey : "cac40",
  };
  saveUiPref(EVOLUTION_PREFS_KEY, payload);
}
