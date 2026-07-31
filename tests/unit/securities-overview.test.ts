import { describe, expect, it } from "vitest";
import {
  buildAccountView,
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
    cashAttributed: true,
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
    marketValueEur: "100",
    unrealizedPnlEur: "0",
    unrealizedPnlPct: null,
    ...p,
  };
}

describe("computeTotals", () => {
  it("ajoute les liquidités à la valeur des titres", () => {
    const t = computeTotals([
      account({ id: "a1", marketValueEur: "1000", cashEur: "200" }),
      account({ id: "a2", marketValueEur: "500", cashEur: "50" }),
    ]);
    expect(t.positionsValueEur).toBe(1500);
    expect(t.cashEur).toBe(250);
    expect(t.totalValueEur).toBe(1750);
    expect(t.accountCount).toBe(2);
  });

  it("rapporte le P&L au capital engagé", () => {
    const t = computeTotals([
      account({ id: "a1", costBasisEur: "1000", unrealizedPnlEur: "250" }),
    ]);
    expect(t.unrealizedPnlPct).toBeCloseTo(25, 6);
  });

  it("ne divise pas par zéro sur un compte vide", () => {
    const t = computeTotals([account({ id: "a1" })]);
    expect(t.unrealizedPnlPct).toBeNull();
    expect(t.totalValueEur).toBe(0);
  });

  it("signale un cash non rattaché plutôt que de l'ignorer", () => {
    expect(
      computeTotals([
        account({ id: "a1", cashEur: "300", cashAttributed: false }),
      ]).hasUnattributedCash
    ).toBe(true);
    // Un compte sans cash ne déclenche pas l'alerte, même non rattaché.
    expect(
      computeTotals([
        account({ id: "a1", cashEur: "0", cashAttributed: false }),
      ]).hasUnattributedCash
    ).toBe(false);
  });
});

describe("splitByEnvelope", () => {
  it("regroupe par type et calcule les parts", () => {
    const split = splitByEnvelope([
      account({ id: "a1", envelopeType: "PEA", marketValueEur: "700", cashEur: "50" }),
      account({
        id: "a2",
        envelopeType: "CTO",
        envelopeLabel: "Compte-Titres",
        marketValueEur: "250",
      }),
    ]);
    expect(split.map((s) => s.envelopeType)).toEqual(["PEA", "CTO"]);
    expect(split[0]!.valueEur).toBe(750);
    expect(split[0]!.sharePct).toBeCloseTo(75, 6);
    expect(split[1]!.sharePct).toBeCloseTo(25, 6);
  });

  it("agrège plusieurs comptes de la même enveloppe", () => {
    const split = splitByEnvelope([
      account({ id: "a1", envelopeType: "PEA", marketValueEur: "100" }),
      account({ id: "a2", envelopeType: "PEA", marketValueEur: "300" }),
    ]);
    expect(split).toHaveLength(1);
    expect(split[0]!.accountCount).toBe(2);
    expect(split[0]!.valueEur).toBe(400);
  });

  it("place toujours le PEA en tête", () => {
    const split = splitByEnvelope([
      account({ id: "a1", envelopeType: "CTO", envelopeLabel: "Compte-Titres" }),
      account({ id: "a2", envelopeType: "PEA" }),
    ]);
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
    const totals = computeTotals([
      account({ id: "a1", marketValueEur: "800", cashEur: "150" }),
    ]);
    const slices = computeAllocation(
      [
        position({ assetId: "p1", category: "EQUITY", marketValueEur: "500" }),
        position({ assetId: "p2", category: "ETF", marketValueEur: "200" }),
        position({ assetId: "p3", category: "EQUITY", marketValueEur: "100" }),
      ],
      totals,
      label
    );
    // EQUITY 600, ETF 200, CASH 150 — deux lignes de même catégorie fusionnent.
    expect(slices.map((s) => s.key)).toEqual(["EQUITY", "ETF", "CASH"]);
    expect(slices[0]!.valueEur).toBe(600);
    expect(slices.reduce((a, s) => a + s.sharePct, 0)).toBeCloseTo(100, 6);
  });

  it("omet les liquidités nulles", () => {
    const totals = computeTotals([account({ id: "a1", marketValueEur: "100" })]);
    const slices = computeAllocation(
      [position({ assetId: "p1", marketValueEur: "100" })],
      totals,
      label
    );
    expect(slices.some((s) => s.key === "CASH")).toBe(false);
  });

  it("ne renvoie rien plutôt qu'un camembert vide", () => {
    const totals = computeTotals([]);
    expect(computeAllocation([], totals, label)).toEqual([]);
  });
});

describe("computeKeyIndicators", () => {
  it("mesure l'exposition actions sur la valeur totale, liquidités comprises", () => {
    const totals = computeTotals([
      account({ id: "a1", marketValueEur: "800", cashEur: "200" }),
    ]);
    const k = computeKeyIndicators(
      [
        position({ assetId: "p1", category: "EQUITY", marketValueEur: "600" }),
        position({ assetId: "p2", category: "BOND", marketValueEur: "200" }),
      ],
      totals
    );
    // 600 / 1 000 : la poche de cash dilue bien l'exposition.
    expect(k.equityExposurePct).toBeCloseTo(60, 6);
  });

  it("compte les lignes et le poids moyen", () => {
    const totals = computeTotals([account({ id: "a1", marketValueEur: "400" })]);
    const k = computeKeyIndicators(
      [
        position({ assetId: "p1", marketValueEur: "100" }),
        position({ assetId: "p2", marketValueEur: "100" }),
        position({ assetId: "p3", marketValueEur: "100" }),
        position({ assetId: "p4", marketValueEur: "100" }),
      ],
      totals
    );
    expect(k.positionCount).toBe(4);
    expect(k.averageWeightPct).toBeCloseTo(25, 6);
  });

  it("expose la plus grosse ligne, que la moyenne masque", () => {
    const totals = computeTotals([account({ id: "a1", marketValueEur: "1000" })]);
    const k = computeKeyIndicators(
      [
        position({ assetId: "p1", name: "Gros", marketValueEur: "700" }),
        position({ assetId: "p2", name: "Petit", marketValueEur: "300" }),
      ],
      totals
    );
    expect(k.largestPositionName).toBe("Gros");
    expect(k.largestPositionPct).toBeCloseTo(70, 6);
  });

  it("reste défini sur un portefeuille vide", () => {
    const k = computeKeyIndicators([], computeTotals([]));
    expect(k.positionCount).toBe(0);
    expect(k.averageWeightPct).toBeNull();
    expect(k.equityExposurePct).toBeNull();
    expect(k.largestPositionPct).toBeNull();
  });
});
