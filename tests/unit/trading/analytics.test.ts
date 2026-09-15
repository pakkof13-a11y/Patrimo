import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import { computeTradingAnalytics } from "@/app/lib/trading/analytics";
import { deductibleCostsOf, realizedNetPnl } from "@/app/lib/crypto/futures";

function trade(pnl: number, closed?: string, opened?: string) {
  return {
    realizedPnlEur: d(pnl),
    openedAt: opened ? new Date(opened) : null,
    closedAt: closed ? new Date(closed) : null,
  };
}

describe("computeTradingAnalytics — cas vide", () => {
  it("aucune opération : les ratios sont absents, pas à zéro", () => {
    const a = computeTradingAnalytics([]);
    expect(a.tradeCount).toBe(0);
    expect(a.winRatePct).toBeNull();
    expect(a.profitFactor).toBeNull();
    expect(a.riskRewardRatio).toBeNull();
    expect(a.maxDrawdownEur.toNumber()).toBe(0);
  });
});

describe("computeTradingAnalytics — comptages", () => {
  it("sépare gagnantes, perdantes et opérations à l'équilibre", () => {
    const a = computeTradingAnalytics([
      trade(500),
      trade(-200),
      trade(0),
      trade(300),
    ]);
    expect(a.tradeCount).toBe(4);
    expect(a.winCount).toBe(2);
    expect(a.lossCount).toBe(1);
    expect(a.breakEvenCount).toBe(1);
    // Une opération à l'équilibre compte au dénominateur : elle a bien eu lieu.
    expect(a.winRatePct!.toNumber()).toBe(50);
  });

  it("agrège profit brut, perte brute et résultat net", () => {
    const a = computeTradingAnalytics([trade(500), trade(300), trade(-200)]);
    expect(a.grossProfitEur.toNumber()).toBe(800);
    expect(a.grossLossEur.toNumber()).toBe(200);
    expect(a.netPnlEur.toNumber()).toBe(600);
  });
});

describe("computeTradingAnalytics — ratios", () => {
  it("calcule gain moyen, perte moyenne et ratio R/R", () => {
    const a = computeTradingAnalytics([
      trade(600),
      trade(400),
      trade(-250),
      trade(-250),
    ]);
    expect(a.averageWinEur!.toNumber()).toBe(500);
    expect(a.averageLossEur!.toNumber()).toBe(250);
    expect(a.riskRewardRatio!.toNumber()).toBe(2);
  });

  it("le profit factor rapporte le profit brut aux pertes brutes", () => {
    const a = computeTradingAnalytics([trade(1_000), trade(-400)]);
    expect(a.profitFactor!.toNumber()).toBe(2.5);
  });

  it("sans aucune perte, les ratios sont absents plutôt qu'infinis", () => {
    const a = computeTradingAnalytics([trade(1_000), trade(500)]);
    expect(a.profitFactor).toBeNull();
    expect(a.riskRewardRatio).toBeNull();
    expect(a.winRatePct!.toNumber()).toBe(100);
  });
});

describe("computeTradingAnalytics — drawdown", () => {
  it("mesure la plus forte baisse depuis un sommet", () => {
    // Courbe : +1000 → 1000, −400 → 600, −300 → 300, +900 → 1200.
    // Sommet à 1000, creux à 300 : drawdown de 700.
    const a = computeTradingAnalytics([
      trade(1_000, "2026-01-01"),
      trade(-400, "2026-02-01"),
      trade(-300, "2026-03-01"),
      trade(900, "2026-04-01"),
    ]);
    expect(a.maxDrawdownEur.toNumber()).toBe(700);
  });

  it("une série uniquement gagnante n'a aucun drawdown", () => {
    const a = computeTradingAnalytics([
      trade(100, "2026-01-01"),
      trade(200, "2026-02-01"),
    ]);
    expect(a.maxDrawdownEur.toNumber()).toBe(0);
  });

  it("suit la chronologie de clôture, pas l'ordre de la liste", () => {
    // Mêmes opérations, saisies à l'envers : le drawdown doit être identique.
    const chronologique = computeTradingAnalytics([
      trade(1_000, "2026-01-01"),
      trade(-800, "2026-02-01"),
    ]);
    const desordre = computeTradingAnalytics([
      trade(-800, "2026-02-01"),
      trade(1_000, "2026-01-01"),
    ]);
    expect(desordre.maxDrawdownEur.toNumber()).toBe(
      chronologique.maxDrawdownEur.toNumber()
    );
    expect(desordre.maxDrawdownEur.toNumber()).toBe(800);
  });

  it("une perte initiale creuse un drawdown dès la première opération", () => {
    const a = computeTradingAnalytics([trade(-500, "2026-01-01")]);
    expect(a.maxDrawdownEur.toNumber()).toBe(500);
  });
});

describe("computeTradingAnalytics — extrêmes et durée", () => {
  it("retient la meilleure et la pire opération", () => {
    const a = computeTradingAnalytics([trade(120), trade(-980), trade(4_300)]);
    expect(a.bestTradeEur!.toNumber()).toBe(4_300);
    expect(a.worstTradeEur!.toNumber()).toBe(-980);
  });

  it("moyenne les durées de détention des opérations datées", () => {
    const a = computeTradingAnalytics([
      trade(100, "2026-01-11", "2026-01-01"), // 10 jours
      trade(100, "2026-02-05", "2026-02-01"), // 4 jours
    ]);
    expect(a.averageHoldingDays).toBeCloseTo(7, 6);
  });

  it("ignore les opérations sans dates plutôt que de les compter à zéro jour", () => {
    const a = computeTradingAnalytics([
      trade(100, "2026-01-11", "2026-01-01"),
      trade(100),
    ]);
    expect(a.averageHoldingDays).toBeCloseTo(10, 6);
  });

  it("aucune date exploitable : la durée moyenne est absente", () => {
    expect(computeTradingAnalytics([trade(100)]).averageHoldingDays).toBeNull();
  });
});

describe("computeTradingAnalytics — P1.1 tuile « Résultat net » vs détail fiscal", () => {
  /*
    `ClosedTrade.realizedPnlEur` est documenté comme le résultat NET de
    l'opération. Lui donner le `realizedPnl` brut stocké en base (comme le
    faisait autrefois `app/api/trading/route.ts`) fait afficher un brut sous
    l'étiquette « Résultat net », en désaccord avec le détail fiscal qui, lui,
    déduit toujours `deductibleCostsOf` (funding signé + |commission|).

    Ce cas reproduit l'écart observé en production : une position clôturée
    avec un funding payé et une commission, brut 752.38 € / net 722.78 €.
  */
  const realizedPnl = d("759.68");
  const fundingPaid = d("5"); // funding payé (charge)
  const commissionPaid = d("31.90");

  it("reproduit l'écart brut ≠ net (752.38 vs 722.78) sur une position avec funding + commission", () => {
    const costs = deductibleCostsOf({ fundingPaid, commissionPaid });
    const net = realizedNetPnl({ realizedPnl, fundingPaid, commissionPaid });

    expect(realizedPnl.toFixed(2)).toBe("759.68");
    // Le brut seul (ancien comportement fautif de la tuile) ne vaut pas le net.
    expect(realizedPnl.toFixed(2)).not.toBe(net.toFixed(2));
    expect(costs.toFixed(2)).toBe("36.90");
    expect(net.toFixed(2)).toBe("722.78");
  });

  it("la tuile (computeTradingAnalytics.netPnlEur) converge avec le détail fiscal (deductibleCostsOf) quand on lui passe le net", () => {
    // Reproduit exactement le mapping de app/api/trading/route.ts : le champ
    // `realizedPnlEur` fourni à computeTradingAnalytics doit être le net,
    // pas p.realizedPnl brut.
    const netTrade = {
      realizedPnlEur: realizedNetPnl({ realizedPnl, fundingPaid, commissionPaid }),
      openedAt: new Date("2026-01-01"),
      closedAt: new Date("2026-01-10"),
    };

    const analytics = computeTradingAnalytics([netTrade]);

    // La tuile affiche désormais le même montant que le détail fiscal
    // (« Résultat avant report » = gains bruts − pertes brutes − frais).
    const netBeforeCarry = realizedPnl.minus(
      deductibleCostsOf({ fundingPaid, commissionPaid })
    );
    expect(analytics.netPnlEur.toFixed(2)).toBe(netBeforeCarry.toFixed(2));
    expect(analytics.netPnlEur.toFixed(2)).toBe("722.78");
  });
});
