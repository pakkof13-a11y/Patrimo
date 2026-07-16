import { describe, expect, it } from "vitest";
import { checkTriggers, DEFAULT_TP_FRACTION } from "../../app/lib/market/triggers";

describe("checkTriggers (long)", () => {
  const base = {
    quantity: "100",
    stopLoss: null as string | null,
    tp1: null as string | null,
    tp2: null as string | null,
    tp3: null as string | null,
    tp4: null as string | null,
  };

  it("does nothing when no levels or qty/price invalid", () => {
    expect(checkTriggers({ ...base, currentPrice: "50" }).fills).toEqual([]);
    expect(checkTriggers({ ...base, currentPrice: "0", stopLoss: "10" }).fills).toEqual([]);
    expect(
      checkTriggers({ ...base, quantity: "0", currentPrice: "50", stopLoss: "60" }).fills
    ).toEqual([]);
  });

  it("fires SL when price <= stopLoss and sells 100%", () => {
    const r = checkTriggers({
      ...base,
      currentPrice: "90",
      stopLoss: "95",
      tp1: "120",
    });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].kind).toBe("SL");
    expect(r.fills[0].quantity).toMatch(/^100/);
    expect(r.remainingQty).toBe("0");
    expect(r.clearFields).toContain("stopLoss");
    // TPs cleared too after full exit
    expect(r.clearFields).toContain("tp1");
  });

  it("does not fire SL when price is above level", () => {
    const r = checkTriggers({
      ...base,
      currentPrice: "100",
      stopLoss: "90",
    });
    expect(r.fills).toEqual([]);
  });

  it("fires a single TP at 25% of open qty", () => {
    const r = checkTriggers({
      ...base,
      currentPrice: "130",
      tp1: "120",
    });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].kind).toBe("TP1");
    expect(Number(r.fills[0].quantity)).toBeCloseTo(100 * DEFAULT_TP_FRACTION, 8);
    expect(Number(r.remainingQty)).toBeCloseTo(75, 8);
    expect(r.clearFields).toEqual(["tp1"]);
  });

  it("can fire multiple TPs on the same tick (gap through levels)", () => {
    const r = checkTriggers({
      ...base,
      currentPrice: "200",
      tp1: "120",
      tp2: "150",
      tp3: "180",
      tp4: "250", // not hit
    });
    expect(r.fills.map((f) => f.kind)).toEqual(["TP1", "TP2", "TP3"]);
    // each 25% of base 100 → 25+25+25 = 75 sold
    expect(Number(r.remainingQty)).toBeCloseTo(25, 8);
    expect(r.clearFields).toEqual(["tp1", "tp2", "tp3"]);
  });

  it("SL takes priority over TPs on the same tick", () => {
    const r = checkTriggers({
      ...base,
      currentPrice: "50",
      stopLoss: "80",
      tp1: "40", // would also be "hit" if checked, but SL first
    });
    expect(r.fills.map((f) => f.kind)).toEqual(["SL"]);
    expect(r.remainingQty).toBe("0");
  });

  it("clears only fired fields (anti re-trigger)", () => {
    const r = checkTriggers({
      ...base,
      currentPrice: "125",
      tp1: "120",
      tp2: "140",
    });
    expect(r.clearFields).toEqual(["tp1"]);
    expect(r.clearFields).not.toContain("tp2");
  });

  it("ignores null / zero / negative levels", () => {
    const r = checkTriggers({
      ...base,
      currentPrice: "100",
      stopLoss: "0",
      tp1: "-5",
      tp2: "",
    });
    expect(r.fills).toEqual([]);
  });

  it("caps TP qty to remaining and dust-closes", () => {
    const r = checkTriggers({
      quantity: "10",
      currentPrice: "200",
      stopLoss: null,
      tp1: "100",
      tp2: "110",
      tp3: "120",
      tp4: "130",
      tpFraction: 0.4,
    });
    // 4 * 40% of 10 = would oversell — remaining never negative
    expect(Number(r.remainingQty)).toBeGreaterThanOrEqual(0);
    const sold = r.fills.reduce((s, f) => s + Number(f.quantity), 0);
    expect(sold).toBeCloseTo(10, 6);
  });
});
