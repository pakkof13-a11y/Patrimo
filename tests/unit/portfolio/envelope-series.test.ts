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

/**
 * Valeur démontrée d'une enveloppe.
 *
 * `null` veut dire « rien ne le démontre » : l'additionner n'aurait pas de
 * sens, et le convertir en zéro reproduirait le défaut que ce fichier garde.
 * On échoue donc plutôt que de deviner.
 */
function demontre(v: number | null): number {
  expect(v).not.toBeNull();
  return v as number;
}

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

  it("un actif CTO observé en 2026 est absent des enveloppes en 2024 et 2025", () => {
    /*
      `null`, et non `0`.

      Ces assertions exigeaient auparavant zéro, et entérinaient donc le défaut
      qu'elles prétendaient garder : une courbe posée à zéro sur toute la
      profondeur antérieure au journal affirme « aucun titre en CTO », là où la
      vérité est « on ne sait pas ». L'absence est la seule réponse honnête.
    */
    const s = observeeTard("CTO");

    for (const jour of ["2024-06-01", "2025-01-01", "2026-05-31"]) {
      const p = at(s, jour);
      expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
      expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeNull();
      // Mais la valeur ne disparaît pas : elle est comptée comme inconnue.
      expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(1_000, 6);
    }
  });

  it("un actif PEA observé en 2026 est absent des enveloppes avant", () => {
    const s = observeeTard("PEA");
    const p = at(s, "2025-06-01");

    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeNull();
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(1_000, 6);
  });

  it("la contribution commence exactement à la date d'observation", () => {
    const s = observeeTard("CTO");

    // La veille : rien n'est démontré, donc rien n'est affirmé.
    expect(at(s, "2026-05-31").byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
    expect(at(s, "2026-05-31").byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(1_000, 6);

    /*
      Le jour même : l'enveloppe est établie. `PEA` redevient un zéro **vrai**,
      puisque plus aucune ligne titre n'est en suspens — l'absence ne se
      justifie que tant que l'inconnu subsiste.
    */
    expect(at(s, "2026-06-01").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2026-06-01").byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
    expect(at(s, "2026-06-01").byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
  });

  it("l'inconnu n'est jamais transformé en zéro silencieux", () => {
    /*
      Sans le seau `UNKNOWN`, les mille euros de cette ligne disparaîtraient de
      la ventilation : `PEA + CTO` vaudrait zéro et laisserait croire qu'aucun
      titre n'était détenu, alors que la position existait bel et bien.
    */
    const p = at(observeeTard("CTO"), "2025-01-01");
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeNull();
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(1_000, 6);
  });

  it("un seul point inconnu suffit à effacer l'affirmation", () => {
    /*
      Cas §2 du chantier : l'inconnu ne dure qu'une journée. Le défaut n'en est
      pas moins présent — un zéro isolé au milieu d'une courbe se lit comme un
      creux réel, ce qui est pire qu'un trou.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        envelopeEventsByAsset: new Map([["a1", [evt("2024-01-11", "CTO")]]]),
        closes: closes({ a1: { "2024-01-10": 100, "2024-01-11": 100 } }),
      })
    ).buildSeries("2024-01-10", "2024-01-12");

    expect(at(s, "2024-01-10").byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
    expect(at(s, "2024-01-10").byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-11").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-11").byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
  });

  it("une suite de points inconnus laisse la courbe interrompue, sans trait à zéro", () => {
    /*
      Cas §3 : ce que le graphique doit recevoir, c'est une série trouée. Un
      point à zéro serait tracé et relierait deux dates par un segment qui
      n'existe pas.
    */
    const s = observeeTard("CTO");
    const inconnus = s.filter((p) => p.byAssetClassAndEnvelope.ACTIONS.CTO === null);
    const connus = s.filter((p) => p.byAssetClassAndEnvelope.ACTIONS.CTO !== null);

    expect(inconnus.length).toBeGreaterThan(100);
    // Aucun point inconnu ne porte de valeur numérique traçable.
    expect(inconnus.every((p) => p.byAssetClassAndEnvelope.ACTIONS.CTO == null)).toBe(true);
    // Et tous les points connus sont postérieurs au premier constat.
    expect(connus.every((p) => p.day >= "2026-06-01")).toBe(true);
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

    expect(at(s, "2025-06-14").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-14").byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
    expect(at(s, "2025-06-15").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-15").byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
  });

  it("PEA → CTO fait l'inverse", () => {
    const s = change("PEA", "CTO");

    expect(at(s, "2025-06-14").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-15").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-15").byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
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

    expect(at(s, "2024-06-01").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-06-20").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
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

    expect(at(s, "2024-01-12").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-12").byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
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

    expect(at(s, "2024-06-01").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2025-02-01").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
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

    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
  });

  it("un actif hors périmètre ne pollue aucune enveloppe", () => {
    /*
      La crypto n'a pas d'événement, et surtout aucun événement titres : la
      compter en `UNKNOWN` gonflerait l'inconnu de trente mille euros qui n'ont
      rien à y faire. « On ne sait pas quelle enveloppe » n'est pas « on ne
      sait pas si c'est un titre ».
    */
    const p = at(deuxLignes(), "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
    const somme =
      demontre(p.byAssetClassAndEnvelope.ACTIONS.PEA) +
      demontre(p.byAssetClassAndEnvelope.ACTIONS.CTO) +
      demontre(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN);
    expect(somme).toBeCloseTo(2_000, 6);
    // Le patrimoine, lui, contient bien la crypto.
    expect(p.grossAssets).toBeCloseTo(32_000, 6);
  });

  it("PEA + CTO couvre exactement le sous-ensemble connu", () => {
    const p = at(deuxLignes(), "2024-01-15");
    expect(demontre(p.byAssetClassAndEnvelope.ACTIONS.PEA) + demontre(p.byAssetClassAndEnvelope.ACTIONS.CTO)).toBeCloseTo(
      2_000,
      6
    );
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

    expect(at(s, "2024-06-01").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    const apres = at(s, "2025-02-01");
    expect(apres.byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
    expect(apres.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
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

    expect(at(s, "2024-02-01").byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
    expect(at(s, "2024-03-05").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
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

    expect(at(s, "2024-05-31").byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-06-10").byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
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

  it("une ligne jamais journalisée reste hors de la ventilation — limite connue", () => {
    /*
      Limite assumée, épinglée ici pour qu'elle ne dérive pas en silence.

      Sans le moindre événement, rien ne démontre qu'une ligne soit candidate au
      PEA ou au CTO, et elle n'entre donc pas dans la ventilation. Élargir le
      critère au compartiment titres a été essayé : il fait entrer une ligne CFD
      de 54 648 € du compte de démonstration, qui porte bien la classe `ACTIONS`
      mais n'est candidate à aucune de ces deux enveloppes. Rien, dans le moteur,
      ne la distingue d'une ligne héritée sans journal.

      Le zéro qui subsiste ici n'est donc pas corrigé par ce chantier. Il ne
      concerne que les portefeuilles dont aucune ligne n'a jamais été
      journalisée — le seed et les cinq portes d'écriture en posent un depuis.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ACTIONS"]]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");

    const p = at(s, "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
    // La valeur reste au patrimoine — seule la ventilation fiscale l'ignore.
    expect(p.grossAssets).toBeCloseTo(1_000, 6);
  });

  it("une enveloppe démontrée reste visible à côté d'un inconnu — PEA", () => {
    /*
      Cas §6 : deux lignes titres, l'une journalisée en PEA, l'autre pas.

      Taire le PEA parce qu'une autre ligne est inconnue perdrait la seule
      partie que le journal établit. Le montant démontré s'affiche donc, et
      l'inconnu reste identifiable à côté. `CTO`, lui, n'a rien qui le démontre
      et reste absent : la ligne inconnue pourrait s'y trouver.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "a1", "2024-01-10", 10, 100),
          buy("t2", "a2", "2024-01-10", 5, 100),
        ],
        rawAssetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "ACTIONS"],
        ]),
        assetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "ACTIONS"],
        ]),
        envelopeEventsByAsset: new Map([
          ["a1", [evt("2024-01-10", "PEA")]],
          // Journalisée, donc candidate — mais seulement observée en 2025 :
          // au 15 janvier 2024 son enveloppe n'est pas démontrée.
          ["a2", [evt("2025-01-01", "CTO")]],
        ]),
        closes: closes({
          a1: { "2024-01-10": 100 },
          a2: { "2024-01-10": 100 },
        }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");

    const p = at(s, "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(500, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
  });

  it("une enveloppe démontrée reste visible à côté d'un inconnu — CTO", () => {
    // Cas §7, symétrique du précédent.
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "a1", "2024-01-10", 10, 100),
          buy("t2", "a2", "2024-01-10", 5, 100),
        ],
        rawAssetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "ACTIONS"],
        ]),
        assetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "ACTIONS"],
        ]),
        envelopeEventsByAsset: new Map([
          ["a1", [evt("2024-01-10", "CTO")]],
          // Journalisée, donc candidate — mais seulement observée en 2025 :
          // au 15 janvier 2024 son enveloppe n'est pas démontrée.
          ["a2", [evt("2025-01-01", "PEA")]],
        ]),
        closes: closes({
          a1: { "2024-01-10": 100 },
          a2: { "2024-01-10": 100 },
        }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");

    const p = at(s, "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(500, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeNull();
  });

  it("crypto, immobilier et cash n'entrent jamais dans l'inconnu", () => {
    /*
      Cas §9. Le critère d'appartenance a changé — la classe d'actif plutôt que
      le journal — et ce test vérifie qu'il n'a pas pour autant élargi le seau.

      Aucune de ces trois lignes n'a d'événement : sous l'ancien critère elles
      étaient exclues faute de journal, sous le nouveau elles le sont parce
      qu'aucune n'appartient au compartiment titres.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "a1", "2024-01-10", 1, 30_000),
          buy("t2", "a2", "2024-01-10", 1, 200_000),
        ],
        rawAssetClassById: new Map([
          ["a1", "CRYPTO"],
          ["a2", "IMMOBILIER"],
        ]),
        assetClassById: new Map([
          ["a1", "CRYPTO"],
          ["a2", "IMMOBILIER"],
        ]),
        closes: closes({
          a1: { "2024-01-10": 30_000 },
          a2: { "2024-01-10": 200_000 },
        }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");

    const p = at(s, "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
    // Aucun titre en suspens : les deux enveloppes valent un zéro vrai.
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
    // Et le patrimoine, lui, les contient bien.
    expect(p.grossAssets).toBeCloseTo(230_000, 6);
  });

  it("un support d'assurance-vie n'entre pas dans l'inconnu", () => {
    /*
      Le piège du nouveau critère, et la raison de viser le compartiment plutôt
      que la classe brute : un ETF logé en assurance-vie porte bien la classe
      `ACTIONS`, mais la surcharge le range en `ASSURANCE_VIE`. Ce n'est pas un
      candidat PEA/CTO, et le compter en inconnu gonflerait le seau d'un montant
      qui n'a rien à y faire.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "a1", "2024-01-10", 10, 100)],
        // Classe brute : ACTIONS. Classe surchargée : ASSURANCE_VIE.
        rawAssetClassById: new Map([["a1", "ACTIONS"]]),
        assetClassById: new Map([["a1", "ASSURANCE_VIE"]]),
        closes: closes({ a1: { "2024-01-10": 100 } }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");

    const p = at(s, "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBe(0);
    expect(p.grossAssets).toBeCloseTo(1_000, 6);
  });
});

/**
 * Croisement classe × enveloppe.
 *
 * La question n'est plus « où sont mes titres » mais « où sont mes actions ».
 * Ce qui change tient en un point : une obligation en compte-titres ne doit
 * plus grossir la courbe « Actions en CTO », alors que la ventilation globale
 * les additionnait.
 */
describe("croisement classe × enveloppe", () => {
  /**
   * Deux actions et une obligation, toutes trois en compte-titres, plus une
   * action en PEA. De quoi vérifier qu'aucune ne déborde sur la case voisine.
   */
  function melange() {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "actPea", "2024-01-10", 10, 100), // 1 000 € actions PEA
          buy("t2", "actCto", "2024-01-10", 5, 100), //    500 € actions CTO
          buy("t3", "obliCto", "2024-01-10", 3, 100), //   300 € obligations CTO
        ],
        rawAssetClassById: new Map([
          ["actPea", "ACTIONS"],
          ["actCto", "ACTIONS"],
          ["obliCto", "OBLIGATIONS"],
        ]),
        assetClassById: new Map([
          ["actPea", "ACTIONS"],
          ["actCto", "ACTIONS"],
          ["obliCto", "OBLIGATIONS"],
        ]),
        envelopeEventsByAsset: new Map([
          ["actPea", [evt("2024-01-10", "PEA")]],
          ["actCto", [evt("2024-01-10", "CTO")]],
          ["obliCto", [evt("2024-01-10", "CTO")]],
        ]),
        closes: closes({
          actPea: { "2024-01-10": 100 },
          actCto: { "2024-01-10": 100 },
          obliCto: { "2024-01-10": 100 },
        }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");
  }

  it("Actions + PEA ne retient que les actions du PEA", () => {
    const p = at(melange(), "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
  });

  it("Actions + CTO ne retient que les actions du CTO, pas les obligations", () => {
    /*
      Le cœur du chantier. La ventilation globale rendait 800 € ici — 500 €
      d'actions plus 300 € d'obligations, toutes deux en compte-titres. Le
      croisement sépare les deux.
    */
    const p = at(melange(), "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(500, 6);
    expect(p.byAssetClassAndEnvelope.OBLIGATIONS.CTO).toBeCloseTo(300, 6);
  });

  it("Obligations + CTO porte la valeur des obligations concernées", () => {
    const p = at(melange(), "2024-01-15");
    expect(p.byAssetClassAndEnvelope.OBLIGATIONS.CTO).toBeCloseTo(300, 6);
    // Aucune obligation en PEA dans ce décor : un zéro vrai, pas une absence.
    expect(p.byAssetClassAndEnvelope.OBLIGATIONS.PEA).toBe(0);
    expect(p.byAssetClassAndEnvelope.OBLIGATIONS.UNKNOWN).toBe(0);
  });

  it("Actions + Tout égale la somme des enveloppes connues de la classe", () => {
    const p = at(melange(), "2024-01-15");
    const c = p.byAssetClassAndEnvelope.ACTIONS;
    const somme = demontre(c.PEA) + demontre(c.CTO) + demontre(c.UNKNOWN);
    expect(somme).toBeCloseTo(1_500, 6);
    // Et cette somme est bien la classe entière, ici sans ligne hors périmètre.
    expect(somme).toBeCloseTo(p.byAssetClass.ACTIONS, 6);
  });

  it("aucun actif n'est compté deux fois, et le total global ne bouge pas", () => {
    const p = at(melange(), "2024-01-15");
    const c = p.byAssetClassAndEnvelope;
    const croise =
      demontre(c.ACTIONS.PEA) +
      demontre(c.ACTIONS.CTO) +
      demontre(c.ACTIONS.UNKNOWN) +
      demontre(c.OBLIGATIONS.PEA) +
      demontre(c.OBLIGATIONS.CTO) +
      demontre(c.OBLIGATIONS.UNKNOWN);
    expect(croise).toBeCloseTo(1_800, 6);
    expect(p.grossAssets).toBeCloseTo(1_800, 6);
  });

  it("aucune classe hors périmètre ne reçoit de case d'enveloppe", () => {
    /*
      Le type l'interdit déjà, et l'objet rendu doit le confirmer : croiser
      « Crypto » et « PEA » ne doit pas même être exprimable dans la réponse.
    */
    const p = at(melange(), "2024-01-15");
    expect(Object.keys(p.byAssetClassAndEnvelope).sort()).toEqual([
      "ACTIONS",
      "OBLIGATIONS",
    ]);
  });

  it("l'inconnu d'une classe ne rend pas l'autre absente", () => {
    /*
      Les deux classes sont indépendantes. Une action dont l'enveloppe n'est pas
      démontrée ne doit pas effacer ce que l'on sait des obligations.
    */
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "actInc", "2024-01-10", 10, 100),
          buy("t2", "obliCto", "2024-01-10", 3, 100),
        ],
        rawAssetClassById: new Map([
          ["actInc", "ACTIONS"],
          ["obliCto", "OBLIGATIONS"],
        ]),
        assetClassById: new Map([
          ["actInc", "ACTIONS"],
          ["obliCto", "OBLIGATIONS"],
        ]),
        envelopeEventsByAsset: new Map([
          // Action journalisée, mais observée seulement en 2025.
          ["actInc", [evt("2025-01-01", "PEA")]],
          ["obliCto", [evt("2024-01-10", "CTO")]],
        ]),
        closes: closes({
          actInc: { "2024-01-10": 100 },
          obliCto: { "2024-01-10": 100 },
        }),
      })
    ).buildSeries("2024-01-10", "2024-01-15");

    const p = at(s, "2024-01-15");
    // Actions : rien n'est démontré, l'inconnu porte la valeur.
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeNull();
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(1_000, 6);
    // Obligations : parfaitement connues, et intactes.
    expect(p.byAssetClassAndEnvelope.OBLIGATIONS.CTO).toBeCloseTo(300, 6);
    expect(p.byAssetClassAndEnvelope.OBLIGATIONS.PEA).toBe(0);
  });
});

describe("le croisement suit les changements d'enveloppe dans le temps", () => {
  /**
   * Scénario du §15 : deux actions qui échangent leurs enveloppes.
   *
   * Date 1 — A en PEA, B en CTO.
   * Date 2 — A passe en CTO, B y reste : tout est en CTO.
   * Date 3 — B passe en PEA, A reste en CTO : les rôles sont inversés.
   *
   * Tester le seul état final laisserait passer une série qui ne bouge jamais.
   */
  function chasseCroisee() {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "A", "2024-01-01", 10, 100), // 1 000 €
          buy("t2", "B", "2024-01-01", 2, 100), //    200 €
        ],
        rawAssetClassById: new Map([
          ["A", "ACTIONS"],
          ["B", "ACTIONS"],
        ]),
        assetClassById: new Map([
          ["A", "ACTIONS"],
          ["B", "ACTIONS"],
        ]),
        envelopeEventsByAsset: new Map([
          ["A", [evt("2024-01-01", "PEA"), evt("2024-02-01", "CTO")]],
          ["B", [evt("2024-01-01", "CTO"), evt("2024-03-01", "PEA")]],
        ]),
        closes: closes({
          A: { "2024-01-01": 100 },
          B: { "2024-01-01": 100 },
        }),
      })
    ).buildSeries("2024-01-01", "2024-03-05");
  }

  it("date 1 — A en PEA, B en CTO", () => {
    const p = at(chasseCroisee(), "2024-01-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(200, 6);
  });

  it("date 2 — A rejoint B en CTO, le PEA se vide pour de vrai", () => {
    const p = at(chasseCroisee(), "2024-02-15");
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_200, 6);
    // Zéro **vrai** : plus aucune action en suspens, le PEA est bien vide.
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBe(0);
  });

  it("date 3 — les rôles sont inversés", () => {
    const p = at(chasseCroisee(), "2024-03-05");
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(200, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeCloseTo(1_000, 6);
  });

  it("les bascules tombent au jour exact, pas la veille ni le lendemain", () => {
    const s = chasseCroisee();
    // A quitte le PEA le 1er février.
    expect(at(s, "2024-01-31").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-02-01").byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
    // B rejoint le PEA le 1er mars.
    expect(at(s, "2024-02-29").byAssetClassAndEnvelope.ACTIONS.PEA).toBe(0);
    expect(at(s, "2024-03-01").byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(200, 6);
  });

  it("le total de la classe ne bouge pas au fil des bascules", () => {
    // Les actions changent d'enveloppe, pas de valeur.
    for (const jour of ["2024-01-15", "2024-02-15", "2024-03-05"]) {
      expect(at(chasseCroisee(), jour).byAssetClass.ACTIONS).toBeCloseTo(1_200, 6);
    }
  });
});
