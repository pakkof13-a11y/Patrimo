/**
 * T-4.E — Vs CAC40, base 100 à l'ancre servie.
 *
 * Contrat Finance :
 * 1. Fenêtre = servedFrom…to de getDailyNav (pas la borne demandée si clamp).
 * 2. base100 = 100 × v(t) / v(ancre) — les deux = 100 à l'ancre.
 * 3. Pas de 2e formule Δ.
 * 4. Pas d'interpolation. WE = LOCF. Aucune close ≤ ancre → overlay absent.
 * 5. MARKET_INDICES + /api/benchmark (hors de ces tests, réseau mocké).
 * 6. Achat immo : Financier ne cliff pas ; Brut peut sauter.
 * 7. Réseau vide → overlay off, NAV intacte.
 *
 * Contrôle live : `npx tsx scripts/check-vs-index-base100.ts`
 */

import { describe, expect, it } from "vitest";
import {
  dailyNavQueryWindow,
  navOfPoint,
  windowDailyNav,
} from "@/app/lib/portfolio/daily-nav-view";
import type { DailyNavPoint } from "@/app/lib/portfolio/historical/get-daily-nav";
import {
  dailyNavToVsIndexLevels,
  indexCloseAtAnchor,
  rebaseToCommonBase100,
  toVsIndexPercentPoints,
  vsIndexAnchorDay,
  vsIndexChartKind,
  vsIndexDayKey,
  vsIndexGapPct,
  vsIndexHasOverlay,
  windowVsIndexNav,
  INDEX_UNAVAILABLE_TITLE,
  type VsIndexLevel,
} from "@/app/lib/portfolio/vs-index-series";

function nav(day: string, value: number): VsIndexLevel {
  return { day, value };
}

function cac(day: string, close: number): VsIndexLevel {
  return { day, value: close };
}

function pt(
  day: string,
  financier: number,
  over: Partial<DailyNavPoint> = {}
): DailyNavPoint {
  return {
    day,
    intervalType: over.intervalType ?? "day",
    nav: over.nav ?? financier,
    status: "EXACT",
    externalFlows: over.externalFlows ?? 0,
    transactionFlow: over.transactionFlow ?? 0,
    financierFlows: over.financierFlows ?? 0,
    listed: over.listed ?? financier,
    financier,
    brut: over.brut ?? financier + 200_000,
    net: over.net ?? financier + 150_000,
    cash: over.cash ?? 0,
    immobilier: over.immobilier ?? 0,
    av: over.av ?? 0,
    alternatifs: over.alternatifs ?? 0,
    employeeSavings: over.employeeSavings ?? 0,
    passifs: over.passifs ?? 50_000,
    priceOrigins: [],
    realizedPnl: 0,
    ledgerCashIncome: 0,
    unrealizedPnl: 0,
    byAssetClassAndEnvelope: {
      ACTIONS: { PEA: null, CTO: null, UNKNOWN: 0 },
      OBLIGATIONS: { PEA: 0, CTO: 0, UNKNOWN: 0 },
    },
    byAssetClass: {
      ACTIONS: financier,
      OBLIGATIONS: 0,
      CRYPTO: 0,
      IMMOBILIER: over.immobilier ?? 0,
      CASH: 0,
      AUTRE: 0,
    },
    flowsByAssetClass: {
      ACTIONS: 0,
      OBLIGATIONS: 0,
      CRYPTO: 0,
      IMMOBILIER: over.externalFlows && over.immobilier ? over.externalFlows : 0,
      CASH: 0,
      AUTRE: 0,
    },
    ...over,
  };
}

describe("rebaseToCommonBase100 — ancre servie", () => {
  it("les deux courbes valent 100 (0 %) à l'ancre", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-05", 200_000), nav("2026-01-06", 210_000)],
      [cac("2026-01-05", 7_000), cac("2026-01-06", 7_350)]
    );
    expect(vsIndexAnchorDay(out.map((p) => nav(p.day, p.portfolioBase100)))).toBe(
      "2026-01-05"
    );
    expect(out[0]!.day).toBe("2026-01-05");
    expect(out[0]!.portfolioBase100).toBe(100);
    expect(out[0]!.indexBase100).toBe(100);
    expect(out[0]!.portfolioPct).toBe(0);
    expect(out[0]!.benchmarkPct).toBe(0);
  });

  it("un portefeuille qui bouge n'est jamais plat à +0 % si le CAC bouge", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-03-02", 100_000), nav("2026-03-03", 105_000)],
      [cac("2026-03-02", 8_000), cac("2026-03-03", 8_320)]
    );
    expect(out[1]!.portfolioPct).toBeCloseTo(5, 6);
    expect(out[1]!.benchmarkPct).toBeCloseTo(4, 6);
    expect(out[1]!.portfolioPct).not.toBe(0);
    expect(out[1]!.benchmarkPct).not.toBe(0);
    expect(out[1]!.portfolioBase100).toBeCloseTo(105, 6);
    expect(out[1]!.indexBase100).toBeCloseTo(104, 6);
  });

  it("ne mélange jamais une NAV en euros avec un indice déjà en %", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-05", 200_000), nav("2026-01-06", 202_000)],
      [cac("2026-01-05", 7_400), cac("2026-01-06", 7_548)]
    );
    for (const p of out) {
      expect(p.portfolioBase100).toBeGreaterThan(90);
      expect(p.portfolioBase100).toBeLessThan(110);
      expect(p.indexBase100).toBeGreaterThan(90);
      expect(p.indexBase100).toBeLessThan(110);
    }
    expect(out[1]!.portfolioPct).toBeCloseTo(1, 6);
    expect(out[1]!.benchmarkPct).toBeCloseTo(2, 6);
  });

  it("aucune close ≤ ancre → overlay absent, NAV intacte dès l'ancre", () => {
    /*
      L'ancre est le premier jour NAV, pas le premier jour CAC.
      Décaler pour attendre l'indice inventerait une origine.
      Inventer 100 pour le CAC le jour J+3 mentirait.
    */
    const out = rebaseToCommonBase100(
      [
        nav("2026-01-02", 100_000),
        nav("2026-01-03", 101_000),
        nav("2026-01-05", 102_000),
        nav("2026-01-06", 104_040),
      ],
      [cac("2026-01-05", 7_000), cac("2026-01-06", 7_140)]
    );
    expect(vsIndexAnchorDay([nav("2026-01-02", 100_000)])).toBe("2026-01-02");
    expect(indexCloseAtAnchor("2026-01-02", [cac("2026-01-05", 7_000)])).toBeNull();
    expect(out[0]!.day).toBe("2026-01-02");
    expect(out).toHaveLength(4);
    expect(out[0]!.portfolioBase100).toBe(100);
    expect(out[1]!.portfolioPct).toBeCloseTo(1, 6);
    for (const p of out) {
      expect(p.indexBase100).toBeUndefined();
      expect(p.benchmarkPct).toBeUndefined();
    }
  });

  it("un week-end de NAV reprend la clôture du vendredi (LOCF), sans interpoler", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-02", 50_000), nav("2026-01-03", 51_000), nav("2026-01-05", 52_000)],
      [cac("2026-01-02", 8_000), cac("2026-01-05", 8_160)]
    );
    expect(out[0]!.day).toBe("2026-01-02");
    expect(out[1]!.day).toBe("2026-01-03");
    expect(out[1]!.indexBase100).toBe(100);
    expect(out[2]!.indexBase100).toBeCloseTo(102, 6);
  });

  it("réseau vide / 429 → overlay off, NAV intacte", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-05", 80_000), nav("2026-01-06", 88_000)],
      []
    );
    expect(out[0]!.portfolioPct).toBe(0);
    expect(out[1]!.portfolioPct).toBeCloseTo(10, 6);
    expect(out[0]!.benchmarkPct).toBeUndefined();
    expect(out[1]!.benchmarkPct).toBeUndefined();
    expect(out[0]!.indexBase100).toBeUndefined();
  });

  it("accepte une clôture ISO (réponse Yahoo) alignée sur le jour Paris", () => {
    expect(vsIndexDayKey("2026-01-15T00:00:00.000Z")).toBe("2026-01-15");
    const out = rebaseToCommonBase100(
      [nav("2026-01-15", 10_000), nav("2026-01-16", 11_000)],
      [
        { day: "2026-01-15T00:00:00.000Z", value: 1_000 },
        { day: "2026-01-16T00:00:00.000Z", value: 1_050 },
      ]
    );
    expect(out[1]!.benchmarkPct).toBeCloseTo(5, 6);
  });

  it("vide si la NAV n'a aucun niveau utilisable", () => {
    expect(rebaseToCommonBase100([nav("2026-01-05", 0)], [cac("2026-01-05", 7_000)])).toEqual([]);
    expect(rebaseToCommonBase100([])).toEqual([]);
  });
});

describe("achat immo — Financier ne cliff pas, Brut peut sauter", () => {
  it("base100 Financier reste 100 ; Brut saute de l'achat", () => {
    const days = [
      pt("2026-01-01", 100_000, { brut: 100_000, immobilier: 0, externalFlows: 0 }),
      pt("2026-01-02", 100_000, {
        brut: 1_080_000,
        immobilier: 980_000,
        externalFlows: 980_000,
      }),
    ];
    const financier = rebaseToCommonBase100(
      dailyNavToVsIndexLevels(days, "financier"),
      [cac("2026-01-01", 7_000), cac("2026-01-02", 7_000)]
    );
    const brut = rebaseToCommonBase100(
      dailyNavToVsIndexLevels(days, "brut"),
      [cac("2026-01-01", 7_000), cac("2026-01-02", 7_000)]
    );
    expect(financier[0]!.portfolioBase100).toBe(100);
    expect(financier[1]!.portfolioBase100).toBe(100);
    expect(financier[1]!.portfolioPct).toBe(0);
    expect(brut[0]!.portfolioBase100).toBe(100);
    expect(brut[1]!.portfolioBase100).toBeCloseTo(1_080, 6);
  });
});

describe("vsIndexGapPct", () => {
  it("écart = perf portefeuille − perf indice, depuis l'ancre", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-05", 100_000), nav("2026-01-06", 110_000)],
      [cac("2026-01-05", 7_000), cac("2026-01-06", 7_350)]
    );
    const gap = vsIndexGapPct(out);
    expect(gap).not.toBeNull();
    expect(gap!.portfolioPct).toBeCloseTo(10, 6);
    expect(gap!.benchmarkPct).toBeCloseTo(5, 6);
    expect(gap!.gapPct).toBeCloseTo(5, 6);
  });

  it("null sans overlay ou sans deux points", () => {
    expect(vsIndexGapPct(rebaseToCommonBase100([nav("2026-01-05", 1)]))).toBeNull();
    expect(
      vsIndexGapPct(
        rebaseToCommonBase100(
          [nav("2026-01-05", 100_000)],
          [cac("2026-01-05", 7_000)]
        )
      )
    ).toBeNull();
  });
});

describe("fenêtre = servedFrom…to, pas la borne demandée", () => {
  it("le plancher servedFrom écarte la borne demandée trop ancienne", () => {
    const dense = [
      pt("1998-06-20", 240),
      pt("2022-10-01", 100_000),
      pt("2022-10-02", 101_000),
      pt("2026-03-01", 110_000),
    ];
    const requested = dailyNavQueryWindow("all", "2026-03-01", "1998-06-20");
    expect(requested.from).toBe("1998-06-20");
    const servedFrom = "2022-10-01";
    const windowed = windowVsIndexNav(
      dense,
      "all",
      "2026-03-01",
      servedFrom
    );
    expect(windowed[0]!.day).toBe("2022-10-01");
    expect(windowed.some((p) => p.day < servedFrom)).toBe(false);
    const out = rebaseToCommonBase100(
      dailyNavToVsIndexLevels(windowed, "financier"),
      [cac("2022-10-01", 6_000), cac("2026-03-01", 6_600)]
    );
    expect(out[0]!.day).toBe("2022-10-01");
    expect(out[0]!.portfolioBase100).toBe(100);
    expect(out[0]!.indexBase100).toBe(100);
    expect(out[out.length - 1]!.portfolioPct).toBeCloseTo(10, 6);
    expect(out[out.length - 1]!.benchmarkPct).toBeCloseTo(10, 6);
  });

  it("windowDailyNav + close ≤ ancre : les deux partent à 100 le même jour", () => {
    const dense = [
      pt("2025-12-01", 90_000),
      pt("2026-02-01", 100_000),
      pt("2026-02-02", 103_000),
      pt("2026-03-01", 106_000),
    ];
    const windowed = windowDailyNav(dense, "1m", "2026-03-01");
    expect(windowed[0]!.day).toBe("2025-12-01");
    const out = rebaseToCommonBase100(
      dailyNavToVsIndexLevels(windowed, "financier"),
      [
        cac("2025-12-01", 7_000),
        cac("2026-02-01", 7_100),
        cac("2026-03-01", 7_210),
      ]
    );
    expect(out[0]!.day).toBe("2025-12-01");
    expect(out[0]!.portfolioBase100).toBe(100);
    expect(out[0]!.indexBase100).toBe(100);
    expect(navOfPoint(windowed[0]!, "financier")).toBe(90_000);
  });
});

describe("vsIndexChartKind — pas de +0 % fantôme", () => {
  it("Versus éteint → NAV seulement, jamais un graphe %", () => {
    expect(
      vsIndexChartKind({ versus: "none", indexError: false, hasOverlay: true })
    ).toBe("nav");
    expect(
      vsIndexChartKind({ versus: "none", indexError: true, hasOverlay: false })
    ).toBe("nav");
  });

  it("403 / erreur fournisseur → empty state, pas une ligne plate à +0 %", () => {
    expect(
      vsIndexChartKind({ versus: "index", indexError: true, hasOverlay: false })
    ).toBe("index-unavailable");
    expect(
      vsIndexChartKind({ versus: "index", indexError: true, hasOverlay: true })
    ).toBe("index-unavailable");
    expect(INDEX_UNAVAILABLE_TITLE).toBe("Indice indisponible");
  });

  it("overlay off (vide / 429 sans erreur HTTP) → NAV seule", () => {
    expect(
      vsIndexChartKind({ versus: "index", indexError: false, hasOverlay: false })
    ).toBe("nav");
    expect(vsIndexHasOverlay([{}, { benchmarkPct: undefined }])).toBe(false);
  });

  it("overlay présent → graphe %", () => {
    expect(
      vsIndexChartKind({ versus: "index", indexError: false, hasOverlay: true })
    ).toBe("percent");
    expect(
      vsIndexHasOverlay([{ benchmarkPct: 0 }, { benchmarkPct: 4 }])
    ).toBe(true);
  });
});

describe("toVsIndexPercentPoints", () => {
  it("expose les % (base 100 − 100) que le graphe Versus lit", () => {
    const pct = toVsIndexPercentPoints(
      rebaseToCommonBase100(
        [nav("2026-01-05", 50_000), nav("2026-01-06", 55_000)],
        [cac("2026-01-05", 8_000), cac("2026-01-06", 7_600)]
      )
    );
    expect(pct[0]!.portfolioPct).toBe(0);
    expect(pct[0]!.benchmarkPct).toBe(0);
    expect(pct[1]!.portfolioPct).toBeCloseTo(10, 6);
    expect(pct[1]!.benchmarkPct).toBeCloseTo(-5, 6);
  });
});

describe("contrat Finance — gardes structurelles", () => {
  it("ne recalcule pas Δmarché / flux et n'emprunte pas le DCA", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("app/lib/portfolio/vs-index-series.ts", "utf8")
    );
    expect(src).not.toMatch(/\bdailyNavDeltas\s*\(/);
    expect(src).not.toMatch(/\bfluxOfDay\s*\(/);
    expect(src).not.toMatch(/\bbuildBenchmarkSeries\s*\(/);
    expect(src).not.toMatch(/\blerp\s*\(/);
  });

  it("le panneau Versus lit MARKET_INDICES + /api/benchmark, pas le DCA", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        "components/dashboard/portfolio-evolution-panel.tsx",
        "utf8"
      )
    );
    expect(src).toMatch(/MARKET_INDICES/);
    expect(src).toMatch(/\/api\/benchmark/);
    expect(src).not.toMatch(/buildBenchmarkSeries/);
    expect(src).toMatch(/servedNavFrom/);
    expect(src).toMatch(/jamais `navQueryFrom`/);
    expect(src).toMatch(/vsIndexChartKind/);
    expect(src).toMatch(/INDEX_UNAVAILABLE_TITLE/);
    expect(src).not.toMatch(/toPercentSeries\s*\(/);
  });

  it("un samedi n'est pas la moyenne vendredi–lundi", () => {
    const out = rebaseToCommonBase100(
      [
        nav("2026-01-02", 100_000),
        nav("2026-01-03", 100_000),
        nav("2026-01-05", 100_000),
      ],
      [cac("2026-01-02", 8_000), cac("2026-01-05", 8_800)]
    );
    expect(out[1]!.day).toBe("2026-01-03");
    expect(out[1]!.indexBase100).toBe(100);
    expect(out[1]!.indexBase100).not.toBeCloseTo(105, 5);
  });
});
