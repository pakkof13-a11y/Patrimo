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
export type EvolutionBenchmark = "none" | "index";

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
  /** Comparaison affichée : Aucun (valeur €) ou Indice (% rebasé à 0). */
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
  /**
   * Ce que la courbe trace pour la classe choisie.
   *
   * `value` : l'encours, apports compris. `performance` : ce que le marché a
   * produit, une fois les mouvements de capitaux retirés — jamais l'un
   * présenté comme l'autre.
   *
   * Sans classe sélectionnée, ce réglage n'a pas d'objet : le patrimoine
   * entier reste en valeur.
   */
  classMetric?: "value" | "performance";
  /**
   * Enveloppe fiscale, à l'intérieur de la classe choisie.
   *
   * Subordonnée à `assetClass`, et non alternative : une classe décrit **ce
   * que** l'on détient, une enveloppe **où** — et « mes actions en PEA » est
   * une question légitime. La composition n'a en revanche de sens que là où une
   * enveloppe titres peut qualifier la classe : « Crypto en PEA » n'en a aucun,
   * et `normalizeEnvelopeFor` refuse cette combinaison plutôt que de la stocker.
   */
  envelope?: "PEA" | "CTO" | null;
};

export const DEFAULT_EVOLUTION_PREFS: EvolutionPrefsV5 = {
  v: 5,
  range: "3m",
  versus: "none",
  indexKey: "cac40",
  scope: "gross",
  assetClass: null,
  classMetric: "value",
  envelope: null,
};

const RANGES = new Set<string>(EVOLUTION_RANGES);
const VERSUS = new Set(["none", "index"]);
const SCOPES = new Set(["gross", "net"]);
const METRICS = new Set(["value", "performance"]);
const ENVELOPES = new Set(["PEA", "CTO"]);
const CLASSES = new Set([
  "ACTIONS",
  "OBLIGATIONS",
  "CRYPTO",
  "IMMOBILIER",
  "CASH",
  "AUTRE",
]);

/**
 * Les classes pour lesquelles l'écran propose un choix d'enveloppe.
 *
 * Les actions seules. Les obligations sont bien des titres, mais le produit
 * n'en connaît qu'en compte-titres : leur proposer « PEA » offrirait un choix
 * dont la série serait vide par convention d'interface plutôt que par constat.
 * Elles reçoivent une indication, pas un contrôle.
 */
const CLASSES_AVEC_ENVELOPPE = new Set(["ACTIONS"]);

/**
 * Enveloppe compatible avec une classe — `null` dès qu'elle ne l'est pas.
 *
 * Un état invalide ne doit ni être stocké ni être restauré : une préférence
 * enregistrée quand le sélecteur était global peut porter « Crypto + PEA », et
 * la rejouer telle quelle filtrerait la crypto sur une enveloppe qu'aucun
 * contrôle n'affiche plus — une courbe vide sans explication.
 *
 * On conserve la classe et on retombe sur « toutes enveloppes » : c'est le
 * choix le moins surprenant, la classe étant le filtre principal.
 */
export function normalizeEnvelopeFor(
  assetClass: EvolutionAssetClass | null | undefined,
  envelope: "PEA" | "CTO" | null | undefined
): "PEA" | "CTO" | null {
  if (envelope == null || !ENVELOPES.has(envelope)) return null;
  if (assetClass == null || !CLASSES_AVEC_ENVELOPPE.has(assetClass)) return null;
  return envelope;
}

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
    o.envelope !== undefined &&
    o.envelope !== null &&
    (typeof o.envelope !== "string" || !ENVELOPES.has(o.envelope))
  ) {
    return false;
  }
  if (
    o.classMetric !== undefined &&
    (typeof o.classMetric !== "string" || !METRICS.has(o.classMetric))
  ) {
    return false;
  }
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
    const assetClass = raw.assetClass ?? null;
    return {
      ...raw,
      scope: raw.scope ?? "gross",
      assetClass,
      classMetric: raw.classMetric ?? "value",
      // Une combinaison devenue invalide est corrigée à la lecture, pas subie.
      envelope: normalizeEnvelopeFor(assetClass, raw.envelope),
    };
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
    classMetric: METRICS.has(prefs.classMetric ?? "") ? prefs.classMetric : "value",
    // Jamais écrite si elle ne s'accorde pas avec la classe : l'invalide ne
    // doit pas même atteindre le stockage.
    envelope: normalizeEnvelopeFor(prefs.assetClass, prefs.envelope),
  };
  saveUiPref(EVOLUTION_PREFS_KEY, payload);
}
