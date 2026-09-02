import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
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
  };
}

describe("requiredMargin", () => {
  it("divise le notionnel par le levier", () => {
    expect(requiredMargin(d(60_000), d(10)).toFixed(2)).toBe("6000.00");
  });

  it("renvoie 0 pour un levier nul plutôt que de diviser par zéro", () => {
    expect(requiredMargin(d(60_000), d(0)).toFixed(2)).toBe("0.00");
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
    expect(v.notionalUsd.toFixed(2)).toBe("60000.00");
    expect(v.marginUsed.toFixed(2)).toBe("6000.00");
    expect(v.unrealizedPnlEur.toFixed(2)).toBe("6000.00");
    expect(v.signedNotional.toFixed(2)).toBe("60000.00");
  });

  it("signe l'exposition négativement pour un SHORT", () => {
    const v = toFuturesView(pos({ direction: "SHORT" }));
    expect(v.signedNotional.lt(0)).toBe(true);
  });

  it("utilise la marge déclarée plutôt que la marge calculée quand elle est fournie", () => {
    const v = toFuturesView(pos({ marginUsed: d(9_999) }));
    expect(v.marginUsed.toFixed(2)).toBe("9999.00");
  });

  it("déclenche l'alerte de liquidation quand le marché s'approche du seuil", () => {
    // Liquidation LONG à 54 300 ; mark à 55 000 → distance ≈ 1,27 % < 15 %.
    const v = toFuturesView(
      pos({ leverage: d(10), entryPrice: d(60_000), markPrice: d(55_000) })
    );
    expect(v.liquidationAlert).toBe(true);
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
});

describe("realizedNetPnl", () => {
  it("retranche funding et commission du P&L réalisé", () => {
    const net = realizedNetPnl({
      realizedPnl: d(1_000),
      fundingPaid: d(50),
      commissionPaid: d(20),
    });
    expect(net.toFixed(2)).toBe("930.00");
  });

  it("traite un funding négatif (perçu) comme un coût malgré le signe", () => {
    // Un funding stocké en négatif (convention "reçu") doit tout de même se
    // retrancher — jamais s'ajouter par accident de signe.
    const net = realizedNetPnl({
      realizedPnl: d(1_000),
      fundingPaid: d(-50),
      commissionPaid: d(0),
    });
    expect(net.toFixed(2)).toBe("950.00");
  });
});
