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
 * Compte tracé, ou `null` pour le patrimoine entier.
 *
 * « Compte » — où l'argent est déposé — jamais « Catégorie » : `ACTIONS`
 * additionnait PEA + CTO + unités de compte d'assurance-vie, et ni PEA ni CTO
 * ne sont cette somme. Chaque entrée correspond à un scope `getDailyNav` (ou,
 * pour `TITRES`, au croisement classe × enveloppe) — jamais à `byAssetClass`,
 * qui agrège l'`assetClass` brute sans le compte et compterait l'assurance-vie
 * deux fois (mesuré : 256 126,86 € contre 138 148,74 € de vraie exposition
 * cotée hors crypto, l'écart étant exactement la poche assurance-vie).
 *
 * Pas de `TRADING` : les positions CFD vivent dans `TradingPosition`, un
 * modèle que le moteur historique ne charge jamais.
 */
export type EvolutionAccount =
  | "TITRES"
  | "ASSURANCE_VIE"
  | "CRYPTO"
  | "IMMOBILIER"
  | "ALTERNATIFS"
  | "EPARGNE_SALARIALE"
  | "CASH";

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
   * Compte isolé, ou `null` pour tout le patrimoine.
   *
   * D18 remplace le sélecteur de classe d'actif (`assetClass`) par un
   * sélecteur de compte. Le champ `assetClass` n'existe plus dans ce schéma :
   * une préférence `v5` enregistrée avant ce chantier ne porte pas `account`,
   * et `loadEvolutionPrefs` retombe alors sur `null` — « Tout », le
   * comportement le plus sûr. Son ancien contenu (`ACTIONS`, `AUTRE`…) n'est
   * jamais relu : la taxonomie a changé de nature, la reconstruire à partir de
   * valeurs qui ne correspondent plus à des comptes inventerait un choix.
   */
  account?: EvolutionAccount | null;
  /**
   * Ce que la courbe trace pour le compte choisi.
   *
   * `value` : l'encours, apports compris. `performance` : ce que le marché a
   * produit, une fois les mouvements de capitaux retirés — jamais l'un
   * présenté comme l'autre.
   *
   * Sans compte sélectionné, ce réglage n'a pas d'objet : le patrimoine
   * entier reste en valeur.
   */
  classMetric?: "value" | "performance";
  /**
   * Enveloppe fiscale, à l'intérieur du compte Titres.
   *
   * Subordonnée à `account === "TITRES"`, et non alternative : le compte
   * décrit **ce qui est déposé où**, l'enveloppe **quelle poche fiscale** —
   * et « mes titres en PEA » est une question légitime. La composition n'a de
   * sens que là où une enveloppe titres peut qualifier le compte ; ailleurs,
   * `normalizeEnvelopeFor` refuse la combinaison plutôt que de la stocker.
   */
  envelope?: "PEA" | "CTO" | null;
};

export const DEFAULT_EVOLUTION_PREFS: EvolutionPrefsV5 = {
  v: 5,
  range: "3m",
  versus: "none",
  indexKey: "cac40",
  scope: "gross",
  account: null,
  classMetric: "value",
  envelope: null,
};

const RANGES = new Set<string>(EVOLUTION_RANGES);
const VERSUS = new Set(["none", "index"]);
const SCOPES = new Set(["gross", "net"]);
const METRICS = new Set(["value", "performance"]);
const ENVELOPES = new Set(["PEA", "CTO"]);
const ACCOUNTS = new Set([
  "TITRES",
  "ASSURANCE_VIE",
  "CRYPTO",
  "IMMOBILIER",
  "ALTERNATIFS",
  "EPARGNE_SALARIALE",
  "CASH",
]);

/**
 * Les comptes pour lesquels l'écran propose un choix d'enveloppe.
 *
 * Titres seul : c'est le seul compte que le journal sait recouper avec PEA ou
 * CTO. Assurance-vie, crypto, immobilier, alternatifs, épargne salariale et
 * banques n'ont aucun rapport avec un compte-titres.
 */
const ACCOUNTS_AVEC_ENVELOPPE = new Set(["TITRES"]);

/**
 * Enveloppe compatible avec un compte — `null` dès qu'elle ne l'est pas.
 *
 * Un état invalide ne doit ni être stocké ni être restauré : une préférence
 * enregistrée quand le compte était Titres peut porter une enveloppe, et la
 * rejouer telle quelle après un changement de compte filtrerait un autre
 * compte sur une enveloppe qu'aucun contrôle n'affiche plus — une courbe vide
 * sans explication.
 *
 * On conserve le compte et on retombe sur « toutes enveloppes » : c'est le
 * choix le moins surprenant, le compte étant le filtre principal.
 */
export function normalizeEnvelopeFor(
  account: EvolutionAccount | null | undefined,
  envelope: "PEA" | "CTO" | null | undefined
): "PEA" | "CTO" | null {
  if (envelope == null || !ENVELOPES.has(envelope)) return null;
  if (account == null || !ACCOUNTS_AVEC_ENVELOPPE.has(account)) return null;
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
    `account` (D18) est arrivé après `assetClass`, lui-même arrivé après v5.
    `null` est une valeur porteuse de sens — « tout le patrimoine » — et doit
    donc être acceptée au même titre qu'un compte, alors qu'`undefined` signale
    une préférence antérieure à ce champ (D17 ou avant, ou D18 elle-même avant
    ce chantier). L'ancien `assetClass` n'est plus lu ni validé : le rejeter
    ferait échouer une préférence par ailleurs valide sur un champ qu'on ne
    consulte plus ; on l'ignore silencieusement, comme n'importe quelle clé
    obsolète.
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
    o.account !== undefined &&
    o.account !== null &&
    (typeof o.account !== "string" || !ACCOUNTS.has(o.account))
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
    const account = raw.account ?? null;
    return {
      ...raw,
      scope: raw.scope ?? "gross",
      account,
      classMetric: raw.classMetric ?? "value",
      // Une combinaison devenue invalide est corrigée à la lecture, pas subie.
      envelope: normalizeEnvelopeFor(account, raw.envelope),
    };
  }
  return { ...DEFAULT_EVOLUTION_PREFS, versus: loadDefaultBenchmark() };
}

/**
 * Écrit la seule période, sans toucher au reste des préférences.
 *
 * La période est devenue commune au tableau de bord — la courbe d'évolution et
 * le bandeau d'indicateurs la partagent — et son état vit désormais au-dessus
 * du panneau qui l'affiche. Elle reste pourtant rangée là où elle l'a toujours
 * été : lui ouvrir une clé à part aurait fait deux périodes mémorisées pour un
 * seul réglage à l'écran, et la première divergence entre les deux serait
 * passée inaperçue.
 *
 * Lecture puis réécriture complète, plutôt qu'une écriture partielle : c'est
 * `saveEvolutionPrefs` qui reste seul juge de ce qu'un objet valide contient.
 */
export function saveEvolutionRange(range: EvolutionRange): void {
  saveEvolutionPrefs({ ...loadEvolutionPrefs(), range });
}

export function saveEvolutionPrefs(prefs: EvolutionPrefsV5): void {
  const payload: EvolutionPrefsV5 = {
    v: 5,
    range: prefs.range,
    versus: VERSUS.has(prefs.versus) ? prefs.versus : "none",
    indexKey: isMarketIndexKey(prefs.indexKey) ? prefs.indexKey : "cac40",
    scope: SCOPES.has(prefs.scope) ? prefs.scope : "gross",
    account:
      prefs.account != null && ACCOUNTS.has(prefs.account)
        ? prefs.account
        : null,
    classMetric: METRICS.has(prefs.classMetric ?? "") ? prefs.classMetric : "value",
    // Jamais écrite si elle ne s'accorde pas avec le compte : l'invalide ne
    // doit pas même atteindre le stockage.
    envelope: normalizeEnvelopeFor(prefs.account, prefs.envelope),
  };
  saveUiPref(EVOLUTION_PREFS_KEY, payload);
}
