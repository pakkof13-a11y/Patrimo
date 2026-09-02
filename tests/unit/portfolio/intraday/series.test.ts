import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { buildIntradaySeries } from "@/app/lib/portfolio/intraday/series";
import type { IntradayBarIndex } from "@/app/lib/portfolio/intraday/bar-index";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * La série intraday, pilotée par le vrai moteur.
 *
 * Les barres sont des fixtures — elles représentent des observations de test,
 * jamais des données de production, et n'entrent nulle part en base. Le moteur,
 * lui, est le vrai : c'est ce qui rend ces chiffres comparables à ceux de la
 * courbe quotidienne.
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

function buy(id: string, assetId: string, iso: string, qty: number, unit: number): LedgerTx {
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
    occurredAt: t(iso),
  };
}

const bars = (m: Record<string, Array<[string, number]>>): IntradayBarIndex =>
  new Map(
    Object.entries(m).map(([id, list]) => [
      id,
      list.map(([iso, priceEur]) => ({ at: t(iso).getTime(), priceEur })),
    ])
  );

/** Construit la série sans base : barres injectées, moteur réel. */
async function serie(opts: {
  inputs?: Partial<HistoricalInputs>;
  bars: IntradayBarIndex;
  from: string;
  to: string;
  maxPoints?: number;
}) {
  return buildIntradaySeries({
    userId: "u1",
    from: t(opts.from),
    to: t(opts.to),
    maxPoints: opts.maxPoints,
    deps: {
      loadBars: async () => opts.bars,
      buildEngine: async () => new PortfolioValuationEngine(inputs(opts.inputs)),
    },
  });
}

/** Une position de 10 titres, achetée avant la fenêtre observée. */
const DIX_TITRES = {
  transactions: [buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100)],
  assetClassById: new Map([["a1", "ACTIONS"]]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
};

describe("1 — série horaire simple", () => {
  it("produit un point par heure, valorisé au cours observé", async () => {
    const s = await serie({
      inputs: DIX_TITRES,
      bars: bars({
        a1: [
          ["2026-08-25T10:00:00Z", 100],
          ["2026-08-25T11:00:00Z", 110],
          ["2026-08-25T12:00:00Z", 90],
        ],
      }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T12:00:00Z",
    });

    expect(s.points).toHaveLength(3);
    expect(s.points.map((p) => p.securities)).toEqual([1000, 1100, 900]);
    expect(s.points.map((p) => p.status)).toEqual(["EXACT", "EXACT", "EXACT"]);
  });

  it("conserve l'horodatage canonique et le jour parisien", async () => {
    const s = await serie({
      inputs: DIX_TITRES,
      bars: bars({ a1: [["2026-08-25T10:00:00Z", 100]] }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T10:00:00Z",
    });
    expect(s.points[0]!.at).toBe("2026-08-25T10:00:00.000Z");
    // 10 h UTC = 12 h à Paris en été : le jour civil reste le 25.
    expect(s.points[0]!.day).toBe("2026-08-25");
  });
});

describe("2 — plusieurs actifs", () => {
  it("additionne les compartiments séparément", async () => {
    const s = await serie({
      inputs: {
        transactions: [
          buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100),
          buy("t2", "a2", "2026-08-20T10:00:00Z", 2, 500),
        ],
        assetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "CRYPTO"],
        ]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
      },
      bars: bars({
        a1: [["2026-08-25T10:00:00Z", 110]],
        a2: [["2026-08-25T10:00:00Z", 600]],
      }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T10:00:00Z",
    });

    expect(s.points[0]!.securities).toBe(1100);
    expect(s.points[0]!.crypto).toBe(1200);
    expect(s.points[0]!.grossAssets).toBe(2300);
  });
});

describe("4 et 5 — trou de donnée et report", () => {
  it("le trou est comblé par la dernière valeur connue, et le point devient estimé", async () => {
    const s = await serie({
      inputs: DIX_TITRES,
      bars: bars({
        a1: [
          ["2026-08-25T10:00:00Z", 100],
          ["2026-08-25T11:00:00Z", 101],
          ["2026-08-25T13:00:00Z", 99],
        ],
      }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T13:00:00Z",
    });

    expect(s.points.map((p) => p.securities)).toEqual([1000, 1010, 1010, 990]);
    expect(s.points.map((p) => p.status)).toEqual([
      "EXACT",
      "EXACT",
      "ESTIMATED",
      "EXACT",
    ]);
    // Jamais 1005 : l'interpolation est exclue.
    expect(s.points[2]!.securities).not.toBe(1005);
    expect(s.points[2]!.estimatedComponents).toContain("securities");
  });
});

describe("7 — actif exclu du patrimoine", () => {
  it("ne contribue pas à la série", async () => {
    const commun = {
      transactions: [
        buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100),
        buy("t2", "nft", "2026-08-20T10:00:00Z", 1, 42),
      ],
      assetClassById: new Map([
        ["a1", "ACTIONS"],
        ["nft", "CRYPTO"],
      ]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
    };
    const b = bars({
      a1: [["2026-08-25T10:00:00Z", 100]],
      nft: [["2026-08-25T10:00:00Z", 42]],
    });
    const fenetre = { from: "2026-08-25T10:00:00Z", to: "2026-08-25T10:00:00Z" };

    const avec = await serie({ inputs: commun, bars: b, ...fenetre });
    const sans = await serie({
      inputs: { ...commun, excludedAssetIds: new Set(["nft"]) },
      bars: b,
      ...fenetre,
    });

    expect(avec.points[0]!.grossAssets - sans.points[0]!.grossAssets).toBeCloseTo(42, 6);
    expect(sans.points[0]!.crypto).toBe(0);
  });
});

describe("8 — transaction intraday", () => {
  it("un achat de 14 h pèse à partir de 14 h, pas depuis minuit", async () => {
    const s = await serie({
      inputs: {
        transactions: [buy("t1", "a1", "2026-08-25T14:37:00Z", 10, 100)],
        assetClassById: new Map([["a1", "ACTIONS"]]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
      },
      bars: bars({
        a1: [
          ["2026-08-25T13:00:00Z", 100],
          ["2026-08-25T14:00:00Z", 100],
          ["2026-08-25T15:00:00Z", 100],
        ],
      }),
      from: "2026-08-25T13:00:00Z",
      to: "2026-08-25T15:00:00Z",
    });

    expect(s.points.map((p) => p.securities)).toEqual([0, 0, 1000]);
  });

  it("l'achat est un flux externe, pas une performance", async () => {
    /*
      Sans cette ligne, acheter pour 1 000 € se lirait comme un gain de
      1 000 € — le défaut que le moteur quotidien évite déjà, et que la série
      horaire ne doit pas réintroduire.
    */
    const s = await serie({
      inputs: {
        transactions: [buy("t1", "a1", "2026-08-25T14:37:00Z", 10, 100)],
        assetClassById: new Map([["a1", "ACTIONS"]]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
      },
      bars: bars({
        a1: [
          ["2026-08-25T14:00:00Z", 100],
          ["2026-08-25T15:00:00Z", 100],
        ],
      }),
      from: "2026-08-25T14:00:00Z",
      to: "2026-08-25T15:00:00Z",
    });

    const achat = s.points[1]!;
    expect(achat.externalFlows).toBeCloseTo(1000, 6);
  });
});

describe("9 — passifs projetés", () => {
  it("sont soustraits du patrimoine net à chaque point", async () => {
    const s = await serie({
      inputs: {
        ...DIX_TITRES,
        liabilities: [
          {
            id: "l1",
            startDate: t("2026-01-01T00:00:00Z"),
            createdAt: t("2026-01-01T00:00:00Z"),
            updatedAt: t("2026-01-01T00:00:00Z"),
            initialAmountEur: d(500),
            remainingAmountEur: d(500),
            events: [],
          },
        ],
      },
      bars: bars({ a1: [["2026-08-25T10:00:00Z", 100]] }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T10:00:00Z",
    });

    const p = s.points[0]!;
    expect(p.grossAssets).toBe(1000);
    expect(p.liabilities).toBe(500);
    expect(p.netWorth).toBe(500);
  });
});

describe("14 et 15 — composition variable", () => {
  it("un actif acheté en cours de fenêtre apparaît à son heure", async () => {
    const s = await serie({
      inputs: {
        transactions: [
          buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100),
          buy("t2", "a2", "2026-08-25T11:30:00Z", 1, 200),
        ],
        assetClassById: new Map([
          ["a1", "ACTIONS"],
          ["a2", "ACTIONS"],
        ]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
      },
      bars: bars({
        a1: [
          ["2026-08-25T10:00:00Z", 100],
          ["2026-08-25T11:00:00Z", 100],
          ["2026-08-25T12:00:00Z", 100],
        ],
        a2: [["2026-08-25T12:00:00Z", 200]],
      }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T12:00:00Z",
    });

    expect(s.points.map((p) => p.securities)).toEqual([1000, 1000, 1200]);
  });

  it("un actif sans barre du tout est retenu à son coût, et le point est estimé", async () => {
    const s = await serie({
      inputs: {
        transactions: [
          buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100),
          buy("t2", "muet", "2026-08-20T10:00:00Z", 1, 300),
        ],
        assetClassById: new Map([
          ["a1", "ACTIONS"],
          ["muet", "ACTIONS"],
        ]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
      },
      bars: bars({ a1: [["2026-08-25T10:00:00Z", 100]] }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T10:00:00Z",
    });

    // 10 × 100 coté + 300 au prix de revient.
    expect(s.points[0]!.securities).toBe(1300);
    expect(s.points[0]!.status).toBe("ESTIMATED");
  });
});

describe("16 — absence de données", () => {
  it("aucune barre : série vide, et c'est une réponse", async () => {
    const s = await serie({
      inputs: DIX_TITRES,
      bars: new Map(),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T12:00:00Z",
    });
    expect(s.points).toEqual([]);
    expect(s.observedFrom).toBeNull();
    expect(s.extremes).toBeNull();
  });

  it("la série ne commence jamais avant la première observation", async () => {
    /*
      Valoriser 10 h alors que la première barre est à 12 h reviendrait à
      reporter un cours futur vers le passé, ou à afficher une marche à 12 h
      qu'aucun mouvement n'a produite.
    */
    const s = await serie({
      inputs: DIX_TITRES,
      bars: bars({ a1: [["2026-08-25T12:00:00Z", 100]] }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T13:00:00Z",
    });
    expect(s.points[0]!.at).toBe("2026-08-25T12:00:00.000Z");
    expect(s.observedFrom).toBe("2026-08-25T12:00:00.000Z");
  });
});

describe("17 — statut composé", () => {
  it("un seul compartiment estimé suffit à estimer le point", async () => {
    const s = await serie({
      inputs: {
        transactions: [
          buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100),
          buy("t2", "c1", "2026-08-20T10:00:00Z", 1, 500),
        ],
        assetClassById: new Map([
          ["a1", "ACTIONS"],
          ["c1", "CRYPTO"],
        ]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
      },
      bars: bars({
        a1: [
          ["2026-08-25T10:00:00Z", 100],
          ["2026-08-25T11:00:00Z", 100],
        ],
        // La crypto s'arrête à 10 h : à 11 h son cours est reporté.
        c1: [["2026-08-25T10:00:00Z", 500]],
      }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T11:00:00Z",
    });

    expect(s.points[0]!.status).toBe("EXACT");
    expect(s.points[1]!.status).toBe("ESTIMATED");
    expect(s.points[1]!.estimatedComponents).toEqual(["crypto"]);
    // Les titres restent observés : le statut nomme ce qui est estimé.
    expect(s.points[1]!.estimatedComponents).not.toContain("securities");
  });
});

describe("18 — la lecture n'écrit rien", () => {
  it("ne reçoit aucun client de base de données", async () => {
    /*
      Les dépendances injectées ici ne contiennent ni prisma ni fournisseur.
      Le service ne peut donc structurellement ni écrire ni appeler le réseau
      pendant une lecture — la règle établie sur les passifs.
    */
    const s = await serie({
      inputs: DIX_TITRES,
      bars: bars({ a1: [["2026-08-25T10:00:00Z", 100]] }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T10:00:00Z",
    });
    expect(s.points).toHaveLength(1);
  });
});

describe("10, 11, 13 — creux, extrêmes, échantillonnage", () => {
  /** Le scénario du chantier : 820 000 → 807 500 → 810 500. */
  const JOURNEE = {
    inputs: {
      transactions: [buy("t1", "a1", "2026-08-20T10:00:00Z", 1000, 800)],
      assetClassById: new Map([["a1", "ACTIONS"]]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
    },
    bars: bars({
      a1: [
        ["2026-08-25T10:00:00Z", 820],
        ["2026-08-25T11:00:00Z", 815],
        ["2026-08-25T12:00:00Z", 812],
        ["2026-08-25T13:00:00Z", 809],
        ["2026-08-25T14:00:00Z", 807.5],
        ["2026-08-25T15:00:00Z", 808],
        ["2026-08-25T16:00:00Z", 810.5],
        ["2026-08-25T17:00:00Z", 816],
      ],
    }),
    from: "2026-08-25T10:00:00Z",
    to: "2026-08-25T17:00:00Z",
  };

  it("le creux et son heure sont retrouvés", async () => {
    const s = await serie(JOURNEE);
    expect(s.extremes!.max.value).toBeCloseTo(820_000, 6);
    expect(s.extremes!.min.value).toBeCloseTo(807_500, 6);
    expect(s.extremes!.min.at).toBe("2026-08-25T14:00:00.000Z");
    expect(s.extremes!.drawdownEur).toBeCloseTo(12_500, 6);
    expect(s.extremes!.peakAt).toBe("2026-08-25T10:00:00.000Z");
    expect(s.extremes!.troughAt).toBe("2026-08-25T14:00:00.000Z");
  });

  it("le creux survit à l'échantillonnage", async () => {
    /*
      Le test qui compte. Un échantillonnage régulier retiendrait 13 h et 15 h,
      et le repli de 12 500 € disparaîtrait de la courbe.
    */
    const s = await serie({ ...JOURNEE, maxPoints: 4 });
    expect(s.points.length).toBeLessThanOrEqual(6);
    const heures = s.points.map((p) => p.at);
    expect(heures).toContain("2026-08-25T14:00:00.000Z");
    expect(heures).toContain("2026-08-25T10:00:00.000Z");
    expect(heures).toContain("2026-08-25T17:00:00.000Z");
  });

  it("les extrêmes sont mesurés sur la série complète, pas sur l'échantillon", async () => {
    const complet = await serie(JOURNEE);
    const reduit = await serie({ ...JOURNEE, maxPoints: 4 });
    expect(reduit.extremes).toEqual(complet.extremes);
  });

  it("le patrimoine ne retrouve pas son sommet ici", async () => {
    const s = await serie(JOURNEE);
    expect(s.extremes!.recoveredAt).toBeNull();
  });
});
