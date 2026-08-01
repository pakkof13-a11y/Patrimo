/**
 * Modes d'affichage du portefeuille — synthèse / analyse / expert.
 *
 * Le sélecteur de colonnes reste disponible pour les réglages fins, mais il
 * demande de connaître les vingt-cinq colonnes du tableau une par une. Ces
 * trois modes répondent à la question réelle — « à quel niveau de détail
 * est-ce que je regarde mon portefeuille en ce moment ? » — d'un seul clic.
 *
 * Un mode ne masque jamais une donnée : il choisit ce qui est montré par
 * défaut. Toute colonne reste atteignable via « Colonnes ».
 *
 * Aucune persistance propre : la visibilité des colonnes est déjà sauvegardée
 * par le tableau, et `modeForVisibility` en redéduit le mode. Stocker le mode
 * en parallèle créerait deux sources de vérité qui divergent dès le premier
 * réglage manuel — le sélecteur afficherait « Vue synthèse » au-dessus de
 * colonnes qui n'en sont plus.
 */

import { HOLDINGS_COLUMN_META } from "@/app/lib/display-preferences";

export type HoldingsViewMode = "summary" | "analysis" | "expert";

export const HOLDINGS_VIEW_MODES: {
  id: HoldingsViewMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "summary",
    label: "Synthèse",
    hint: "L'essentiel : ce que je détiens, ce que ça vaut, ce que ça a rapporté",
  },
  {
    id: "analysis",
    label: "Analyse",
    hint: "Ajoute le capital investi, la devise et le poids dans sa classe",
  },
  {
    id: "expert",
    label: "Expert",
    hint: "Toutes les mesures : classe, chaîne, frais, revenus, seuil de rentabilité",
  },
];

/**
 * Colonnes verrouillées par le tableau : visibles dans les trois modes.
 * Les lire depuis la méta plutôt que les recopier évite qu'un mode prétende
 * masquer une colonne que le sélecteur de colonnes refuse de décocher.
 */
const ALWAYS_VISIBLE = HOLDINGS_COLUMN_META.filter(
  (c) => c.group === "mandatory" || c.locked
).map((c) => c.id);

/** Synthèse = les colonnes du mockup : ticker, PRU, poids. */
const SUMMARY_EXTRA = ["ticker", "avgCostEur", "allocationPct"] as const;

/**
 * Analyse = synthèse + combien la ligne a coûté, où elle est gardée, et ce
 * qu'elle pèse dans sa classe.
 *
 * Le dépositaire entre ici et non en synthèse : savoir qu'une position vaut
 * 8 000 € et qu'elle a gagné 20 % se lit sans savoir chez qui elle dort. La
 * question de la garde vient ensuite — et le panneau de détail y répond aussi.
 */
const ANALYSIS_EXTRA = [
  "costBasisEur",
  "currency",
  "platformName",
  "allocationPctOfClass",
] as const;

/**
 * Colonnes que le mode expert ajoute encore. Les seuils (`stopLoss`, `tp1`…)
 * en sont volontairement absents : ce sont des champs de saisie, pas des
 * mesures, et les afficher par défaut transforme le tableau en formulaire.
 */
const EXPERT_EXTRA = [
  "assetClass",
  "blockchain",
  "acquisitionFeesBase",
  "passiveIncomeBase",
  "breakEvenBase",
  "lastUpdatedAt",
] as const;

function visibleIdsForMode(mode: HoldingsViewMode): Set<string> {
  const visible = new Set<string>(ALWAYS_VISIBLE);
  for (const id of SUMMARY_EXTRA) visible.add(id);
  if (mode === "analysis" || mode === "expert") {
    for (const id of ANALYSIS_EXTRA) visible.add(id);
  }
  if (mode === "expert") {
    for (const id of EXPERT_EXTRA) visible.add(id);
  }
  return visible;
}

/**
 * Construit l'état de visibilité pour un mode donné.
 *
 * `allColumnIds` vient du tableau lui-même : passer par lui plutôt que par une
 * liste écrite ici évite qu'une colonne ajoutée demain reste invisible dans
 * les trois modes sans que personne ne s'en aperçoive.
 */
export function visibilityForMode(
  mode: HoldingsViewMode,
  allColumnIds: string[]
): Record<string, boolean> {
  const visible = visibleIdsForMode(mode);
  const out: Record<string, boolean> = {};
  for (const id of allColumnIds) {
    out[id] = visible.has(id);
  }
  return out;
}

/**
 * Mode correspondant à une visibilité donnée, ou `null` si l'utilisateur a
 * composé ses colonnes à la main. Ce `null` est le comportement souhaité :
 * mieux vaut aucun onglet actif qu'un onglet qui décrit autre chose que ce
 * que le tableau affiche.
 */
export function modeForVisibility(
  visibility: Record<string, boolean>,
  allColumnIds: string[]
): HoldingsViewMode | null {
  for (const { id: mode } of HOLDINGS_VIEW_MODES) {
    const want = visibleIdsForMode(mode);
    const matches = allColumnIds.every(
      (id) => Boolean(visibility[id]) === want.has(id)
    );
    if (matches) return mode;
  }
  return null;
}
