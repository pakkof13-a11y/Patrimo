/**
 * Ventilation historique du patrimoine par enveloppe fiscale.
 *
 * La question de chaque test : **cette valeur était-elle démontrablement en PEA
 * ou en CTO à cette date ?** Quand la réponse est « on ne sait pas », elle doit
 * rester visible et séparée — jamais fondue dans une enveloppe, jamais réduite
 * à zéro.
 *
 * ## Le piège que ce module existe pour éviter
 *
 * Prendre l'enveloppe actuelle d'un actif et la tartiner sur tout son passé.
 * Une ligne aujourd'hui en CTO, dont le journal ne commence qu'en 2026, n'était
 * pas CTO en 2023 : elle était quelque part, et nous n'en savons rien.
 *
 * ## Fixtures
 *
 * Construites en mémoire. Aucun seed, aucune base, aucun fournisseur.
 */

import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";


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

function buy(id: string, assetId: string, jour: string, qty: number, unit: number): LedgerTx {
  return {
    id,
    type: "ACHAT",
    platformId: "p1",
    toPlatformId: null,
    assetId,
    occurredAt: new Date(`${jour}T10:00:00Z`),
    quantity: d(qty),
    unitPrice: d(unit),
    feesEur: d(0),
    amountEur: d(qty * unit),
    netCashImpactEur: d(-qty * unit),
    fxRateToEur: d(1),
  } as unknown as LedgerTx;
}

function sell(id: string, assetId: string, jour: string, qty: number, unit: number): LedgerTx {
  return {
    id,
    type: "VENTE",
    platformId: "p1",
    toPlatformId: null,
    assetId,
    occurredAt: new Date(`${jour}T10:00:00Z`),
    quantity: d(qty),
    unitPrice: d(unit),
    feesEur: d(0),
    amountEur: d(qty * unit),
    netCashImpactEur: d(qty * unit),
    fxRateToEur: d(1),
  } as unknown as LedgerTx;
}

/** Un événement du journal d'enveloppe. */
function evt(jour: string, accountType: string, compte?: { id: string; envelopeType: string }) {
  return {
    occurredAt: new Date(`${jour}T12:00:00.000Z`),
    accountType,
    securitiesAccountId: compte?.id ?? null,
    envelopeType: compte?.envelopeType ?? null,
  };
}

function closes(spec: Record<string, Record<string, number>>) {
  return new Map(
    Object.entries(spec).map(([id, byDay]) => [id, new Map(Object.entries(byDay))])
  );
}

const at = (s: ReturnType<PortfolioValuationEngine["buildSeries"]>, jour: string) =>
  s.find((p) => p.day === jour)!;

describe("aucune rétroprojection — le cœur du chantier", () => {
  /**
   * Une ligne achetée en 2024, observée en CTO seulement en 2026.
   *
   * C'est la situation réelle du compte de démonstration : le journal ne
   * remonte pas plus loin que sa mise en place, et les transactions, elles,
   * remontent à des années.
   */
  function observeeTard(accountType: string) {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        envelopeEventsByAsset: new Map([["a1", [evt("2026-06-01", accountType)]]]),
        closes: closes({ a1: { "2024-01-10": 100, "2026-06-01": 100 } }),
      })
    ).buildSeries("2024-01-10", "2026-06-05");
  }

  it("un actif CTO observé en 2026 reste inconnu en 2024 et 2025", () => {
    const s = observeeTard("CTO");

    for (const jour of ["2024-06-01", "2025-01-01", "2026-05-31"]) {
      const p = at(s, jour);
      expect(p.byEnvelope.CTO).toBe(0);
      expect(p.byEnvelope.PEA).toBe(0);
      // Mais la valeur ne disparaît pas : elle est comptée comme inconnue.
      expect(p.byEnvelope.UNKNOWN).toBeCloseTo(1_000, 6);
    }
  });

  it("un actif PEA observé en 2026 reste inconnu avant", () => {
    const s = observeeTard("PEA");
    const p = at(s, "2025-06-01");

    expect(p.byEnvelope.PEA).toBe(0);
    expect(p.byEnvelope.UNKNOWN).toBeCloseTo(1_000, 6);
  });

  it("la contribution commence exactement à la date d'observation", () => {
    const s = observeeTard("CTO");

    expect(at(s, "2026-05-31").byEnvelope.CTO).toBe(0);
    expect(at(s, "2026-06-01").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2026-06-01").byEnvelope.UNKNOWN).toBe(0);
  });

  it("l'inconnu n'est jamais transformé en zéro silencieux", () => {
    /*
      Sans le seau `UNKNOWN`, les mille euros de cette ligne disparaîtraient de
      la ventilation : `PEA + CTO` vaudrait zéro et laisserait croire qu'aucun
      titre n'était détenu, alors que la position existait bel et bien.
    */
    const p = at(observeeTard("CTO"), "2025-01-01");
    const somme = p.byEnvelope.PEA + p.byEnvelope.CTO + p.byEnvelope.UNKNOWN;
    expect(somme).toBeCloseTo(1_000, 6);
  });
});

describe("changements d'enveloppe", () => {
  function change(de: string, vers: string) {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        envelopeEventsByAsset: new Map([
          ["a1", [evt("2024-01-10", de), evt("2025-06-15", vers)]],
        ]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2025-06-20");
  }

  it("CTO → PEA coupe CTO et commence PEA à la date exacte", () => {
    const s = change("CTO", "PEA");

    expect(at(s, "2025-06-14").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-14").byEnvelope.PEA).toBe(0);
    expect(at(s, "2025-06-15").byEnvelope.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-15").byEnvelope.CTO).toBe(0);
  });

  it("PEA → CTO fait l'inverse", () => {
    const s = change("PEA", "CTO");

    expect(at(s, "2025-06-14").byEnvelope.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-15").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-15").byEnvelope.PEA).toBe(0);
  });

  it("deux événements insérés à l'envers restent lus selon leur date métier", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        // Le plus récent d'abord — l'ordre du tableau ne doit rien changer.
        envelopeEventsByAsset: new Map([
          ["a1", [evt("2025-06-15", "PEA"), evt("2024-01-10", "CTO")]],
        ]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    );
    const s = e.buildSeries("2024-01-10", "2025-06-20");

    expect(at(s, "2024-06-01").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-20").byEnvelope.PEA).toBeCloseTo(1_000, 6);
  });
});

describe("PEA-PME rejoint PEA", () => {
  it("une ligne en PEA-PME contribue au seau PEA", () => {
    /*
      Trois seaux, pas quatre. C'est la règle de `accountTypeForEnvelope`, que
      ce chantier réutilise plutôt que d'inventer une taxonomie parallèle.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        envelopeEventsByAsset: new Map([
          ["a1", [evt("2024-01-10", "PEA", { id: "c1", envelopeType: "PEA_PME" })]],
        ]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2024-01-12");

    expect(at(s, "2024-01-12").byEnvelope.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-12").byEnvelope.CTO).toBe(0);
  });

  it("le type d'enveloppe survit à la suppression du compte", () => {
    /*
      Le journal copie `envelopeType` dans l'événement précisément pour cela :
      supprimer le compte détache la ligne mais n'efface pas ce qu'elle fut.
      L'événement suivant enregistre le détachement, la famille fiscale
      demeure.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        envelopeEventsByAsset: new Map([
          [
            "a1",
            [
              evt("2024-01-10", "PEA", { id: "c1", envelopeType: "PEA_PME" }),
              // Compte supprimé : détachement, mais toujours en famille PEA.
              evt("2025-01-10", "PEA"),
            ],
          ],
        ]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2025-02-01");

    expect(at(s, "2024-06-01").byEnvelope.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-02-01").byEnvelope.PEA).toBeCloseTo(1_000, 6);
  });
});

describe("composition et périmètre", () => {
  function deuxLignes() {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "pea", "2024-01-10", 10, 100),
          buy("t2", "cto", "2024-01-10", 5, 200),
          // Une crypto, hors du périmètre titres.
          buy("t3", "btc", "2024-01-10", 1, 30_000),
        ],
        rawAssetClassById: new Map([
          ["pea", "ACTIONS"],
          ["cto", "ACTIONS"],
          ["btc", "CRYPTO"],
        ]),
        assetClassById: new Map([
          ["pea", "ACTIONS"],
          ["cto", "ACTIONS"],
          ["btc", "CRYPTO"],
        ]),
        envelopeEventsByAsset: new Map([
          ["pea", [evt("2024-01-10", "PEA")]],
          ["cto", [evt("2024-01-10", "CTO")]],
          // La crypto n'a aucun événement : elle n'est pas un titre.
        ]),
        closes: closes({
          pea: { "2024-01-10": 100 },
          cto: { "2024-01-10": 200 },
          btc: { "2024-01-10": 30_000 },
        }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");
  }

  it("deux lignes sont additionnées dans leurs enveloppes respectives", () => {
    const p = at(deuxLignes(), "2024-01-15");

    expect(p.byEnvelope.PEA).toBeCloseTo(1_000, 6);
    expect(p.byEnvelope.CTO).toBeCloseTo(1_000, 6);
  });

  it("un actif hors périmètre ne pollue aucune enveloppe", () => {
    /*
      La crypto n'a pas d'événement, et surtout aucun événement titres : la
      compter en `UNKNOWN` gonflerait l'inconnu de trente mille euros qui n'ont
      rien à y faire. « On ne sait pas quelle enveloppe » n'est pas « on ne
      sait pas si c'est un titre ».
    */
    const p = at(deuxLignes(), "2024-01-15");
    expect(p.byEnvelope.UNKNOWN).toBe(0);
    const somme = p.byEnvelope.PEA + p.byEnvelope.CTO + p.byEnvelope.UNKNOWN;
    expect(somme).toBeCloseTo(2_000, 6);
    // Le patrimoine, lui, contient bien la crypto.
    expect(p.grossAssets).toBeCloseTo(32_000, 6);
  });

  it("PEA + CTO couvre exactement le sous-ensemble connu", () => {
    const p = at(deuxLignes(), "2024-01-15");
    expect(p.byEnvelope.PEA + p.byEnvelope.CTO).toBeCloseTo(2_000, 6);
  });

  it("une ligne sortie des enveloppes titres cesse de contribuer", () => {
    // Devenue AV : ce n'est plus un titre, et la compter fausserait la courbe.
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        envelopeEventsByAsset: new Map([
          ["a1", [evt("2024-01-10", "CTO"), evt("2025-01-10", "AV")]],
        ]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2025-02-01");

    expect(at(s, "2024-06-01").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    const apres = at(s, "2025-02-01");
    expect(apres.byEnvelope.CTO).toBe(0);
    expect(apres.byEnvelope.UNKNOWN).toBe(0);
  });
});

describe("le périmètre suit les positions réellement détenues", () => {
  it("un actif n'apparaît pas avant son acquisition", () => {
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-03-01", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        // L'événement précède l'achat : la ligne est connue en CTO, mais
        // elle n'est pas encore détenue.
        envelopeEventsByAsset: new Map([["a1", [evt("2024-01-01", "CTO")]]]),
        closes: closes({ a1: { "2024-03-01": 100 } }),
      })
    ).buildSeries("2024-01-01", "2024-03-05");

    expect(at(s, "2024-02-01").byEnvelope.CTO).toBe(0);
    expect(at(s, "2024-03-05").byEnvelope.CTO).toBeCloseTo(1_000, 6);
  });

  it("un actif vendu disparaît de la contribution", () => {
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "a1", "2024-01-10", 10, 100),
          sell("t2", "a1", "2024-06-01", 10, 100),
        ],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        envelopeEventsByAsset: new Map([["a1", [evt("2024-01-10", "CTO")]]]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2024-06-10");

    expect(at(s, "2024-05-31").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-06-10").byEnvelope.CTO).toBe(0);
  });
});

describe("la ventilation ne touche pas le patrimoine", () => {
  it("les totaux sont identiques avec ou sans journal d'enveloppe", () => {
    /*
      La régression à empêcher : que l'ajout d'une ventilation modifie ce
      qu'elle ventile. Deux moteurs, mêmes données, l'un sans aucun événement.
    */
    const base = {
      transactions: [
        buy("t1", "a1", "2024-01-10", 10, 100),
        buy("t2", "a2", "2024-02-10", 5, 200),
      ],
      rawAssetClassById: new Map([
        ["a1", "ACTIONS"],
        ["a2", "ACTIONS"],
      ]),
      assetClassById: new Map([
        ["a1", "ACTIONS"],
        ["a2", "ACTIONS"],
      ]),
      closes: closes({
        a1: { "2024-01-10": 100, "2024-03-01": 120 },
        a2: { "2024-02-10": 200 },
      }),
    };

    const sans = new PortfolioValuationEngine(inputs(base)).buildSeries(
      "2024-01-10",
      "2024-03-05"
    );
    const avec = new PortfolioValuationEngine(
      inputs({
        ...base,
        envelopeEventsByAsset: new Map([
          ["a1", [evt("2024-01-10", "CTO")]],
          ["a2", [evt("2024-02-10", "PEA")]],
        ]),
      })
    ).buildSeries("2024-01-10", "2024-03-05");

    expect(avec.length).toBe(sans.length);
    for (let i = 0; i < sans.length; i++) {
      expect(avec[i]!.grossAssets).toBe(sans[i]!.grossAssets);
      expect(avec[i]!.netWorth).toBe(sans[i]!.netWorth);
      expect(avec[i]!.cash).toBe(sans[i]!.cash);
      expect(avec[i]!.securities).toBe(sans[i]!.securities);
      expect(avec[i]!.externalFlows).toBe(sans[i]!.externalFlows);
      expect(avec[i]!.investmentPerformance).toBe(sans[i]!.investmentPerformance);
      expect(avec[i]!.status).toBe(sans[i]!.status);
      expect(avec[i]!.byAssetClass.ACTIONS).toBe(sans[i]!.byAssetClass.ACTIONS);
    }
  });

  it("sans aucun journal, les trois seaux restent à zéro", () => {
    // Aucune invention : sans événement, aucune ligne n'entre dans la
    // ventilation, pas même en `UNKNOWN`.
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");

    const p = at(s, "2024-01-15");
    expect(p.byEnvelope.PEA).toBe(0);
    expect(p.byEnvelope.CTO).toBe(0);
    expect(p.byEnvelope.UNKNOWN).toBe(0);
    // La valeur reste au patrimoine — seule la ventilation fiscale l'ignore.
    expect(p.grossAssets).toBeCloseTo(1_000, 6);
  });
});
