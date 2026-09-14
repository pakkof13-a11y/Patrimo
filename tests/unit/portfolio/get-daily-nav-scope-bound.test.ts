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
import { lastCloseAligned } from "@/app/lib/market/last-close-as-of";
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
  lastCloseAsOf: new Map([
    [
      "aapl",
      {
        day: "2022-10-06",
        closeEur: 100,
        fetchedAt: "2022-10-06T16:00:00.000Z",
        source: "daily-close" as const,
      },
    ],
  ]),
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
const { pocketSeriesTooShort } = await import(
  "@/app/lib/portfolio/pocket-series"
);

describe("getDailyNav — borne « Tout » par scope", () => {
  it("from=1900-01-01, scope=brut : ramené à 1998-06-20, r.from l'annonce", async () => {
    const r = await getDailyNav({
      userId: "u1",
      scope: "brut",
      from: "1900-01-01",
      to: "2022-10-06",
      // `now` proche de 2022 : le cap MAX_HISTORY_YEARS (6 ans) ne doit pas
      // interférer avec ce que ce test vérifie — le clamp par scope.
      now: DAY("2004-06-01"),
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
    expect(r.asOfDay).toBe("2022-10-06");
    expect(r.fetchedAt).toBe("2022-10-06T16:00:00.000Z");
    expect(lastCloseAligned("2022-10-06", r.asOfDay)).toBe(true);
  });

  it("les deux bornes diffèrent bien sur les mêmes données (1998 vs 2022)", async () => {
    const brut = await getDailyNav({
      userId: "u1",
      scope: "brut",
      from: "1900-01-01",
      to: "2022-10-06",
      now: DAY("2004-06-01"),
    });
    const financier = await getDailyNav({
      userId: "u1",
      scope: "financier",
      from: "1900-01-01",
      to: "2022-10-06",
      now: DAY("2004-06-01"),
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
    expect(r.asOfDay).toBeNull();
    expect(r.fetchedAt).toBeNull();
  });

  it("from=1900-01-01, scope=immobilier : clamp 1998, au moins 2 points (fenêtre 1998, `now` 1998)", async () => {
    // `now` posé la même année que la fenêtre demandée : le cap
    // MAX_HISTORY_YEARS (6 ans) ne mord alors pas sur 1998, et ce test
    // vérifie exactement ce qu'il vérifiait avant D19 — le clamp par scope,
    // pas le cap de profondeur.
    const r = await getDailyNav({
      userId: "u1",
      scope: "immobilier",
      from: "1900-01-01",
      to: "1998-07-20",
      now: DAY("1998-08-01"),
    });
    expect(r.from).toBe("1998-06-20");
    expect(r.points.length).toBeGreaterThanOrEqual(2);
    expect(r.points[0]!.day).toBe("1998-06-20");
    expect(r.points.every((p) => p.immobilier > 0)).toBe(true);
    expect(pocketSeriesTooShort(r.points)).toBe(false);
  });

  it("D19 — une fenêtre entièrement antérieure au plancher (aujourd'hui − 6 ans) ne produit aucun point", async () => {
    // Nouvelle vérité du cap : avec `now` réel (2026), le plancher est
    // 2020-09-06. Une demande bornée à 1998-07-20 tombe entièrement avant
    // ce plancher — `scopeEarliest > to`, donc une réponse vide, pas une
    // série tronquée à 1998. Les transactions de 1998 restent en base ;
    // seule leur lecture s'arrête.
    const r = await getDailyNav({
      userId: "u1",
      scope: "immobilier",
      from: "1900-01-01",
      to: "1998-07-20",
      now: DAY("2026-09-06"),
    });
    expect(r.points).toEqual([]);
    expect(r.asOfDay).toBeNull();
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
