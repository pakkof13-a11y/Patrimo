import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * FIN-01 (point 3) — `positionsCostBasis` doit sortir les positions
 * `excludedAssetIds` du coût, comme la valorisation le fait déjà pour
 * `securities`/`crypto`/… (`engine.ts:949`, `:1103`).
 *
 * Avant la correction, `totalCostBasis(state)` sommait le journal brut : le
 * coût d'une position DeFi écartée du patrimoine restait dans
 * `positionsCostBasis` alors que sa valeur de marché en était déjà sortie —
 * même défaut que `getPortfolioBundle` (`service.ts:961`) et
 * `getPlatformCashBalances`, mais sur la courbe historique.
 */

const DAY = (s: string) => new Date(`${s}T10:00:00Z`);

function inputs(over: Partial<HistoricalInputs> = {}): HistoricalInputs {
  return {
    transactions: [],
    assetClassById: new Map(),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
    excludedAssetIds: new Set(),
    closes: new Map(),
    cashAccounts: [],
    cashEvents: [],
    metals: [],
    privateEquity: [],
    crowdlending: [],
    tangibles: [],
    employeeSavings: [],
    liabilities: [],
    ...over,
  };
}

function buy(
  assetId: string,
  day: string,
  qty: number,
  unit: number,
  id: string
): LedgerTx {
  return {
    id,
    type: "ACHAT",
    platformId: "p1",
    toPlatformId: null,
    assetId,
    quantity: d(qty),
    unitPrice: d(unit),
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    grossOriginal: d(qty * unit),
    cashAmountOriginal: d(qty * unit),
    occurredAt: DAY(day),
  };
}

describe("positionsCostBasis — position DeFi écartée (excludedAssetIds)", () => {
  /*
    a1 : position ordinaire, 10 titres achetés 100, cotés 120 → marché 1 200,
    coût 1 000, latent 200.

    a2 : position DeFi marquée `isIgnoredInPortfolio`, 10 unités achetées 600
    (coût 6 000), cotée 120 (marché 1 200) — les mêmes montants que le
    scénario de mesure du brief FIN-01.
  */
  const txs = [
    buy("a1", "2024-01-10", 10, 100, "b-a1"),
    buy("a2", "2024-01-10", 10, 600, "b-a2"),
  ];
  const closes = new Map([
    ["a1", new Map([["2024-01-10", 100], ["2024-03-01", 120]])],
    ["a2", new Map([["2024-01-10", 600], ["2024-03-01", 120]])],
  ]);

  function build(excluded: Set<string>) {
    return new PortfolioValuationEngine(
      inputs({
        transactions: txs,
        assetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "ACTIONS"],
        ]),
        rawAssetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "ACTIONS"],
        ]),
        closes,
        excludedAssetIds: excluded,
      })
    );
  }

  it("sans exclusion : le coût de a2 pèse dans positionsCostBasis, comme sa valeur dans securities", () => {
    const e = build(new Set());
    const point = e.buildSeries("2024-01-10", "2024-03-01").at(-1)!;

    expect(point.positionsCostBasis).toBeCloseTo(1_000 + 6_000, 6);
    expect(point.securities).toBeCloseTo(1_200 + 1_200, 6);
  });

  it("a2 exclu : sort du coût exactement comme il sort déjà de securities", () => {
    const e = build(new Set(["a2"]));
    const point = e.buildSeries("2024-01-10", "2024-03-01").at(-1)!;

    // Avant la correction, ce test aurait vu positionsCostBasis = 7 000 :
    // `securities` excluait déjà a2 (`:949`), `positionsCostBasis` non.
    expect(point.positionsCostBasis).toBeCloseTo(1_000, 6);
    expect(point.securities).toBeCloseTo(1_200, 6);
    // Le périmètre est désormais le même des deux côtés : le latent de a1
    // seul, pas amputé du coût d'une position déjà sortie de la valeur.
    expect(point.securities - point.positionsCostBasis).toBeCloseTo(200, 6);
  });
});
