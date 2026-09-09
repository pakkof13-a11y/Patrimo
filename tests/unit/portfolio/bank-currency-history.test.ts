import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";

/**
 * Un compte courant qui change de devise, vu par la courbe.
 *
 * Même défaut qu'en D38 sur les poches d'enveloppe, même remède : `updatedAt`
 * est la seule ancre d'un compte sans événement, toute écriture de la ligne la
 * ramène au présent, et un changement de devise écrit la ligne. Le compte
 * repartait donc d'aujourd'hui, son passé effacé.
 *
 * Ici l'analogie s'arrête : contrairement à une poche d'enveloppe, dont la
 * route reconstruit le solde par conversion, un compte bancaire garde son
 * nominal. 5 200 étiquetés USD au lieu d'EUR valent réellement moins en euros,
 * et la chronologie doit le montrer — sans flux, puisque rien n'est entré ni
 * sorti.
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

/*
  La série part toujours du 19 août : la performance d'un jour se mesure contre
  la veille, et une fenêtre d'un seul jour n'en a pas.
*/
const serie = (e: PortfolioValuationEngine, jour: string) => {
  const p = e
    .buildSeries("2026-08-19", "2026-09-09")
    .find((x) => x.day === jour)!;
  return { cash: p.cash, flux: p.externalFlows, perf: p.investmentPerformance };
};

/*
  Le compte après la bascule : 5 200 USD, soit 4 160 € au taux de 1,25. La
  ligne a été réécrite aujourd'hui, donc `knownAt` vaut aujourd'hui.
*/
const compte = {
  id: "b1",
  balanceEur: d(4160),
  createdAt: t("2020-01-01T00:00:00Z"),
  knownAt: t("2026-09-09T11:00:00Z"),
};

const ouverture = {
  accountId: "b1",
  occurredAt: t("2026-08-20T10:00:00Z"),
  amountEur: d(5200),
  balanceAfterEur: d(5200),
  type: "OPENING",
};

const bascule = {
  accountId: "b1",
  occurredAt: t("2026-09-09T11:00:00Z"),
  amountEur: d(0),
  balanceAfterEur: d(4160),
  type: "REDENOMINATION",
};

describe("bascule de devise seule sur un compte sans historique", () => {
  const sansOuverture = inputs({ cashAccounts: [compte] });
  const avecOuverture = inputs({
    cashAccounts: [compte],
    cashEvents: [ouverture, bascule],
  });

  it("le défaut : la courbe d'avant le jour J est effacée", () => {
    const e = new PortfolioValuationEngine(sansOuverture);
    expect(serie(e, "2026-08-21").cash).toBe(0);
    expect(serie(e, "2026-09-08").cash).toBe(0);
  });

  it("le défaut : le solde entier arrive en flux le jour de la bascule", () => {
    const e = new PortfolioValuationEngine(sansOuverture);
    const j = serie(e, "2026-09-09");
    expect(j.cash).toBeCloseTo(4160, 6);
    expect(j.flux).toBeCloseTo(4160, 6);
  });

  it("avec l'ouverture : la courbe d'avant le jour J est intacte", () => {
    const e = new PortfolioValuationEngine(avecOuverture);
    expect(serie(e, "2026-08-20").cash).toBeCloseTo(5200, 6);
    expect(serie(e, "2026-09-08").cash).toBeCloseTo(5200, 6);
  });

  it("l'apport reste daté du 20 août, pas du jour de la bascule", () => {
    const e = new PortfolioValuationEngine(avecOuverture);
    expect(serie(e, "2026-08-20").flux).toBeCloseTo(5200, 6);
  });

  /*
    Le jour de la bascule : la valeur en euros baisse de 1 040 € et **aucun
    flux** ne l'accompagne. C'est un effet de change, donc de la performance —
    la seule lecture qui ne prétende ni que l'utilisateur a retiré de l'argent,
    ni que rien n'a changé.
  */
  it("la bascule ne crée aucun flux : ce n'est pas un retrait", () => {
    const e = new PortfolioValuationEngine(avecOuverture);
    const j = serie(e, "2026-09-09");
    expect(j.cash).toBeCloseTo(4160, 6);
    expect(j.flux).toBe(0);
    expect(j.perf).toBeCloseTo(-1040, 6);
  });

  /*
    L'ouverture porte la devise d'alors. Si le chargeur la convertissait avec
    celle du compte *aujourd'hui* — ce qu'il faisait —, ces 5 200 € seraient
    relus comme 5 200 USD, soit 4 160 €, et tout le passé du compte changerait
    de valeur sans qu'aucun fait ne l'explique.
  */
  it("le passé garde sa valeur : il n'est pas reconverti avec la devise du jour", () => {
    const e = new PortfolioValuationEngine(avecOuverture);
    expect(serie(e, "2026-09-01").cash).toBeCloseTo(5200, 6);
    expect(serie(e, "2026-09-01").cash).not.toBeCloseTo(4160, 6);
  });
});
