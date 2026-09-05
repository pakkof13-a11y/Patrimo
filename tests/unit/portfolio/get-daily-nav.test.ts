import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import {
  dailyNavFromSeries,
  financierFlowOf,
  isDailyNavScope,
  listedTransactionFlow,
  navAtScope,
  parseDayKey,
} from "@/app/lib/portfolio/historical/get-daily-nav";
import { d } from "@/app/lib/money/decimal";
import { enumerateDays } from "@/app/lib/portfolio/historical/timeline";
import type { LedgerTx } from "@/app/lib/accounting/types";
import {
  CENTIME_EUR,
  computePatrimonyMetrics,
} from "@/app/lib/portfolio/patrimony-metrics";

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

/** Week-end civil (samedi/dimanche) du calendrier grégorien. */
function isWeekend(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** Clôtures des seuls jours de semaine — comme Yahoo, sans barres WE inventées. */
function weekdayCloses(
  assetId: string,
  from: string,
  to: string,
  priceAt: (day: string, i: number) => number
): Map<string, Map<string, number>> {
  const series = new Map<string, number>();
  enumerateDays(from, to).forEach((day, i) => {
    if (isWeekend(day)) return;
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

  it("les scopes T-01 + poches d'actif sont reconnus — pas les passifs", () => {
    expect(isDailyNavScope("financier")).toBe(true);
    expect(isDailyNavScope("brut")).toBe(true);
    expect(isDailyNavScope("net")).toBe(true);
    expect(isDailyNavScope("listed")).toBe(true);
    expect(isDailyNavScope("immobilier")).toBe(true);
    expect(isDailyNavScope("av")).toBe(true);
    expect(isDailyNavScope("cash")).toBe(true);
    expect(isDailyNavScope("alternatifs")).toBe(true);
    expect(isDailyNavScope("employeeSavings")).toBe(true);
    expect(isDailyNavScope("autre")).toBe(true);
    expect(isDailyNavScope("passifs")).toBe(false);
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

  it("pastilles = flux cotés, pas l'achat immo (externalFlows)", () => {
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
            { accountType: "IMMOBILIER", hasRealEstateDetail: true },
          ],
        ]),
        closes: closesFor("aapl", from, to, () => 100),
      })
    );
    const nav = dailyNavFromSeries(e.buildSeries(from, to), "financier");
    const jourAchat = nav.find((p) => p.day === immoDay)!;
    const veille = nav.find((p) => p.day === "2026-01-14")!;
    expect(jourAchat.externalFlows).toBe(250_000);
    expect(jourAchat.transactionFlow).toBe(0);
    expect(jourAchat.financierFlows).toBe(0);
    expect(jourAchat.financier).toBe(veille.financier);
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
      expect(navAtScope(p, "brut")).toBe(p.brut);
      expect(navAtScope(p, "net")).toBe(p.net);
      expect(navAtScope(p, "financier")).toBe(p.financier);
      expect(navAtScope(p, "listed")).toBe(p.pockets.listed);
      expect(p.financier).toBeLessThanOrEqual(p.brut + 0.01);
      expect(p.net).toBeCloseTo(p.brut - p.pockets.passifs, 8);
    }
  });
});

describe("T-05 golden 1 — 1 point / jour civil, longueur = nb jours calendaires", () => {
  it("1A inclusive : autant de points que de jours dans [from, to]", () => {
    const from = "2025-09-04";
    const to = "2026-09-04";
    const days = enumerateDays(from, to);
    expect(days.length).toBeGreaterThanOrEqual(365);

    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", from, 10, 100)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: weekdayCloses("aapl", from, to, (_d, i) => 100 + Math.sin(i / 5) * 6),
      })
    );
    const nav = dailyNavFromSeries(e.buildSeries(from, to), "financier");
    expect(nav).toHaveLength(days.length);
    expect(nav.map((p) => p.day)).toEqual(days);
  });
});

describe("T-05 golden 2 — cotés : qty×close, WE/férié = LOCF ESTIMATED", () => {
  it("samedi/dimanche portent le close du vendredi, tag ESTIMATED", () => {
    // 2026-01-02 = vendredi, 3 = samedi, 4 = dimanche, 5 = lundi
    const friday = "2026-01-02";
    const saturday = "2026-01-03";
    const sunday = "2026-01-04";
    const monday = "2026-01-05";
    expect(isWeekend(friday)).toBe(false);
    expect(isWeekend(saturday)).toBe(true);
    expect(isWeekend(sunday)).toBe(true);

    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", friday, 10, 100)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: new Map([
          [
            "aapl",
            new Map([
              [friday, 110],
              [monday, 120],
            ]),
          ],
        ]),
      })
    );
    const nav = dailyNavFromSeries(e.buildSeries(friday, monday), "listed");
    const ven = nav.find((p) => p.day === friday)!;
    const sam = nav.find((p) => p.day === saturday)!;
    const dim = nav.find((p) => p.day === sunday)!;
    const lun = nav.find((p) => p.day === monday)!;

    expect(ven.nav).toBe(10 * 110);
    expect(sam.nav).toBe(10 * 110);
    expect(dim.nav).toBe(10 * 110);
    expect(lun.nav).toBe(10 * 120);

    const series = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", friday, 10, 100)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: new Map([
          [
            "aapl",
            new Map([
              [friday, 110],
              [monday, 120],
            ]),
          ],
        ]),
      })
    ).buildSeries(friday, monday);

    expect(series.find((p) => p.day === friday)!.status).toBe("EXACT");
    expect(series.find((p) => p.day === saturday)!.status).toBe("ESTIMATED");
    expect(series.find((p) => p.day === sunday)!.status).toBe("ESTIMATED");
    expect(series.find((p) => p.day === saturday)!.priceOrigins).toContain(
      "MARKET_CARRIED"
    );
    expect(series.find((p) => p.day === friday)!.priceOrigins).toContain(
      "DAILY_EXACT"
    );
  });
});

describe("T-05 golden 3 — pas d'interpolation immo/AV, pas de padding à 0", () => {
  it("immo : entre deux expertises, palier au dernier constat — jamais de pente", () => {
    const from = "2026-01-01";
    const to = "2026-03-01";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "maison", from, 1, 200_000)],
        assetClassById: new Map([["maison", "IMMOBILIER"]]),
        rawAssetClassById: new Map([["maison", "IMMOBILIER"]]),
        holdingMetaById: new Map([
          ["maison", { accountType: "IMMOBILIER", hasRealEstateDetail: true }],
        ]),
        closes: new Map([
          [
            "maison",
            new Map([
              [from, 200_000],
              ["2026-03-01", 240_000],
            ]),
          ],
        ]),
      })
    );
    const nav = dailyNavFromSeries(e.buildSeries(from, to), "immobilier");
    const mid = nav.find((p) => p.day === "2026-02-01")!;
    expect(mid.nav).toBe(200_000);
    expect(mid.nav).not.toBe(220_000);
    for (const p of nav) {
      expect(p.nav).toBeGreaterThan(0);
    }
  });

  it("immo sans close avant l'expertise : coût, jamais 0", () => {
    const from = "2026-01-01";
    const expertise = "2026-03-01";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "maison", from, 1, 250_000)],
        assetClassById: new Map([["maison", "IMMOBILIER"]]),
        rawAssetClassById: new Map([["maison", "IMMOBILIER"]]),
        holdingMetaById: new Map([
          ["maison", { accountType: "IMMOBILIER", hasRealEstateDetail: true }],
        ]),
        closes: new Map([["maison", new Map([[expertise, 280_000]])]]),
      })
    );
    const nav = dailyNavFromSeries(e.buildSeries(from, expertise), "immobilier");
    const avant = nav.find((p) => p.day === "2026-02-01")!;
    const jour = nav.find((p) => p.day === expertise)!;
    expect(avant.nav).toBe(250_000);
    expect(jour.nav).toBe(280_000);
    expect(nav.every((p) => p.nav > 0)).toBe(true);
  });

  it("cotés sans close : coût, jamais padding à 0", () => {
    const day = "2026-06-01";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", day, 10, 50)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: new Map(),
      })
    );
    const p = e.buildSeries(day, day)[0]!;
    expect(navAtScope(p, "listed")).toBe(500);
    expect(p.status).toBe("ESTIMATED");
    expect(p.priceOrigins).toContain("UNAVAILABLE");
  });
});

describe("T-05 golden 5 — démo 1A : variance intra-mois sur listed", () => {
  it("un mois au milieu d'une fenêtre 1A n'est pas trois marches d'events", () => {
    const from = "2025-09-04";
    const to = "2026-09-04";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", "aapl", from, 10, 100)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: weekdayCloses("aapl", from, to, (_d, i) => 100 + Math.sin(i / 4) * 12),
      })
    );
    const nav = dailyNavFromSeries(e.buildSeries(from, to), "listed");
    const fev = nav.filter((p) => p.day.startsWith("2026-02-"));
    expect(fev.length).toBe(28);
    const uniq = new Set(fev.map((p) => p.nav.toFixed(2)));
    expect(uniq.size).toBeGreaterThan(5);

    const values = nav.map((p) => p.nav);
    const ups = values.filter((v, i) => i > 0 && v > values[i - 1]!).length;
    const downs = values.filter((v, i) => i > 0 && v < values[i - 1]!).length;
    expect(ups).toBeGreaterThan(20);
    expect(downs).toBeGreaterThan(20);
  });
});

describe("T-05 golden 6 — point live = hero Financier (±0,01 €)", () => {
  it("dernier point getDailyNav.financier = computePatrimonyMetrics.financier", () => {
    const from = "2026-08-01";
    const to = "2026-09-04";
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "aapl", from, 10, 100),
          buy("t2", "fe", from, 1, 10_000),
        ],
        assetClassById: new Map([
          ["aapl", "ACTIONS"],
          ["fe", "ASSURANCE_VIE"],
        ]),
        rawAssetClassById: new Map([
          ["aapl", "ACTIONS"],
          ["fe", "OBLIGATIONS"],
        ]),
        holdingMetaById: new Map([
          ["aapl", { accountType: "CTO" }],
          ["fe", { accountType: "AV", isFondsEuro: true, name: "Fonds euro" }],
        ]),
        closes: weekdayCloses("aapl", from, to, () => 103.5),
        cashAccounts: [{ id: "b1", balanceEur: d(4_000), createdAt: DAY(from) }],
        employeeSavings: [
          {
            id: "es1",
            contributionDate: DAY(from),
            createdAt: DAY(from),
            updatedAt: DAY(from),
            contributedEur: d(2_000),
            currentEur: d(2_000),
            isLiquid: true,
          },
        ],
      })
    );
    const series = e.buildSeries(from, to);
    const live = series[series.length - 1]!;
    const liveAt = e.calculateAt(to);
    expect(Math.abs(live.financier - liveAt.financier)).toBeLessThanOrEqual(
      CENTIME_EUR.toNumber()
    );

    const listed = 10 * 103.5;
    const recomposed = computePatrimonyMetrics({
      holdings: [
        {
          id: "aapl",
          assetClass: "ACTIONS",
          accountType: "CTO",
          marketValueEur: listed,
        },
        {
          id: "fe",
          assetClass: "OBLIGATIONS",
          accountType: "AV",
          marketValueEur: 10_000,
          isFondsEuro: true,
        },
      ],
      cash: 4_000,
      alternatives: 0,
      employeeSavings: { total: 2_000, esLiquid: 2_000 },
      liabilities: 0,
    });
    expect(
      Math.abs(live.financier - recomposed.financier.toNumber())
    ).toBeLessThanOrEqual(CENTIME_EUR.toNumber());
    expect(navAtScope(live, "financier")).toBe(live.financier);
  });
});

describe("flux Financier — une clé manquante n'est pas NaN", () => {
  it("listedTransactionFlow et financierFlowOf restent des nombres", () => {
    const partiel = { ACTIONS: 10 } as Parameters<typeof listedTransactionFlow>[0];
    expect(listedTransactionFlow(partiel)).toBe(10);
    expect(Number.isNaN(financierFlowOf(partiel))).toBe(false);
    expect(financierFlowOf(partiel)).toBe(10);
  });
});

describe("T-05 golden 7 — getDailyNav ne downsample jamais", () => {
  it("le source de get-daily-nav n'appelle pas downsampleSeries", () => {
    const src = readFileSync(
      join(__dirname, "../../../app/lib/portfolio/historical/get-daily-nav.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/downsampleSeries/);
  });
});
