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
 * Le cockpit (`EmptyPatrimonyCockpit`) intercepte le compte réellement vierge
 * en amont, dans `portfolio-app.tsx` : si `DashboardTab` est monté, une
 * plateforme, une transaction ou une position existe déjà. Masquer aussi la
 * carte de tête et le journal en maturité « setup » — le cas d'un compte qui
 * vient de créer sa première plateforme, sans encore de transaction — ne
 * laissait donc plus rien à l'écran.
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
  const showFloor = blocks.showEvolutionChart || maturity === "setup";
  return { showHeroCard: showFloor, showJournal: showFloor };
}
