import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { buildIntradaySeries } from "@/app/lib/portfolio/intraday/series";
import { resolverAt } from "@/app/lib/market/market-data-repository";
import type { IntradayBarIndex } from "@/app/lib/portfolio/intraday/bar-index";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * Historique reconstructible — les douze cas du chantier.
 *
 * Le point de ce fichier : un patrimoine se reconstruit à partir des
 * transactions et des données de marché, **sans** dépendre d'instantanés pris à
 * l'époque. Et chaque valeur dit d'où elle vient : une clôture quotidienne ne se
 * fait pas passer pour une observation de 14 h 37, et une position sans donnée
 * est comptée comme telle plutôt que figée à son coût en silence.
 */

const t = (iso: string) => new Date(iso);
const H = 3_600_000;

function inputs(over: Partial<HistoricalInputs> = {}): HistoricalInputs {
  return {
    transactions: [],
    assetClassById: new Map(),
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
    id, type: "ACHAT", platformId: "p1", toPlatformId: null, assetId,
    quantity: d(qty), unitPrice: d(unit), fees: d(0), currency: "EUR",
    fxRateToEur: d(1), grossOriginal: d(qty * unit),
    cashAmountOriginal: d(qty * unit), occurredAt: t(iso),
  };
}

const bars = (m: Record<string, Array<[string, number]>>): IntradayBarIndex =>
  new Map(Object.entries(m).map(([id, l]) => [
    id, l.map(([iso, priceEur]) => ({ at: t(iso).getTime(), priceEur })),
  ]));

const closes = (m: Record<string, Record<string, number>>) =>
  new Map(Object.entries(m).map(([id, days]) => [id, new Map(Object.entries(days))]));

async function serie(o: {
  inputs?: Partial<HistoricalInputs>;
  bars?: IntradayBarIndex;
  from: string;
  to: string;
  maxPoints?: number;
}) {
  return buildIntradaySeries({
    userId: "u1",
    from: t(o.from),
    to: t(o.to),
    maxPoints: o.maxPoints,
    deps: {
      loadBars: async () => o.bars ?? new Map(),
      buildEngine: async () => new PortfolioValuationEngine(inputs(o.inputs)),
    },
  });
}

// ── A ────────────────────────────────────────────────────────────────────────
describe("A — reconstitution sans aucun instantané", () => {
  it("une courbe existe à partir des seules clôtures quotidiennes", async () => {
    /*
      Le critère principal du chantier. L'utilisateur arrive aujourd'hui, ses
      transactions datent de 2020, et aucun `PortfolioSnapshot` n'a jamais été
      pris. La courbe doit exister quand même.
    */
    const s = await serie({
      inputs: {
        transactions: [buy("t1", "a1", "2020-03-02T10:00:00Z", 10, 50)],
        assetClassById: new Map([["a1", "ACTIONS"]]),
        closes: closes({ a1: { "2026-08-24": 100, "2026-08-25": 110 } }),
      },
      from: "2026-08-25T08:00:00Z",
      to: "2026-08-25T10:00:00Z",
    });

    expect(s.points.length).toBeGreaterThan(0);
    expect(s.points[0]!.securities).toBe(1100);
    // Pas au prix de revient (10 × 50 = 500), mais au marché.
    expect(s.points[0]!.securities).not.toBe(500);
    expect(s.points[0]!.priceOrigin).toBe("DAILY_EXACT");
    expect(s.points[0]!.priceCoverage).toBe(1);
  });
});

// ── B ────────────────────────────────────────────────────────────────────────
describe("B — flash crash", () => {
  it("le creux de midi apparaît dans la courbe", async () => {
    const s = await serie({
      inputs: {
        transactions: [buy("t1", "a1", "2020-01-01T10:00:00Z", 100, 100)],
        assetClassById: new Map([["a1", "ACTIONS"]]),
      },
      bars: bars({
        a1: [
          ["2026-08-25T10:00:00Z", 100],
          ["2026-08-25T11:00:00Z", 99],
          ["2026-08-25T12:00:00Z", 75],
          ["2026-08-25T13:00:00Z", 98],
        ],
      }),
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T13:00:00Z",
    });

    expect(s.points.map((p) => p.securities)).toEqual([10_000, 9_900, 7_500, 9_800]);
    expect(s.extremes!.min.value).toBe(7_500);
    expect(s.extremes!.min.at).toBe("2026-08-25T12:00:00.000Z");
    // Jamais remplacé par le coût de revient.
    expect(s.points[2]!.securities).not.toBe(10_000);
  });
});

// ── C ────────────────────────────────────────────────────────────────────────
describe("C — transaction à 14 h 37", () => {
  it("la position commence exactement à cette heure", async () => {
    const s = await serie({
      inputs: {
        transactions: [buy("t1", "a1", "2026-08-25T14:37:00Z", 10, 100)],
        assetClassById: new Map([["a1", "ACTIONS"]]),
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
    expect(s.points.map((p) => p.securities)).toEqual([0, 1000]);
  });
});

// ── D, G ─────────────────────────────────────────────────────────────────────
describe("D et G — hiérarchie de résolution", () => {
  const serie3h = bars({
    a1: [
      ["2026-08-25T10:00:00Z", 100],
      ["2026-08-25T11:00:00Z", 101],
    ],
  });

  it("une barre couvrant l'instant est MARKET_EXACT", () => {
    const r = resolverAt({ intraday: serie3h }, t("2026-08-25T11:30:00Z"), {
      intervalMs: H,
    })("a1");
    expect(r).toMatchObject({ priceEur: 101, origin: "MARKET_EXACT" });
  });

  it("sans clôture, une barre ancienne est reportée sous borne", () => {
    const r = resolverAt({ intraday: serie3h }, t("2026-08-25T13:00:00Z"), {
      intervalMs: H,
    })("a1");
    expect(r).toMatchObject({ priceEur: 101, origin: "MARKET_CARRIED" });
  });

  it("au-delà de la borne, plus de report", () => {
    const r = resolverAt({ intraday: serie3h }, t("2026-09-30T13:00:00Z"), {
      intervalMs: H,
    })("a1");
    expect(r).toBeNull();
  });

  it("une clôture du jour l'emporte sur une barre vieille de trois jours", () => {
    /*
      L'ordre suit la finesse d'information, pas la fraîcheur brute : la clôture
      décrit la journée demandée, la vieille barre décrit un autre moment.
    */
    const r = resolverAt(
      { intraday: serie3h, daily: closes({ a1: { "2026-08-28": 90 } }) },
      t("2026-08-28T13:00:00Z"),
      { intervalMs: H }
    )("a1");
    expect(r).toMatchObject({ priceEur: 90, origin: "DAILY_EXACT" });
  });

  it("sans marché du tout, la clôture seule donne DAILY_EXACT", () => {
    const r = resolverAt(
      { daily: closes({ a1: { "2026-08-25": 42 } }) },
      t("2026-08-25T13:00:00Z"),
      { intervalMs: H }
    )("a1");
    expect(r).toMatchObject({ priceEur: 42, origin: "DAILY_EXACT" });
  });
});

// ── E ────────────────────────────────────────────────────────────────────────
describe("E — événements de valorisation", () => {
  const events = new Map([
    ["bien", [
      { at: t("2023-01-01T00:00:00Z").getTime(), valueEur: 250_000 },
      { at: t("2024-06-01T00:00:00Z").getTime(), valueEur: 275_000 },
      { at: t("2025-01-01T00:00:00Z").getTime(), valueEur: 290_000 },
    ]],
  ]);

  it("entre deux constats, la dernière valeur connue tient", () => {
    const r = resolverAt({ valuationEvents: events }, t("2024-09-15T00:00:00Z"), {
      intervalMs: H,
    })("bien");
    expect(r).toMatchObject({ priceEur: 275_000, origin: "VALUATION_EVENT" });
  });

  it("après le dernier constat, c'est lui qui vaut", () => {
    const r = resolverAt({ valuationEvents: events }, t("2026-08-25T00:00:00Z"), {
      intervalMs: H,
    })("bien");
    expect(r!.priceEur).toBe(290_000);
  });

  it("avant le premier constat, rien n'est inventé", () => {
    const r = resolverAt({ valuationEvents: events }, t("2022-01-01T00:00:00Z"), {
      intervalMs: H,
    })("bien");
    expect(r).toBeNull();
  });
});

// ── F ────────────────────────────────────────────────────────────────────────
describe("F — actif sans historique", () => {
  it("un prix saisi sans histoire est STATIC, et ne feint aucun mouvement", () => {
    const r = resolverAt(
      { staticPrices: new Map([["objet", 1_500]]) },
      t("2024-01-01T00:00:00Z"),
      { intervalMs: H }
    )("objet");
    expect(r).toMatchObject({ priceEur: 1_500, origin: "STATIC" });
    // Aucun instant d'application : ce prix ne se rattache à aucune date.
    expect(r!.appliesAt).toBeUndefined();
  });

  it("sans rien du tout, la résolution rend null", () => {
    expect(resolverAt({}, t("2024-01-01T00:00:00Z"), { intervalMs: H })("x")).toBeNull();
  });

  it("une position sans donnée est comptée, pas figée en silence", async () => {
    const s = await serie({
      inputs: {
        transactions: [
          buy("t1", "connu", "2020-01-01T10:00:00Z", 10, 100),
          buy("t2", "muet", "2020-01-01T10:00:00Z", 1, 300),
        ],
        assetClassById: new Map([
          ["connu", "ACTIONS"],
          ["muet", "ACTIONS"],
        ]),
        closes: closes({ connu: { "2026-08-25": 110 } }),
      },
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-25T10:00:00Z",
    });

    const p = s.points[0]!;
    // 10 × 110 au marché + 300 au coût, faute de mieux.
    expect(p.securities).toBe(1_400);
    // Et surtout : la moitié des lignes n'a pas d'histoire, et c'est dit.
    expect(p.priceCoverage).toBeCloseTo(0.5, 6);
    expect(p.priceOrigin).toBe("UNAVAILABLE");
    expect(s.coverage).toBeCloseTo(0.5, 6);
  });
});

// ── I ────────────────────────────────────────────────────────────────────────
describe("I — plusieurs sources, une seule représentation", () => {
  it("deux actifs venant de caches différents produisent la même forme", () => {
    const resolve = resolverAt(
      {
        intraday: bars({ crypto: [["2026-08-25T10:00:00Z", 55_000]] }),
        daily: closes({ action: { "2026-08-25": 100 } }),
      },
      t("2026-08-25T10:30:00Z"),
      { intervalMs: H }
    );
    const a = resolve("crypto")!;
    const b = resolve("action")!;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.origin).toBe("MARKET_EXACT");
    expect(b.origin).toBe("DAILY_EXACT");
  });
});

// ── J, K ─────────────────────────────────────────────────────────────────────
describe("J et K — le cache est la seule source de lecture", () => {
  it("aucune collecte n'est déclenchée pendant une lecture", async () => {
    /*
      Les dépendances injectées ne contiennent ni fournisseur ni prisma : le
      service ne peut structurellement pas appeler le réseau. Une donnée déjà
      présente est relue, une donnée absente reste absente — les trous se
      comblent par la collecte planifiée, jamais par l'affichage.
    */
    let chargements = 0;
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T10:00:00Z"),
      to: t("2026-08-25T11:00:00Z"),
      deps: {
        loadBars: async () => {
          chargements++;
          return bars({ a1: [["2026-08-25T10:00:00Z", 100]] });
        },
        buildEngine: async () =>
          new PortfolioValuationEngine(
            inputs({
              transactions: [buy("t1", "a1", "2020-01-01T10:00:00Z", 1, 100)],
              assetClassById: new Map([["a1", "ACTIONS"]]),
            })
          ),
      },
    });
    expect(chargements).toBe(1);
    expect(s.points.length).toBeGreaterThan(0);
  });
});

// ── H ────────────────────────────────────────────────────────────────────────
describe("H — les instantanés ne redéfinissent pas le patrimoine", () => {
  it("la valorisation ne dépend d'aucun PortfolioSnapshot", async () => {
    /*
      `HistoricalInputs` ne comporte aucun champ d'instantané : le moteur ne
      peut pas en lire un. C'est la garantie structurelle qu'il n'existe pas de
      seconde définition — un instantané ne peut qu'accélérer une lecture, pas
      changer un chiffre.
    */
    const champs = Object.keys(inputs());
    expect(champs.some((k) => /snapshot/i.test(k))).toBe(false);
  });
});

// ── L ────────────────────────────────────────────────────────────────────────
describe("L — deux temps distincts", () => {
  it("une résolution dit à quel instant sa valeur s'applique", () => {
    /*
      `appliesAt` est au résolveur ce que `marketAt` est à `PriceHistory` : le
      moment que la valeur décrit, distinct de celui où on la lit. Sans lui,
      « cours de 11 h reporté à midi » serait indiscernable d'un cours de midi.
    */
    const r = resolverAt(
      { intraday: bars({ a1: [["2026-08-25T11:00:00Z", 101]] }) },
      t("2026-08-25T12:30:00Z"),
      { intervalMs: H }
    )("a1")!;

    expect(r.origin).toBe("MARKET_CARRIED");
    expect(r.appliesAt!.toISOString()).toBe("2026-08-25T11:00:00.000Z");
    // L'instant demandé n'est pas celui que la valeur décrit.
    expect(r.appliesAt!.getTime()).toBeLessThan(t("2026-08-25T12:30:00Z").getTime());
  });

  it("une clôture s'applique à son jour, pas à l'heure demandée", () => {
    const r = resolverAt(
      { daily: closes({ a1: { "2026-08-24": 90 } }) },
      t("2026-08-25T14:37:00Z"),
      { intervalMs: H }
    )("a1")!;
    expect(r.origin).toBe("DAILY_EXACT");
    expect(r.appliesAt!.toISOString().slice(0, 10)).toBe("2026-08-24");
  });
});
