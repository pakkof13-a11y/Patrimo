import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  groupByProtocol,
  summarizeDefi,
  toPositionView,
  type DefiPositionInput,
} from "@/app/lib/crypto/defi";
import {
  categorizeTicker,
  healthFactorRisk,
  isStablecoinTicker,
  refineDefiType,
} from "@/app/lib/crypto/constants";

function pos(over: Partial<DefiPositionInput> = {}): DefiPositionInput {
  return {
    id: over.id ?? "p1",
    protocol: over.protocol ?? "Aave",
    chain: over.chain ?? "ethereum",
    positionType: over.positionType ?? "LENDING",
    assetSymbol: over.assetSymbol ?? "USDC",
    valueEur: over.valueEur ?? d(1000),
    rewardsValueEur: over.rewardsValueEur ?? null,
    apyPct: over.apyPct ?? null,
    healthFactor: over.healthFactor ?? null,
    ltvPct: over.ltvPct ?? null,
  };
}

describe("summarizeDefi — dépôts et dettes", () => {
  it("retranche les emprunts au lieu de les additionner", () => {
    const s = summarizeDefi([
      pos({ id: "a", positionType: "LENDING", valueEur: d(10_000) }),
      pos({ id: "b", positionType: "BORROWING", valueEur: d(4_000) }),
    ]);

    expect(s.depositedEur.toFixed(2)).toBe("10000.00");
    expect(s.borrowedEur.toFixed(2)).toBe("4000.00");
    // Le point critique : 10 000 − 4 000, pas 14 000.
    expect(s.netEur.toFixed(2)).toBe("6000.00");
  });

  it("donne une contribution négative à une position empruntée", () => {
    const v = toPositionView(
      pos({ positionType: "BORROWING", valueEur: d(2_500) })
    );
    expect(v.isDebt).toBe(true);
    expect(v.netValueEur.toFixed(2)).toBe("-2500.00");
  });

  it("compte les dépôts positivement", () => {
    const v = toPositionView(
      pos({ positionType: "STAKING", valueEur: d(2_500) })
    );
    expect(v.isDebt).toBe(false);
    expect(v.netValueEur.toFixed(2)).toBe("2500.00");
  });
});

describe("summarizeDefi — APY pondéré", () => {
  it("pondère par la valeur déposée, pas par le nombre de lignes", () => {
    const s = summarizeDefi([
      pos({ id: "a", valueEur: d(50), apyPct: d(40) }),
      pos({ id: "b", valueEur: d(50_000), apyPct: d(3) }),
    ]);
    // Moyenne simple = 21,5 % ; pondérée = (50×40 + 50000×3) / 50050 ≈ 3,04 %.
    const expected = d(50).times(40).plus(d(50_000).times(3)).div(50_050);
    expect(s.weightedApyPct?.toFixed(4)).toBe(expected.toFixed(4));
    expect(Number(s.weightedApyPct)).toBeLessThan(4);
  });

  it("ignore le taux d'un emprunt dans l'APY moyen", () => {
    const s = summarizeDefi([
      pos({ id: "a", positionType: "LENDING", valueEur: d(1_000), apyPct: d(5) }),
      pos({
        id: "b",
        positionType: "BORROWING",
        valueEur: d(1_000),
        apyPct: d(9),
      }),
    ]);
    // Seul le dépôt compte : 5 %, et non la moyenne (5+9)/2 = 7 %.
    expect(s.weightedApyPct?.toFixed(2)).toBe("5.00");
  });

  it("renvoie null quand aucun APY n'est connu", () => {
    expect(summarizeDefi([pos()]).weightedApyPct).toBeNull();
  });
});

describe("summarizeDefi — récompenses et risque", () => {
  it("cumule les récompenses non réclamées", () => {
    const s = summarizeDefi([
      pos({ id: "a", rewardsValueEur: d("12.5") }),
      pos({ id: "b", rewardsValueEur: d("7.5") }),
    ]);
    expect(s.pendingRewardsEur.toFixed(2)).toBe("20.00");
  });

  it("retient le health factor le plus bas", () => {
    const s = summarizeDefi([
      pos({ id: "a", healthFactor: 2.4 }),
      pos({ id: "b", healthFactor: 1.15 }),
      pos({ id: "c", healthFactor: null }),
    ]);
    expect(s.worstHealthFactor).toBe(1.15);
  });

  it("compte les protocoles distincts sans doublon de casse", () => {
    const s = summarizeDefi([
      pos({ id: "a", protocol: "Aave" }),
      pos({ id: "b", protocol: "aave" }),
      pos({ id: "c", protocol: "Lido" }),
    ]);
    expect(s.protocolCount).toBe(2);
    expect(s.positionCount).toBe(3);
  });
});

describe("healthFactorRisk", () => {
  it("classe selon les paliers", () => {
    expect(healthFactorRisk(1.05)).toBe("CRITICAL");
    expect(healthFactorRisk(1.5)).toBe("WARNING");
    expect(healthFactorRisk(2.2)).toBe("OK");
    expect(healthFactorRisk(null)).toBeNull();
  });
});

describe("groupByProtocol", () => {
  it("compense dépôt et emprunt au sein d'un même protocole", () => {
    const groups = groupByProtocol([
      pos({ id: "a", protocol: "Aave", positionType: "LENDING", valueEur: d(9_000) }),
      pos({ id: "b", protocol: "Aave", positionType: "BORROWING", valueEur: d(3_000) }),
      pos({ id: "c", protocol: "Lido", positionType: "LIQUID_STAKING", valueEur: d(5_000) }),
    ]);

    const aave = groups.find((g) => g.protocol === "Aave");
    expect(aave?.netEur.toFixed(2)).toBe("6000.00");
    expect(aave?.positions).toHaveLength(2);

    // Aave (12 000 d'engagement brut) passe devant Lido (5 000).
    expect(groups[0]?.protocol).toBe("Aave");
  });
});

describe("refineDefiType", () => {
  it("garde un emprunt en emprunt même sur un protocole d'AMM", () => {
    expect(refineDefiType("loan", "Uniswap")).toBe("BORROWING");
  });

  it("reconnaît le staking liquide malgré un position_type « deposit »", () => {
    expect(refineDefiType("deposit", "Lido")).toBe("LIQUID_STAKING");
  });

  it("reconnaît le restaking avant le staking liquide", () => {
    expect(refineDefiType("deposit", "EigenLayer")).toBe("RESTAKING");
  });

  it("déduit un LP de la présence d'un second actif", () => {
    expect(refineDefiType("deposit", "Protocole inconnu", true)).toBe("LP");
  });

  it("range un dépôt Aave en prêt", () => {
    expect(refineDefiType("deposit", "Aave")).toBe("LENDING");
  });

  it("retombe sur OTHER quand rien n'est reconnaissable", () => {
    expect(refineDefiType(null, null)).toBe("OTHER");
  });
});

describe("categorizeTicker", () => {
  it("classe les grandes familles", () => {
    expect(categorizeTicker("BTC")).toBe("L1");
    expect(categorizeTicker("ARB")).toBe("L2");
    expect(categorizeTicker("usdc")).toBe("STABLECOIN");
    expect(categorizeTicker("wstETH")).toBe("LST");
    expect(categorizeTicker("AAVE")).toBe("DEFI_TOKEN");
    expect(categorizeTicker("PEPE")).toBe("MEME");
    expect(categorizeTicker("XYZUNKNOWN")).toBe("OTHER");
    expect(categorizeTicker(null)).toBe("OTHER");
  });

  it("détecte les stablecoins indépendamment de la casse", () => {
    expect(isStablecoinTicker("usdt")).toBe(true);
    expect(isStablecoinTicker("ETH")).toBe(false);
  });
});
