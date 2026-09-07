import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  invalidatePortfolioView,
  PORTFOLIO_VIEW_QUERY_KEYS,
} from "@/app/lib/ui/invalidate-portfolio";

/*
  Après une mutation, l'écran doit redemander ce qu'il affiche.

  Les invalidations nommaient une par une les requêtes à rafraîchir, sur huit
  sites. La liste a divergé le jour où la courbe a changé de source : elles ont
  continué de citer `portfolio-history`, qui ne porte plus la série, et le tracé
  gardait son état d'avant la suppression ou l'ajout.

  Ces contrôles épinglent la couverture, pas l'implémentation : ce qui compte
  est qu'aucune des requêtes de la vue patrimoniale ne soit oubliée.
*/
describe("invalidatePortfolioView", () => {
  function faux() {
    const invalidateQueries =
      vi.fn<(args: { queryKey: string[] }) => Promise<void>>(() =>
        Promise.resolve()
      );
    return {
      qc: { invalidateQueries } as unknown as QueryClient,
      invalidateQueries,
    };
  }

  it("invalide la série dense que la courbe dessine", () => {
    const { qc, invalidateQueries } = faux();
    invalidatePortfolioView(qc);
    const cles = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    expect(cles).toContain("portfolio-daily-nav");
  });

  it("couvre les positions, le journal et les plateformes", () => {
    const { qc, invalidateQueries } = faux();
    invalidatePortfolioView(qc);
    const cles = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    for (const attendue of ["holdings", "transactions", "platforms"]) {
      expect(cles).toContain(attendue);
    }
  });

  it("invalide chaque clé déclarée, sans en sauter", () => {
    const { qc, invalidateQueries } = faux();
    invalidatePortfolioView(qc);
    expect(invalidateQueries).toHaveBeenCalledTimes(
      PORTFOLIO_VIEW_QUERY_KEYS.length
    );
  });

  it("invalide par préfixe, pour couvrir toutes les fenêtres d'une série", () => {
    /*
      `portfolio-daily-nav` est suivi du périmètre, de la période et des bornes.
      Les énumérer serait sans fin ; le préfixe seul les couvre toutes.
    */
    const { qc, invalidateQueries } = faux();
    invalidatePortfolioView(qc);
    for (const [{ queryKey }] of invalidateQueries.mock.calls) {
      expect(queryKey).toHaveLength(1);
    }
  });
});
