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

/**
 * Périmètre tracé par la courbe.
 *
 * `gross` — valeur brute des actifs, le défaut : c'est ce que « portefeuille »
 * désigne, et ce qui se compare à un indice.
 * `net` — patrimoine net, actifs moins passifs.
 *
 * Les deux ne doivent jamais se mélanger dans une même courbe : leur écart est
 * l'encours des dettes, pas un mouvement de marché.
 */
export type EvolutionScope = "gross" | "net";

/**
 * Classe d'actif tracée, ou `null` pour le patrimoine entier.
 *
 * Séparée de `EvolutionScope` à dessein : « brut ou net » et « quelle classe »
 * sont deux questions indépendantes. On peut vouloir la crypto en valeur brute
 * comme le patrimoine entier en net, et les fondre en une seule liste aurait
 * produit douze choix dont la moitié n'a pas de sens — une classe d'actif n'a
 * pas de version « nette », les dettes n'appartenant à aucune classe.
 */
export type EvolutionAssetClass =
  | "ACTIONS"
  | "OBLIGATIONS"
  | "CRYPTO"
  | "IMMOBILIER"
  | "CASH"
  | "AUTRE";

export type EvolutionPrefsV5 = {
  v: 5;
  range: EvolutionRange;
  /** Comparaison affichée : Aucun (valeur €) / Inflation / Indice (% rebasé à 0). */
  versus: EvolutionBenchmark;
  /** Indice choisi quand versus = "index". */
  indexKey: MarketIndexKey;
  /** Périmètre tracé : actifs bruts (défaut) ou patrimoine net. */
  scope: EvolutionScope;
  /**
   * Classe d'actif isolée, ou `null` pour tout le patrimoine.
   *
   * Arrivée après v5, comme `scope` : une préférence enregistrée avant ne la
   * porte pas, et retombe donc sur `null` — le comportement d'avant.
   */
  assetClass?: EvolutionAssetClass | null;
};

export const DEFAULT_EVOLUTION_PREFS: EvolutionPrefsV5 = {
  v: 5,
  range: "3m",
  versus: "none",
  indexKey: "cac40",
  scope: "gross",
  assetClass: null,
};

const RANGES = new Set<string>(EVOLUTION_RANGES);
const VERSUS = new Set(["none", "inflation", "index"]);
const SCOPES = new Set(["gross", "net"]);
const CLASSES = new Set([
  "ACTIONS",
  "OBLIGATIONS",
  "CRYPTO",
  "IMMOBILIER",
  "CASH",
  "AUTRE",
]);

function isEvolutionPrefsV5(raw: unknown): raw is EvolutionPrefsV5 {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.v !== 5) return false;
  if (typeof o.range !== "string" || !RANGES.has(o.range)) return false;
  if (typeof o.versus !== "string" || !VERSUS.has(o.versus)) return false;
  if (!isMarketIndexKey(o.indexKey)) return false;
  // `scope` est arrivé après v5 : une préférence enregistrée avant reste
  // valide et retombe sur le périmètre brut plutôt que d'être effacée.
  if (o.scope !== undefined && (typeof o.scope !== "string" || !SCOPES.has(o.scope))) {
    return false;
  }
  /*
    `assetClass` est arrivée encore après. `null` est une valeur porteuse de
    sens — « tout le patrimoine » — et doit donc être acceptée au même titre
    qu'une classe, alors qu'`undefined` signale une préférence antérieure.
  */
  if (
    o.assetClass !== undefined &&
    o.assetClass !== null &&
    (typeof o.assetClass !== "string" || !CLASSES.has(o.assetClass))
  ) {
    return false;
  }
  return true;
}

/**
 * Charge les prefs ; fallback propre si absentes ou de schéma obsolète (v3/v4).
 * Premier chargement : hérite du benchmark par défaut défini dans Préférences,
 * exactement comme le faisait le mode "default" de l'ancien schéma.
 */
export function loadEvolutionPrefs(): EvolutionPrefsV5 {
  const raw = loadUiPref<unknown>(EVOLUTION_PREFS_KEY, null);
  if (isEvolutionPrefsV5(raw)) {
    return { ...raw, scope: raw.scope ?? "gross", assetClass: raw.assetClass ?? null };
  }
  return { ...DEFAULT_EVOLUTION_PREFS, versus: loadDefaultBenchmark() };
}

export function saveEvolutionPrefs(prefs: EvolutionPrefsV5): void {
  const payload: EvolutionPrefsV5 = {
    v: 5,
    range: prefs.range,
    versus: VERSUS.has(prefs.versus) ? prefs.versus : "none",
    indexKey: isMarketIndexKey(prefs.indexKey) ? prefs.indexKey : "cac40",
    scope: SCOPES.has(prefs.scope) ? prefs.scope : "gross",
    assetClass:
      prefs.assetClass != null && CLASSES.has(prefs.assetClass)
        ? prefs.assetClass
        : null,
  };
  saveUiPref(EVOLUTION_PREFS_KEY, payload);
}
