import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import {
  dailyNavFromSeries,
  isDailyNavScope,
  navAtScope,
  parseDayKey,
} from "@/app/lib/portfolio/historical/get-daily-nav";
import { d } from "@/app/lib/money/decimal";
import { enumerateDays } from "@/app/lib/portfolio/historical/timeline";
import type { LedgerTx } from "@/app/lib/accounting/types";
import { computePatrimonyMetrics } from "@/app/lib/portfolio/patrimony-metrics";

/**
 * T-05 — getDailyNav.
 *
 * La série est quotidienne et dense. Financier suit T-01
 * (listed + cashInvest + fondsEuro + esLiquid), pas le brut.
 */

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

function closesFor(
  assetId: string,
  from: string,
  to: string,
  priceAt: (day: string, i: number) => number
): Map<string, Map<string, number>> {
  const series = new Map<string, number>();
  enumerateDays(from, to).forEach((day, i) => {
    series.set(day, priceAt(day, i));
  });
  return new Map([[assetId, series]]);
}

describe("parse / scopes", () => {
  it("n'accepte qu'un jour civil YYYY-MM-DD", () => {
    expect(parseDayKey("2026-01-15")).toBe("2026-01-15");
    expect(parseDayKey("2026-1-15")).toBeNull();
    expect(parseDayKey("not-a-day")).toBeNull();
    expect(parseDayKey(null)).toBeNull();
  });

  it("les scopes T-01 + poches sont reconnus", () => {
    expect(isDailyNavScope("financier")).toBe(true);
    expect(isDailyNavScope("brut")).toBe(true);
    expect(isDailyNavScope("net")).toBe(true);
    expect(isDailyNavScope("listed")).toBe(true);
    expect(isDailyNavScope("immobilier")).toBe(true);
    expect(isDailyNavScope("totaux")).toBe(false);
  });
});

describe("série dense — pas un escalier d'événements", () => {
  it("getDailyNav({ scope: financier }) a exactement 1 point par jour", () => {
    const from = "2026-01-01";
    const to = "2026-03-31";
    const days = enumerateDays(from, to);
    expect(days.length).toBeGreaterThan(80);

    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", from, 10, 100)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: closesFor("aapl", from, to, (_d, i) => 100 + Math.sin(i / 3) * 8),
        cashAccounts: [
          { id: "b1", balanceEur: d(5_000), createdAt: DAY(from) },
        ],
      })
    );

    const series = e.buildSeries(from, to);
    const nav = dailyNavFromSeries(series, "financier");

    expect(nav).toHaveLength(days.length);
    expect(nav.map((p) => p.day)).toEqual(days);
    expect(new Set(nav.map((p) => p.day)).size).toBe(days.length);
  });

  it("sur ~3 mois, Financier monte et descend intra-mois — pas trois marches", () => {
    const from = "2026-01-01";
    const to = "2026-03-31";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", from, 10, 100)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: closesFor("aapl", from, to, (_d, i) => 100 + Math.sin(i / 4) * 12),
      })
    );

    const nav = dailyNavFromSeries(e.buildSeries(from, to), "financier");
    const values = nav.map((p) => p.nav);
    const uniq = new Set(values.map((v) => v.toFixed(2)));
    expect(uniq.size).toBeGreaterThan(20);

    const ups = values.filter((v, i) => i > 0 && v > values[i - 1]!).length;
    const downs = values.filter((v, i) => i > 0 && v < values[i - 1]!).length;
    expect(ups).toBeGreaterThan(10);
    expect(downs).toBeGreaterThan(10);

    // Un escalier d'achats n'aurait que 1–2 paliers sur la fenêtre.
    expect(uniq.size).not.toBeLessThanOrEqual(3);
  });
});

describe("scopes T-01 — Financier ≠ Brut, immo hors Financier", () => {
  it("achat immo : ΔFinancier = 0, ΔBrut = prix", () => {
    const from = "2026-01-01";
    const to = "2026-01-31";
    const immoDay = "2026-01-15";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "aapl", from, 10, 100),
          buy("t2", "maison", immoDay, 1, 250_000),
        ],
        assetClassById: new Map([
          ["aapl", "ACTIONS"],
          ["maison", "IMMOBILIER"],
        ]),
        rawAssetClassById: new Map([
          ["aapl", "ACTIONS"],
          ["maison", "IMMOBILIER"],
        ]),
        holdingMetaById: new Map([
          ["aapl", { accountType: "CTO" }],
          [
            "maison",
            {
              accountType: "IMMOBILIER",
              hasRealEstateDetail: true,
            },
          ],
        ]),
        closes: closesFor("aapl", from, to, () => 100),
        cashAccounts: [
          { id: "b1", balanceEur: d(20_000), createdAt: DAY(from) },
        ],
      })
    );

    const series = e.buildSeries(from, to);
    const avant = series.find((p) => p.day === "2026-01-14")!;
    const apres = series.find((p) => p.day === immoDay)!;

    expect(navAtScope(apres, "financier") - navAtScope(avant, "financier")).toBe(0);
    expect(navAtScope(apres, "brut") - navAtScope(avant, "brut")).toBe(250_000);
    expect(navAtScope(apres, "net") - navAtScope(avant, "net")).toBe(250_000);
    expect(apres.listed).toBe(avant.listed);
  });

  it("financier = listed + cash + fondsEuro + esLiquid (formule T-01)", () => {
    const day = "2026-06-01";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "aapl", day, 2, 50),
          buy("t2", "fe", day, 1, 10_000),
          buy("t3", "uc", day, 1, 4_000),
        ],
        assetClassById: new Map([
          ["aapl", "ACTIONS"],
          ["fe", "ASSURANCE_VIE"],
          ["uc", "ASSURANCE_VIE"],
        ]),
        rawAssetClassById: new Map([
          ["aapl", "ACTIONS"],
          ["fe", "OBLIGATIONS"],
          ["uc", "ACTIONS"],
        ]),
        holdingMetaById: new Map([
          ["aapl", { accountType: "CTO" }],
          ["fe", { accountType: "AV", isFondsEuro: true, name: "Fonds euro" }],
          ["uc", { accountType: "AV", isFondsEuro: false, name: "UC" }],
        ]),
        closes: new Map([
          ["aapl", new Map([[day, 50]])],
          ["fe", new Map([[day, 10_000]])],
          ["uc", new Map([[day, 4_000]])],
        ]),
        cashAccounts: [{ id: "b1", balanceEur: d(3_000), createdAt: DAY(day) }],
        employeeSavings: [
          {
            id: "es1",
            contributionDate: DAY(day),
            createdAt: DAY(day),
            updatedAt: DAY(day),
            contributedEur: d(2_000),
            currentEur: d(2_000),
            isLiquid: true,
          },
          {
            id: "es2",
            contributionDate: DAY(day),
            createdAt: DAY(day),
            updatedAt: DAY(day),
            contributedEur: d(8_000),
            currentEur: d(8_000),
            isLiquid: false,
          },
        ],
      })
    );

    const p = e.buildSeries(day, day)[0]!;
    expect(p.listed).toBe(100);
    expect(p.fondsEuro).toBe(10_000);
    expect(p.esLiquid).toBe(2_000);
    expect(p.financier).toBe(100 + 3_000 + 10_000 + 2_000);
    expect(p.lifeInsurance).toBe(14_000);
    expect(p.employeeSavings).toBe(10_000);
    expect(p.grossAssets).toBe(p.financier + 4_000 + 8_000);

    const recomposed = computePatrimonyMetrics({
      holdings: [
        {
          id: "aapl",
          assetClass: "ACTIONS",
          accountType: "CTO",
          marketValueEur: 100,
        },
        {
          id: "fe",
          assetClass: "OBLIGATIONS",
          accountType: "AV",
          marketValueEur: 10_000,
          isFondsEuro: true,
        },
        {
          id: "uc",
          assetClass: "ACTIONS",
          accountType: "AV",
          marketValueEur: 4_000,
        },
      ],
      cash: 3_000,
      alternatives: 0,
      employeeSavings: { total: 10_000, esLiquid: 2_000 },
      liabilities: 0,
    });
    expect(p.financier).toBe(recomposed.financier.toNumber());
    expect(p.listed).toBe(recomposed.pockets.listed.toNumber());
  });

  it("brut / net / financier restent des lectures du même point", () => {
    const from = "2026-02-01";
    const to = "2026-02-05";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", from, 1, 200)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        closes: closesFor("aapl", from, to, (_d, i) => 200 + i * 5),
        cashAccounts: [{ id: "b1", balanceEur: d(1_000), createdAt: DAY(from) }],
        liabilities: [
          {
            id: "l1",
            startDate: DAY(from),
            createdAt: DAY(from),
            updatedAt: DAY(from),
            initialAmountEur: d(400),
            remainingAmountEur: d(400),
            events: [],
          },
        ],
      })
    );
    const series = e.buildSeries(from, to);
    for (const p of series) {
      expect(navAtScope(p, "brut")).toBe(p.grossAssets);
      expect(navAtScope(p, "net")).toBe(p.netWorth);
      expect(navAtScope(p, "financier")).toBe(p.financier);
      expect(p.financier).toBeLessThanOrEqual(p.grossAssets + 0.01);
      expect(p.netWorth).toBeCloseTo(p.grossAssets - p.liabilities, 8);
    }
  });
});
