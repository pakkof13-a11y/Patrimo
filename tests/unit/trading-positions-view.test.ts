import { describe, it, expect } from "vitest";
import {
  buildPositionView,
  buildPositionViews,
  closedNetPnl,
  computeTradingOverview,
  filterPositions,
  markFreshnessOf,
  sortPositions,
  EMPTY_FILTERS,
} from "@/app/lib/trading/positions-view";
import type { TradingPositionRow } from "@/components/trading/types";

function pos(over: Partial<TradingPositionRow> = {}): TradingPositionRow {
  const base: TradingPositionRow = {
    id: "p1",
    tradingAccountId: null,
    underlyingType: "CRYPTO",
    exchange: "HYPERLIQUID",
    instrument: "BTC/USD-PERP",
    contractType: "PERPETUAL",
    direction: "LONG",
    leverage: "5",
    sizeContracts: "0.42",
    entryPrice: "61200",
    markPrice: "63480",
    expiryDate: null,
    fundingPaid: null,
    commissionPaid: null,
    unrealizedPnl: null,
    realizedPnl: null,
    isOpen: true,
    openedAt: "2026-05-21T14:32:00.000Z",
    closedAt: null,
    stopLoss: null,
    takeProfit: null,
    tickValue: null,
    marginType: null,
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    subAccountLabel: null,
    exchangeTradeId: null,
    notes: null,
    liquidationPriceReported: null,
    derived: {
      notionalEur: "25704.00",
      marginUsedEur: "5140.80",
      liquidationPriceEstimated: "49266.00",
      distanceToLiquidationPct: 22.4,
      unrealizedPnlEur: "957.60",
      signedNotionalEur: "25704.00",
      liquidationAlert: false,
      fundingAlert: false,
    },
    ...over,
  };
  return base;
}

describe("direction et P&L", () => {
  it("un long et un short opposés donnent des expositions de signes contraires", () => {
    /*
      L'exposition nette est la seule lecture qui dise à quoi le portefeuille
      est réellement exposé : deux positions symétriques se compensent, alors
      que leur notionnel brut, lui, s'additionne.
    */
    const long = buildPositionView(pos());
    const short = buildPositionView(
      pos({
        id: "p2",
        direction: "SHORT",
        derived: {
          ...pos().derived,
          signedNotionalEur: "-25704.00",
          unrealizedPnlEur: "-957.60",
        },
      })
    );

    const o = computeTradingOverview([long, short]);
    expect(o.netExposureEur).toBeCloseTo(0, 2);
    expect(o.grossExposureEur).toBeCloseTo(51408, 2);
    expect(o.unrealizedPnlEur).toBeCloseTo(0, 2);
  });

  it("le pourcentage se rapporte à la marge, pas au notionnel", () => {
    /*
      Sur un levier x5, un mouvement de 1 % du sous-jacent fait 5 % du capital
      engagé. C'est ce second chiffre qui dit au trader ce qu'il risque.
    */
    const v = buildPositionView(pos());
    expect(v.pnlPct).toBeCloseTo((957.6 / 5140.8) * 100, 4);
    expect(v.pnlPct!).toBeGreaterThan(18);
  });

  it("latent et réalisé ne se mélangent jamais", () => {
    const open = buildPositionView(pos());
    const closed = buildPositionView(
      pos({
        id: "p2",
        isOpen: false,
        realizedPnl: "1000",
        fundingPaid: "20",
        commissionPaid: "15",
        closedAt: "2026-06-01T00:00:00.000Z",
      })
    );

    const o = computeTradingOverview([open, closed]);
    expect(o.unrealizedPnlEur).toBeCloseTo(957.6, 2);
    // Funding et commissions sont des coûts : ils réduisent toujours le net.
    expect(o.realizedPnlEur).toBeCloseTo(965, 2);
    expect(o.openCount).toBe(1);
    expect(o.closedCount).toBe(1);
  });

  it("le net d'une position close déduit funding et commissions quel que soit leur signe", () => {
    expect(
      closedNetPnl(pos({ realizedPnl: "500", fundingPaid: "-30", commissionPaid: "10" }))
    ).toBe(460);
  });
});

describe("fraîcheur du prix de marque", () => {
  it("un prix égal au prix d'entrée n'est pas une cotation", () => {
    /*
      `markPrice` vaut le prix d'entrée par défaut à la création. Présenter le
      P&L nul qui en découle comme une observation de marché serait faux.
    */
    expect(markFreshnessOf(pos({ markPrice: "61200" }))).toBe("UNMARKED");
    expect(markFreshnessOf(pos({ markPrice: null }))).toBe("MISSING");
    expect(markFreshnessOf(pos())).toBe("MARKED");
  });

  it("la synthèse compte les positions ouvertes au prix non actualisé", () => {
    const views = buildPositionViews([
      pos(),
      pos({ id: "p2", markPrice: "61200" }),
      // Une position close n'a plus de prix à actualiser : elle ne compte pas.
      pos({ id: "p3", isOpen: false, markPrice: "61200", realizedPnl: "0" }),
    ]);
    expect(computeTradingOverview(views).unmarkedCount).toBe(1);
  });
});

describe("risque", () => {
  it("une position sans stop, sans cible et sans liquidation n'a rien à montrer", () => {
    // La section Risque doit disparaître plutôt que s'afficher vide.
    const bare = buildPositionView(
      pos({
        derived: { ...pos().derived, liquidationPriceEstimated: null },
      })
    );
    expect(bare.hasRiskData).toBe(false);

    expect(buildPositionView(pos({ stopLoss: "58000" })).hasRiskData).toBe(true);
  });

  it("une alerte de liquidation ne concerne que les positions ouvertes", () => {
    const closed = buildPositionView(
      pos({
        isOpen: false,
        realizedPnl: "0",
        derived: { ...pos().derived, liquidationAlert: true },
      })
    );
    expect(closed.liquidationAlert).toBe(false);
  });
});

describe("filtres et tri", () => {
  const views = buildPositionViews([
    pos(),
    pos({ id: "p2", direction: "SHORT", instrument: "SOL/USD-PERP", exchange: "PARADEX" }),
    pos({ id: "p3", isOpen: false, realizedPnl: "300", instrument: "ETH/USD-PERP" }),
  ]);

  it("le statut par défaut ne montre que les positions ouvertes", () => {
    const open = filterPositions(views, EMPTY_FILTERS);
    expect(open).toHaveLength(2);
    expect(open.every((v) => v.isOpen)).toBe(true);
  });

  it("filtre par direction, plateforme et recherche", () => {
    expect(
      filterPositions(views, { ...EMPTY_FILTERS, direction: "SHORT" })
    ).toHaveLength(1);
    expect(
      filterPositions(views, { ...EMPTY_FILTERS, exchange: "PARADEX" })
    ).toHaveLength(1);
    expect(
      filterPositions(views, { ...EMPTY_FILTERS, status: "ALL", search: "eth" })
    ).toHaveLength(1);
  });

  it("trie sans muter la liste d'origine", () => {
    const before = views.map((v) => v.id);
    const sorted = sortPositions(views, "instrument");
    expect(sorted[0]!.instrument).toBe("BTC/USD-PERP");
    expect(views.map((v) => v.id)).toEqual(before);
  });
});
