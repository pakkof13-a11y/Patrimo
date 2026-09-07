import type { QueryClient } from "@tanstack/react-query";

/**
 * Les requêtes qui portent la vue patrimoniale, invalidées ensemble.
 *
 * Elles l'étaient une par une, sur huit sites d'appel. La liste a divergé le
 * jour où la série a changé de source : `GET /api/portfolio` ne calcule plus
 * d'historique, et sa requête `portfolio-history` a été retirée de la page —
 * mais les invalidations, elles, ont continué de la nommer. Elles ne
 * rafraîchissaient donc plus rien, et la courbe gardait son état d'avant la
 * mutation : plateforme supprimée, transaction ajoutée, prix rafraîchis, le
 * tracé ne bougeait pas.
 *
 * Le remède n'est pas d'ajouter une clé de plus à huit endroits — c'est
 * exactement ce qui a permis la dérive. Une seule fonction les connaît ; un
 * appelant qui l'utilise ne peut plus en oublier une.
 *
 * `portfolio-history` reste de la liste : la requête existe encore et d'autres
 * écrans peuvent la lire. L'invalider ne coûte rien, l'omettre coûterait un
 * écran figé de plus.
 */
export const PORTFOLIO_VIEW_QUERY_KEYS = [
  ["holdings"],
  ["portfolio-daily-nav"],
  ["portfolio-history"],
  ["transactions"],
  ["platforms"],
] as const;

/**
 * À appeler après toute mutation qui change ce que le patrimoine vaut ou
 * contient. Les clés sont invalidées par préfixe : `portfolio-daily-nav` couvre
 * donc toutes ses fenêtres et tous ses périmètres, sans avoir à les énumérer.
 */
export function invalidatePortfolioView(qc: QueryClient): void {
  for (const queryKey of PORTFOLIO_VIEW_QUERY_KEYS) {
    void qc.invalidateQueries({ queryKey: [...queryKey] });
  }
}
