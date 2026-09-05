import { describe, expect, it } from "vitest";
import {
  dailyNavDeltas,
  dailyNavKpiSeries,
  dailyNavQueryWindow,
  dailyNavToHistoryPoints,
  fluxOfDay,
  headerDelta,
  headerFlux,
  headerMarketDelta,
  navOfPoint,
  sumDailyDeltas,
  toDailyNavChartPoints,
  windowDailyNav,
} from "@/app/lib/portfolio/daily-nav-view";
import type { DailyNavPoint } from "@/app/lib/portfolio/historical/get-daily-nav";
import { enumerateDays } from "@/app/lib/portfolio/historical/timeline";

function pt(
  day: string,
  over: Partial<DailyNavPoint> & {
    financier: number;
    brut: number;
    net?: number;
  }
): DailyNavPoint {
  return {
    day,
    nav: over.nav ?? over.financier,
    status: over.status ?? "EXACT",
    externalFlows: over.externalFlows ?? 0,
    transactionFlow: over.transactionFlow ?? 0,
    financierFlows: over.financierFlows ?? 0,
    listed: over.listed ?? over.financier,
    financier: over.financier,
    brut: over.brut,
    net: over.net ?? over.brut,
    cash: over.cash ?? 0,
    immobilier: over.immobilier ?? 0,
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
  };
}

/** Série dense : un point par jour, Financier qui oscille, pas trois marches. */
function denseFinancier(from: string, to: string): DailyNavPoint[] {
  return enumerateDays(from, to).map((day, i) => {
    const listed = 100_000 + Math.round(Math.sin(i / 3) * 800);
    return pt(day, {
      financier: listed + 5_000,
      brut: listed + 5_000 + 200_000,
      net: listed + 5_000 + 200_000 - 50_000,
      listed,
      cash: 5_000,
      immobilier: 200_000,
      passifs: 50_000,
      status: i % 7 === 6 || i % 7 === 5 ? "ESTIMATED" : "EXACT",
      priceOrigins:
        i % 7 === 6 || i % 7 === 5 ? ["MARKET_CARRIED"] : ["DAILY_EXACT"],
    });
  });
}

describe("windowDailyNav — période = fenêtre, pas texture", () => {
  const series = denseFinancier("2025-09-01", "2026-09-03");

  it("1M et 1A restent quotidiennes — pas de seau mensuel", () => {
    const unMois = windowDailyNav(series, "1m", "2026-09-03");
    const unAn = windowDailyNav(series, "1y", "2026-09-03");
    expect(unMois.length).toBeGreaterThan(20);
    expect(unAn.length).toBeGreaterThan(unMois.length);

    for (let i = 1; i < unMois.length; i++) {
      expect(unMois[i]!.day > unMois[i - 1]!.day).toBe(true);
    }
    // Aucun trou : jours civils consécutifs dans la fenêtre interne.
    const inner = unMois.slice(1);
    for (let i = 1; i < inner.length; i++) {
      const prev = Date.parse(`${inner[i - 1]!.day}T12:00:00Z`);
      const curr = Date.parse(`${inner[i]!.day}T12:00:00Z`);
      expect((curr - prev) / 86_400_000).toBe(1);
    }
  });

  it("Max conserve 1 pt/jour sur toute la série", () => {
    const all = windowDailyNav(series, "all", "2026-09-03");
    expect(all).toHaveLength(series.length);
    expect(all.map((p) => p.day)).toEqual(series.map((p) => p.day));
  });
});

describe("cartes Brut / Net / Financier — même série, champ distinct", () => {
  const series = denseFinancier("2026-01-01", "2026-03-31");

  it("Financier ≠ Brut dès qu'il y a de l'immo", () => {
    const last = series[series.length - 1]!;
    expect(navOfPoint(last, "financier")).toBe(last.financier);
    expect(navOfPoint(last, "brut")).toBe(last.brut);
    expect(last.financier).toBeLessThan(last.brut);
    expect(navOfPoint(last, "net")).toBe(last.net);
  });

  it("un achat immo ne fait pas cliffer Financier", () => {
    const avant = pt("2026-01-01", {
      financier: 100_000,
      brut: 100_000,
      listed: 100_000,
    });
    const apres = pt("2026-01-02", {
      financier: 100_000,
      brut: 1_080_000,
      listed: 100_000,
      immobilier: 980_000,
      externalFlows: 980_000,
      transactionFlow: 0,
      financierFlows: 0,
    });
    expect(navOfPoint(apres, "financier") - navOfPoint(avant, "financier")).toBe(
      0
    );
    expect(navOfPoint(apres, "brut") - navOfPoint(avant, "brut")).toBe(980_000);
  });
});

describe("Δ marché journaliers — somme ≈ (last − first) − Σ flux", () => {
  it("identité marché sur une série sans flux", () => {
    const series = denseFinancier("2026-01-01", "2026-03-31");
    const windowed = windowDailyNav(series, "3m", "2026-03-31");
    const deltas = dailyNavDeltas(windowed, "financier");
    const nav = headerDelta(windowed, "financier")!;
    const flow = headerFlux(windowed, "financier")!;
    expect(sumDailyDeltas(deltas)).toBeCloseTo(nav - flow, 8);
    expect(headerMarketDelta(windowed, "financier")).toBeCloseTo(nav - flow, 8);
  });

  it("l'ancre n'entre pas dans la somme", () => {
    const points = [
      pt("2026-01-01", { financier: 100, brut: 100 }),
      pt("2026-01-02", { financier: 110, brut: 110 }),
      pt("2026-01-03", { financier: 105, brut: 105 }),
    ];
    const deltas = dailyNavDeltas(points, "financier");
    expect(deltas[0]).toBe(0);
    expect(sumDailyDeltas(deltas)).toBe(5);
    expect(headerDelta(points, "financier")).toBe(5);
    expect(headerMarketDelta(points, "financier")).toBe(5);
  });

  it("un APPORT n'est pas une barre de performance", () => {
    const points = [
      pt("2026-01-01", { financier: 100_000, brut: 100_000 }),
      pt("2026-01-02", {
        financier: 150_000,
        brut: 150_000,
        cash: 50_000,
        externalFlows: 50_000,
        financierFlows: 50_000,
        transactionFlow: 0,
      }),
    ];
    const deltas = dailyNavDeltas(points, "financier");
    expect(deltas[1]).toBe(0);
    expect(fluxOfDay(points[1]!, points[0], "financier")).toBe(50_000);
    expect(headerDelta(points, "financier")).toBe(50_000);
    expect(headerMarketDelta(points, "financier")).toBe(0);
    expect(headerFlux(points, "financier")).toBe(50_000);
    expect(sumDailyDeltas(deltas)).toBe(0);

    const chart = toDailyNavChartPoints(points, "financier");
    expect(chart[1]!.delta).toBe(0);
    expect(chart[1]!.flux).toBe(50_000);
    expect(chart[1]!.total).toBe(150_000);
  });

  it("achat immo : ΔFinancier marché ≈ 0, flux sur brut/net", () => {
    const points = [
      pt("2026-01-01", { financier: 100_000, brut: 100_000, net: 100_000 }),
      pt("2026-01-02", {
        financier: 100_000,
        brut: 1_080_000,
        net: 1_080_000,
        immobilier: 980_000,
        externalFlows: 980_000,
        transactionFlow: 0,
        financierFlows: 0,
      }),
    ];
    expect(dailyNavDeltas(points, "financier")[1]).toBe(0);
    expect(dailyNavDeltas(points, "brut")[1]).toBe(0);
    expect(dailyNavDeltas(points, "net")[1]).toBe(0);
    expect(headerMarketDelta(points, "financier")).toBe(0);
    expect(headerFlux(points, "financier")).toBe(0);
    expect(headerFlux(points, "brut")).toBe(980_000);
    expect(headerFlux(points, "net")).toBe(980_000);
    expect(headerDelta(points, "brut")).toBe(980_000);
    expect(headerMarketDelta(points, "brut")).toBe(0);

    const fin = toDailyNavChartPoints(points, "financier");
    const brut = toDailyNavChartPoints(points, "brut");
    expect(fin[1]!.delta).toBe(0);
    expect(fin[1]!.flux).toBe(0);
    expect(brut[1]!.delta).toBe(0);
    expect(brut[1]!.flux).toBe(980_000);
  });

  it("en net, un emprunt rejoint les flux, pas le marché", () => {
    const points = [
      pt("2026-03-01", {
        financier: 100_000,
        brut: 100_000,
        net: 100_000,
        passifs: 0,
      }),
      pt("2026-03-02", {
        financier: 300_000,
        brut: 300_000,
        net: 100_000,
        cash: 200_000,
        passifs: 200_000,
        externalFlows: 200_000,
        financierFlows: 200_000,
      }),
    ];
    expect(dailyNavDeltas(points, "net")[1]).toBe(0);
    expect(headerMarketDelta(points, "net")).toBe(0);
    expect(headerFlux(points, "net")).toBe(0);
    expect(headerDelta(points, "net")).toBe(0);
    expect(headerMarketDelta(points, "brut")).toBe(0);
    expect(headerFlux(points, "brut")).toBe(200_000);
  });

  it("même jour : APPORT + hausse cotés → barre = marché seulement", () => {
    const points = [
      pt("2026-01-01", { financier: 100_000, brut: 100_000 }),
      pt("2026-01-02", {
        financier: 152_000,
        brut: 152_000,
        externalFlows: 50_000,
        financierFlows: 50_000,
      }),
    ];
    const deltas = dailyNavDeltas(points, "financier");
    expect(headerDelta(points, "financier")).toBe(52_000);
    expect(headerFlux(points, "financier")).toBe(50_000);
    expect(deltas[1]).toBe(2_000);
    expect(sumDailyDeltas(deltas)).toBe(2_000);
    expect(headerMarketDelta(points, "financier")).toBe(2_000);
    expect(sumDailyDeltas(deltas)).toBeCloseTo(
      headerDelta(points, "financier")! - headerFlux(points, "financier")!,
      8
    );
  });
});

describe("pastilles vs Marché/Flux", () => {
  it("toDailyNavChartPoints porte transactionFlow, pas l'immo en pastille", () => {
    const points = [
      pt("2026-01-01", { financier: 100_000, brut: 100_000 }),
      pt("2026-01-02", {
        financier: 100_000,
        brut: 1_080_000,
        immobilier: 980_000,
        externalFlows: 980_000,
        transactionFlow: 0,
      }),
      pt("2026-01-03", {
        financier: 105_000,
        brut: 1_085_000,
        transactionFlow: 4_000,
        financierFlows: 4_000,
        listed: 105_000,
      }),
    ];
    const chart = toDailyNavChartPoints(points, "financier");
    expect(chart[1]!.transactionFlow).toBe(0);
    expect(chart[1]!.flows).toBe(980_000);
    expect(chart[1]!.flux).toBe(0);
    expect(chart[1]!.delta).toBe(0);
    expect(chart[2]!.transactionFlow).toBe(4_000);
    expect(chart[2]!.flux).toBe(4_000);
    expect(chart[2]!.delta).toBe(1_000);
  });

  it("LOCF MARKET_CARRIED → carried (pastille creuse)", () => {
    const points = [
      pt("2026-01-02", {
        financier: 100,
        brut: 100,
        status: "EXACT",
        priceOrigins: ["DAILY_EXACT"],
      }),
      pt("2026-01-03", {
        financier: 100,
        brut: 100,
        status: "ESTIMATED",
        priceOrigins: ["MARKET_CARRIED"],
      }),
    ];
    const chart = toDailyNavChartPoints(points, "financier");
    expect(chart[0]!.carried).toBe(false);
    expect(chart[1]!.carried).toBe(true);
  });
});

describe("KPI Titres & crypto — listed du même point", () => {
  it("la spark listed ignore l'immo", () => {
    const points = [
      pt("2026-01-01", {
        financier: 100_000,
        brut: 300_000,
        listed: 80_000,
        immobilier: 200_000,
      }),
      pt("2026-01-02", {
        financier: 100_000,
        brut: 310_000,
        listed: 80_000,
        immobilier: 210_000,
      }),
    ];
    expect(dailyNavKpiSeries(points, "listed")).toEqual([80_000, 80_000]);
  });
});

describe("dailyNavToHistoryPoints — réutilise hero/KPI sans recalcul", () => {
  it("recopie financier / listed / transactionFlow", () => {
    const points = [
      pt("2026-01-01", {
        financier: 42,
        brut: 100,
        listed: 40,
        transactionFlow: 12,
        financierFlows: 12,
      }),
      pt("2026-01-02", {
        financier: 50,
        brut: 110,
        listed: 48,
        transactionFlow: 0,
      }),
    ];
    const history = dailyNavToHistoryPoints(points);
    expect(history).toHaveLength(2);
    expect(history[0]!.financierBase).toBe(42);
    expect(history[0]!.listedBase).toBe(40);
    expect(history[0]!.transactionFlowBase).toBe(12);
    expect(history[0]!.grossAssetsBase).toBe(100);
    expect(history[0]!.date.endsWith("Z")).toBe(true);
  });

  it("recopie le croisement classe × enveloppe, y compris UNKNOWN", () => {
    const points = [
      pt("2026-01-01", {
        financier: 40,
        brut: 40,
        listed: 40,
        byAssetClassAndEnvelope: {
          ACTIONS: { PEA: null, CTO: null, UNKNOWN: 40 },
          OBLIGATIONS: { PEA: 0, CTO: 0, UNKNOWN: 0 },
        },
      }),
    ];
    const history = dailyNavToHistoryPoints(points);
    expect(history[0]!.byAssetClassAndEnvelopeBase?.ACTIONS.UNKNOWN).toBe(40);
    expect(history[0]!.byAssetClassAndEnvelopeBase?.ACTIONS.PEA).toBeNull();
  });
});

describe("dailyNavQueryWindow", () => {
  it("1A reste une fenêtre glissante, pas un an civil", () => {
    const w = dailyNavQueryWindow("1y", "2026-09-03");
    expect(w.to).toBe("2026-09-03");
    expect(w.from < "2026-09-03").toBe(true);
    expect(w.from >= "2025-08-01").toBe(true);
  });

  it("Tout part du premier jour connu", () => {
    const w = dailyNavQueryWindow("all", "2026-09-03", "2020-01-15");
    expect(w).toEqual({ from: "2020-01-15", to: "2026-09-03" });
  });
});
