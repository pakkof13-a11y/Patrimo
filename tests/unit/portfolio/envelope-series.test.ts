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
      expect(p.byEnvelope.CTO).toBeNull();
      expect(p.byEnvelope.PEA).toBeNull();
      // Mais la valeur ne disparaît pas : elle est comptée comme inconnue.
      expect(p.byEnvelope.UNKNOWN).toBeCloseTo(1_000, 6);
    }
  });

  it("un actif PEA observé en 2026 est absent des enveloppes avant", () => {
    const s = observeeTard("PEA");
    const p = at(s, "2025-06-01");

    expect(p.byEnvelope.PEA).toBeNull();
    expect(p.byEnvelope.CTO).toBeNull();
    expect(p.byEnvelope.UNKNOWN).toBeCloseTo(1_000, 6);
  });

  it("la contribution commence exactement à la date d'observation", () => {
    const s = observeeTard("CTO");

    // La veille : rien n'est démontré, donc rien n'est affirmé.
    expect(at(s, "2026-05-31").byEnvelope.CTO).toBeNull();
    expect(at(s, "2026-05-31").byEnvelope.UNKNOWN).toBeCloseTo(1_000, 6);

    /*
      Le jour même : l'enveloppe est établie. `PEA` redevient un zéro **vrai**,
      puisque plus aucune ligne titre n'est en suspens — l'absence ne se
      justifie que tant que l'inconnu subsiste.
    */
    expect(at(s, "2026-06-01").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2026-06-01").byEnvelope.UNKNOWN).toBe(0);
    expect(at(s, "2026-06-01").byEnvelope.PEA).toBe(0);
  });

  it("l'inconnu n'est jamais transformé en zéro silencieux", () => {
    /*
      Sans le seau `UNKNOWN`, les mille euros de cette ligne disparaîtraient de
      la ventilation : `PEA + CTO` vaudrait zéro et laisserait croire qu'aucun
      titre n'était détenu, alors que la position existait bel et bien.
    */
    const p = at(observeeTard("CTO"), "2025-01-01");
    expect(p.byEnvelope.PEA).toBeNull();
    expect(p.byEnvelope.CTO).toBeNull();
    expect(p.byEnvelope.UNKNOWN).toBeCloseTo(1_000, 6);
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

    expect(at(s, "2024-01-10").byEnvelope.CTO).toBeNull();
    expect(at(s, "2024-01-10").byEnvelope.UNKNOWN).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-11").byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-11").byEnvelope.UNKNOWN).toBe(0);
  });

  it("une suite de points inconnus laisse la courbe interrompue, sans trait à zéro", () => {
    /*
      Cas §3 : ce que le graphique doit recevoir, c'est une série trouée. Un
      point à zéro serait tracé et relierait deux dates par un segment qui
      n'existe pas.
    */
    const s = observeeTard("CTO");
    const inconnus = s.filter((p) => p.byEnvelope.CTO === null);
    const connus = s.filter((p) => p.byEnvelope.CTO !== null);

    expect(inconnus.length).toBeGreaterThan(100);
    // Aucun point inconnu ne porte de valeur numérique traçable.
    expect(inconnus.every((p) => p.byEnvelope.CTO == null)).toBe(true);
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
    const somme =
      demontre(p.byEnvelope.PEA) +
      demontre(p.byEnvelope.CTO) +
      demontre(p.byEnvelope.UNKNOWN);
    expect(somme).toBeCloseTo(2_000, 6);
    // Le patrimoine, lui, contient bien la crypto.
    expect(p.grossAssets).toBeCloseTo(32_000, 6);
  });

  it("PEA + CTO couvre exactement le sous-ensemble connu", () => {
    const p = at(deuxLignes(), "2024-01-15");
    expect(demontre(p.byEnvelope.PEA) + demontre(p.byEnvelope.CTO)).toBeCloseTo(
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
    expect(p.byEnvelope.PEA).toBe(0);
    expect(p.byEnvelope.CTO).toBe(0);
    expect(p.byEnvelope.UNKNOWN).toBe(0);
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
    expect(p.byEnvelope.PEA).toBeCloseTo(1_000, 6);
    expect(p.byEnvelope.UNKNOWN).toBeCloseTo(500, 6);
    expect(p.byEnvelope.CTO).toBeNull();
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
    expect(p.byEnvelope.CTO).toBeCloseTo(1_000, 6);
    expect(p.byEnvelope.UNKNOWN).toBeCloseTo(500, 6);
    expect(p.byEnvelope.PEA).toBeNull();
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
    expect(p.byEnvelope.UNKNOWN).toBe(0);
    // Aucun titre en suspens : les deux enveloppes valent un zéro vrai.
    expect(p.byEnvelope.PEA).toBe(0);
    expect(p.byEnvelope.CTO).toBe(0);
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
    expect(p.byEnvelope.UNKNOWN).toBe(0);
    expect(p.byEnvelope.PEA).toBe(0);
    expect(p.byEnvelope.CTO).toBe(0);
    expect(p.grossAssets).toBeCloseTo(1_000, 6);
  });
});
