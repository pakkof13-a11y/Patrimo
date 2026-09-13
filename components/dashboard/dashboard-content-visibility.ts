/**
 * Plancher de contenu du tableau de bord — extrait de `DashboardTab` pour
 * rester testable sans rendu React (pas de harnais DOM dans cette session).
 *
 * `dashboardBlocksFor("setup")` masque la carte de tête et le journal au même
 * titre que les blocs analytiques (KPI, répartition, actualité) : c'est
 * justifié pour ces derniers (rien à comparer ou à répartir sans données),
 * mais pas pour les deux premiers, qui savent déjà dire l'absence — « Pas
 * encore de courbe », « Aucune opération enregistrée » — sans jamais rien
 * inventer.
 *
 * `maturity` (et les `blocks` qui en découlent) ne reflètent que trois
 * compteurs locaux — plateformes, transactions, positions calculées
 * (`resolveDashboardMaturity`, `app/lib/dashboard/maturity.ts`). Le cockpit
 * (`EmptyPatrimonyCockpit`) décide lui de monter `DashboardTab` sur la foi de
 * l'état serveur réel (`getPatrimonyState`/`isEmpty`,
 * `app/lib/portfolio/patrimony-state.ts`), qui couvre bien plus de familles :
 * un passif, un contrat d'assurance-vie, un dépôt à terme, une cession de
 * métal précieux, un compte-titres ou un compte de trading suffisent à lever
 * `isEmpty` côté serveur sans faire bouger le moindre des trois compteurs
 * locaux.
 *
 * Concrètement : `DashboardTab` peut être monté (le serveur sait que le
 * compte n'est pas vierge) alors que `maturity` vaut ici « empty » (les trois
 * compteurs locaux, eux, sont à zéro) — CR-vide : un compte dont la seule
 * donnée est un prêt ou une assurance-vie. Traiter « empty » comme une preuve
 * de vacuité et masquer la carte de tête et le journal reproduirait
 * exactement le bug que le cockpit corrige déjà en amont : un écran
 * entièrement blanc sur un compte qui ne l'est pas. Ce fichier ne peut pas
 * consulter l'état serveur (il ne reçoit que `maturity`/`blocks`, calculés
 * localement) ; il traite donc « empty » comme « setup » — la carte de tête
 * et le journal restent affichés dans les deux cas, puisqu'aucun des deux ne
 * prouve un compte réellement vierge une fois que `DashboardTab` est monté.
 */

import type {
  DashboardBlockVisibility,
  DashboardMaturity,
} from "@/app/lib/dashboard/maturity";

export type DashboardContentVisibility = {
  /** Carte de tête (patrimoine net/brut, courbe ou « Pas encore de courbe »). */
  showHeroCard: boolean;
  /** Journal des dernières opérations, ou « Aucune opération enregistrée ». */
  showJournal: boolean;
};

export function resolveDashboardContentVisibility(
  maturity: DashboardMaturity,
  blocks: DashboardBlockVisibility
): DashboardContentVisibility {
  const showFloor =
    blocks.showEvolutionChart || maturity === "setup" || maturity === "empty";
  return { showHeroCard: showFloor, showJournal: showFloor };
}
