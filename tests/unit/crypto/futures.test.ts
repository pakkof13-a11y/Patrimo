import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  deductibleCostsOf,
  distanceToLiquidationPct,
  estimatedLiquidationPrice,
  isFundingAlert,
  isLiquidationAlert,
  realizedNetPnl,
  requiredMargin,
  summarizeFutures,
  toFuturesView,
  unrealizedPnl,
  type FuturesPositionInput,
} from "@/app/lib/crypto/futures";
import {
  buildPositionViews,
  closedNetPnl,
  computeTradingOverview,
} from "@/app/lib/trading/positions-view";
import { computeTradingYear } from "@/app/lib/trading/tax";
import type { TradingPositionRow } from "@/components/trading/types";

function pos(over: Partial<FuturesPositionInput> = {}): FuturesPositionInput {
  return {
    id: over.id ?? "p1",
    exchange: over.exchange ?? "Binance",
    pair: over.pair ?? "BTC/USDT-PERP",
    direction: over.direction ?? "LONG",
    leverage: over.leverage ?? d(10),
    sizeContracts: over.sizeContracts ?? d(1),
    entryPrice: over.entryPrice ?? d(60_000),
    markPrice: over.markPrice ?? d(60_000),
    marginUsed: over.marginUsed ?? null,
    fundingPaid: over.fundingPaid ?? null,
    commissionPaid: over.commissionPaid ?? null,
    marginType: over.marginType ?? null,
    contractValue: over.contractValue ?? null,
  };
}

describe("requiredMargin", () => {
  it("divise le notionnel par le levier", () => {
    expect(requiredMargin(d(60_000), d(10))!.toFixed(2)).toBe("6000.00");
  });

  it("renvoie 0 pour un levier nul plutôt que de diviser par zéro", () => {
    expect(requiredMargin(d(60_000), d(0))!.toFixed(2)).toBe("0.00");
  });

  it("renvoie null (UNKNOWN) quand le notionnel est inconnu — TRA-03", () => {
    expect(requiredMargin(null, d(10))).toBeNull();
  });
});

describe("estimatedLiquidationPrice", () => {
  it("place le prix de liquidation d'un LONG en dessous de l'entrée", () => {
    const liq = estimatedLiquidationPrice("LONG", d(60_000), d(10));
    // 60000 × (1 − 0.1 + 0.005) = 60000 × 0.905 = 54300
    expect(liq?.toFixed(2)).toBe("54300.00");
    expect(liq?.lt(60_000)).toBe(true);
  });

  it("place le prix de liquidation d'un SHORT au dessus de l'entrée", () => {
    const liq = estimatedLiquidationPrice("SHORT", d(60_000), d(10));
    // 60000 × (1 + 0.1 − 0.005) = 60000 × 1.095 = 65700
    expect(liq?.toFixed(2)).toBe("65700.00");
    expect(liq?.gt(60_000)).toBe(true);
  });

  it("rapproche la liquidation de l'entrée quand le levier augmente", () => {
    const liq5 = estimatedLiquidationPrice("LONG", d(60_000), d(5))!;
    const liq50 = estimatedLiquidationPrice("LONG", d(60_000), d(50))!;
    // Un levier plus élevé tolère un mouvement de marché plus faible.
    expect(liq50.gt(liq5)).toBe(true);
  });

  it("renvoie null pour un levier ou un prix d'entrée nul", () => {
    expect(estimatedLiquidationPrice("LONG", d(60_000), d(0))).toBeNull();
    expect(estimatedLiquidationPrice("LONG", d(0), d(10))).toBeNull();
  });
});

describe("distanceToLiquidationPct", () => {
  it("calcule l'écart en % du prix actuel", () => {
    const dist = distanceToLiquidationPct(d(60_000), d(54_000));
    expect(dist?.toFixed(2)).toBe("10.00");
  });

  it("n'est jamais négative même si le marché a dépassé la liquidation", () => {
    const dist = distanceToLiquidationPct(d(50_000), d(54_000));
    expect(dist?.gte(0)).toBe(true);
  });
});

describe("unrealizedPnl — symétrie LONG / SHORT", () => {
  it("un LONG gagne quand le prix monte", () => {
    const pnl = unrealizedPnl("LONG", d(2), d(60_000), d(65_000));
    expect(pnl.toFixed(2)).toBe("10000.00");
  });

  it("un SHORT perd quand le prix monte", () => {
    const pnl = unrealizedPnl("SHORT", d(2), d(60_000), d(65_000));
    expect(pnl.toFixed(2)).toBe("-10000.00");
  });

  it("LONG et SHORT ouverts au même prix et à la même taille sont exactement opposés", () => {
    const long = unrealizedPnl("LONG", d(3), d(1_800), d(2_000));
    const short = unrealizedPnl("SHORT", d(3), d(1_800), d(2_000));
    expect(long.plus(short).toFixed(8)).toBe("0.00000000");
  });
});

describe("alertes", () => {
  it("déclenche l'alerte de liquidation sous le seuil", () => {
    expect(isLiquidationAlert(14.9)).toBe(true);
    expect(isLiquidationAlert(15)).toBe(false);
    expect(isLiquidationAlert(20)).toBe(false);
    expect(isLiquidationAlert(null)).toBe(false);
  });

  it("déclenche l'alerte de funding au delà de 1 % de la marge", () => {
    expect(isFundingAlert(d(150), d(10_000))).toBe(true);
    expect(isFundingAlert(d(50), d(10_000))).toBe(false);
    expect(isFundingAlert(null, d(10_000))).toBe(false);
    expect(isFundingAlert(d(150), null)).toBe(false);
  });

  it("l'alerte de funding utilise la valeur absolue (funding reçu ou payé)", () => {
    expect(isFundingAlert(d(-150), d(10_000))).toBe(true);
  });
});

describe("toFuturesView", () => {
  it("assemble marge, liquidation et P&L pour un LONG", () => {
    const v = toFuturesView(
      pos({ leverage: d(10), sizeContracts: d(1), entryPrice: d(60_000), markPrice: d(66_000) })
    );
    expect(v.notionalUsd!.toFixed(2)).toBe("60000.00");
    expect(v.marginUsed!.toFixed(2)).toBe("6000.00");
    expect(v.unrealizedPnlEur!.toFixed(2)).toBe("6000.00");
    expect(v.signedNotional!.toFixed(2)).toBe("60000.00");
  });

  it("signe l'exposition négativement pour un SHORT", () => {
    const v = toFuturesView(pos({ direction: "SHORT" }));
    expect(v.signedNotional!.lt(0)).toBe(true);
  });

  it("utilise la marge déclarée plutôt que la marge calculée quand elle est fournie", () => {
    const v = toFuturesView(pos({ marginUsed: d(9_999) }));
    expect(v.marginUsed!.toFixed(2)).toBe("9999.00");
  });

  it("déclenche l'alerte de liquidation quand le marché s'approche du seuil", () => {
    // Liquidation LONG à 54 300 ; mark à 55 000 → distance ≈ 1,27 % < 15 %.
    const v = toFuturesView(
      pos({ leverage: d(10), entryPrice: d(60_000), markPrice: d(55_000) })
    );
    expect(v.liquidationAlert).toBe(true);
  });

  it("rend le notionnel et le P&L null pour un contrat COIN-M sans valeur de contrat — TRA-03", () => {
    const v = toFuturesView(
      pos({ marginType: "COIN_M", contractValue: null, marginUsed: null })
    );
    expect(v.notionalUsd).toBeNull();
    expect(v.marginUsed).toBeNull();
    expect(v.unrealizedPnlEur).toBeNull();
    expect(v.signedNotional).toBeNull();
  });

  it("calcule le notionnel COIN-M depuis la valeur de contrat quand elle est connue", () => {
    const v = toFuturesView(
      pos({
        marginType: "COIN_M",
        contractValue: d(100),
        sizeContracts: d(50),
        marginUsed: null,
      })
    );
    // 50 contrats × 100 USD = 5 000 USD de notionnel, pas 50 × 60 000.
    expect(v.notionalUsd!.toFixed(2)).toBe("5000.00");
  });
});

describe("summarizeFutures", () => {
  it("compense long et short dans l'exposition nette", () => {
    const s = summarizeFutures([
      pos({ id: "a", direction: "LONG", sizeContracts: d(1), entryPrice: d(60_000), markPrice: d(60_000) }),
      pos({ id: "b", direction: "SHORT", sizeContracts: d("0.5"), entryPrice: d(60_000), markPrice: d(60_000) }),
    ]);
    // Long 60 000 − short 30 000 = exposition nette 30 000, pas 90 000.
    expect(s.netExposureEur.toFixed(2)).toBe("30000.00");
  });

  it("cumule la marge de toutes les positions ouvertes", () => {
    const s = summarizeFutures([
      pos({ id: "a", marginUsed: d(1_000) }),
      pos({ id: "b", marginUsed: d(2_500) }),
    ]);
    expect(s.totalMarginEur.toFixed(2)).toBe("3500.00");
  });

  it("compte les positions en alerte de liquidation", () => {
    const s = summarizeFutures([
      pos({ id: "a", leverage: d(10), entryPrice: d(60_000), markPrice: d(55_000) }), // proche liq
      pos({ id: "b", leverage: d(3), entryPrice: d(60_000), markPrice: d(60_000) }), // loin
    ]);
    expect(s.liquidationAlerts).toBe(1);
  });

  it("écarte les positions COIN-M sans valeur de contrat de l'exposition et du P&L — TRA-03", () => {
    const s = summarizeFutures([
      pos({ id: "a", direction: "LONG", sizeContracts: d(1), entryPrice: d(60_000), markPrice: d(60_000) }),
      pos({ id: "b", marginType: "COIN_M", contractValue: null, marginUsed: null }),
    ]);
    // La position b est UNKNOWN : elle ne doit ni gonfler ni fausser l'exposition nette.
    expect(s.netExposureEur.toFixed(2)).toBe("60000.00");
    expect(s.unvaluedCount).toBe(1);
  });
});

describe("realizedNetPnl — convention de signe du funding", () => {
  it("retranche un funding payé (positif) et la commission du P&L réalisé", () => {
    const net = realizedNetPnl({
      realizedPnl: d(1_000),
      fundingPaid: d(50),
      commissionPaid: d(20),
    });
    expect(net.toFixed(2)).toBe("930.00");
  });

  it("ajoute un funding perçu (négatif) au lieu de le retrancher", () => {
    /*
      `fundingPaid` est signé : négatif = funding **perçu**, un produit. Le
      prendre en valeur absolue (ancien comportement) transformait un
      encaissement de 50 en charge de 50 — 100 d'écart sur le même fait
      économique, et un désaccord avec le bucket fiscal qui, lui, sommait le
      funding signé.
    */
    const net = realizedNetPnl({
      realizedPnl: d(1_000),
      fundingPaid: d(-50),
      commissionPaid: d(0),
    });
    expect(net.toFixed(2)).toBe("1050.00");
  });

  it("retranche la commission même stockée en négatif : un frais n'est jamais encaissé", () => {
    // Signe de cash-flow d'un export ou d'une saisie manuelle : aucune
    // information économique à préserver, contrairement au funding.
    const net = realizedNetPnl({
      realizedPnl: d(1_000),
      fundingPaid: d(0),
      commissionPaid: d(-20),
    });
    expect(net.toFixed(2)).toBe("980.00");
  });

  it("rend un coût déductible négatif quand le funding perçu dépasse les commissions", () => {
    const costs = deductibleCostsOf({
      fundingPaid: d("-10.00"),
      commissionPaid: d("4.00"),
    });
    // Produit net de 6 : ni écrasé à 0, ni lissé.
    expect(costs.toFixed(2)).toBe("-6.00");
  });

  it("traite un funding ou une commission absents comme 0, pas comme une erreur", () => {
    expect(
      realizedNetPnl({
        realizedPnl: d(500),
        fundingPaid: null,
        commissionPaid: null,
      }).toFixed(2)
    ).toBe("500.00");
  });
});

describe("golden TRA/CRY — l'écran et le fiscal retiennent le même net", () => {
  /*
    Position mesurée par finance-metier : SOL/USD-PERP, funding stocké −4,10 €
    (donc **perçu**, nouvelle convention) et commission 6,20 €. Avant
    convergence, le net affiché valait 312,50 − 4,10 − 6,20 = 302,20 (funding
    pris en valeur absolue) pendant que l'assiette fiscale valait
    312,50 − (−4,10 + 6,20) = 310,40 : 8,20 d'écart, soit exactement 2 × le
    funding, sur un seul et même fait économique.
  */
  const REALIZED = "312.50";
  const FUNDING = "-4.10";
  const COMMISSION = "6.20";
  /** 312,50 + 4,10 − 6,20 */
  const EXPECTED_NET = "310.40";

  function solRow(): TradingPositionRow {
    return {
      id: "sol-1",
      tradingAccountId: null,
      underlyingType: "CRYPTO",
      exchange: "BYBIT",
      instrument: "SOL/USD-PERP",
      contractType: "PERPETUAL",
      direction: "SHORT",
      leverage: "3",
      sizeContracts: "25",
      entryPrice: "168.30",
      markPrice: "162.45",
      markPriceUpdatedAt: "2026-05-01T00:00:00.000Z",
      expiryDate: null,
      fundingPaid: FUNDING,
      commissionPaid: COMMISSION,
      unrealizedPnl: null,
      realizedPnl: REALIZED,
      isOpen: false,
      openedAt: "2026-04-20T00:00:00.000Z",
      closedAt: "2026-05-02T00:00:00.000Z",
      stopLoss: null,
      takeProfit: null,
      tickValue: null,
      marginType: "USDT_M",
      baseCurrency: "SOL",
      quoteCurrency: "USD",
      subAccountLabel: null,
      exchangeTradeId: null,
      notes: null,
      liquidationPriceReported: null,
      derived: {
        notionalEur: "4207.50",
        marginUsedEur: "1402.50",
        liquidationPriceEstimated: "223.36",
        distanceToLiquidationPct: 37.5,
        unrealizedPnlEur: null,
        signedNotionalEur: "-4207.50",
        liquidationAlert: false,
        fundingAlert: false,
      },
    };
  }

  /** Reproduit l'arithmétique du bucket fiscal de `app/api/trading/route.ts`. */
  function fiscalNet(): string {
    const pnl = d(REALIZED);
    const fees = deductibleCostsOf({
      fundingPaid: d(FUNDING),
      commissionPaid: d(COMMISSION),
    });
    const year = computeTradingYear({
      year: 2026,
      grossGainsEur: pnl.gt(0) ? pnl : d(0),
      grossLossesEur: pnl.lt(0) ? pnl.abs() : d(0),
      feesEur: fees,
    });
    return year.netBeforeCarryEur.toFixed(2);
  }

  it("le moteur, l'écran et l'assiette fiscale donnent le même montant", () => {
    const moteur = realizedNetPnl({
      realizedPnl: d(REALIZED),
      fundingPaid: d(FUNDING),
      commissionPaid: d(COMMISSION),
    }).toFixed(2);
    const ecran = closedNetPnl(solRow()).toFixed(2);
    const fiscal = fiscalNet();

    expect(moteur).toBe(EXPECTED_NET);
    expect(ecran).toBe(EXPECTED_NET);
    expect(fiscal).toBe(EXPECTED_NET);
    // Plus aucun écart de 2 × funding entre la lecture d'écran et le fiscal.
    expect(Number(ecran) - Number(fiscal)).toBe(0);
  });

  it("la synthèse d'écran retient ce même net pour la position close", () => {
    const overview = computeTradingOverview(buildPositionViews([solRow()]));
    expect(overview.closedCount).toBe(1);
    expect(overview.realizedPnlEur.toFixed(2)).toBe(EXPECTED_NET);
  });
});
