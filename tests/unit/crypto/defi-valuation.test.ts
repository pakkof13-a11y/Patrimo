/**
 * Valorisation DeFi — décomposition, méthodes, replis, anti-double-compte
 * interne.
 *
 * Couvre les cas métier 1 à 13 et 17-18, 37-41, 46 du cahier des charges F1 :
 * staking, liquid staking, borrowing, LP, CLMM, vault, rewards multiples,
 * receipt token, points, valorisation manuelle, fallback, quote-part.
 */

import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  computeDebtRatios,
  debtRiskLevel,
  decomposeUnderlying,
  isStaleValuation,
  selectValuationLegs,
  summarizeValuationQuality,
  sumValuableRewards,
  valuePosition,
  type ValuationLeg,
} from "@/app/lib/crypto/defi-valuation";

const leg = (
  legType: string,
  symbol: string,
  quantity: string,
  priceEur: string | null,
  unitCostEur?: string
): ValuationLeg => ({
  legType,
  symbol,
  quantity: d(quantity),
  priceEur: priceEur == null ? null : d(priceEur),
  unitCostEur: unitCostEur != null ? d(unitCostEur) : null,
});

describe("valuePosition — natifs et staking", () => {
  it("valorise un staking natif au prix de marché (cas 4)", () => {
    const out = valuePosition({
      legs: [leg("ASSET", "ATOM", "1000", "8")],
    });
    expect(out.grossEur.toFixed(2)).toBe("8000.00");
    expect(out.netEur.toFixed(2)).toBe("8000.00");
    expect(out.retainedEur.toFixed(2)).toBe("8000.00");
    expect(out.method).toBe("MARKET");
    expect(out.isValuable).toBe(true);
  });

  it("ne compte pas deux fois le dépôt et son jeton de reçu (cas 5, 18)", () => {
    // Staking liquide : 10 ETH déposés, 10 stETH reçus. La position vaut
    // 10 × prix, pas 20 × prix.
    const out = valuePosition({
      legs: [
        leg("ASSET", "ETH", "10", "3000"),
        leg("RECEIPT", "STETH", "10", "3050"),
      ],
    });
    // Seul le reçu compte : c'est lui que le portefeuille détient.
    expect(out.grossEur.toFixed(2)).toBe("30500.00");
    expect(out.method).toBe("MARKET");
  });

  it("valorise un restaking par son reçu, sans doubler la couche sous-jacente (cas 6)", () => {
    const out = valuePosition({
      legs: [
        leg("ASSET", "WEETH", "5", "3100"),
        leg("RECEIPT", "EZETH", "5", "3120"),
      ],
    });
    expect(out.grossEur.toFixed(2)).toBe("15600.00");
  });
});

describe("valuePosition — dette et collatéral", () => {
  it("retranche la dette du collatéral (cas 8)", () => {
    const out = valuePosition({
      legs: [
        leg("COLLATERAL", "ETH", "10", "3000"),
        leg("DEBT", "USDC", "12000", "1"),
      ],
    });
    expect(out.collateralEur.toFixed(2)).toBe("30000.00");
    expect(out.debtEur.toFixed(2)).toBe("12000.00");
    expect(out.netEur.toFixed(2)).toBe("18000.00");
    expect(out.retainedEur.toFixed(2)).toBe("18000.00");
  });

  it("agrège plusieurs collatéraux sans les confondre avec la dette (cas 9)", () => {
    const out = valuePosition({
      legs: [
        leg("COLLATERAL", "ETH", "5", "3000"),
        leg("COLLATERAL", "WBTC", "0.5", "60000"),
        leg("DEBT", "USDC", "20000", "1"),
      ],
    });
    expect(out.collateralEur.toFixed(2)).toBe("45000.00");
    expect(out.debtEur.toFixed(2)).toBe("20000.00");
    expect(out.netEur.toFixed(2)).toBe("25000.00");
  });

  it("se replie sur le coût plutôt que d'oublier une dette non cotée", () => {
    // Une dette omise gonflerait le patrimoine du montant exact du dû : c'est
    // l'erreur la plus coûteuse du module, elle ne doit jamais passer par zéro.
    const out = valuePosition({
      legs: [
        leg("COLLATERAL", "ETH", "10", "3000"),
        leg("DEBT", "XYZ", "1000", null, "2"),
      ],
    });
    expect(out.debtEur.toFixed(2)).toBe("2000.00");
    expect(out.netEur.toFixed(2)).toBe("28000.00");
  });
});

describe("valuePosition — LP, CLMM et vaults", () => {
  it("valorise une LP par ses sous-jacents sans compter la part (cas 11)", () => {
    const out = valuePosition({
      legs: [
        leg("SHARE", "UNI-V2-LP", "1", "10000"),
        leg("UNDERLYING", "ETH", "1", "3000"),
        leg("UNDERLYING", "USDC", "3000", "1"),
      ],
    });
    // 3000 + 3000 = 6000 par les sous-jacents, et non 10000 + 6000.
    expect(out.grossEur.toFixed(2)).toBe("6000.00");
    expect(out.method).toBe("UNDERLYING_ASSETS");
    expect(out.underlyingEur?.toFixed(2)).toBe("6000.00");
  });

  it("valorise une LP concentrée par ses bornes de jambes (cas 12)", () => {
    const out = valuePosition({
      legs: [
        leg("UNDERLYING", "ETH", "0.4", "3000"),
        leg("UNDERLYING", "USDC", "1800", "1"),
      ],
    });
    expect(out.grossEur.toFixed(2)).toBe("3000.00");
    expect(out.method).toBe("UNDERLYING_ASSETS");
  });

  it("valorise un vault par sa part quand les sous-jacents sont opaques (cas 13, 14)", () => {
    const out = valuePosition({
      legs: [leg("SHARE", "YVUSDC", "5000", "1.08")],
    });
    expect(out.grossEur.toFixed(2)).toBe("5400.00");
    expect(out.method).toBe("MARKET");
    // Aucun sous-jacent connu : pas de décomposition inventée.
    expect(out.underlyingEur).toBeNull();
  });

  it("décompose les sous-jacents en parts, ou rien du tout", () => {
    const parts = decomposeUnderlying([
      leg("UNDERLYING", "ETH", "1", "3000"),
      leg("UNDERLYING", "USDC", "1000", "1"),
    ]);
    expect(parts).not.toBeNull();
    expect(parts!.map((p) => p.symbol)).toEqual(["ETH", "USDC"]);
    expect(parts![0].sharePct.toFixed(1)).toBe("75.0");

    // Une jambe non cotée rend la répartition fausse : ne rien renvoyer plutôt
    // que d'inventer un pourcentage.
    expect(
      decomposeUnderlying([
        leg("UNDERLYING", "ETH", "1", "3000"),
        leg("UNDERLYING", "XYZ", "1000", null),
      ])
    ).toBeNull();
  });
});

describe("valuePosition — récompenses", () => {
  it("additionne plusieurs jetons de récompense (cas 10)", () => {
    const out = valuePosition({
      legs: [leg("ASSET", "CRV", "1000", "0.5")],
      rewards: [
        { symbol: "CRV", rewardType: "EMISSIONS", accruedQuantity: d(50), valueEur: d(25) },
        { symbol: "CVX", rewardType: "EMISSIONS", accruedQuantity: d(10), valueEur: d(30) },
      ],
    });
    expect(out.rewardsEur.toFixed(2)).toBe("55.00");
    // Les récompenses comptent dans `gross` mais pas dans `net` : elles ne sont
    // pas encore encaissées. Politique explicite, pas implicite.
    expect(out.grossEur.toFixed(2)).toBe("555.00");
    expect(out.netEur.toFixed(2)).toBe("500.00");
  });

  it("exclut les points de la valorisation (cas 17)", () => {
    const out = valuePosition({
      legs: [leg("ASSET", "ETH", "1", "3000")],
      rewards: [
        { symbol: "EIGEN-PTS", rewardType: "POINTS", accruedQuantity: d(50000), valueEur: d(9999) },
      ],
    });
    expect(out.rewardsEur.toFixed(2)).toBe("0.00");
    expect(out.grossEur.toFixed(2)).toBe("3000.00");
  });

  it("ignore un accru soldé", () => {
    expect(
      sumValuableRewards([
        { symbol: "CRV", rewardType: "YIELD", accruedQuantity: d(0), valueEur: d(10) },
      ]).toFixed(2)
    ).toBe("0.00");
  });

  it("permet d'exclure les récompenses non réclamées", () => {
    const out = valuePosition({
      legs: [leg("ASSET", "CRV", "1000", "0.5")],
      rewards: [{ symbol: "CRV", rewardType: "YIELD", accruedQuantity: d(50), valueEur: d(25) }],
      includeUnclaimedRewards: false,
    });
    expect(out.rewardsEur.toFixed(2)).toBe("0.00");
    expect(out.grossEur.toFixed(2)).toBe("500.00");
  });
});

describe("valuePosition — méthodes et replis", () => {
  it("fait prévaloir une valorisation manuelle (cas 38)", () => {
    const out = valuePosition({
      legs: [leg("SHARE", "OPAQUE", "100", "3")],
      manualGrossValueEur: d(1234.56),
    });
    expect(out.grossEur.toFixed(2)).toBe("1234.56");
    expect(out.method).toBe("MANUAL");
    expect(out.confidenceScore).toBe(60);
  });

  it("retient l'estimation du fournisseur faute de prix de jambe", () => {
    const out = valuePosition({
      legs: [leg("SHARE", "OPAQUE", "100", null)],
      providerGrossValueEur: d(900),
    });
    expect(out.method).toBe("PROVIDER_ESTIMATE");
    expect(out.grossEur.toFixed(2)).toBe("900.00");
    expect(out.fallbackReason).toContain("OPAQUE");
  });

  it("se replie sur le coût d'acquisition en dernier recours (cas 12 fallback)", () => {
    const out = valuePosition({
      legs: [leg("ASSET", "XYZ", "100", null, "4")],
    });
    expect(out.method).toBe("ACQUISITION_COST_FALLBACK");
    expect(out.grossEur.toFixed(2)).toBe("400.00");
    expect(out.confidenceScore).toBe(30);
    expect(out.fallbackReason).toContain("coût d'acquisition");
  });

  it("déclare une position non valorisable plutôt que de renvoyer zéro (cas 37)", () => {
    const out = valuePosition({ legs: [leg("ASSET", "XYZ", "100", null)] });
    expect(out.method).toBe("UNKNOWN");
    expect(out.isValuable).toBe(false);
    expect(out.grossEur.toFixed(2)).toBe("0.00");
    expect(out.unpricedSymbols).toContain("XYZ");
  });

  it("sort une position fermée de la valorisation sans prétendre qu'elle vaut zéro (cas 28, 29)", () => {
    const out = valuePosition({
      legs: [leg("ASSET", "ETH", "10", "3000")],
      excluded: true,
      excludedReason: "Position closed",
    });
    expect(out.retainedEur.toFixed(2)).toBe("0.00");
    expect(out.isValuable).toBe(false);
    expect(out.fallbackReason).toBe("Position closed");
  });
});

describe("valuePosition — quote-part", () => {
  it("applique la quote-part au net retenu (cas 41)", () => {
    const out = valuePosition({
      legs: [leg("ASSET", "ETH", "10", "3000")],
      ownershipPct: d(30),
    });
    expect(out.netEur.toFixed(2)).toBe("30000.00");
    expect(out.retainedEur.toFixed(2)).toBe("9000.00");
  });

  it("traite une quote-part absente ou hors bornes comme 100 %", () => {
    for (const pct of [null, d(0), d(150)]) {
      const out = valuePosition({
        legs: [leg("ASSET", "ETH", "1", "3000")],
        ownershipPct: pct,
      });
      expect(out.retainedEur.toFixed(2)).toBe("3000.00");
    }
  });

  it("applique la quote-part après déduction de la dette, jamais avant", () => {
    // 30 % de (30000 − 12000) = 5400, et non 30 % de 30000 moins 12000.
    const out = valuePosition({
      legs: [
        leg("COLLATERAL", "ETH", "10", "3000"),
        leg("DEBT", "USDC", "12000", "1"),
      ],
      ownershipPct: d(30),
    });
    expect(out.retainedEur.toFixed(2)).toBe("5400.00");
  });
});

describe("selectValuationLegs", () => {
  it("écarte les représentations quand on valorise par les sous-jacents", () => {
    const legs = [
      leg("SHARE", "LP", "1", "1000"),
      leg("UNDERLYING", "ETH", "1", "3000"),
    ];
    const picked = selectValuationLegs(legs, "UNDERLYING_ASSETS");
    expect(picked.map((l) => l.symbol)).toEqual(["ETH"]);
  });

  it("écarte les sous-jacents quand une représentation existe", () => {
    const legs = [
      leg("SHARE", "LP", "1", "1000"),
      leg("UNDERLYING", "ETH", "1", "3000"),
    ];
    const picked = selectValuationLegs(legs, "REPRESENTATIVE");
    expect(picked.map((l) => l.symbol)).toEqual(["LP"]);
  });

  it("laisse toujours passer dette et collatéral", () => {
    const legs = [
      leg("SHARE", "LP", "1", "1000"),
      leg("DEBT", "USDC", "500", "1"),
      leg("COLLATERAL", "ETH", "1", "3000"),
    ];
    for (const method of ["UNDERLYING_ASSETS", "REPRESENTATIVE"] as const) {
      const picked = selectValuationLegs(legs, method);
      expect(picked.some((l) => l.legType === "DEBT")).toBe(true);
      expect(picked.some((l) => l.legType === "COLLATERAL")).toBe(true);
    }
  });

  it("écarte les jambes soldées et les récompenses de l'exposition", () => {
    const legs: ValuationLeg[] = [
      { ...leg("ASSET", "ETH", "1", "3000"), isActive: false },
      leg("REWARD", "CRV", "10", "0.5"),
      leg("ASSET", "SOL", "10", "150"),
    ];
    const picked = selectValuationLegs(legs, "REPRESENTATIVE");
    expect(picked.map((l) => l.symbol)).toEqual(["SOL"]);
  });
});

describe("ratios de dette", () => {
  it("calcule LTV, ratio de collatéral et health factor", () => {
    const r = computeDebtRatios(d(12000), d(30000), d(80));
    expect(r.ltvPct?.toFixed(2)).toBe("40.00");
    expect(r.collateralRatio?.toFixed(2)).toBe("2.50");
    // 30000 × 80 % / 12000 = 2
    expect(r.healthFactor?.toFixed(2)).toBe("2.00");
    expect(debtRiskLevel(r)).toBe("OK");
  });

  it("alerte en critique sous le seuil", () => {
    const r = computeDebtRatios(d(20000), d(25000), d(80));
    // 25000 × 0,8 / 20000 = 1
    expect(r.healthFactor?.toFixed(2)).toBe("1.00");
    expect(debtRiskLevel(r)).toBe("CRITICAL");
  });

  it("se rabat sur la LTV quand le seuil de liquidation est inconnu", () => {
    const r = computeDebtRatios(d(24000), d(30000), null);
    expect(r.healthFactor).toBeNull();
    expect(r.ltvPct?.toFixed(0)).toBe("80");
    expect(debtRiskLevel(r)).toBe("WARNING");
  });

  it("ne renvoie aucun niveau sans dette ni collatéral", () => {
    expect(debtRiskLevel(computeDebtRatios(d(0), d(0), null))).toBeNull();
  });
});

describe("vétusté et qualité de valorisation", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("considère périmée une valorisation de plus de 24 h", () => {
    expect(isStaleValuation("2026-07-29T11:00:00Z", now)).toBe(false);
    expect(isStaleValuation("2026-07-27T11:00:00Z", now)).toBe(true);
  });

  it("considère périmée une position jamais valorisée", () => {
    expect(isStaleValuation(null, now)).toBe(true);
    expect(isStaleValuation("pas une date", now)).toBe(true);
  });

  it("mesure la part de valeur adossée à une méthode faible", () => {
    const q = summarizeValuationQuality([
      valuePosition({ legs: [leg("ASSET", "ETH", "1", "3000")] }),
      valuePosition({ legs: [leg("ASSET", "XYZ", "100", null, "3")] }),
    ]);
    // 300 € sur 3300 € au coût d'acquisition.
    expect(q.weakSharePct.toFixed(2)).toBe("9.09");
    expect(q.unvaluableCount).toBe(0);
    expect(q.weightedConfidence).not.toBeNull();
  });

  it("compte les positions non valorisables", () => {
    const q = summarizeValuationQuality([
      valuePosition({ legs: [leg("ASSET", "XYZ", "100", null)] }),
    ]);
    expect(q.unvaluableCount).toBe(1);
  });
});
