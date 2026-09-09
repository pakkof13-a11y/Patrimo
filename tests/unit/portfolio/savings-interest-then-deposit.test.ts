import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";

/**
 * Intérêts crédités puis solde saisi, vus par la courbe.
 *
 * La route lisait son état de départ avant de créditer les intérêts dus. Sur
 * un livret à 10 000 € portant 100 € d'intérêts, une saisie à 10 500 €
 * journalisait « dépôt de 500 depuis 10 000 » alors que le livret valait déjà
 * 10 100 : le compartiment écarte les `INTEREST` des flux, si bien que les
 * 100 € d'intérêts passaient d'une performance à un apport.
 *
 * Ce fichier mesure la conséquence là où elle se voit, et rien d'autre : les
 * deux jeux d'événements sont ceux que la route écrivait avant, puis après.
 */

const t = (iso: string) => new Date(iso);

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

/** Le livret après la saisie : 10 500 €, connu du jour même. */
const livret = {
  id: "s1",
  balanceEur: d(10_500),
  createdAt: t("2020-01-01T00:00:00Z"),
  knownAt: t("2026-09-09T11:00:00Z"),
};

/** Ouverture au 20 août : le livret valait 10 000 € et rien ne le disait. */
const ouverture = {
  accountId: "s1",
  occurredAt: t("2026-08-20T10:00:00Z"),
  amountEur: d(10_000),
  balanceAfterEur: d(10_000),
  type: "OPENING",
};

/** Les intérêts dus, crédités par l'accrual au moment de la saisie. */
const interets = {
  accountId: "s1",
  occurredAt: t("2026-09-09T11:00:00Z"),
  amountEur: d(100),
  balanceAfterEur: d(10_100),
  type: "INTEREST",
};

const depotFaux = {
  accountId: "s1",
  occurredAt: t("2026-09-09T11:00:00Z"),
  amountEur: d(500),
  balanceAfterEur: d(10_500),
  type: "DEPOSIT",
};

const depotJuste = { ...depotFaux, amountEur: d(400) };

const jourJ = (e: PortfolioValuationEngine) => {
  const p = e
    .buildSeries("2026-08-19", "2026-09-09")
    .find((x) => x.day === "2026-09-09")!;
  return { cash: p.cash, flux: p.externalFlows, perf: p.investmentPerformance };
};

describe("100 € d'intérêts puis une saisie à 10 500 €", () => {
  const avant = inputs({
    cashAccounts: [livret],
    cashEvents: [ouverture, interets, depotFaux],
  });
  const apres = inputs({
    cashAccounts: [livret],
    cashEvents: [ouverture, interets, depotJuste],
  });

  it("le défaut : les 100 € d'intérêts sont comptés comme un apport", () => {
    const j = jourJ(new PortfolioValuationEngine(avant));
    expect(j.cash).toBeCloseTo(10_500, 6);
    expect(j.flux).toBeCloseTo(500, 6);
    // La valeur monte de 500 et les flux disent 500 : plus rien pour la
    // performance, alors que 100 € d'intérêts viennent d'être versés.
    expect(j.perf).toBeCloseTo(0, 6);
  });

  it("le remède : 400 € d'apport, 100 € de performance", () => {
    const j = jourJ(new PortfolioValuationEngine(apres));
    expect(j.cash).toBeCloseTo(10_500, 6);
    expect(j.flux).toBeCloseTo(400, 6);
    expect(j.perf).toBeCloseTo(100, 6);
  });

  /*
    Les intérêts ne sont jamais un flux : c'est ce que le compartiment décide
    sur le type `INTEREST`, et c'est ce qui rend l'écart du dépôt décisif.
  */
  it("les intérêts seuls sont de la performance, jamais un apport", () => {
    const sansDepot = inputs({
      cashAccounts: [{ ...livret, balanceEur: d(10_100) }],
      cashEvents: [ouverture, interets],
    });
    const j = jourJ(new PortfolioValuationEngine(sansDepot));
    expect(j.cash).toBeCloseTo(10_100, 6);
    expect(j.flux).toBe(0);
    expect(j.perf).toBeCloseTo(100, 6);
  });

  it("le passé du livret reste à 10 000 € : l'ouverture le tient", () => {
    const e = new PortfolioValuationEngine(apres);
    const veille = e
      .buildSeries("2026-08-19", "2026-09-09")
      .find((x) => x.day === "2026-09-08")!;
    expect(veille.cash).toBeCloseTo(10_000, 6);
  });
});
