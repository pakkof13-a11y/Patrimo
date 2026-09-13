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
  return trade("ACHAT", assetId, day, qty, unit, id);
}

function sell(
  assetId: string,
  day: string,
  qty: number,
  unit: number,
  id: string
): LedgerTx {
  return trade("VENTE", assetId, day, qty, unit, id);
}

function trade(
  type: "ACHAT" | "VENTE",
  assetId: string,
  day: string,
  qty: number,
  unit: number,
  id: string
): LedgerTx {
  return {
    id,
    type,
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

/**
 * FIN-01 (suite) — meme perimetre pour le realise.
 *
 * `positionsCostBasis` filtrait deja `excludedAssetIds` ; `realizedPnl` non. La
 * courbe reportait donc le gain realise d'une ligne dont elle avait retire la
 * valeur et le cout.
 *
 * Deux portes a fermer, verifiees toutes les deux ici : le calcul direct
 * (`calculateAt`, somme complete des lots) et le cumul incremental que la serie
 * entretient au fil du rejeu (`RealizedPnlAccumulator`). Fermer la premiere
 * seule aurait laisse le trou ouvert sur le chemin qui sert les courbes.
 */
describe("realizedPnl historique — position DeFi ecartee", () => {
  /*
    a1 : 10 titres a 100, 5 revendus a 140 -> realise 200.
    a2 : position DeFi, 10 unites a 600, toutes revendues a 900 -> realise
    3 000, position soldee. Seul son lot subsiste au journal.
  */
  const txs = [
    buy("a1", "2024-01-10", 10, 100, "b-a1"),
    buy("a2", "2024-01-10", 10, 600, "b-a2"),
    sell("a1", "2024-02-01", 5, 140, "s-a1"),
    sell("a2", "2024-02-01", 10, 900, "s-a2"),
  ];
  const closes = new Map([
    ["a1", new Map([["2024-01-10", 100], ["2024-02-01", 140], ["2024-03-01", 120]])],
    ["a2", new Map([["2024-01-10", 600], ["2024-02-01", 900], ["2024-03-01", 900]])],
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

  it("sans exclusion : les deux realises se cumulent", () => {
    const e = build(new Set());
    expect(e.calculateAt("2024-03-01").realizedPnl).toBeCloseTo(200 + 3_000, 6);
    expect(e.buildSeries("2024-01-10", "2024-03-01").at(-1)!.realizedPnl).toBeCloseTo(
      200 + 3_000,
      6
    );
  });

  it("a2 exclu : son realise sort du point isole", () => {
    // Avant la correction : 3 200, alors que ni la valeur ni le cout de a2
    // n'entraient plus dans ce meme point.
    expect(build(new Set(["a2"])).calculateAt("2024-03-01").realizedPnl).toBeCloseTo(
      200,
      6
    );
  });

  it("a2 exclu : le cumul incremental de la serie donne le meme chiffre", () => {
    const e = build(new Set(["a2"]));
    const serie = e.buildSeries("2024-01-10", "2024-03-01");

    // La serie passe par `RealizedPnlAccumulator` : sans filtre de son cote,
    // le realise exclu rentrait par cette porte-la.
    expect(serie.at(-1)!.realizedPnl).toBeCloseTo(200, 6);
    expect(serie.at(-1)!.realizedPnl).toBeCloseTo(
      e.calculateAt("2024-03-01").realizedPnl,
      6
    );
    // Cumulatif : rien avant la vente du 1er fevrier.
    expect(serie.find((p) => p.day === "2024-01-31")!.realizedPnl).toBeCloseTo(0, 6);
  });
});
