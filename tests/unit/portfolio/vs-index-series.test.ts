/**
 * T-4.E — Vs CAC40, base 100 commune.
 *
 * La régression à empêcher : l'indice bouge, le portefeuille reste plat à
 * +0 %. Ça arrivait dès que la série daily-nav (même `from`/`to` que le
 * hero) passait par `toPercentSeries` sans `growth` — la NAV en euros se
 * taisait, le CAC déjà en % occupait l'axe.
 *
 * Ici les deux séries sont des **niveaux**, ramenés à 100 au premier jour
 * commun. Les tests mockent le réseau. Contrôle live (Yahoo ^FCHI, même
 * client que `/api/benchmark`) :
 *
 *   npx tsx scripts/check-vs-index-base100.ts
 */

import { describe, expect, it } from "vitest";
import {
  dailyNavQueryWindow,
  navOfPoint,
  windowDailyNav,
} from "@/app/lib/portfolio/daily-nav-view";
import type { DailyNavPoint } from "@/app/lib/portfolio/historical/get-daily-nav";
import {
  firstCommonDay,
  rebaseToCommonBase100,
  toVsIndexPercentPoints,
  vsIndexDayKey,
  vsIndexGapPct,
  type VsIndexLevel,
} from "@/app/lib/portfolio/vs-index-series";

function nav(day: string, value: number): VsIndexLevel {
  return { day, value };
}

function cac(day: string, close: number): VsIndexLevel {
  return { day, value: close };
}

function pt(day: string, financier: number): DailyNavPoint {
  return {
    day,
    nav: financier,
    status: "EXACT",
    externalFlows: 0,
    transactionFlow: 0,
    financierFlows: 0,
    listed: financier,
    financier,
    brut: financier + 200_000,
    net: financier + 150_000,
    cash: 0,
    immobilier: 0,
    av: 0,
    alternatifs: 0,
    employeeSavings: 0,
    passifs: 50_000,
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
      IMMOBILIER: 0,
      CASH: 0,
      AUTRE: 0,
    },
    flowsByAssetClass: {
      ACTIONS: 0,
      OBLIGATIONS: 0,
      CRYPTO: 0,
      IMMOBILIER: 0,
      CASH: 0,
      AUTRE: 0,
    },
  };
}

describe("rebaseToCommonBase100", () => {
  it("les deux courbes partent à 100 (0 %) le premier jour commun", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-05", 200_000), nav("2026-01-06", 210_000)],
      [cac("2026-01-05", 7_000), cac("2026-01-06", 7_350)]
    );
    expect(out[0]!.day).toBe("2026-01-05");
    expect(out[0]!.portfolioBase100).toBe(100);
    expect(out[0]!.indexBase100).toBe(100);
    expect(out[0]!.portfolioPct).toBe(0);
    expect(out[0]!.benchmarkPct).toBe(0);
  });

  it("un portefeuille qui bouge n'est jamais plat à +0 % si le CAC bouge", () => {
    /*
      DoD : « Portfolio flat +0% while CAC moves = FAIL ».
      NAV +5 %, CAC +4 % — les deux quittent 100.
    */
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
    /*
      Si l'on traçait 200 000 € à côté d'un CAC déjà en +2 %, le
      portefeuille saturait l'axe (ou, ramené à 0 par erreur, restait plat).
      Les deux sorties sont des base 100, même ordre de grandeur.
    */
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

  it("attend le premier jour où les deux séries existent", () => {
    const out = rebaseToCommonBase100(
      [
        nav("2026-01-02", 100_000),
        nav("2026-01-03", 101_000),
        nav("2026-01-05", 102_000),
        nav("2026-01-06", 104_040),
      ],
      [cac("2026-01-05", 7_000), cac("2026-01-06", 7_140)]
    );
    expect(firstCommonDay(
      [
        nav("2026-01-02", 100_000),
        nav("2026-01-05", 102_000),
      ],
      [cac("2026-01-05", 7_000)]
    )).toBe("2026-01-05");
    expect(out[0]!.day).toBe("2026-01-05");
    expect(out).toHaveLength(2);
    expect(out[0]!.portfolioBase100).toBe(100);
    expect(out[1]!.portfolioPct).toBeCloseTo(2, 6);
    expect(out[1]!.benchmarkPct).toBeCloseTo(2, 6);
  });

  it("un week-end de NAV reprend la clôture du vendredi (LOCF)", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-02", 50_000), nav("2026-01-03", 51_000), nav("2026-01-05", 52_000)],
      [cac("2026-01-02", 8_000), cac("2026-01-05", 8_160)]
    );
    expect(out[0]!.day).toBe("2026-01-02");
    expect(out[1]!.day).toBe("2026-01-03");
    expect(out[1]!.indexBase100).toBe(100);
    expect(out[2]!.indexBase100).toBeCloseTo(102, 6);
  });

  it("sans indice, le portefeuille part à 100 — pas une droite à +0 %", () => {
    const out = rebaseToCommonBase100(
      [nav("2026-01-05", 80_000), nav("2026-01-06", 88_000)]
    );
    expect(out[0]!.portfolioPct).toBe(0);
    expect(out[1]!.portfolioPct).toBeCloseTo(10, 6);
    expect(out[0]!.benchmarkPct).toBeUndefined();
    expect(out[1]!.benchmarkPct).toBeUndefined();
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

describe("vsIndexGapPct", () => {
  it("écart = perf portefeuille − perf indice, depuis le jour commun", () => {
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

  it("null sans indice ou sans deux points", () => {
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

describe("même fenêtre que daily-nav / hero", () => {
  it("le jour commun est pris dans windowDailyNav, pas avant", () => {
    const dense = [
      pt("2025-12-01", 90_000),
      pt("2026-02-01", 100_000),
      pt("2026-02-02", 103_000),
      pt("2026-03-01", 106_000),
    ];
    const windowed = windowDailyNav(dense, "1m", "2026-03-01");
    // Ancre hors plage (comme le hero) : elle borne le Δ, elle n'est pas
    // le jour commun si l'indice ne commence qu'après.
    expect(windowed[0]!.day).toBe("2025-12-01");
    const portfolio = windowed.map((p) => ({
      day: p.day,
      value: navOfPoint(p, "financier"),
    }));
    const out = rebaseToCommonBase100(portfolio, [
      cac("2026-02-01", 7_000),
      cac("2026-03-01", 7_210),
    ]);
    expect(out[0]!.day).toBe("2026-02-01");
    expect(out[0]!.portfolioBase100).toBe(100);
    expect(out[out.length - 1]!.portfolioPct).toBeCloseTo(6, 6);
  });

  it("dailyNavQueryWindow fournit les bornes from/to du hero", () => {
    const w = dailyNavQueryWindow("1m", "2026-03-01", "2022-10-01");
    expect(w.to).toBe("2026-03-01");
    expect(w.from <= "2026-02-01").toBe(true);
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
