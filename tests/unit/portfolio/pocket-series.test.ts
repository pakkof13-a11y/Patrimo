/**
 * T-4.F — filtres de poche.
 *
 * Mesure d'abord : le clamp T-4 D de `getDailyNav` produit déjà une série
 * Immo dès que le scope est `immobilier`. L'écran vide (« Période trop
 * courte » sur Tout) venait du chemin `scopeHistory` : la série daily-nav
 * du hero n'y portait pas `byAssetClassBase`, donc tous les points
 * disparaissaient — pas d'un clamp trop agressif.
 */
import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import {
  dailyNavFromSeries,
} from "@/app/lib/portfolio/historical/get-daily-nav";
import type { DailyNavPoint } from "@/app/lib/portfolio/historical/get-daily-nav";
import {
  dailyNavDeltas,
  dailyNavToHistoryPoints,
  headerFlux,
  headerMarketDelta,
  windowDailyNav,
} from "@/app/lib/portfolio/daily-nav-view";
import { scopeHistory } from "@/app/lib/portfolio/scope-history";
import {
  clampRequestedFrom,
  dailyNavScopeForClass,
  locfValueAt,
  pocketChartLineType,
  pocketSeriesTooShort,
  pocketValueAt,
  toPocketChartPoints,
  windowPocketDailyNav,
} from "@/app/lib/portfolio/pocket-series";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

const DAY = (s: string) => new Date(`${s}T10:00:00Z`);

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
    quantity: d(qty),
    unitPrice: d(unit),
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    grossOriginal: d(qty * unit),
    cashAmountOriginal: d(qty * unit),
    occurredAt: DAY(day),
  };
}

const maisonEtAction = () =>
  new PortfolioValuationEngine(
    inputs({
      transactions: [
        buy("t0", "maison", "1998-06-20", 1, 100_000),
        buy("t1", "aapl", "2022-10-06", 10, 100),
      ],
      assetClassById: new Map([
        ["maison", "IMMOBILIER"],
        ["aapl", "ACTIONS"],
      ]),
      rawAssetClassById: new Map([
        ["maison", "IMMOBILIER"],
        ["aapl", "ACTIONS"],
      ]),
      holdingMetaById: new Map([
        ["maison", { accountType: "IMMOBILIER", hasRealEstateDetail: true }],
        ["aapl", { accountType: "CTO" }],
      ]),
    })
  );

function emptyClass(over: Partial<DailyNavPoint["byAssetClass"]> = {}) {
  return {
    ACTIONS: 0,
    OBLIGATIONS: 0,
    CRYPTO: 0,
    IMMOBILIER: 0,
    CASH: 0,
    AUTRE: 0,
    ...over,
  };
}

function pt(
  day: string,
  over: Partial<DailyNavPoint> & { immobilier?: number; cash?: number }
): DailyNavPoint {
  const immobilier = over.immobilier ?? 0;
  const cash = over.cash ?? 0;
  return {
    day,
    nav: over.nav ?? immobilier,
    status: over.status ?? "EXACT",
    externalFlows: over.externalFlows ?? 0,
    transactionFlow: over.transactionFlow ?? 0,
    financierFlows: over.financierFlows ?? 0,
    listed: over.listed ?? 0,
    financier: over.financier ?? 0,
    brut: over.brut ?? immobilier + cash,
    net: over.net ?? immobilier + cash,
    cash,
    immobilier,
    av: over.av ?? 0,
    alternatifs: over.alternatifs ?? 0,
    employeeSavings: over.employeeSavings ?? 0,
    passifs: over.passifs ?? 0,
    priceOrigins: over.priceOrigins ?? [],
    realizedPnl: over.realizedPnl ?? 0,
    ledgerCashIncome: over.ledgerCashIncome ?? 0,
    unrealizedPnl: over.unrealizedPnl ?? 0,
    byAssetClassAndEnvelope: over.byAssetClassAndEnvelope ?? {
      ACTIONS: { PEA: null, CTO: null, UNKNOWN: 0 },
      OBLIGATIONS: { PEA: 0, CTO: 0, UNKNOWN: 0 },
    },
    byAssetClass: over.byAssetClass ?? emptyClass({ IMMOBILIER: immobilier, CASH: cash }),
    flowsByAssetClass: over.flowsByAssetClass ?? emptyClass(),
  };
}

describe("mesure — T-4 D clamp vs écran vide", () => {
  it("scope=immobilier + from trop ancien : le clamp produit ≥ 2 points", () => {
    const e = maisonEtAction();
    const earliest = e.earliestDayForScope("immobilier");
    expect(earliest).toBe("1998-06-20");

    const from = clampRequestedFrom("1900-01-01", earliest);
    expect(from).toBe("1998-06-20");

    const nav = dailyNavFromSeries(
      e.buildSeries(from!, "1998-07-20"),
      "immobilier"
    );
    expect(nav.length).toBeGreaterThanOrEqual(2);
    expect(pocketSeriesTooShort(nav)).toBe(false);
    expect(nav.every((p) => p.byAssetClass.IMMOBILIER > 0)).toBe(true);
  });

  it("scope=financier « Tout » tronque l'immo d'avant 2022 — d'où le second fetch", () => {
    const e = maisonEtAction();
    const finFrom = clampRequestedFrom(
      "1900-01-01",
      e.earliestDayForScope("financier")
    );
    expect(finFrom).toBe("2022-10-06");
    const fin = dailyNavFromSeries(
      e.buildSeries(finFrom!, "2022-10-20"),
      "financier"
    );
    expect(fin[0]!.day).toBe("2022-10-06");
    expect(fin.every((p) => p.day >= "2022-10-06")).toBe(true);
  });

  it("6M : la série financier porte déjà l'immo — ce n'était pas le clamp", () => {
    const e = maisonEtAction();
    const fin = dailyNavFromSeries(
      e.buildSeries("2022-10-06", "2023-04-06"),
      "financier"
    );
    const sixM = windowDailyNav(fin, "6m", "2023-04-06");
    expect(sixM.length).toBeGreaterThanOrEqual(2);
    expect(sixM.every((p) => p.immobilier === 100_000)).toBe(true);
  });

  it("sans byAssetClassBase, scopeHistory vide la courbe (bug mesuré)", () => {
    const points = [
      pt("2023-01-01", { immobilier: 100_000 }),
      pt("2023-01-02", { immobilier: 100_000 }),
    ];
    const history = dailyNavToHistoryPoints(points).map((p) => {
      const { byAssetClassBase: _drop, ...rest } = p;
      return rest;
    });
    const scoped = scopeHistory(history, {
      scope: "gross",
      assetClass: "IMMOBILIER",
      envelope: null,
      classMetric: "value",
    });
    expect(scoped).toEqual([]);
    expect(pocketSeriesTooShort(scoped)).toBe(true);
  });

  it("avec byAssetClassBase recopié, le même historique se projette", () => {
    const history = dailyNavToHistoryPoints([
      pt("2023-01-01", { immobilier: 100_000 }),
      pt("2023-01-02", { immobilier: 100_000 }),
    ]);
    expect(history[0]!.byAssetClassBase?.IMMOBILIER).toBe(100_000);
    const scoped = scopeHistory(history, {
      scope: "gross",
      assetClass: "IMMOBILIER",
      envelope: null,
      classMetric: "value",
    });
    expect(scoped).toHaveLength(2);
  });
});

describe("« Période trop courte » seulement après clamp", () => {
  it("une fenêtre trop ancienne n'est pas trop courte une fois clampée", () => {
    const earliest = "2024-06-01";
    const from = clampRequestedFrom("2020-01-01", earliest);
    expect(from).toBe("2024-06-01");
    const points = [
      pt("2024-06-01", { immobilier: 200_000 }),
      pt("2024-06-02", { immobilier: 200_000 }),
      pt("2024-12-01", { immobilier: 220_000 }),
    ];
    const windowed = windowPocketDailyNav(points, "all", "2024-12-01", from);
    expect(pocketSeriesTooShort(windowed)).toBe(false);
    expect(windowed[0]!.day).toBe("2024-06-01");
  });

  it("un seul point après clamp → trop courte", () => {
    expect(pocketSeriesTooShort([pt("2024-06-01", { immobilier: 1 })])).toBe(
      true
    );
  });

  it("zéro point (scope jamais observé) → trop courte", () => {
    expect(clampRequestedFrom("1900-01-01", null)).toBeNull();
    expect(pocketSeriesTooShort([])).toBe(true);
  });
});

describe("Immo / cash / alternatifs — marches, pas d'interpolation", () => {
  it("Immo 6M et Tout : deux expertises restent deux paliers", () => {
    const points = [
      pt("2023-10-01", { immobilier: 200_000 }),
      pt("2024-01-01", { immobilier: 200_000 }),
      pt("2024-03-15", { immobilier: 280_000 }),
      pt("2024-04-01", { immobilier: 280_000 }),
    ];
    const tout = toPocketChartPoints(points, "IMMOBILIER");
    expect(tout.map((p) => p.total)).toEqual([
      200_000, 200_000, 280_000, 280_000,
    ]);
    expect(tout).toHaveLength(4);

    const sixM = toPocketChartPoints(
      windowPocketDailyNav(points, "6m", "2024-04-01"),
      "IMMOBILIER"
    );
    expect(sixM.length).toBeGreaterThanOrEqual(2);
    expect(sixM.map((p) => p.total)).toEqual(tout.map((p) => p.total));
  });

  it("aucune valeur n'est fabriquée entre deux expertises", () => {
    const series = toPocketChartPoints(
      [
        pt("2010-01-01", { immobilier: 200_000 }),
        pt("2015-06-01", { immobilier: 280_000 }),
      ],
      "IMMOBILIER"
    );
    expect(series.map((p) => p.total)).toEqual([200_000, 280_000]);
    const invented = series.filter(
      (p) => p.total !== 200_000 && p.total !== 280_000
    );
    expect(invented).toEqual([]);
  });

  it("cash et AUTRE (alternatifs) se dessinent en stepAfter", () => {
    expect(pocketChartLineType("IMMOBILIER")).toBe("stepAfter");
    expect(pocketChartLineType("CASH")).toBe("stepAfter");
    expect(pocketChartLineType("AUTRE")).toBe("stepAfter");
    expect(pocketChartLineType("ACTIONS")).toBe("linear");
    expect(pocketChartLineType(null)).toBe("linear");
  });

  it("cash lit la poche, pas une interpolation", () => {
    const series = toPocketChartPoints(
      [
        pt("2024-01-01", { cash: 5_000 }),
        pt("2024-06-01", { cash: 5_000 }),
        pt("2024-06-02", { cash: 8_000 }),
      ],
      "CASH"
    );
    expect(series.map((p) => p.total)).toEqual([5_000, 5_000, 8_000]);
  });
});

describe("mapping classe → scope de clamp", () => {
  it("Immo / Cash / cotés / AUTRE", () => {
    expect(dailyNavScopeForClass("IMMOBILIER")).toBe("immobilier");
    expect(dailyNavScopeForClass("CASH")).toBe("cash");
    expect(dailyNavScopeForClass("ACTIONS")).toBe("listed");
    expect(dailyNavScopeForClass("CRYPTO")).toBe("listed");
    expect(dailyNavScopeForClass("AUTRE")).toBe("brut");
  });

  it("pocketValueAt préfère byAssetClass, repli poche pour l'illiquide", () => {
    const p = pt("2024-01-01", {
      immobilier: 10,
      byAssetClass: emptyClass({ IMMOBILIER: 42 }),
    });
    expect(pocketValueAt(p, "IMMOBILIER")).toBe(42);
    const sansClasse = {
      ...p,
      byAssetClass: undefined as unknown as DailyNavPoint["byAssetClass"],
    };
    expect(pocketValueAt(sansClasse, "IMMOBILIER")).toBe(10);
  });
});

describe("contrainte métier F — LOCF, flux immo, trop courte", () => {
  it("entre deux expertises on tient le palier, on n'interpole pas", () => {
    const expertises = [
      { day: "2010-01-01", value: 200_000 },
      { day: "2015-06-01", value: 280_000 },
    ];
    expect(locfValueAt(expertises, "2009-12-31")).toBeNull();
    expect(locfValueAt(expertises, "2010-01-01")).toBe(200_000);
    expect(locfValueAt(expertises, "2012-06-01")).toBe(200_000);
    expect(locfValueAt(expertises, "2015-05-31")).toBe(200_000);
    expect(locfValueAt(expertises, "2015-06-01")).toBe(280_000);
    // Le lerp aurait donné 240 000 à mi-parcours — ce n'est pas une valo.
    expect(locfValueAt(expertises, "2012-09-16")).not.toBe(240_000);
  });

  it("après un achat immo la série tient le prix — palier, pas une pente", () => {
    const e = maisonEtAction();
    const from = clampRequestedFrom(
      "1900-01-01",
      e.earliestDayForScope("immobilier")
    );
    const nav = dailyNavFromSeries(
      e.buildSeries(from!, "1998-07-20"),
      "immobilier"
    );
    expect(pocketSeriesTooShort(nav)).toBe(false);
    const immo = nav.map((p) => p.immobilier);
    expect(new Set(immo)).toEqual(new Set([100_000]));
    const chart = toPocketChartPoints(nav, "IMMOBILIER");
    expect(chart.every((p) => p.total === 100_000)).toBe(true);
    expect(pocketChartLineType("IMMOBILIER")).toBe("stepAfter");
  });

  it("achat immo = flux brut/net, ΔFinancier marché ≈ 0, marche immo", () => {
    const avant = pt("2026-01-14", {
      financier: 100_000,
      brut: 100_000,
      listed: 100_000,
      immobilier: 0,
      byAssetClass: emptyClass({ ACTIONS: 100_000 }),
    });
    const apres = pt("2026-01-15", {
      financier: 100_000,
      brut: 1_080_000,
      listed: 100_000,
      immobilier: 980_000,
      externalFlows: 980_000,
      financierFlows: 0,
      transactionFlow: 0,
      byAssetClass: emptyClass({ ACTIONS: 100_000, IMMOBILIER: 980_000 }),
      flowsByAssetClass: emptyClass({ IMMOBILIER: 980_000 }),
    });
    const points = [avant, apres];

    expect(dailyNavDeltas(points, "financier")[1]).toBe(0);
    expect(headerMarketDelta(points, "financier")).toBe(0);
    expect(headerFlux(points, "brut")).toBe(980_000);
    expect(headerFlux(points, "net")).toBe(980_000);

    const marche = toPocketChartPoints(points, "IMMOBILIER");
    expect(marche.map((p) => p.total)).toEqual([0, 980_000]);
    expect(marche).toHaveLength(2);
    expect(locfValueAt(
      marche.map((p) => ({ day: p.day, value: p.total })),
      "2026-01-14"
    )).toBe(0);
    expect(locfValueAt(
      marche.map((p) => ({ day: p.day, value: p.total })),
      "2026-01-15"
    )).toBe(980_000);
  });

  it("from plus ancien que earliestDayForScope : clamp, pas « trop courte »", () => {
    const earliest = "1998-06-20";
    expect(clampRequestedFrom("1900-01-01", earliest)).toBe(earliest);
    const clamped = [
      pt("1998-06-20", { immobilier: 100_000 }),
      pt("1998-06-21", { immobilier: 100_000 }),
    ];
    expect(pocketSeriesTooShort(clamped)).toBe(false);
    expect(
      pocketSeriesTooShort([pt("1998-06-20", { immobilier: 100_000 })])
    ).toBe(true);
  });
});
