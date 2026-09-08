import { describe, expect, it } from "vitest";
import {
  buildAccountView,
  cashAttributionNotice,
  computeAllocation,
  computeKeyIndicators,
  computeTotals,
  positionWeightPct,
  splitByEnvelope,
  type SecuritiesAccount,
  type SecuritiesPosition,
} from "@/app/lib/securities/overview";

function account(p: Partial<SecuritiesAccount> & { id: string }): SecuritiesAccount {
  return {
    envelopeType: "PEA",
    envelopeLabel: "PEA",
    platformId: "pf",
    platformName: "BoursoBank",
    platformLogoUrl: null,
    openDate: "2018-03-12T00:00:00.000Z",
    positionCount: 0,
    marketValueEur: "0",
    costBasisEur: "0",
    unrealizedPnlEur: "0",
    unrealizedPnlPct: null,
    cashEur: "0",
    cashAttribution: "ATTRIBUTED",
    liquidationValueEur: "0",
    contributionsEur: "0",
    withdrawalsEur: "0",
    gainEur: "0",
    maturity: null,
    room: null,
    taxStatusLabel: null,
    ...p,
  };
}

function position(
  p: Partial<SecuritiesPosition> & { assetId: string }
): SecuritiesPosition {
  return {
    securitiesAccountId: "a1",
    accountType: "PEA",
    name: "Actif",
    ticker: null,
    category: "EQUITY",
    costBasisEur: "100",
    marketValueEur: "100",
    unrealizedPnlEur: "0",
    unrealizedPnlPct: null,
    ...p,
  };
}

describe("computeTotals", () => {
  it("ajoute les liquidités à la valeur des titres", () => {
    const t = computeTotals(
      [
        account({ id: "a1", cashEur: "200" }),
        account({ id: "a2", cashEur: "50" }),
      ],
      [
        position({ assetId: "p1", marketValueEur: "1000" }),
        position({ assetId: "p2", marketValueEur: "500" }),
      ],
      {}
    );
    expect(t.positionsValueEur).toBe(1500);
    expect(t.cashEur).toBe(250);
    expect(t.totalValueEur).toBe(1750);
    expect(t.accountCount).toBe(2);
  });

  it("rapporte le P&L au capital engagé", () => {
    const t = computeTotals(
      [account({ id: "a1" })],
      [
        position({
          assetId: "p1",
          costBasisEur: "1000",
          marketValueEur: "1250",
          unrealizedPnlEur: "250",
        }),
      ],
      {}
    );
    expect(t.unrealizedPnlPct).toBeCloseTo(25, 6);
  });

  it("ne divise pas par zéro sur un compte vide", () => {
    const t = computeTotals([account({ id: "a1" })], [], {});
    expect(t.unrealizedPnlPct).toBeNull();
    expect(t.totalValueEur).toBe(0);
  });

  /*
    Le périmètre : toutes les lignes titres, rattachées ou non.

    Les totaux ne sommaient que les lignes rattachées à un compte déclaré,
    quand le camembert et les indicateurs partaient de toutes. D'où des parts
    au-delà de 100 %, et surtout du capital invisible pendant toute la saisie.
  */
  it("compte les lignes non rattachées, et le dit", () => {
    const t = computeTotals(
      [account({ id: "a1", envelopeType: "PEA" })],
      [
        position({ assetId: "p1", securitiesAccountId: "a1", marketValueEur: "10000" }),
        position({
          assetId: "p2",
          securitiesAccountId: null,
          accountType: "CTO",
          marketValueEur: "10000",
        }),
      ],
      {}
    );
    expect(t.positionsValueEur).toBe(20_000);
    expect(t.positionCount).toBe(2);
    expect(t.positionsWithoutAccountCount).toBe(1);
  });

  /*
    La mesure de référence : deux comptes-titres et une poche CTO de 5 000 €.

    `attributeCash` ne sait pas dire lequel des deux la détient, donc aucun ne
    la porte. Elle entrait alors nulle part — ni au total, ni dans un bandeau,
    dont le garde ne pouvait pas s'allumer : il exigeait un montant non nul
    sur un compte où le service venait justement de mettre zéro.
  */
  it("ajoute une fois la poche d'enveloppe que personne ne porte", () => {
    const t = computeTotals(
      [
        account({
          id: "a1",
          envelopeType: "CTO",
          cashEur: "0",
          cashAttribution: "ENVELOPE_LEVEL",
        }),
        account({
          id: "a2",
          envelopeType: "CTO",
          cashEur: "0",
          cashAttribution: "ENVELOPE_LEVEL",
        }),
      ],
      [position({ assetId: "p1", marketValueEur: "1000" })],
      { CTO: "5000" }
    );
    expect(t.cashEur).toBe(5000);
    expect(t.totalValueEur).toBe(6000);
    expect(t.unattributedCashEur).toBe(5000);
    expect(t.hasUnattributedCash).toBe(true);
  });

  it("ne compte pas la poche une fois par compte", () => {
    // Distribuer une grandeur d'enveloppe à N comptes la compterait N fois :
    // c'est la raison pour laquelle elle n'est pas imputée d'office.
    const t = computeTotals(
      [
        account({ id: "a1", envelopeType: "CTO" }),
        account({ id: "a2", envelopeType: "CTO" }),
        account({ id: "a3", envelopeType: "CTO" }),
      ],
      [],
      { CTO: "5000" }
    );
    expect(t.cashEur).toBe(5000);
  });

  /*
    Le découvert d'enveloppe : mesure de référence du chantier.

    Deux CTO et une poche de −1 200 €. Le service la jetait (`lte(0)`) alors
    qu'avec un seul compte elle entrait dans son `cashEur` : le même
    découvert déplaçait le total de la page de 1 200 € selon le nombre de
    comptes déclarés.
  */
  it("compte une poche négative, et l'annonce", () => {
    const t = computeTotals(
      [
        account({
          id: "a1",
          envelopeType: "CTO",
          cashEur: "0",
          cashAttribution: "ENVELOPE_LEVEL",
        }),
        account({
          id: "a2",
          envelopeType: "CTO",
          cashEur: "0",
          cashAttribution: "ENVELOPE_LEVEL",
        }),
      ],
      [],
      { CTO: "-1200" }
    );
    expect(t.cashEur).toBe(-1200);
    expect(t.totalValueEur).toBe(-1200);
    expect(t.hasUnattributedCash).toBe(true);
  });

  /*
    Le bandeau se décide poche par poche, jamais sur leur somme.

    +5 000 € sur le CTO et −5 000 € sur le PEA somment à zéro : deux montants
    bien réels sont entrés dans le total sans appartenir à aucun compte, et
    un garde posé sur `unattributedCashEur > 0` les aurait tous deux tus.
  */
  it("s'allume sur deux poches opposées dont la somme est nulle", () => {
    const t = computeTotals(
      [account({ id: "a1", envelopeType: "CTO", cashEur: "0" })],
      [],
      { CTO: "5000", PEA: "-5000" }
    );
    expect(t.unattributedCashEur).toBe(0);
    expect(t.hasUnattributedCash).toBe(true);
  });

  it("n'allume rien quand toute la poche est imputée", () => {
    const t = computeTotals(
      [account({ id: "a1", cashEur: "300", cashAttribution: "ATTRIBUTED" })],
      [],
      {}
    );
    expect(t.cashEur).toBe(300);
    expect(t.hasUnattributedCash).toBe(false);
  });
});

describe("splitByEnvelope", () => {
  it("regroupe par type et calcule les parts", () => {
    const accounts = [
      account({ id: "a1", envelopeType: "PEA", cashEur: "50" }),
      account({ id: "a2", envelopeType: "CTO", envelopeLabel: "Compte-Titres" }),
    ];
    const positions = [
      position({ assetId: "p1", securitiesAccountId: "a1", marketValueEur: "700" }),
      position({ assetId: "p2", securitiesAccountId: "a2", marketValueEur: "250" }),
    ];
    const split = splitByEnvelope(
      accounts,
      positions,
      {},
      computeTotals(accounts, positions, {})
    );
    expect(split.map((s) => s.envelopeType)).toEqual(["PEA", "CTO"]);
    expect(split[0]!.valueEur).toBe(750);
    expect(split[0]!.sharePct).toBeCloseTo(75, 6);
    expect(split[1]!.sharePct).toBeCloseTo(25, 6);
  });

  it("agrège plusieurs comptes de la même enveloppe", () => {
    const accounts = [
      account({ id: "a1", envelopeType: "PEA" }),
      account({ id: "a2", envelopeType: "PEA" }),
    ];
    const positions = [
      position({ assetId: "p1", securitiesAccountId: "a1", marketValueEur: "100" }),
      position({ assetId: "p2", securitiesAccountId: "a2", marketValueEur: "300" }),
    ];
    const split = splitByEnvelope(
      accounts,
      positions,
      {},
      computeTotals(accounts, positions, {})
    );
    expect(split).toHaveLength(1);
    expect(split[0]!.accountCount).toBe(2);
    expect(split[0]!.valueEur).toBe(400);
  });

  it("place toujours le PEA en tête", () => {
    const accounts = [
      account({ id: "a1", envelopeType: "CTO", envelopeLabel: "Compte-Titres" }),
      account({ id: "a2", envelopeType: "PEA" }),
    ];
    const split = splitByEnvelope(accounts, [], {}, computeTotals(accounts, [], {}));
    expect(split[0]!.envelopeType).toBe("PEA");
  });
});

describe("buildAccountView", () => {
  it("titre = établissement, sous-titre = enveloppe", () => {
    const v = buildAccountView(
      account({ id: "a1", platformName: "Interactive Brokers", envelopeLabel: "Compte-Titres" }),
      []
    );
    expect(v.title).toBe("Interactive Brokers");
    expect(v.subtitle).toBe("Compte-Titres");
  });

  it("retombe sur l'enveloppe si la plateforme n'a pas de nom", () => {
    const v = buildAccountView(
      account({ id: "a1", platformName: "", envelopeLabel: "PEA" }),
      []
    );
    expect(v.title).toBe("PEA");
  });

  it("sur un PEA, le disponible vient du plafond et non du cash", () => {
    const v = buildAccountView(
      account({
        id: "a1",
        cashEur: "5000",
        room: {
          ownCapEur: "150000",
          contributionsEur: "148750",
          combinedContributionsEur: "148750",
          remainingEur: "1250",
          overCapEur: "0",
          usedPct: "99.17",
          isOverCap: false,
          bindingCap: "OWN",
        },
      }),
      []
    );
    // 5 000 € en caisse mais seulement 1 250 € versables : c'est le plafond
    // qui contraint, et l'écran doit montrer la contrainte réelle.
    expect(v.investableEur).toBe(1250);
    expect(v.investableLabel).toBe("Disponible à investir");
    expect(v.investableIsCapped).toBe(true);
  });

  it("sur un compte-titres, le pouvoir d'achat est la trésorerie", () => {
    const v = buildAccountView(
      account({ id: "a1", envelopeType: "CTO", cashEur: "1280.20", room: null }),
      []
    );
    expect(v.investableEur).toBeCloseTo(1280.2, 2);
    expect(v.investableLabel).toBe("Pouvoir d'achat");
    expect(v.investableIsCapped).toBe(false);
  });

  it("ne propose jamais un disponible négatif sur un plafond dépassé", () => {
    const v = buildAccountView(
      account({
        id: "a1",
        room: {
          ownCapEur: "150000",
          contributionsEur: "152000",
          combinedContributionsEur: "152000",
          remainingEur: "-2000",
          overCapEur: "2000",
          usedPct: "101.33",
          isOverCap: true,
          bindingCap: "OWN",
        },
      }),
      []
    );
    expect(v.investableEur).toBe(0);
  });

  it("retient les plus grosses lignes du compte, et elles seules", () => {
    const v = buildAccountView(
      account({ id: "a1" }),
      [
        position({ assetId: "p1", marketValueEur: "100" }),
        position({ assetId: "p2", marketValueEur: "900" }),
        position({ assetId: "p3", marketValueEur: "500" }),
        position({ assetId: "px", securitiesAccountId: "autre", marketValueEur: "9999" }),
      ],
      { topCount: 2 }
    );
    expect(v.positions.map((p) => p.assetId)).toEqual(["p2", "p3"]);
  });

  it("calcule la part des liquidités dans la valeur du compte", () => {
    const v = buildAccountView(
      account({ id: "a1", marketValueEur: "9000", cashEur: "1000" }),
      []
    );
    expect(v.cashSharePct).toBeCloseTo(10, 6);
  });
});

describe("positionWeightPct", () => {
  it("rapporte la ligne aux titres, pas au compte liquidités comprises", () => {
    const a = account({ id: "a1", marketValueEur: "1000", cashEur: "1000" });
    const w = positionWeightPct(position({ assetId: "p", marketValueEur: "250" }), a);
    // 25 % des titres, et non 12,5 % du compte : les poids des lignes
    // doivent totaliser 100 %.
    expect(w).toBeCloseTo(25, 6);
  });

  it("renvoie null quand le compte ne détient aucun titre", () => {
    expect(
      positionWeightPct(position({ assetId: "p" }), account({ id: "a1" }))
    ).toBeNull();
  });
});

describe("computeAllocation", () => {
  const label = (c: string) => c;

  it("agrège par catégorie, inclut les liquidités et trie par valeur", () => {
    const positions = [
      position({ assetId: "p1", category: "EQUITY", marketValueEur: "500" }),
      position({ assetId: "p2", category: "ETF", marketValueEur: "200" }),
      position({ assetId: "p3", category: "EQUITY", marketValueEur: "100" }),
    ];
    const totals = computeTotals(
      [account({ id: "a1", cashEur: "150" })],
      positions,
      {}
    );
    const slices = computeAllocation(positions, totals, label);
    // EQUITY 600, ETF 200, CASH 150 — deux lignes de même catégorie fusionnent.
    expect(slices.map((s) => s.key)).toEqual(["EQUITY", "ETF", "CASH"]);
    expect(slices[0]!.valueEur).toBe(600);
    expect(slices.reduce((a, s) => a + s.sharePct, 0)).toBeCloseTo(100, 6);
  });

  it("omet les liquidités nulles", () => {
    const positions = [position({ assetId: "p1", marketValueEur: "100" })];
    const totals = computeTotals([account({ id: "a1" })], positions, {});
    const slices = computeAllocation(positions, totals, label);
    expect(slices.some((s) => s.key === "CASH")).toBe(false);
  });

  it("ne renvoie rien plutôt qu'un camembert vide", () => {
    const totals = computeTotals([], [], {});
    expect(computeAllocation([], totals, label)).toEqual([]);
  });
});

describe("computeKeyIndicators", () => {
  it("mesure l'exposition actions sur la valeur totale, liquidités comprises", () => {
    const positions = [
      position({ assetId: "p1", category: "EQUITY", marketValueEur: "600" }),
      position({ assetId: "p2", category: "BOND", marketValueEur: "200" }),
    ];
    const totals = computeTotals(
      [account({ id: "a1", cashEur: "200" })],
      positions,
      {}
    );
    const k = computeKeyIndicators(positions, totals);
    // 600 / 1 000 : la poche de cash dilue bien l'exposition.
    expect(k.equityExposurePct).toBeCloseTo(60, 6);
  });

  it("compte les lignes et le poids moyen", () => {
    const positions = [
      position({ assetId: "p1", marketValueEur: "100" }),
      position({ assetId: "p2", marketValueEur: "100" }),
      position({ assetId: "p3", marketValueEur: "100" }),
      position({ assetId: "p4", marketValueEur: "100" }),
    ];
    const totals = computeTotals([account({ id: "a1" })], positions, {});
    const k = computeKeyIndicators(positions, totals);
    expect(k.positionCount).toBe(4);
    expect(k.averageWeightPct).toBeCloseTo(25, 6);
  });

  it("expose la plus grosse ligne, que la moyenne masque", () => {
    const positions = [
      position({ assetId: "p1", name: "Gros", marketValueEur: "700" }),
      position({ assetId: "p2", name: "Petit", marketValueEur: "300" }),
    ];
    const totals = computeTotals([account({ id: "a1" })], positions, {});
    const k = computeKeyIndicators(positions, totals);
    expect(k.largestPositionName).toBe("Gros");
    expect(k.largestPositionPct).toBeCloseTo(70, 6);
  });

  it("reste défini sur un portefeuille vide", () => {
    const k = computeKeyIndicators([], computeTotals([], [], {}));
    expect(k.positionCount).toBe(0);
    expect(k.averageWeightPct).toBeNull();
    expect(k.equityExposurePct).toBeNull();
    expect(k.largestPositionPct).toBeNull();
  });
});

describe("cashAttributionNotice", () => {
  it("ne dit rien quand il y a un montant à afficher", () => {
    expect(cashAttributionNotice("ATTRIBUTED")).toBeNull();
  });

  /*
    Les deux mentions doivent rester distinctes.

    Elles n'en faisaient qu'une — « non ventilées » — et cette phrase, servie
    au PEA-PME, accusait d'un échec de ventilation un compte dont l'enveloppe
    n'a aucune poche à ventiler. Un seul texte pour deux situations, c'était
    en dire une fausse à chaque fois qu'on disait l'autre.
  */
  it("distingue « partagée entre comptes » de « pas de poche du tout »", () => {
    const partagee = cashAttributionNotice("ENVELOPE_LEVEL")!;
    const nonSuivie = cashAttributionNotice("NOT_TRACKED")!;
    expect(partagee.short).not.toBe(nonSuivie.short);
    expect(partagee.title).not.toBe(nonSuivie.title);
  });

  it("ne parle pas de ventilation là où il n'y a rien à ventiler", () => {
    const nonSuivie = cashAttributionNotice("NOT_TRACKED")!;
    expect(nonSuivie.short).not.toMatch(/ventil/i);
    expect(nonSuivie.title).not.toMatch(/ventil/i);
    // Inconnu, pas nul : le texte doit le dire, c'est toute la nuance.
    expect(nonSuivie.title).toMatch(/inconnu/i);
  });
});
