/**
 * Ventilation du patrimoine par classe d'actif.
 *
 * La question à laquelle chaque test répond est celle du chantier : **quels
 * actifs appartenaient à cette classe à cette date, et que valaient-ils ?**
 *
 * ## Pourquoi une seconde ventilation
 *
 * Le moteur en produisait déjà une, par *compartiment* : elle fusionne actions
 * et obligations en `securities` et isole l'assurance-vie. C'est ce qu'il faut
 * pour décrire ce que le patrimoine **contient**. Elle ne décrit pas ce que
 * l'utilisateur **voit** — une UC actions logée dans un contrat reste une
 * action à ses yeux.
 *
 * Les deux ventilations partitionnent le même brut. Ce ne sont pas deux
 * calculs : les mêmes lignes, aux mêmes quantités, valorisées par le même
 * résolveur, regroupées deux fois.
 *
 * ## Pourquoi `assetClass` et rien d'autre
 *
 * `Asset.assetClass` n'a **aucun chemin de mise à jour** — il est fixé à la
 * création. `category` et `accountType` sont mutables sans journal : les
 * utiliser ferait qu'un changement d'aujourd'hui réécrirait tout le passé.
 *
 * ## Nature des données
 *
 * Fixtures construites en mémoire dans ce fichier. Aucun seed, aucune donnée
 * réelle, aucun fournisseur contacté.
 */

import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import { VALUATION_ASSET_CLASSES } from "@/app/lib/portfolio/historical/types";
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
    occurredAt: new Date(`${day}T10:00:00Z`),
    quantity: d(qty),
    unitPrice: d(unit),
    feesEur: d(0),
    amountEur: d(qty * unit),
    netCashImpactEur: d(-qty * unit),
    fxRateToEur: d(1),
  } as unknown as LedgerTx;
}

function sell(
  id: string,
  assetId: string,
  day: string,
  qty: number,
  unit: number
): LedgerTx {
  return {
    id,
    type: "VENTE",
    platformId: "p1",
    toPlatformId: null,
    assetId,
    occurredAt: new Date(`${day}T10:00:00Z`),
    // Le moteur porte le sens dans `type` : une vente déclare une quantité
    // positive, comme un achat. Un signe négatif serait compté deux fois.
    quantity: d(qty),
    unitPrice: d(unit),
    feesEur: d(0),
    amountEur: d(qty * unit),
    netCashImpactEur: d(qty * unit),
    fxRateToEur: d(1),
  } as unknown as LedgerTx;
}

/** Index de clôtures : `{ actif: { jour: cours } }`. */
function closes(spec: Record<string, Record<string, number>>) {
  return new Map(
    Object.entries(spec).map(([id, byDay]) => [id, new Map(Object.entries(byDay))])
  );
}

const at = (series: ReturnType<PortfolioValuationEngine["buildSeries"]>, day: string) =>
  series.find((p) => p.day === day)!;

describe("§18 — le test critique : Crypto est la poche, pas Bitcoin", () => {
  /**
   * La série exacte du chantier.
   *
   * BTC monte puis baisse, ETH monte, SOL apparaît puis disparaît. Aucune de
   * ces trois trajectoires n'est celle de la poche : c'est bien la somme qui
   * est demandée.
   */
  function poche() {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "btc", "2024-01-01", 1, 10_000),
          buy("t2", "eth", "2024-01-01", 1, 5_000),
          buy("t3", "sol", "2024-02-01", 1, 4_000),
          sell("t4", "sol", "2024-03-01", 1, 4_000),
        ],
        rawAssetClassById: new Map([
          ["btc", "CRYPTO"],
          ["eth", "CRYPTO"],
          ["sol", "CRYPTO"],
        ]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([
          ["btc", "CRYPTO"],
          ["eth", "CRYPTO"],
          ["sol", "CRYPTO"],
        ]),
        closes: closes({
          btc: { "2024-01-01": 10_000, "2024-02-01": 8_000, "2024-03-01": 7_500 },
          eth: { "2024-01-01": 5_000, "2024-02-01": 6_000, "2024-03-01": 5_500 },
          sol: { "2024-02-01": 4_000, "2024-03-01": 4_000 },
        }),
      })
    ).buildSeries("2024-01-01", "2024-03-01");
  }

  it("15 000 → 18 000 → 13 000, exactement", () => {
    const s = poche();

    expect(at(s, "2024-01-01").byAssetClass.CRYPTO).toBeCloseTo(15_000, 6);
    expect(at(s, "2024-02-01").byAssetClass.CRYPTO).toBeCloseTo(18_000, 6);
    expect(at(s, "2024-03-01").byAssetClass.CRYPTO).toBeCloseTo(13_000, 6);
  });

  it("ce n'est pas la série de Bitcoin", () => {
    // BTC : 10 000 → 8 000 → 7 500. Une baisse continue, là où la poche monte
    // d'abord. Un proxy Bitcoin aurait donné exactement l'inverse au 1er mois.
    const s = poche();
    const btcSeul = [10_000, 8_000, 7_500];
    const poches = [
      at(s, "2024-01-01").byAssetClass.CRYPTO,
      at(s, "2024-02-01").byAssetClass.CRYPTO,
      at(s, "2024-03-01").byAssetClass.CRYPTO,
    ];

    expect(poches).not.toEqual(btcSeul);
    // La poche monte entre janvier et février ; Bitcoin baisse.
    expect(poches[1]!).toBeGreaterThan(poches[0]!);
    expect(btcSeul[1]!).toBeLessThan(btcSeul[0]!);
  });

  it("ce n'est pas la composition finale réappliquée au passé", () => {
    /*
      Au dernier point, la poche ne contient plus que BTC et ETH. Si la
      composition finale était projetée en arrière, février vaudrait
      8 000 + 6 000 = 14 000 au lieu de 18 000 : SOL disparaîtrait d'un mois où
      il était réellement détenu.
    */
    expect(at(poche(), "2024-02-01").byAssetClass.CRYPTO).not.toBeCloseTo(14_000, 6);
  });

  it("SOL n'existe pas avant son achat", () => {
    // Janvier ne connaît que BTC et ETH : 15 000, pas 19 000.
    expect(at(poche(), "2024-01-15").byAssetClass.CRYPTO).toBeCloseTo(15_000, 6);
  });
});

describe("classes séparées et périmètre daté", () => {
  it("ACTIONS et OBLIGATIONS ne sont plus confondues", () => {
    /*
      Le compartiment `securities` les fusionne — c'est son rôle. La
      ventilation par classe doit les distinguer, sans quoi la taxonomie
      demandée n'existerait pas.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "act", "2024-01-01", 10, 100),
          buy("t2", "obl", "2024-01-01", 5, 200),
        ],
        rawAssetClassById: new Map([
          ["act", "ACTIONS"],
          ["obl", "OBLIGATIONS"],
        ]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([
          ["act", "ACTIONS"],
          ["obl", "OBLIGATIONS"],
        ]),
        closes: closes({
          act: { "2024-01-01": 100 },
          obl: { "2024-01-01": 200 },
        }),
      })
    );
    const p = at(e.buildSeries("2024-01-01", "2024-01-01"), "2024-01-01");

    expect(p.byAssetClass.ACTIONS).toBeCloseTo(1_000, 6);
    expect(p.byAssetClass.OBLIGATIONS).toBeCloseTo(1_000, 6);
    // Le compartiment, lui, additionne les deux — les deux vues coexistent.
    expect(p.securities).toBeCloseTo(2_000, 6);
  });

  it("une classe sans actif vaut zéro, et zéro est une réponse exacte", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "act", "2024-01-01", 10, 100)],
        rawAssetClassById: new Map([["act", "ACTIONS"]]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([["act", "ACTIONS"]]),
        closes: closes({ act: { "2024-01-01": 100 } }),
      })
    );
    const p = at(e.buildSeries("2024-01-01", "2024-01-01"), "2024-01-01");

    // Ne rien détenir en crypto est une information, pas une absence.
    expect(p.byAssetClass.CRYPTO).toBe(0);
    expect(p.byAssetClass.IMMOBILIER).toBe(0);
  });

  it("un actif exclu du patrimoine ne contribue à aucune classe", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "btc", "2024-01-01", 1, 10_000),
          buy("t2", "nft", "2024-01-01", 1, 5_000),
        ],
        rawAssetClassById: new Map([
          ["btc", "CRYPTO"],
          ["nft", "CRYPTO"],
        ]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([
          ["btc", "CRYPTO"],
          ["nft", "CRYPTO"],
        ]),
        excludedAssetIds: new Set(["nft"]),
        closes: closes({
          btc: { "2024-01-01": 10_000 },
          nft: { "2024-01-01": 5_000 },
        }),
      })
    );
    const p = at(e.buildSeries("2024-01-01", "2024-01-01"), "2024-01-01");

    expect(p.byAssetClass.CRYPTO).toBeCloseTo(10_000, 6);
  });

  it("une classe inconnue rejoint AUTRE plutôt que de disparaître", () => {
    /*
      La colonne est une chaîne libre : une valeur héritée ne doit pas
      s'évaporer de la ventilation, sinon la partition cesserait d'être vraie
      sans que rien ne le signale.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "x", "2024-01-01", 1, 700)],
        rawAssetClassById: new Map([["x", "CLASSE_HERITEE"]]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([["x", "CLASSE_HERITEE"]]),
        closes: closes({ x: { "2024-01-01": 700 } }),
      })
    );
    const p = at(e.buildSeries("2024-01-01", "2024-01-01"), "2024-01-01");

    expect(p.byAssetClass.AUTRE).toBeCloseTo(700, 6);
  });
});

describe("§13 — la partition, vérifiée au centime", () => {
  it("la somme des classes égale la valeur brute, à chaque point", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "act", "2024-01-01", 10, 100),
          buy("t2", "obl", "2024-01-02", 5, 200),
          buy("t3", "btc", "2024-01-03", 1, 10_000),
          buy("t4", "imm", "2024-01-04", 1, 250_000),
          sell("t5", "act", "2024-01-08", 4, 110),
        ],
        rawAssetClassById: new Map([
          ["act", "ACTIONS"],
          ["obl", "OBLIGATIONS"],
          ["btc", "CRYPTO"],
          ["imm", "IMMOBILIER"],
        ]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([
          ["act", "ACTIONS"],
          ["obl", "OBLIGATIONS"],
          ["btc", "CRYPTO"],
          ["imm", "IMMOBILIER"],
        ]),
        closes: closes({
          act: { "2024-01-01": 100, "2024-01-08": 110 },
          obl: { "2024-01-02": 200 },
          btc: { "2024-01-03": 10_000, "2024-01-06": 12_000 },
          imm: { "2024-01-04": 250_000 },
        }),
      })
    );

    const series = e.buildSeries("2024-01-01", "2024-01-10");
    expect(series.length).toBe(10);

    for (const p of series) {
      const somme = VALUATION_ASSET_CLASSES.reduce(
        (acc, c) => acc + p.byAssetClass[c],
        0
      );
      // Au centime : la partition est une identité, pas une approximation.
      expect(somme).toBeCloseTo(p.grossAssets, 6);
    }
  });

  it("les deux ventilations décrivent le même brut", () => {
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "act", "2024-01-01", 10, 100),
          buy("t2", "btc", "2024-01-01", 1, 10_000),
        ],
        rawAssetClassById: new Map([
          ["act", "ACTIONS"],
          ["btc", "CRYPTO"],
        ]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([
          ["act", "ACTIONS"],
          ["btc", "CRYPTO"],
        ]),
        closes: closes({
          act: { "2024-01-01": 100 },
          btc: { "2024-01-01": 10_000 },
        }),
      })
    );
    const p = at(e.buildSeries("2024-01-01", "2024-01-01"), "2024-01-01");

    const parClasse = VALUATION_ASSET_CLASSES.reduce(
      (acc, c) => acc + p.byAssetClass[c],
      0
    );
    const parCompartiment =
      p.securities +
      p.crypto +
      p.realEstate +
      p.lifeInsurance +
      p.cash +
      p.alternatives +
      p.employeeSavings +
      p.otherAssets;

    expect(parClasse).toBeCloseTo(parCompartiment, 6);
    expect(parClasse).toBeCloseTo(p.grossAssets, 6);
  });
});

describe("§19 — un apport n'est pas une performance", () => {
  it("la valeur monte, la performance d'investissement reste nulle", () => {
    /*
      Achat de 5 000 € de crypto le second jour, à cours inchangé. La poche
      passe de 10 000 à 15 000 — mais rien n'a été gagné.

      Le moteur produit `externalFlows` et `investmentPerformance` au niveau
      **global**, pas par classe. C'est exactement pour cela qu'aucune
      performance par classe n'est publiée : le chiffre existe pour le
      portefeuille, pas pour la poche.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "btc", "2024-01-01", 1, 10_000),
          buy("t2", "btc", "2024-01-02", 0.5, 10_000),
        ],
        rawAssetClassById: new Map([["btc", "CRYPTO"]]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([["btc", "CRYPTO"]]),
        closes: closes({ btc: { "2024-01-01": 10_000, "2024-01-02": 10_000 } }),
      })
    );
    const s = e.buildSeries("2024-01-01", "2024-01-02");

    expect(at(s, "2024-01-01").byAssetClass.CRYPTO).toBeCloseTo(10_000, 6);
    expect(at(s, "2024-01-02").byAssetClass.CRYPTO).toBeCloseTo(15_000, 6);

    // +50 % en valeur, 0 € de performance : c'est la distinction que la courbe
    // ne doit jamais effacer.
    expect(at(s, "2024-01-02").investmentPerformance).toBeCloseTo(0, 6);
  });
});

describe("§10 — le statut n'est pas dilué par la ventilation", () => {
  it("un compartiment estimé rend tout le point estimé, ventilation comprise", () => {
    /*
      Le statut est porté par le **point**, pas par la classe : les deux
      ventilations décrivent le même instant et partagent donc la même
      incertitude. Une classe ne peut pas se déclarer exacte dans un point qui
      ne l'est pas — c'est l'exigence du §10, et elle est satisfaite par
      construction plutôt que par un second calcul.

      Un compte de trésorerie sans aucun événement : son solde est connu, son
      histoire ne l'est pas.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "act", "2024-01-01", 10, 100)],
        rawAssetClassById: new Map([["act", "ACTIONS"]]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([["act", "ACTIONS"]]),
        closes: closes({ act: { "2024-01-01": 100 } }),
        cashAccounts: [
          { id: "b1", balanceEur: d(10_000), createdAt: new Date("2024-01-01T10:00:00Z") },
        ],
      })
    );
    const p = e.calculateAt("2024-06-01");

    expect(p.status).toBe("ESTIMATED");
    expect(p.estimatedComponents).toContain("cash");
    // La partition tient malgré l'incertitude : elle n'est pas amputée.
    const somme = VALUATION_ASSET_CLASSES.reduce((a, c) => a + p.byAssetClass[c], 0);
    expect(somme).toBeCloseTo(p.grossAssets, 6);
  });

  it("une clôture reportée reste exacte sur un point quotidien", () => {
    /*
      Convention du moteur, antérieure à ce chantier et délibérée : une clôture
      quotidienne **est** la valeur exacte d'une journée. Sur un point de
      14 h 37 elle ne décrirait pas l'instant demandé et vaudrait report ; sur
      un point quotidien, elle est l'observation.

      La ventilation par classe hérite de cette convention sans la modifier.
      La valeur reportée reste identique à l'observation — jamais interpolée.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "act", "2024-01-01", 10, 100)],
        rawAssetClassById: new Map([["act", "ACTIONS"]]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([["act", "ACTIONS"]]),
        closes: closes({ act: { "2024-01-01": 100 } }),
      })
    );
    const s = e.buildSeries("2024-01-01", "2024-01-03");

    expect(at(s, "2024-01-03").byAssetClass.ACTIONS).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-03").status).toBe("EXACT");
  });
});

describe("§8 et §16 — l'absence de ventilation n'est pas une classe vide", () => {
  /**
   * Le panneau isole une classe en réécrivant le total **avant** l'agrégation,
   * comme le fait déjà « patrimoine net ». Ce test couvre la règle de tri qui
   * accompagne cette réécriture.
   *
   * La distinction est celle du chantier : un point dont la ventilation est
   * inconnue doit sortir de la série, jamais valoir zéro. Zéro dirait « cette
   * classe ne valait rien ce jour-là » — une affirmation, là où la réponse
   * juste est « on ne sait pas ».
   */
  function isoler(
    history: Array<{ byAssetClassBase?: Record<string, number> }>,
    classe: string
  ) {
    const out: number[] = [];
    for (const p of history) {
      const v = p.byAssetClassBase?.[classe];
      if (v == null) continue;
      out.push(v);
    }
    return out;
  }

  it("un point sans ventilation est retiré, pas ramené à zéro", () => {
    const serie = isoler(
      [
        { byAssetClassBase: { CRYPTO: 10_000 } },
        {}, // ventilation absente — source antérieure au chantier
        { byAssetClassBase: { CRYPTO: 12_000 } },
      ],
      "CRYPTO"
    );

    expect(serie).toEqual([10_000, 12_000]);
    expect(serie).not.toContain(0);
  });

  it("une classe réellement vide garde ses zéros", () => {
    // Zéro publié par le moteur est une mesure : ne rien détenir se trace.
    expect(
      isoler(
        [
          { byAssetClassBase: { CRYPTO: 0, ACTIONS: 1_000 } },
          { byAssetClassBase: { CRYPTO: 0, ACTIONS: 1_100 } },
        ],
        "CRYPTO"
      )
    ).toEqual([0, 0]);
  });

  it("aucune donnée sur la période : aucune série, pas une ligne plate", () => {
    expect(isoler([{}, {}], "CRYPTO")).toEqual([]);
  });
});

describe("§1 — un actif exclu ne fabrique pas de contre-performance", () => {
  /**
   * Le défaut : `ledgerFlowToday` sommait **toutes** les transactions, sans
   * écarter celles portant un actif exclu du patrimoine — alors que la
   * valorisation, elle, les écarte.
   *
   * Acheter 5 000 € d'un NFT marqué « ignoré » ajoutait donc un flux de
   * +5 000 € sans ajouter la moindre valeur. La performance du jour, définie
   * comme `Δvaleur − flux`, plongeait de 5 000 € sans qu'aucun marché n'ait
   * bougé.
   */
  function avecExclu() {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "act", "2024-01-01", 10, 100),
          // Achat d'un actif hors patrimoine, le lendemain.
          buy("t2", "nft", "2024-01-02", 1, 5_000),
        ],
        rawAssetClassById: new Map([
          ["act", "ACTIONS"],
          ["nft", "CRYPTO"],
        ]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([
          ["act", "ACTIONS"],
          ["nft", "CRYPTO"],
        ]),
        excludedAssetIds: new Set(["nft"]),
        closes: closes({
          act: { "2024-01-01": 100, "2024-01-02": 100 },
          nft: { "2024-01-02": 5_000 },
        }),
      })
    ).buildSeries("2024-01-01", "2024-01-02");
  }

  it("l'achat d'un actif exclu ne compte pour aucun flux", () => {
    expect(at(avecExclu(), "2024-01-02").externalFlows).toBeCloseTo(0, 6);
  });

  it("et ne produit donc aucune performance artificielle", () => {
    /*
      Rien n'a bougé : le cours de l'action est inchangé, l'actif exclu ne
      compte pas. La performance du jour doit être nulle, et non −5 000 €.
    */
    expect(at(avecExclu(), "2024-01-02").investmentPerformance).toBeCloseTo(0, 6);
  });

  it("la valeur reste celle des seuls actifs du patrimoine", () => {
    const s = avecExclu();
    expect(at(s, "2024-01-02").grossAssets).toBeCloseTo(1_000, 6);
    expect(at(s, "2024-01-02").byAssetClass.CRYPTO).toBeCloseTo(0, 6);
  });

  it("un actif non exclu garde exactement son flux", () => {
    // Le témoin : la correction ne doit rien changer au cas normal.
    const s = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "act", "2024-01-01", 10, 100),
          buy("t2", "act", "2024-01-02", 5, 100),
        ],
        rawAssetClassById: new Map([["act", "ACTIONS"]]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([["act", "ACTIONS"]]),
        closes: closes({ act: { "2024-01-01": 100, "2024-01-02": 100 } }),
      })
    ).buildSeries("2024-01-01", "2024-01-02");

    expect(at(s, "2024-01-02").externalFlows).toBeCloseTo(500, 6);
    expect(at(s, "2024-01-02").investmentPerformance).toBeCloseTo(0, 6);
  });
});

describe("§8 — flux et performance par classe, le scénario Crypto", () => {
  /**
   * Le scénario du chantier, à trois temps.
   *
   * t1 : BTC 10 000 + ETH 5 000                → 15 000, aucun flux antérieur
   * t2 : achat de 5 000 € de crypto            → 20 000, flux +5 000, perf 0
   * t3 : le marché monte de 1 000 €            → 21 000, flux 0, perf +1 000
   *
   * Le piège serait d'annoncer +6 000 € de performance à t3 en comptant
   * l'apport comme un gain.
   */
  function scenario() {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "btc", "2024-01-01", 1, 10_000),
          buy("t2", "eth", "2024-01-01", 1, 5_000),
          // t2 : un apport de 5 000 € investi en ETH.
          buy("t3", "eth", "2024-01-02", 1, 5_000),
        ],
        rawAssetClassById: new Map([
          ["btc", "CRYPTO"],
          ["eth", "CRYPTO"],
        ]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([
          ["btc", "CRYPTO"],
          ["eth", "CRYPTO"],
        ]),
        closes: closes({
          btc: {
            "2024-01-01": 10_000,
            "2024-01-02": 10_000,
            "2024-01-03": 11_000, // t3 : +1 000 € de marché
          },
          eth: { "2024-01-01": 5_000, "2024-01-02": 5_000, "2024-01-03": 5_000 },
        }),
      })
    ).buildSeries("2024-01-01", "2024-01-03");
  }

  it("t2 : la valeur monte de 5 000 €, la performance reste nulle", () => {
    const p = at(scenario(), "2024-01-02");

    expect(p.byAssetClass.CRYPTO).toBeCloseTo(20_000, 6);
    expect(p.flowsByAssetClass.CRYPTO).toBeCloseTo(5_000, 6);
    expect(p.performanceByAssetClass!.CRYPTO).toBeCloseTo(0, 6);
  });

  it("t3 : +1 000 € de marché, et surtout pas +6 000 €", () => {
    const p = at(scenario(), "2024-01-03");

    expect(p.byAssetClass.CRYPTO).toBeCloseTo(21_000, 6);
    expect(p.flowsByAssetClass.CRYPTO).toBeCloseTo(0, 6);
    expect(p.performanceByAssetClass!.CRYPTO).toBeCloseTo(1_000, 6);
    // L'erreur que ce chantier existe pour empêcher.
    expect(p.performanceByAssetClass!.CRYPTO).not.toBeCloseTo(6_000, 6);
  });

  it("le premier point n'a pas de performance : rien à comparer", () => {
    // Publier 0 laisserait croire à une classe stable, alors que la veille
    // n'existe pas.
    expect(at(scenario(), "2024-01-01").performanceByAssetClass).toBeNull();
  });
});

describe("§13 — chaque nature de flux à sa place", () => {
  /** Une opération sans actif : apport, retrait, transfert de trésorerie. */
  function cashTx(id: string, type: string, day: string, montant: number): LedgerTx {
    return {
      id,
      type,
      platformId: "p1",
      toPlatformId: type === "TRANSFERT_CASH" ? "p2" : null,
      assetId: null,
      occurredAt: new Date(`${day}T10:00:00Z`),
      quantity: null,
      unitPrice: null,
      feesEur: d(0),
      amountEur: d(montant),
      netCashImpactEur: d(montant),
      cashAmountOriginal: d(montant),
      fxRateToEur: d(1),
    } as unknown as LedgerTx;
  }

  /** Un revenu encaissé : dividende, coupon, loyer. */
  function revenu(id: string, type: string, assetId: string, day: string, montant: number): LedgerTx {
    return {
      id,
      type,
      platformId: "p1",
      toPlatformId: null,
      assetId,
      occurredAt: new Date(`${day}T10:00:00Z`),
      quantity: null,
      unitPrice: null,
      feesEur: d(0),
      amountEur: d(montant),
      netCashImpactEur: d(montant),
      fxRateToEur: d(1),
    } as unknown as LedgerTx;
  }

  function avec(txs: LedgerTx[]) {
    return new PortfolioValuationEngine(
      inputs({
        transactions: [buy("b0", "act", "2024-01-01", 10, 100), ...txs],
        rawAssetClassById: new Map([["act", "ACTIONS"]]),
    envelopeEventsByAsset: new Map(),
        assetClassById: new Map([["act", "ACTIONS"]]),
        closes: closes({
          act: { "2024-01-01": 100, "2024-01-02": 100 },
        }),
      })
    ).buildSeries("2024-01-01", "2024-01-02");
  }

  it("un achat entre dans la classe de son actif", () => {
    const p = at(avec([buy("t1", "act", "2024-01-02", 5, 100)]), "2024-01-02");
    expect(p.flowsByAssetClass.ACTIONS).toBeCloseTo(500, 6);
    expect(p.performanceByAssetClass!.ACTIONS).toBeCloseTo(0, 6);
  });

  it("une vente en sort, du même montant", () => {
    const p = at(avec([sell("t1", "act", "2024-01-02", 4, 100)]), "2024-01-02");
    expect(p.flowsByAssetClass.ACTIONS).toBeCloseTo(-400, 6);
    expect(p.performanceByAssetClass!.ACTIONS).toBeCloseTo(0, 6);
  });

  it.each(["APPORT", "RETRAIT", "TRANSFERT_CASH"])(
    "%s n'est attribué à aucune classe",
    (type) => {
      /*
        Ces opérations ne touchent que le cash du journal, hors périmètre du
        moteur : elles valent zéro flux. Leur inventer une classe serait une
        décision métier que la donnée ne porte pas.
      */
      const p = at(avec([cashTx("t1", type, "2024-01-02", 10_000)]), "2024-01-02");

      for (const c of VALUATION_ASSET_CLASSES) {
        expect(p.flowsByAssetClass[c]).toBeCloseTo(0, 6);
      }
      expect(p.externalFlows).toBeCloseTo(0, 6);
    }
  );

  it.each([
    ["DIVIDENDE", "dividende"],
    ["COUPON", "coupon"],
    ["LOYER", "loyer"],
  ])("un %s reste hors de la performance", (type) => {
    /*
      Convention du moteur, inchangée par ce chantier : les revenus encaissés
      atterrissent dans le cash du journal, hors périmètre. Ils ne sont ni un
      flux, ni de la performance mesurable ici.

      Conséquence à assumer : une action versant 5 % de dividende n'affiche que
      sa variation de cours.
    */
    const p = at(avec([revenu("t1", type, "act", "2024-01-02", 300)]), "2024-01-02");

    expect(p.flowsByAssetClass.ACTIONS).toBeCloseTo(0, 6);
    expect(p.performanceByAssetClass!.ACTIONS).toBeCloseTo(0, 6);
  });

  it("les trois identités tiennent sur toute une série", () => {
    const s = avec([
      buy("t1", "act", "2024-01-02", 5, 100),
      cashTx("t2", "APPORT", "2024-01-02", 9_000),
      revenu("t3", "DIVIDENDE", "act", "2024-01-02", 42),
    ]);
    const somme = (r: Record<string, number>) =>
      VALUATION_ASSET_CLASSES.reduce((a, c) => a + r[c]!, 0);

    for (const p of s) {
      expect(somme(p.byAssetClass)).toBeCloseTo(p.grossAssets, 6);
      expect(somme(p.flowsByAssetClass)).toBeCloseTo(p.externalFlows, 6);
      if (p.performanceByAssetClass) {
        expect(somme(p.performanceByAssetClass)).toBeCloseTo(
          p.investmentPerformance,
          6
        );
      }
    }
  });
});
