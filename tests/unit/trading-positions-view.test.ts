import { describe, it, expect } from "vitest";
import {
  STALE_MARK_DAYS,
  buildPositionView,
  buildPositionViews,
  closedNetPnl,
  markAgeDays,
  markFreshnessNotice,
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
    markPriceUpdatedAt: null,
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
  const NOW = new Date("2026-06-01T12:00:00Z");
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it("un horodatage vaut mieux qu'une présomption", () => {
    /*
      Aurea n'a aucune source de prix de marque : ni les wallets on-chain, ni
      les imports n'en fournissent. `markPriceUpdatedAt` dit quand un prix a
      été **observé** — un fait, là où la comparaison au prix d'entrée n'était
      qu'une devinette.
    */
    expect(
      markFreshnessOf(pos({ markPrice: "61200", markPriceUpdatedAt: daysAgo(1) }))
    ).toBe("MARKED");
    expect(markAgeDays(pos({ markPriceUpdatedAt: daysAgo(3) }), NOW)).toBe(3);
    expect(markAgeDays(pos({ markPriceUpdatedAt: null }), NOW)).toBeNull();
  });

  it("les lignes antérieures à l'horodatage gardent l'ancienne présomption", () => {
    /*
      Sans ce repli, tout l'historique basculerait d'un coup en « prix non
      actualisé », y compris des positions dont le prix avait bien été saisi.
    */
    expect(markFreshnessOf(pos({ markPrice: "61200" }))).toBe("UNMARKED");
    expect(markFreshnessOf(pos({ markPrice: null }))).toBe("MISSING");
    expect(markFreshnessOf(pos())).toBe("MARKED");
  });

  it("une observation ancienne est signalée, une position close ne l'est pas", () => {
    /*
      Sur une position close, le prix de marque **est** le prix de sortie : il
      est définitif, pas périmé.
    */
    const stale = buildPositionView(
      pos({ markPriceUpdatedAt: daysAgo(STALE_MARK_DAYS + 1) }),
      NOW
    );
    expect(stale.markIsStale).toBe(true);
    expect(stale.markFreshness).toBe("MARKED");

    const fresh = buildPositionView(pos({ markPriceUpdatedAt: daysAgo(1) }), NOW);
    expect(fresh.markIsStale).toBe(false);

    const closed = buildPositionView(
      pos({
        isOpen: false,
        realizedPnl: "100",
        markPriceUpdatedAt: daysAgo(90),
      }),
      NOW
    );
    expect(closed.markIsStale).toBe(false);
  });

  it("la phrase de fraîcheur ne prétend jamais au temps réel", () => {
    const notice = markFreshnessNotice(
      pos({ markPriceUpdatedAt: daysAgo(5) }),
      NOW
    );
    expect(notice).toContain("il y a 5 jours");
    expect(notice).not.toMatch(/temps réel|actuel|live/i);

    expect(
      markFreshnessNotice(pos({ markPrice: null }), NOW)
    ).toMatch(/ne peut pas être calculé/i);
    expect(
      markFreshnessNotice(pos({ markPrice: "61200" }), NOW)
    ).toMatch(/ne le rafraîchit pas/i);
  });

  it("la synthèse compte les prix non observés et les observations anciennes", () => {
    const views = buildPositionViews(
      [
        // Observée hier : crédible.
        pos({ markPriceUpdatedAt: daysAgo(1) }),
        // Jamais observée.
        pos({ id: "p2", markPrice: "61200" }),
        // Observée, mais il y a un mois : le latent ne vaut plus rien.
        pos({ id: "p3", markPriceUpdatedAt: daysAgo(30) }),
        // Close : plus de prix à actualiser, elle ne compte pas.
        pos({
          id: "p4",
          isOpen: false,
          markPrice: "61200",
          realizedPnl: "0",
        }),
      ],
      NOW
    );
    expect(computeTradingOverview(views).unmarkedCount).toBe(2);
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
