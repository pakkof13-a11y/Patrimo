import type { EvolutionRange } from "@/app/lib/portfolio/evolution-aggregate";

/**
 * Les huit périodes du tableau de bord, libellées une seule fois.
 *
 * Deux blocs les affichent — la carte de tête et le panneau « Évolution » — et
 * ils changent la **même** fenêtre : un unique `range` vit dans
 * `dashboard-tab.tsx`, retenu sous `evolutionPrefs.v5`. Deux listes séparées
 * auraient fini par diverger, et l'écran aurait proposé en haut des périodes
 * que le bas ne savait pas ouvrir — c'est exactement ce qui s'était produit
 * quand la carte portait ses six périodes à elle, sans 7J ni 6M.
 *
 * La constante vit ici, et non dans l'un des deux composants, parce qu'aucun
 * des deux n'en est propriétaire. La faire descendre du panneau obligeait la
 * carte de tête à importer tout le graphe du panneau — Recharts inclus — pour
 * huit libellés.
 */
export const EVOLUTION_RANGE_CHIPS: { id: EvolutionRange; label: string }[] = [
  { id: "7d", label: "7J" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1A" },
  { id: "5y", label: "5A" },
  { id: "all", label: "Tout" },
];
