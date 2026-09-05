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
/**
 * La période écrite en toutes lettres, pour accompagner une variation.
 *
 * Un « −872 € » ne dit pas sur quoi il porte. Tant que la fenêtre n'était
 * lisible que dans un attribut `data-range`, deux tuiles voisines pouvaient
 * afficher une variation à sept jours et un cumul depuis l'origine sans que
 * rien ne les sépare — le P&L latent à +14 606 € contre des titres à −872 €,
 * deux chiffres justes qui se contredisaient en apparence.
 *
 * Le libellé décrit la **variation**, pas le montant qui la surmonte.
 */
export function evolutionRangePeriodLabel(range: EvolutionRange): string {
  switch (range) {
    case "7d":
      return "sur 7 jours";
    case "1m":
      return "sur 1 mois";
    case "3m":
      return "sur 3 mois";
    case "6m":
      return "sur 6 mois";
    case "ytd":
      return "depuis le 1er janvier";
    case "1y":
      return "sur 1 an";
    case "5y":
      return "sur 5 ans";
    case "all":
      return "depuis l'origine";
  }
}

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
