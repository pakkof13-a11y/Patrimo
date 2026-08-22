import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * Les invariants du moteur de valorisation historique.
 *
 * Chaque test isole une règle que la courbe précédente enfreignait : périmètre
 * identique entre l'historique et le jour même, flux distingués de la
 * performance, valeur d'aujourd'hui jamais reportée dans le passé.
 */

const DAY = (s: string) => new Date(`${s}T10:00:00Z`);

function inputs(over: Partial<HistoricalInputs> = {}): HistoricalInputs {
  return {
    transactions: [],
    assetClassById: new Map(),
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
  id: string,
  assetId: string,
  day: string,
  qty: number,
  unit: number
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

const last = <T,>(a: T[]): T => a[a.length - 1]!;
const at = <T extends { day: string }>(pts: T[], day: string): T =>
  pts.find((p) => p.day === day)!;

describe("moteur de valorisation historique", () => {
  it("Test 1 — le dernier point historique égale la valeur brute du jour", () => {
    /*
      C'est l'invariant qui manquait : la courbe et la carte du dashboard
      additionnaient des périmètres différents, et la marche entre les deux se
      lisait comme un mouvement de marché.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          { id: "b1", balanceEur: d(10_000), createdAt: DAY("2024-01-01") },
        ],
        tangibles: [
          {
            id: "t1",
            purchaseDate: DAY("2024-01-01"),
            createdAt: DAY("2024-01-01"),
            updatedAt: DAY("2024-06-01"),
            costEur: d(50_000),
            estimatedValueEur: d(60_000),
            valuations: [],
          },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-07-01");
    const live = e.calculateAt("2024-07-01");

    expect(last(series).grossAssets).toBeCloseTo(live.grossAssets, 6);
    expect(last(series).grossAssets).toBeCloseTo(70_000, 6);
  });

  it("Test 2 — le patrimoine net du dernier point égale celui du jour", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          { id: "b1", balanceEur: d(100_000), createdAt: DAY("2024-01-01") },
        ],
        liabilities: [
          {
            id: "l1",
            startDate: DAY("2024-01-01"),
            createdAt: DAY("2024-01-01"),
            updatedAt: DAY("2024-01-01"),
            initialAmountEur: d(30_000),
            remainingAmountEur: d(30_000),
            events: [],
          },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-03-01");
    const live = e.calculateAt("2024-03-01");

    expect(last(series).netWorth).toBeCloseTo(live.netWorth, 6);
    expect(last(series).netWorth).toBeCloseTo(70_000, 6);
    expect(last(series).grossAssets - last(series).liabilities).toBeCloseTo(
      last(series).netWorth,
      6
    );
  });

  it("Test 3 — un apport de cash monte la courbe sans créer de performance", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          { id: "b1", balanceEur: d(200_000), createdAt: DAY("2024-01-01") },
        ],
        cashEvents: [
          {
            accountId: "b1",
            occurredAt: DAY("2024-01-01"),
            amountEur: d(100_000),
            balanceAfterEur: d(100_000),
            type: "OPENING",
          },
          {
            accountId: "b1",
            occurredAt: DAY("2024-06-01"),
            amountEur: d(100_000),
            balanceAfterEur: d(200_000),
            type: "DEPOSIT",
          },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-07-01");
    const deposit = at(series, "2024-06-01");

    expect(at(series, "2024-05-31").grossAssets).toBeCloseTo(100_000, 6);
    expect(deposit.grossAssets).toBeCloseTo(200_000, 6);
    // La courbe monte de 100 k€…
    expect(deposit.externalFlows).toBeCloseTo(100_000, 6);
    // …et la performance reste nulle : rien n'a produit de gain.
    expect(deposit.investmentPerformance).toBeCloseTo(0, 6);
  });

  it("Test 4 — acquérir un actif alternatif ne fabrique pas de plus-value", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        tangibles: [
          {
            id: "t1",
            purchaseDate: DAY("2024-06-01"),
            createdAt: DAY("2024-06-01"),
            updatedAt: DAY("2024-06-01"),
            costEur: d(2_000_000),
            estimatedValueEur: d(2_000_000),
            valuations: [],
          },
        ],
        cashAccounts: [
          { id: "b1", balanceEur: d(1_000), createdAt: DAY("2024-01-01") },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-07-01");
    const acq = at(series, "2024-06-01");

    expect(at(series, "2024-05-31").alternatives).toBeCloseTo(0, 6);
    expect(acq.alternatives).toBeCloseTo(2_000_000, 6);
    expect(acq.externalFlows).toBeCloseTo(2_000_000, 6);
    expect(acq.investmentPerformance).toBeCloseTo(0, 6);
  });

  it("Test 5 — une revalorisation datée ne remonte pas dans le passé", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        tangibles: [
          {
            id: "t1",
            purchaseDate: DAY("2023-01-01"),
            createdAt: DAY("2023-01-01"),
            updatedAt: DAY("2024-07-01"),
            costEur: d(1_000_000),
            estimatedValueEur: d(1_200_000),
            valuations: [
              { valuedAt: DAY("2024-01-01"), valueEur: d(1_000_000) },
              { valuedAt: DAY("2024-07-01"), valueEur: d(1_200_000) },
            ],
          },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-08-01");

    expect(at(series, "2024-01-01").alternatives).toBeCloseTo(1_000_000, 6);
    // Avant la seconde expertise, la valeur connue reste la première.
    expect(at(series, "2024-06-30").alternatives).toBeCloseTo(1_000_000, 6);
    expect(at(series, "2024-07-01").alternatives).toBeCloseTo(1_200_000, 6);
    // Aucune interpolation entre les deux constats.
    expect(at(series, "2024-04-01").alternatives).toBeCloseTo(1_000_000, 6);
    // La revalorisation est de la performance, pas un flux.
    expect(at(series, "2024-07-01").externalFlows).toBeCloseTo(0, 6);
    expect(at(series, "2024-07-01").investmentPerformance).toBeCloseTo(200_000, 6);
  });

  it("Test 6 — le patrimoine net progresse quand la dette s'amortit", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          { id: "b1", balanceEur: d(500_000), createdAt: DAY("2023-12-01") },
        ],
        liabilities: [
          {
            id: "l1",
            startDate: DAY("2024-01-01"),
            createdAt: DAY("2024-01-01"),
            updatedAt: DAY("2024-07-01"),
            initialAmountEur: d(200_000),
            remainingAmountEur: d(180_000),
            events: [
              { eventDate: DAY("2024-01-01"), remainingAfterEur: d(200_000) },
              { eventDate: DAY("2024-07-01"), remainingAfterEur: d(180_000) },
            ],
          },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-08-01");
    const before = at(series, "2024-06-30");
    const after = at(series, "2024-07-01");

    expect(before.liabilities).toBeCloseTo(200_000, 6);
    expect(after.liabilities).toBeCloseTo(180_000, 6);
    // La valeur brute n'a pas bougé : seul le passif a baissé.
    expect(after.grossAssets).toBeCloseTo(before.grossAssets, 6);
    expect(after.netWorth - before.netWorth).toBeCloseTo(20_000, 6);
  });

  it("Test 7 — la courbe bouge sur un mouvement de cours sans transaction", () => {
    const closes = new Map([
      [
        "a1",
        new Map([
          ["2024-01-01", 100],
          ["2024-01-05", 120],
        ]),
      ],
    ]);
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-01", 10, 100)],
        assetClassById: new Map([["a1", "ACTIONS"]]),
        closes,
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-01-10");

    expect(at(series, "2024-01-01").securities).toBeCloseTo(1_000, 6);
    // Report du dernier cours connu, puis prise en compte du nouveau.
    expect(at(series, "2024-01-04").securities).toBeCloseTo(1_000, 6);
    expect(at(series, "2024-01-05").securities).toBeCloseTo(1_200, 6);
    // Aucune transaction ce jour-là : la hausse est intégralement de la
    // performance.
    expect(at(series, "2024-01-05").externalFlows).toBeCloseTo(0, 6);
    expect(at(series, "2024-01-05").investmentPerformance).toBeCloseTo(200, 6);
  });

  it("Test 8 — un transfert interne ne change pas la valeur globale", () => {
    /*
      Deux comptes du même patrimoine : ce qui sort de l'un entre dans l'autre.
      Le total doit rester plat, et surtout aucun flux externe ne doit
      apparaître — sinon le transfert se lirait comme un apport suivi d'un
      retrait, et la performance du jour serait faussée deux fois.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        cashAccounts: [
          { id: "b1", balanceEur: d(70_000), createdAt: DAY("2024-01-01") },
          { id: "b2", balanceEur: d(30_000), createdAt: DAY("2024-01-01") },
        ],
        cashEvents: [
          {
            accountId: "b1",
            occurredAt: DAY("2024-01-01"),
            amountEur: d(100_000),
            balanceAfterEur: d(100_000),
            type: "OPENING",
          },
          {
            accountId: "b2",
            occurredAt: DAY("2024-01-01"),
            amountEur: d(0),
            balanceAfterEur: d(0),
            type: "OPENING",
          },
          {
            accountId: "b1",
            occurredAt: DAY("2024-05-01"),
            amountEur: d(-30_000),
            balanceAfterEur: d(70_000),
            type: "WITHDRAWAL",
          },
          {
            accountId: "b2",
            occurredAt: DAY("2024-05-01"),
            amountEur: d(30_000),
            balanceAfterEur: d(30_000),
            type: "DEPOSIT",
          },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-06-01");

    expect(at(series, "2024-04-30").grossAssets).toBeCloseTo(100_000, 6);
    expect(at(series, "2024-05-01").grossAssets).toBeCloseTo(100_000, 6);
    expect(at(series, "2024-05-01").externalFlows).toBeCloseTo(0, 6);
    expect(at(series, "2024-05-01").investmentPerformance).toBeCloseTo(0, 6);
  });

  it("§21 — chaque point vérifie sa propre décomposition", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-01", 10, 100)],
        assetClassById: new Map([["a1", "ACTIONS"]]),
        closes: new Map([["a1", new Map([["2024-01-01", 100]])]]),
        cashAccounts: [
          { id: "b1", balanceEur: d(5_000), createdAt: DAY("2024-01-01") },
        ],
        employeeSavings: [
          {
            id: "e1",
            contributionDate: DAY("2024-01-01"),
            createdAt: DAY("2024-01-01"),
            updatedAt: DAY("2024-01-01"),
            contributedEur: d(3_000),
            currentEur: d(3_500),
          },
        ],
        liabilities: [
          {
            id: "l1",
            startDate: DAY("2024-01-01"),
            createdAt: DAY("2024-01-01"),
            updatedAt: DAY("2024-01-01"),
            initialAmountEur: d(2_000),
            remainingAmountEur: d(2_000),
            events: [],
          },
        ],
      })
    );

    for (const p of e.buildSeries("2024-01-01", "2024-02-01")) {
      const sum =
        p.securities +
        p.crypto +
        p.realEstate +
        p.lifeInsurance +
        p.cash +
        p.alternatives +
        p.employeeSavings +
        p.otherAssets;
      expect(sum).toBeCloseTo(p.grossAssets, 6);
      expect(p.grossAssets - p.liabilities).toBeCloseTo(p.netWorth, 6);
    }
  });

  it("signale les compartiments estimés au lieu de prétendre à l'exactitude", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        // Aucun événement : l'histoire du compte est inconnue.
        cashAccounts: [
          { id: "b1", balanceEur: d(10_000), createdAt: DAY("2024-01-01") },
        ],
      })
    );

    const p = e.calculateAt("2024-06-01");
    expect(p.status).toBe("ESTIMATED");
    expect(p.estimatedComponents).toContain("cash");
  });

  it("ne fait exister aucun actif avant sa date d'acquisition", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        metals: [
          {
            id: "m1",
            acquiredAt: DAY("2024-03-01"),
            createdAt: DAY("2024-03-01"),
            // La valeur courante n'est constatée qu'à la dernière saisie.
            updatedAt: DAY("2024-03-20"),
            costEur: d(20_000),
            currentValueEur: d(25_000),
          },
        ],
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-04-01");
    expect(at(series, "2024-02-28").alternatives).toBeCloseTo(0, 6);
    // Le prix payé tient jusqu'au constat suivant — pas de pente inventée.
    expect(at(series, "2024-03-01").alternatives).toBeCloseTo(20_000, 6);
    expect(at(series, "2024-03-19").alternatives).toBeCloseTo(20_000, 6);
    expect(at(series, "2024-03-20").alternatives).toBeCloseTo(25_000, 6);
  });

  it("le jour de l'acquisition ne produit aucune plus-value instantanée", () => {
    /*
      Ligne saisie et estimée d'un seul geste : `updatedAt` tombe le jour de
      l'achat. L'écart entre prix payé et estimation ne doit pas se lire comme
      un gain du jour — rien ne s'est produit, l'objet vient d'entrer.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        metals: [
          {
            id: "m1",
            acquiredAt: DAY("2024-03-01"),
            createdAt: DAY("2024-03-01"),
            updatedAt: DAY("2024-03-01"),
            costEur: d(20_000),
            currentValueEur: d(25_000),
          },
        ],
      })
    );

    const series = e.buildSeries("2024-02-25", "2024-03-05");
    const acq = at(series, "2024-03-01");
    expect(acq.alternatives).toBeCloseTo(20_000, 6);
    expect(acq.externalFlows).toBeCloseTo(20_000, 6);
    expect(acq.investmentPerformance).toBeCloseTo(0, 6);
  });
});
