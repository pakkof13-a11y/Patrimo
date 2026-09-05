/**
 * T-04 lot D — `getDailyNav` ramène `from` à la borne du scope, et l'annonce.
 *
 * `loadHistoricalInputs` est mocké : ce module lit Prisma, et cette suite ne
 * teste que l'orchestration `getDailyNav` (clamp + réponse), pas le
 * chargement. Le moteur (`PortfolioValuationEngine`) reste réel — c'est lui
 * qui porte `earliestDayForScope`.
 */
import { describe, expect, it, vi } from "vitest";
import { d } from "@/app/lib/money/decimal";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import type { LedgerTx } from "@/app/lib/accounting/types";

const DAY = (s: string) => new Date(`${s}T10:00:00Z`);

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

const demoInputs: HistoricalInputs = {
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
  envelopeEventsByAsset: new Map(),
  excludedAssetIds: new Set(),
  holdingMetaById: new Map([
    ["maison", { accountType: "IMMOBILIER", hasRealEstateDetail: true }],
    ["aapl", { accountType: "CTO" }],
  ]),
  closes: new Map([["aapl", new Map([["2022-10-06", 100]])]]),
  cashAccounts: [],
  cashEvents: [],
  metals: [],
  privateEquity: [],
  crowdlending: [],
  tangibles: [],
  employeeSavings: [],
  liabilities: [],
};

vi.mock("@/app/lib/portfolio/historical/load", () => ({
  loadHistoricalInputs: vi.fn(async () => demoInputs),
}));

const { getDailyNav } = await import(
  "@/app/lib/portfolio/historical/get-daily-nav"
);

describe("getDailyNav — borne « Tout » par scope", () => {
  it("from=1900-01-01, scope=brut : ramené à 1998-06-20, r.from l'annonce", async () => {
    const r = await getDailyNav({
      userId: "u1",
      scope: "brut",
      from: "1900-01-01",
      to: "2022-10-06",
    });
    expect(r.from).toBe("1998-06-20");
    expect(r.points[0]!.day).toBe("1998-06-20");
    expect(r.points.every((p) => p.day >= "1998-06-20")).toBe(true);
  });

  it("from=1900-01-01, scope=financier : ramené à 2022-10-06, jamais avant", async () => {
    const r = await getDailyNav({
      userId: "u1",
      scope: "financier",
      from: "1900-01-01",
      to: "2022-10-06",
    });
    expect(r.from).toBe("2022-10-06");
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.day).toBe("2022-10-06");
  });

  it("les deux bornes diffèrent bien sur les mêmes données (1998 vs 2022)", async () => {
    const brut = await getDailyNav({
      userId: "u1",
      scope: "brut",
      from: "1900-01-01",
      to: "2022-10-06",
    });
    const financier = await getDailyNav({
      userId: "u1",
      scope: "financier",
      from: "1900-01-01",
      to: "2022-10-06",
    });
    expect(brut.from).toBe("1998-06-20");
    expect(financier.from).toBe("2022-10-06");
    expect(brut.from < financier.from).toBe(true);
  });

  it("un scope vide (aucune donnée jamais observée) ne fabrique pas de série fantôme", async () => {
    const r = await getDailyNav({
      userId: "u1",
      scope: "employeeSavings",
      from: "1900-01-01",
      to: "2022-10-06",
    });
    expect(r.points).toEqual([]);
  });

  it("from déjà valide (postérieur à la borne) n'est pas modifié", async () => {
    const r = await getDailyNav({
      userId: "u1",
      scope: "brut",
      from: "2022-01-01",
      to: "2022-10-06",
    });
    expect(r.from).toBe("2022-01-01");
  });
});
