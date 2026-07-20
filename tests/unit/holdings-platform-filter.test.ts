import { describe, expect, it } from "vitest";
import {
  applyPlatformFilterToHolding,
  holdingMatchesPlatform,
  mergePlatformSlices,
  recomputeAllocationsForFiltered,
  sliceFixed,
  sliceFromHoldingLeg,
  type HoldingPlatformSlice,
  type HoldingSliceable,
} from "@/app/lib/portfolio/holdings-platform-slice";

function leg(partial: {
  platformId: string;
  platformName: string;
  assetId: string;
  quantity: string;
  costBasisEur: string;
  marketValueEur: string;
}): HoldingSliceable & { assetClass: string } {
  const qty = Number(partial.quantity);
  const cost = Number(partial.costBasisEur);
  const mv = Number(partial.marketValueEur);
  const unreal = mv - cost;
  const avg = qty > 0 ? cost / qty : 0;
  const h: HoldingSliceable & { assetClass: string } = {
    assetId: partial.assetId,
    platformId: partial.platformId,
    platformIds: [partial.platformId],
    platformName: partial.platformName,
    platformLogoUrl: null,
    quantity: sliceFixed(qty),
    avgCostEur: sliceFixed(avg),
    costBasisEur: sliceFixed(cost),
    costBasisBase: sliceFixed(cost),
    marketValueEur: sliceFixed(mv),
    marketValueBase: sliceFixed(mv),
    unrealizedPnlEur: sliceFixed(unreal),
    unrealizedPnlBase: sliceFixed(unreal),
    unrealizedPnlPct: sliceFixed(cost > 0 ? (unreal / cost) * 100 : 0, 4),
    acquisitionFeesEur: "0.00000000",
    acquisitionFeesBase: "0.00000000",
    passiveIncomeEur: "0.00000000",
    passiveIncomeBase: "0.00000000",
    breakEvenEur: sliceFixed(avg),
    breakEvenBase: sliceFixed(avg),
    currentPriceEur: sliceFixed(qty > 0 ? mv / qty : 0),
    assetClass: "CRYPTO",
  };
  h.platformSlices = [sliceFromHoldingLeg(h)];
  return h;
}

/** Miroir du merge holdings : agrège 2 jambes crypto. */
function mergeTwo(
  a: HoldingSliceable & { assetClass: string },
  b: HoldingSliceable & { assetClass: string }
): HoldingSliceable & { assetClass: string } {
  const qty = Number(a.quantity) + Number(b.quantity);
  const cost = Number(a.costBasisEur) + Number(b.costBasisEur);
  const mv = Number(a.marketValueEur) + Number(b.marketValueEur);
  const unreal = mv - cost;
  const avg = qty > 0 ? cost / qty : 0;
  const takeB = Number(b.quantity) > Number(a.quantity);
  const slices = mergePlatformSlices(
    a.platformSlices || [sliceFromHoldingLeg(a)],
    b.platformSlices || [sliceFromHoldingLeg(b)]
  );
  return {
    ...a,
    assetId: takeB ? b.assetId : a.assetId,
    platformId: takeB ? b.platformId : a.platformId,
    platformIds: [
      ...new Set([...(a.platformIds || [a.platformId]), ...(b.platformIds || [b.platformId])]),
    ],
    platformName: `${a.platformName}, ${b.platformName}`,
    platformSlices: slices,
    quantity: sliceFixed(qty),
    costBasisEur: sliceFixed(cost),
    costBasisBase: sliceFixed(cost),
    marketValueEur: sliceFixed(mv),
    marketValueBase: sliceFixed(mv),
    avgCostEur: sliceFixed(avg),
    breakEvenEur: sliceFixed(avg),
    breakEvenBase: sliceFixed(avg),
    unrealizedPnlEur: sliceFixed(unreal),
    unrealizedPnlBase: sliceFixed(unreal),
    unrealizedPnlPct: sliceFixed(cost > 0 ? (unreal / cost) * 100 : 0, 4),
    currentPriceEur: sliceFixed(qty > 0 ? mv / qty : 0),
  };
}

describe("holdings platform filter multi-custody", () => {
  it("exclut une position mono-plateforme hors filtre", () => {
    expect(
      holdingMatchesPlatform(
        { platformId: "plat-a", platformIds: ["plat-a"] },
        "plat-b"
      )
    ).toBe(false);
  });

  it("inclut une crypto fusionnée via platformIds même si platformId = jambe A", () => {
    const merged = {
      platformId: "plat-a",
      platformIds: ["plat-a", "plat-b"],
    };
    expect(holdingMatchesPlatform(merged, "plat-b")).toBe(true);
    expect(holdingMatchesPlatform(merged, "plat-a")).toBe(true);
    expect(holdingMatchesPlatform(merged, "plat-c")).toBe(false);
  });

  it("fallback sur platformId si platformIds absent (rétrocompat)", () => {
    expect(holdingMatchesPlatform({ platformId: "only" }, "only")).toBe(true);
    expect(holdingMatchesPlatform({ platformId: "only" }, "other")).toBe(false);
  });
});

describe("platformSlices merge + reslice filtre", () => {
  const base = leg({
    platformId: "plat-a",
    platformName: "Base",
    assetId: "eth-base",
    quantity: "1",
    costBasisEur: "2000",
    marketValueEur: "3000",
  });
  const revolut = leg({
    platformId: "plat-b",
    platformName: "Revolut",
    assetId: "eth-rev",
    quantity: "3",
    costBasisEur: "6000",
    marketValueEur: "9000",
  });
  const merged = mergeTwo(base, revolut);

  it("sans filtre : quantité agrégée A+B inchangée", () => {
    expect(Number(merged.quantity)).toBeCloseTo(4, 5);
    expect(Number(merged.marketValueEur)).toBeCloseTo(12000, 2);
    expect(merged.platformIds).toEqual(["plat-a", "plat-b"]);
    expect(merged.platformSlices).toHaveLength(2);
    // Principal = plus grosse jambe (Revolut)
    expect(merged.platformId).toBe("plat-b");
    expect(merged.assetId).toBe("eth-rev");
  });

  it("filtre plateforme A : qty / MV / coût de la jambe Base uniquement", () => {
    const sliced = applyPlatformFilterToHolding(merged, "plat-a");
    expect(Number(sliced.quantity)).toBeCloseTo(1, 5);
    expect(Number(sliced.marketValueEur)).toBeCloseTo(3000, 2);
    expect(Number(sliced.costBasisEur)).toBeCloseTo(2000, 2);
    expect(Number(sliced.unrealizedPnlEur)).toBeCloseTo(1000, 2);
    expect(sliced.platformId).toBe("plat-a");
    expect(sliced.platformName).toBe("Base");
    expect(sliced.assetId).toBe("eth-base");
    // platformIds / slices complets conservés (détail multi-custody)
    expect(sliced.platformIds).toEqual(["plat-a", "plat-b"]);
    expect(sliced.platformSlices).toHaveLength(2);
  });

  it("filtre plateforme B : qty / MV de la jambe Revolut uniquement", () => {
    const sliced = applyPlatformFilterToHolding(merged, "plat-b");
    expect(Number(sliced.quantity)).toBeCloseTo(3, 5);
    expect(Number(sliced.marketValueEur)).toBeCloseTo(9000, 2);
    expect(Number(sliced.costBasisEur)).toBeCloseTo(6000, 2);
    expect(Number(sliced.avgCostEur)).toBeCloseTo(2000, 2);
    expect(sliced.platformId).toBe("plat-b");
    expect(sliced.platformName).toBe("Revolut");
    expect(sliced.assetId).toBe("eth-rev");
  });

  it("mono-plateforme : filtre n’altère pas les métriques", () => {
    const sliced = applyPlatformFilterToHolding(base, "plat-a");
    expect(Number(sliced.quantity)).toBeCloseTo(1, 5);
    expect(Number(sliced.marketValueEur)).toBeCloseTo(3000, 2);
    expect(sliced.platformId).toBe("plat-a");
  });

  it("applyPlatformFilter sans id → identité", () => {
    const same = applyPlatformFilterToHolding(merged, "");
    expect(same.quantity).toBe(merged.quantity);
    expect(same.marketValueEur).toBe(merged.marketValueEur);
  });

  it("recomputeAllocationsForFiltered sur ensemble slicé", () => {
    const a = applyPlatformFilterToHolding(merged, "plat-a");
    const b = leg({
      platformId: "plat-a",
      platformName: "Base",
      assetId: "btc-base",
      quantity: "0.1",
      costBasisEur: "5000",
      marketValueEur: "7000",
    });
    const withAlloc = recomputeAllocationsForFiltered([a, b]);
    // total MV = 3000 + 7000 = 10000 → ETH 30 %, BTC 70 %
    expect(Number(withAlloc[0]!.allocationPct)).toBeCloseTo(30, 1);
    expect(Number(withAlloc[1]!.allocationPct)).toBeCloseTo(70, 1);
  });

  it("mergePlatformSlices accumule même platformId", () => {
    const s1: HoldingPlatformSlice = {
      platformId: "p1",
      platformName: "X",
      assetId: "a1",
      quantity: "1.00000000",
      costBasisEur: "10.00000000",
      costBasisBase: "10.00000000",
      marketValueEur: "12.00000000",
      marketValueBase: "12.00000000",
      acquisitionFeesEur: "0.00000000",
      acquisitionFeesBase: "0.00000000",
      passiveIncomeEur: "0.00000000",
      passiveIncomeBase: "0.00000000",
      unrealizedPnlEur: "2.00000000",
      unrealizedPnlBase: "2.00000000",
    };
    const s2: HoldingPlatformSlice = {
      ...s1,
      quantity: "2.00000000",
      costBasisEur: "20.00000000",
      costBasisBase: "20.00000000",
      marketValueEur: "24.00000000",
      marketValueBase: "24.00000000",
      unrealizedPnlEur: "4.00000000",
      unrealizedPnlBase: "4.00000000",
    };
    const m = mergePlatformSlices([s1], [s2]);
    expect(m).toHaveLength(1);
    expect(Number(m[0]!.quantity)).toBeCloseTo(3, 5);
    expect(Number(m[0]!.marketValueEur)).toBeCloseTo(36, 2);
  });
});
