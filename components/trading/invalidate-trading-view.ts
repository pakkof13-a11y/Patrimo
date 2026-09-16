import type { QueryClient } from "@tanstack/react-query";
import { invalidatePortfolioView } from "@/app/lib/ui/invalidate-portfolio";

/**
 * Les requêtes de l'onglet Trading, invalidées ensemble.
 *
 * Une position à levier se saisit, se clôture et se supprime dans le
 * sous-onglet Futures, mais elle se lit ailleurs : la liste du sous-onglet
 * Positions vient de `trading-bundle`, le journal et les comptes de
 * `trading`. Le panneau Futures n'invalidait que sa propre requête
 * `crypto-futures` — le toast annonçait la position, la liste Positions la
 * taisait jusqu'au rechargement, car sa requête reste montée au niveau de
 * l'onglet et n'a donc aucune raison de se relancer toute seule.
 *
 * Même remède que `invalidatePortfolioView` : une seule fonction connaît les
 * clés, un appelant qui l'utilise ne peut plus en oublier une.
 */
export const TRADING_VIEW_QUERY_KEYS = [
  ["crypto-futures"],
  ["trading-bundle"],
  ["trading"],
] as const;

/**
 * À appeler après toute mutation d'une position à levier. La position pèse
 * aussi au patrimoine (equity comptée dans la ventilation par venue de
 * `/api/holdings`), d'où la vue patrimoniale en plus des clés de l'onglet.
 */
export function invalidateTradingView(qc: QueryClient): void {
  for (const queryKey of TRADING_VIEW_QUERY_KEYS) {
    void qc.invalidateQueries({ queryKey: [...queryKey] });
  }
  invalidatePortfolioView(qc);
}
