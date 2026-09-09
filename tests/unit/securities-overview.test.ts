import { describe, expect, it } from "vitest";
import {
  allocationBaseEur,
  allocationNotice,
  buildAccountView,
  cashAttributionNotice,
  computeAllocation,
  computeKeyIndicators,
  computeTotals,
  isOverviewEmpty,
  positionWeightPct,
  splitByEnvelope,
  unattributedPockets,
  type SecuritiesAccount,
  type SecuritiesPosition,
} from "@/app/lib/securities/overview";
import { securitiesEnvelopeLabel } from "@/app/lib/securities/constants";

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

/* ── D37 ① — l'aperçu ne se tait que s'il n'a rien ──────────────── */

describe("isOverviewEmpty", () => {
  it("se tait quand il n'y a ni compte, ni ligne, ni poche", () => {
    expect(isOverviewEmpty([], [], computeTotals([], [], {}))).toBe(true);
  });

  /*
    Le cas d'arrivée : trois lignes CTO saisies, aucun compte déclaré.

    La page monte l'aperçu en premier et ne déplie la gestion des comptes que
    sur demande : un état vide ici, et ces lignes n'étaient visibles nulle
    part sur l'écran d'arrivée.
  */
  it("montre l'aperçu sur des lignes que ne porte aucun compte déclaré", () => {
    const positions = [
      position({ assetId: "p1", securitiesAccountId: null, accountType: "CTO", marketValueEur: "1000" }),
      position({ assetId: "p2", securitiesAccountId: null, accountType: "CTO", marketValueEur: "2000" }),
      position({ assetId: "p3", securitiesAccountId: null, accountType: "CTO", marketValueEur: "3000" }),
    ];
    const totals = computeTotals([], positions, {});
    expect(isOverviewEmpty([], positions, totals)).toBe(false);
    // Et le total qu'il affichera n'est pas vide non plus.
    expect(totals.totalValueEur).toBe(6000);
  });

  it("montre l'aperçu sur une poche d'enveloppe sans aucun compte", () => {
    const totals = computeTotals([], [], { CTO: "5000" });
    expect(isOverviewEmpty([], [], totals)).toBe(false);
  });

  /*
    Une poche à zéro n'allume pas le drapeau et ne suffit pas à sortir de
    l'état vide : il n'y a rien à montrer, et une carte vide vaut mieux
    qu'un écran qui prétend porter quelque chose.
  */
  it("reste muet sur une poche déclarée à zéro", () => {
    expect(isOverviewEmpty([], [], computeTotals([], [], { CTO: "0" }))).toBe(true);
  });
});

/* ── D37 ② — le bandeau nomme chaque poche ──────────────────────── */

describe("unattributedPockets", () => {
  /*
    La mesure du chantier : +5 000 € d'un côté, −5 000 € de l'autre.

    La somme algébrique vaut zéro et le bandeau annonçait « 0,00 € » tout en
    affirmant que ce montant comptait dans le total. Deux lignes, deux
    montants, et 10 000 € qui cessent d'être invisibles.
  */
  it("rend une ligne par poche, deux poches opposées comprises", () => {
    const poches = unattributedPockets(
      { CTO: "5000", PEA: "-5000" },
      securitiesEnvelopeLabel
    );
    // Triées sur le libellé : « Compte-titres » avant « PEA ».
    expect(poches.map((p) => [p.label, p.montantEur])).toEqual([
      ["Compte-titres", 5000],
      ["PEA", -5000],
    ]);
    // Et la somme, elle, ne dit rien : c'est bien pour ça qu'on ne l'affiche plus.
    expect(computeTotals([], [], { CTO: "5000", PEA: "-5000" }).unattributedCashEur).toBe(0);
  });

  it("nomme l'enveloppe plutôt que son code", () => {
    const poches = unattributedPockets({ PEA_PME: "300" }, securitiesEnvelopeLabel);
    expect(poches[0]!.label).toBe("PEA-PME");
    expect(poches[0]!.envelope).toBe("PEA_PME");
  });

  it("écarte les poches sans montant, comme le drapeau", () => {
    expect(unattributedPockets({ CTO: "0" }, securitiesEnvelopeLabel)).toEqual([]);
    expect(computeTotals([], [], { CTO: "0" }).hasUnattributedCash).toBe(false);
  });

  it("trie sur le libellé, pas sur le code", () => {
    const poches = unattributedPockets(
      { PEA_PME: "1", CTO: "2", PEA: "3" },
      securitiesEnvelopeLabel
    );
    expect(poches.map((p) => p.label)).toEqual(["Compte-titres", "PEA", "PEA-PME"]);
  });
});

/* ── D37 ③ — ce qui dépend d'une poche inconnue n'est pas zéro ──── */

describe("buildAccountView — trésorerie inconnue", () => {
  /*
    Hors `ATTRIBUTED`, `cashEur` vaut « 0 » côté service sans que personne ne
    l'ait relevé. Trois grandeurs en dépendaient et l'affichaient comme un
    fait : les liquidités, la valeur du compte, le pouvoir d'achat.
  */
  it("ne rend ni liquidités, ni valeur, ni pouvoir d'achat quand la poche n'est pas suivie", () => {
    const v = buildAccountView(
      account({
        id: "a1",
        envelopeType: "CTO",
        marketValueEur: "20000",
        cashEur: "0",
        cashAttribution: "NOT_TRACKED",
        room: null,
      }),
      []
    );
    expect(v.cashEur).toBeNull();
    expect(v.valueEur).toBeNull();
    expect(v.investableEur).toBeNull();
    expect(v.cashSharePct).toBeNull();
    // Les titres, eux, sont connus : la carte garde de quoi être utile.
    expect(v.positionsValueEur).toBe(20000);
  });

  it("en dit autant d'une poche tenue au niveau de l'enveloppe", () => {
    const v = buildAccountView(
      account({ id: "a1", envelopeType: "CTO", cashAttribution: "ENVELOPE_LEVEL", room: null }),
      []
    );
    expect(v.cashEur).toBeNull();
    expect(v.investableEur).toBeNull();
  });

  /*
    Le pivot est l'attribution, jamais le montant : une poche relevée à zéro
    est un fait, et un fait s'affiche.
  */
  it("affiche bien un zéro relevé", () => {
    const v = buildAccountView(
      account({ id: "a1", envelopeType: "CTO", marketValueEur: "1000", cashEur: "0", cashAttribution: "ATTRIBUTED", room: null }),
      []
    );
    expect(v.cashEur).toBe(0);
    expect(v.valueEur).toBe(1000);
    expect(v.investableEur).toBe(0);
  });

  /*
    Le plafond d'un PEA ne dépend pas de la poche : il reste connu, et le
    disponible avec lui.
  */
  it("garde le disponible d'un PEA plafonné, poche inconnue ou non", () => {
    const v = buildAccountView(
      account({
        id: "a1",
        cashAttribution: "NOT_TRACKED",
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
    expect(v.investableEur).toBe(1250);
    expect(v.cashEur).toBeNull();
  });
});

/* ── D37 ⑥ — l'anneau, le levier, et leurs deux dénominateurs ───── */

describe("répartition et découvert", () => {
  const avecDecouvert = () => {
    const accounts = [
      account({ id: "cto", envelopeType: "CTO", marketValueEur: "10000", cashEur: "-1200" }),
    ];
    const positions = [position({ assetId: "p1", securitiesAccountId: "cto", category: "EQUITY", marketValueEur: "10000" })];
    return { accounts, positions, totals: computeTotals(accounts, positions, {}) };
  };

  it("sépare les espèces créditrices des débitrices sans toucher au total", () => {
    const { totals } = avecDecouvert();
    expect(totals.cashEur).toBe(-1200);
    expect(totals.cashPositiveEur).toBe(0);
    expect(totals.cashNegativeEur).toBe(-1200);
    expect(totals.totalValueEur).toBe(8800);
  });

  /*
    Le défaut que la somme algébrique cachait : une poche PEA créditrice de
    500 € disparaissait de l'anneau parce qu'un CTO était à découvert de
    1 200 € — deux enveloppes qui n'ont rien à voir l'une avec l'autre.
  */
  it("n'efface plus une trésorerie créditrice avec le découvert d'une autre enveloppe", () => {
    const accounts = [account({ id: "cto", envelopeType: "CTO", marketValueEur: "10000", cashEur: "-1200" })];
    const positions = [position({ assetId: "p1", securitiesAccountId: "cto", category: "EQUITY", marketValueEur: "10000" })];
    const totals = computeTotals(accounts, positions, { PEA: "500" });
    expect(totals.cashEur).toBe(-700);
    expect(totals.cashPositiveEur).toBe(500);
    const parts = computeAllocation(positions, totals, (c) => c);
    const liquidites = parts.find((s) => s.key === "CASH");
    expect(liquidites?.valueEur).toBe(500);
  });

  /*
    Une partition n'a pas de part négative. L'anneau répartit donc le brut
    long — ses parts somment à 100 % de cette base — et le découvert se lit
    sous lui, chiffré : c'est la doctrine des passifs du tableau de bord.
  */
  it("ne dessine aucune part négative et somme bien à 100 %", () => {
    const { positions, totals } = avecDecouvert();
    const parts = computeAllocation(positions, totals, (c) => c);
    expect(parts.every((s) => s.valueEur > 0)).toBe(true);
    expect(parts.reduce((a, s) => a + s.sharePct, 0)).toBeCloseTo(100, 6);
    expect(allocationBaseEur(totals)).toBe(10000);
  });

  it("écrit sous l'anneau les trois nombres qui referment l'écart", () => {
    const { totals } = avecDecouvert();
    const phrase = allocationNotice(totals, (v) => `${v}`)!;
    expect(phrase).toContain("-1200");
    expect(phrase).toContain("10000");
    expect(phrase).toContain("8800");
  });

  it("ne dit rien quand il n'y a pas de découvert : les deux bases coïncident", () => {
    const accounts = [account({ id: "a1", marketValueEur: "1000", cashEur: "200" })];
    const positions = [position({ assetId: "p1", marketValueEur: "1000" })];
    const totals = computeTotals(accounts, positions, {});
    expect(allocationNotice(totals, (v) => `${v}`)).toBeNull();
    expect(allocationBaseEur(totals)).toBe(totals.totalValueEur);
  });

  /*
    L'exposition reste un levier, rapportée à la valeur nette : 113,6 % est
    la bonne réponse à « combien de titres pour un euro de patrimoine ». Ce
    qui manquait, c'est de dire à quoi elle se rapporte — d'où les deux
    termes, que l'écran affiche.
  */
  it("expose ses deux termes pour que 113,6 % se rapproche de 100 %", () => {
    const { positions, totals } = avecDecouvert();
    const k = computeKeyIndicators(positions, totals);
    expect(k.equityValueEur).toBe(10000);
    expect(k.exposureBaseEur).toBe(8800);
    expect(k.equityExposurePct).toBeCloseTo(113.636, 3);
    // Le même numérateur sur la base de l'anneau donne bien les 100 % voisins.
    expect((k.equityValueEur / allocationBaseEur(totals)) * 100).toBeCloseTo(100, 6);
  });
});
