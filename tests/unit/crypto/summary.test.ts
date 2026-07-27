import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  computeVariation24h,
  MIN_COVERAGE_RATIO,
  summarizeCryptoTotals,
  type CryptoAssetInput,
  type Variation24hInput,
} from "@/app/lib/crypto/summary";

function asset(over: Partial<CryptoAssetInput>): CryptoAssetInput {
  return {
    assetId: over.assetId ?? "a1",
    kind: over.kind ?? "SPOT",
    valueEur: over.valueEur ?? d(1000),
    costBasisEur: over.costBasisEur ?? d(800),
  };
}

describe("summarizeCryptoTotals — trois legs", () => {
  it("additionne spot, DeFi net et floor NFT sans double compte", () => {
    const totals = summarizeCryptoTotals([
      asset({ kind: "SPOT", valueEur: d(50_000), costBasisEur: d(40_000) }),
      asset({ kind: "DEFI_DEPOSIT", valueEur: d(10_000), costBasisEur: d(10_000) }),
      asset({ kind: "DEFI_DEBT", valueEur: d(4_000), costBasisEur: d(4_000) }),
      asset({ kind: "NFT", valueEur: d(5_000), costBasisEur: d(8_000) }),
    ]);

    expect(totals.spotEur.toFixed(2)).toBe("50000.00");
    expect(totals.defiNetEur.toFixed(2)).toBe("6000.00"); // 10 000 − 4 000
    expect(totals.nftFloorEur.toFixed(2)).toBe("5000.00");
    // 50 000 + 6 000 + 5 000
    expect(totals.totalEur.toFixed(2)).toBe("61000.00");
  });

  it("retranche le coût de revient d'une dette, pas seulement sa valeur", () => {
    const totals = summarizeCryptoTotals([
      asset({ kind: "DEFI_DEPOSIT", valueEur: d(10_000), costBasisEur: d(10_000) }),
      asset({ kind: "DEFI_DEBT", valueEur: d(4_000), costBasisEur: d(4_000) }),
    ]);
    // Valeur nette 6 000, coût net 6 000 → PV latente nulle, pas 6 000.
    // Si le coût de la dette n'était pas retranché : coût = 10 000, PV = -4 000 (faux).
    expect(totals.unrealizedPnlEur.toFixed(2)).toBe("0.00");
  });

  it("calcule une PV latente négative quand le floor NFT est sous le prix d'acquisition", () => {
    const totals = summarizeCryptoTotals([
      asset({ kind: "NFT", valueEur: d(5_000), costBasisEur: d(8_000) }),
    ]);
    expect(totals.unrealizedPnlEur.toFixed(2)).toBe("-3000.00");
  });

  it("renvoie des totaux nuls sur un ensemble vide", () => {
    const totals = summarizeCryptoTotals([]);
    expect(totals.totalEur.toFixed(2)).toBe("0.00");
    expect(totals.unrealizedPnlEur.toFixed(2)).toBe("0.00");
  });
});

function varInput(over: Partial<Variation24hInput>): Variation24hInput {
  return {
    assetId: over.assetId ?? "a1",
    quantity: over.quantity ?? d(1),
    currentPriceEur: over.currentPriceEur ?? d(100),
    previousCloseEur: "previousCloseEur" in over ? over.previousCloseEur! : d(90),
  };
}

describe("computeVariation24h", () => {
  it("calcule la variation quand tout est couvert", () => {
    const out = computeVariation24h([
      varInput({ quantity: d(2), currentPriceEur: d(110), previousCloseEur: d(100) }),
    ]);
    expect(out.coverageRatio).toBe(1);
    expect(out.pct?.toFixed(2)).toBe("10.00");
  });

  it("ignore les actifs sans clôture connue plutôt que de leur supposer une variation nulle", () => {
    const out = computeVariation24h([
      varInput({ assetId: "a", quantity: d(1), currentPriceEur: d(800), previousCloseEur: d(400) }),
      varInput({ assetId: "b", quantity: d(1), currentPriceEur: d(200), previousCloseEur: null }),
    ]);
    // Seul "a" est couvert (80 % de la valeur totale) : 800 → depuis 400, soit
    // +100 %. Le mélanger avec "b" (non couvert) donnerait un pourcentage
    // arbitraire dépendant de b.
    expect(out.coverageRatio).toBeGreaterThanOrEqual(MIN_COVERAGE_RATIO);
    expect(out.pct?.toFixed(2)).toBe("100.00");
  });

  it("renvoie null sous le seuil de couverture minimal", () => {
    const out = computeVariation24h([
      varInput({ assetId: "a", quantity: d(1), currentPriceEur: d(1), previousCloseEur: d(1) }),
      varInput({ assetId: "b", quantity: d(1), currentPriceEur: d(99), previousCloseEur: null }),
    ]);
    expect(out.coverageRatio).toBeLessThan(MIN_COVERAGE_RATIO);
    expect(out.pct).toBeNull();
  });

  it("renvoie null sur un ensemble entièrement non couvert", () => {
    const out = computeVariation24h([
      varInput({ previousCloseEur: null }),
    ]);
    expect(out.pct).toBeNull();
    expect(out.coverageRatio).toBe(0);
  });

  it("ne divise jamais par zéro si la valeur totale est nulle", () => {
    const out = computeVariation24h([]);
    expect(out.pct).toBeNull();
    expect(out.coverageRatio).toBe(0);
  });
});
