import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { buildIntradaySeries } from "@/app/lib/portfolio/intraday/series";
import type { IntradayBarIndex } from "@/app/lib/portfolio/intraday/bar-index";
import { isCollectableSource } from "@/app/lib/market/intraday-collector";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * Convergence, devises, et ce qui n'entre jamais dans la série.
 *
 * Le point de ce fichier : la courbe horaire et la courbe quotidienne
 * décrivent le même patrimoine. Si elles divergent au même instant, l'une des
 * deux ment — c'est le défaut que les chantiers précédents ont supprimé, et
 * qu'une seconde source temporelle pourrait réintroduire.
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

describe("12 — convergence avec la clôture quotidienne", () => {
  it("le dernier point du jour rejoint la valeur quotidienne", async () => {
    /*
      Les deux moteurs reçoivent la même position et le même cours de clôture :
      118 € pour le 25. Le dernier point horaire de la journée porte ce cours,
      donc les deux valorisations doivent coïncider — à l'euro près, sans
      tolérance large qui masquerait un écart réel.
    */
    const position = {
      transactions: [buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100)],
      assetClassById: new Map([["a1", "ACTIONS"]]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
    };

    const quotidien = new PortfolioValuationEngine(
      inputs({
        ...position,
        closes: new Map([["a1", new Map([["2026-08-25", 118]])]]),
      })
    ).calculateAt("2026-08-25");

    const horaire = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T08:00:00Z"),
      to: t("2026-08-25T21:00:00Z"),
      deps: {
        loadBars: async () =>
          bars({
            a1: [
              ["2026-08-25T08:00:00Z", 110],
              ["2026-08-25T14:00:00Z", 105],
              ["2026-08-25T21:00:00Z", 118],
            ],
          }),
        buildEngine: async () => new PortfolioValuationEngine(inputs(position)),
      },
    });

    const dernier = horaire.points[horaire.points.length - 1]!;
    expect(dernier.grossAssets).toBeCloseTo(quotidien.grossAssets, 2);
    expect(dernier.netWorth).toBeCloseTo(quotidien.netWorth, 2);
    expect(dernier.securities).toBeCloseTo(1180, 2);
  });

  it("les passifs sont soustraits de la même façon des deux côtés", async () => {
    const commun = {
      transactions: [buy("t1", "a1", "2026-08-20T10:00:00Z", 10, 100)],
      assetClassById: new Map([["a1", "ACTIONS"]]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
      liabilities: [
        {
          id: "l1",
          startDate: t("2026-01-01T00:00:00Z"),
          createdAt: t("2026-01-01T00:00:00Z"),
          updatedAt: t("2026-01-01T00:00:00Z"),
          initialAmountEur: d(400),
          remainingAmountEur: d(400),
          events: [],
        },
      ],
    };

    const quotidien = new PortfolioValuationEngine(
      inputs({ ...commun, closes: new Map([["a1", new Map([["2026-08-25", 118]])]]) })
    ).calculateAt("2026-08-25");

    const horaire = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T21:00:00Z"),
      to: t("2026-08-25T21:00:00Z"),
      deps: {
        loadBars: async () => bars({ a1: [["2026-08-25T21:00:00Z", 118]] }),
        buildEngine: async () => new PortfolioValuationEngine(inputs(commun)),
      },
    });

    expect(horaire.points[0]!.liabilities).toBeCloseTo(quotidien.liabilities, 2);
    expect(horaire.points[0]!.netWorth).toBeCloseTo(quotidien.netWorth, 2);
  });

  it("les poches non cotées portent la même valeur qu'au jour le jour", async () => {
    /*
      Immobilier, alternatifs, épargne salariale, cash : rien de tout cela ne
      bouge dans la journée. La série horaire ne doit ni les figer à zéro, ni
      leur inventer un mouvement.
    */
    const commun = {
      cashAccounts: [
        { id: "b1", balanceEur: d(10_000), createdAt: t("2026-01-01T00:00:00Z") },
      ],
      tangibles: [
        {
          id: "tg1",
          purchaseDate: t("2026-01-01T00:00:00Z"),
          createdAt: t("2026-01-01T00:00:00Z"),
          updatedAt: t("2026-01-01T00:00:00Z"),
          costEur: d(50_000),
          estimatedValueEur: d(60_000),
          valuations: [],
        },
      ],
    };

    const quotidien = new PortfolioValuationEngine(inputs(commun)).calculateAt(
      "2026-08-25"
    );
    const horaire = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T10:00:00Z"),
      to: t("2026-08-25T12:00:00Z"),
      deps: {
        // Une barre existe pour qu'une série soit produite, sans position qui
        // la consomme : seules les poches pèsent.
        loadBars: async () => bars({ inutilise: [["2026-08-25T10:00:00Z", 1]] }),
        buildEngine: async () => new PortfolioValuationEngine(inputs(commun)),
      },
    });

    for (const p of horaire.points) {
      expect(p.cash).toBeCloseTo(quotidien.cash, 2);
      expect(p.alternatives).toBeCloseTo(quotidien.alternatives, 2);
    }
    // Et elles ne se mettent pas à bouger d'un point à l'autre.
    expect(new Set(horaire.points.map((p) => p.alternatives)).size).toBe(1);
  });
});

describe("3 — devises", () => {
  it("les barres sont en euros par construction", async () => {
    /*
      La conversion n'est pas refaite ici : `getAssetPriceHistory` interroge
      CoinGecko en `vs_currency=eur` et convertit Yahoo au chargement, et le
      collecteur refuse toute série qui ne serait pas en EUR. Refaire la
      conversion à la lecture obligerait à la maintenir en double, et une
      seconde convention de change est exactement ce qu'il ne faut pas créer.

      Ce test vérifie donc que la série additionne les cours stockés tels quels,
      quelle que soit la devise d'origine de l'actif.
    */
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T10:00:00Z"),
      to: t("2026-08-25T10:00:00Z"),
      deps: {
        loadBars: async () =>
          bars({
            euro: [["2026-08-25T10:00:00Z", 100]],
            dollar: [["2026-08-25T10:00:00Z", 90]],
            crypto: [["2026-08-25T10:00:00Z", 55_000]],
          }),
        buildEngine: async () =>
          new PortfolioValuationEngine(
            inputs({
              transactions: [
                buy("t1", "euro", "2026-08-20T10:00:00Z", 10, 100),
                buy("t2", "dollar", "2026-08-20T10:00:00Z", 10, 80),
                buy("t3", "crypto", "2026-08-20T10:00:00Z", 2, 50_000),
              ],
              assetClassById: new Map([
                ["euro", "ACTIONS"],
                ["dollar", "ACTIONS"],
                ["crypto", "CRYPTO"],
              ]),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
            })
          ),
      },
    });

    const p = s.points[0]!;
    expect(p.securities).toBeCloseTo(10 * 100 + 10 * 90, 6);
    expect(p.crypto).toBeCloseTo(2 * 55_000, 6);
    expect(p.grossAssets).toBeCloseTo(1900 + 110_000, 6);
  });
});

describe("6 — les observations fabriquées n'existent pas dans la série", () => {
  it("aucune source mock ne peut atteindre la table qu'elle lit", () => {
    /*
      La série se nourrit exclusivement d'`AssetIntradayBar`, et le collecteur
      n'y écrit que `yahoo` ou `coingecko`. La garde est en amont : il n'y a
      donc rien à filtrer à la lecture, et surtout rien à rattraper.
    */
    expect(isCollectableSource("mock")).toBe(false);
    expect(isCollectableSource("db")).toBe(false);
    expect(isCollectableSource("yahoo")).toBe(true);
    expect(isCollectableSource("coingecko")).toBe(true);
  });
});
