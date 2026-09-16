import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { PORTFOLIO_VIEW_QUERY_KEYS } from "@/app/lib/ui/invalidate-portfolio";
import {
  invalidateTradingView,
  TRADING_VIEW_QUERY_KEYS,
} from "@/components/trading/invalidate-trading-view";

/*
  Une position à levier se saisit dans le sous-onglet Futures et se lit dans
  le sous-onglet Positions, dont la liste vient d'une autre requête
  (`trading-bundle`). Le panneau n'invalidait que la sienne : le toast
  annonçait la position, la liste Positions la taisait jusqu'au rechargement.

  Ces contrôles épinglent la couverture, pas l'implémentation.
*/
describe("invalidateTradingView", () => {
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

  it("invalide la liste du sous-onglet Positions, pas seulement celle du panneau", () => {
    const { qc, invalidateQueries } = faux();
    invalidateTradingView(qc);
    const cles = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    expect(cles).toContain("trading-bundle");
    expect(cles).toContain("crypto-futures");
  });

  it("couvre le journal et les comptes, qui lisent `trading` par préfixe", () => {
    const { qc, invalidateQueries } = faux();
    invalidateTradingView(qc);
    const cles = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    expect(cles).toContain("trading");
  });

  it("couvre la vue patrimoniale, où l'equity de la position est comptée", () => {
    const { qc, invalidateQueries } = faux();
    invalidateTradingView(qc);
    const cles = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    for (const [attendue] of PORTFOLIO_VIEW_QUERY_KEYS) {
      expect(cles).toContain(attendue);
    }
  });

  it("invalide chaque clé déclarée, sans en sauter", () => {
    const { qc, invalidateQueries } = faux();
    invalidateTradingView(qc);
    expect(invalidateQueries).toHaveBeenCalledTimes(
      TRADING_VIEW_QUERY_KEYS.length + PORTFOLIO_VIEW_QUERY_KEYS.length
    );
  });

  it("invalide par préfixe, pour couvrir `trading` quelle que soit l'année", () => {
    const { qc, invalidateQueries } = faux();
    invalidateTradingView(qc);
    for (const [{ queryKey }] of invalidateQueries.mock.calls) {
      expect(queryKey).toHaveLength(1);
    }
  });
});
