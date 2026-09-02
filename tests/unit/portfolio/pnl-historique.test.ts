import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import {
  applyTransaction,
  createEmptyLedger,
  totalCostBasis,
  totalRealizedPnl,
} from "@/app/lib/accounting/ledger";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * P&L latent et réalisé, reconstruits à une date passée.
 *
 * Les deux grandeurs n'étaient pas calculées côté historique : la tuile
 * affichait une courbe plate à zéro, produite par un `num(undefined)`. Elles
 * sont désormais lues sur l'état comptable que le moteur rejoue de toute façon,
 * avec les fonctions mêmes du patrimoine du jour — c'est ce que ces tests
 * vérifient, plutôt que des montants choisis pour tomber juste.
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

function buy(day: string, qty: number, unit: number, id = `b-${day}`): LedgerTx {
  return {
    id,
    type: "ACHAT",
    platformId: "p1",
    toPlatformId: null,
    assetId: "a1",
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

function sell(day: string, qty: number, unit: number, id = `s-${day}`): LedgerTx {
  return {
    id,
    type: "VENTE",
    platformId: "p1",
    toPlatformId: null,
    assetId: "a1",
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

function income(
  type: "DIVIDENDE" | "INTERET",
  day: string,
  amount: number
): LedgerTx {
  return {
    id: `${type}-${day}`,
    type,
    platformId: "p1",
    toPlatformId: null,
    assetId: "a1",
    quantity: null,
    unitPrice: null,
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    cashAmountOriginal: d(amount),
    occurredAt: DAY(day),
  };
}

/** Une action, cotée aux dates fournies. */
function actions(txs: LedgerTx[], closes: Record<string, number>) {
  return inputs({
    transactions: txs,
    assetClassById: new Map([["a1", "ACTIONS"]]),
    rawAssetClassById: new Map([["a1", "ACTIONS"]]),
    closes: new Map([["a1", new Map(Object.entries(closes))]]),
  });
}

const at = <T extends { day: string }>(pts: T[], day: string): T =>
  pts.find((p) => p.day === day)!;

describe("P&L latent historique", () => {
  it("vaut la valeur de marché du jour moins le prix de revient", () => {
    // 10 titres payés 100, cotés 120 : 200 € de latent, à cette date-là.
    const e = new PortfolioValuationEngine(
      actions([buy("2024-01-10", 10, 100)], {
        "2024-01-10": 100,
        "2024-03-01": 120,
      })
    );

    const point = at(e.buildSeries("2024-01-10", "2024-03-01"), "2024-03-01");

    expect(point.positionsCostBasis).toBeCloseTo(1_000, 6);
    expect(point.securities).toBeCloseTo(1_200, 6);
    expect(point.securities - point.positionsCostBasis).toBeCloseTo(200, 6);
  });

  it("suit le cours dans le temps, sans palier fabriqué", () => {
    const e = new PortfolioValuationEngine(
      actions([buy("2024-01-10", 10, 100)], {
        "2024-01-10": 100,
        "2024-01-11": 110,
        "2024-01-12": 90,
      })
    );

    const serie = e.buildSeries("2024-01-10", "2024-01-12");
    const latent = serie.map((p) => p.securities - p.positionsCostBasis);

    // Trois valeurs distinctes : le jour de l'achat (nul), puis la hausse, puis
    // la baisse. C'est exactement ce que la courbe plate à zéro cachait.
    expect(latent[0]).toBeCloseTo(0, 6);
    expect(latent[1]).toBeCloseTo(100, 6);
    expect(latent[2]).toBeCloseTo(-100, 6);
  });

  it("sans cours connu, la position est retenue au coût — et le point le dit", () => {
    /*
      Le latent vaut alors exactement zéro : ce n'est pas une mesure, c'est la
      conséquence du repli au prix de revient. Le patrimoine du jour fait la
      même chose (« If no market price, show cost as value »), ce qui garde les
      deux d'accord — et le point porte `status: ESTIMATED` pour que l'écran
      puisse le signaler plutôt que de le faire passer pour un fait.
    */
    const e = new PortfolioValuationEngine(
      actions([buy("2024-01-10", 10, 100)], {})
    );

    const point = at(e.buildSeries("2024-01-10", "2024-02-01"), "2024-02-01");

    expect(point.securities - point.positionsCostBasis).toBe(0);
    expect(point.status).toBe("ESTIMATED");
    expect(point.priceCoverage).toBeLessThan(1);
  });

  it("aucune position : coût nul, et c'est un vrai zéro", () => {
    const e = new PortfolioValuationEngine(
      actions([buy("2024-02-10", 10, 100)], { "2024-02-10": 100 })
    );

    // La veille de l'achat : rien n'est détenu.
    const point = at(e.buildSeries("2024-02-09", "2024-02-10"), "2024-02-09");
    expect(point.positionsCostBasis).toBe(0);
    expect(point.securities).toBe(0);
  });
});

describe("réalisé historique", () => {
  it("apparaît à la date de la vente et reste cumulé ensuite", () => {
    const e = new PortfolioValuationEngine(
      actions([buy("2024-01-10", 10, 100), sell("2024-02-01", 5, 150)], {
        "2024-01-10": 100,
        "2024-02-01": 150,
        "2024-03-01": 150,
      })
    );

    const serie = e.buildSeries("2024-01-10", "2024-03-01");

    // Avant la vente : rien de réalisé — un zéro vrai, pas une absence.
    expect(at(serie, "2024-01-10").realizedPnl).toBe(0);
    // 5 titres vendus 150, entrés à 100 : 250 €.
    expect(at(serie, "2024-02-01").realizedPnl).toBeCloseTo(250, 6);
    // Un cumul ne redescend pas les jours suivants.
    expect(at(serie, "2024-03-01").realizedPnl).toBeCloseTo(250, 6);
  });

  it("le coût de revient baisse de la part vendue", () => {
    const e = new PortfolioValuationEngine(
      actions([buy("2024-01-10", 10, 100), sell("2024-02-01", 5, 150)], {
        "2024-01-10": 100,
        "2024-02-01": 150,
      })
    );

    const serie = e.buildSeries("2024-01-10", "2024-02-01");
    expect(at(serie, "2024-01-10").positionsCostBasis).toBeCloseTo(1_000, 6);
    expect(at(serie, "2024-02-01").positionsCostBasis).toBeCloseTo(500, 6);
  });

  it("les revenus du journal comptent les intérêts, comme le patrimoine du jour", () => {
    const e = new PortfolioValuationEngine(
      actions(
        [
          buy("2024-01-10", 10, 100),
          income("DIVIDENDE", "2024-02-01", 40),
          income("INTERET", "2024-02-15", 10),
        ],
        { "2024-01-10": 100, "2024-02-15": 100 }
      )
    );

    const serie = e.buildSeries("2024-01-10", "2024-02-15");
    expect(at(serie, "2024-01-10").ledgerCashIncome).toBe(0);
    expect(at(serie, "2024-02-01").ledgerCashIncome).toBeCloseTo(40, 6);
    expect(at(serie, "2024-02-15").ledgerCashIncome).toBeCloseTo(50, 6);
  });
});

/**
 * Les deux chemins de calcul doivent rendre le même nombre.
 *
 * La série entretient un cumul du réalisé au fil du rejeu ; le point isolé le
 * recalcule sur tous les lots. Une divergence entre les deux serait exactement
 * le genre de défaut qu'un accumulateur introduit sans bruit.
 */
describe("cohérence avec les fonctions du patrimoine du jour", () => {
  const txs = [
    buy("2024-01-10", 10, 100),
    buy("2024-01-20", 5, 120),
    sell("2024-02-01", 8, 150),
    income("DIVIDENDE", "2024-02-10", 30),
    sell("2024-03-01", 2, 90),
  ];
  const closes = {
    "2024-01-10": 100,
    "2024-01-20": 120,
    "2024-02-01": 150,
    "2024-03-01": 90,
    "2024-04-01": 130,
  };

  /** L'état comptable rejoué à part, comme le fait `getPortfolioBundle`. */
  function referenceState() {
    const state = createEmptyLedger();
    for (const tx of txs) applyTransaction(state, tx);
    return state;
  }

  it("le dernier point porte le réalisé de `totalRealizedPnl`", () => {
    const e = new PortfolioValuationEngine(actions(txs, closes));
    const serie = e.buildSeries("2024-01-10", "2024-04-01");
    const dernier = serie[serie.length - 1]!;

    expect(dernier.realizedPnl).toBeCloseTo(
      Number(totalRealizedPnl(referenceState()).toString()),
      6
    );
  });

  it("le dernier point porte le coût de `totalCostBasis`", () => {
    const e = new PortfolioValuationEngine(actions(txs, closes));
    const serie = e.buildSeries("2024-01-10", "2024-04-01");
    const dernier = serie[serie.length - 1]!;

    expect(dernier.positionsCostBasis).toBeCloseTo(
      Number(totalCostBasis(referenceState()).toString()),
      6
    );
  });

  it("série et point isolé s'accordent, malgré deux chemins de cumul", () => {
    const e = new PortfolioValuationEngine(actions(txs, closes));
    const serie = e.buildSeries("2024-01-10", "2024-04-01");

    for (const jour of ["2024-01-20", "2024-02-01", "2024-03-01", "2024-04-01"]) {
      const isole = e.calculateAt(jour);
      expect(at(serie, jour).realizedPnl).toBeCloseTo(isole.realizedPnl, 6);
      expect(at(serie, jour).positionsCostBasis).toBeCloseTo(
        isole.positionsCostBasis,
        6
      );
      expect(at(serie, jour).ledgerCashIncome).toBeCloseTo(
        isole.ledgerCashIncome,
        6
      );
    }
  });
});
