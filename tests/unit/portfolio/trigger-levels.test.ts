import { describe, expect, it } from "vitest";
import {
  computeTriggerLevelStatus,
  triggerKindOf,
} from "@/app/lib/portfolio/trigger-levels";

describe("computeTriggerLevelStatus — Stop Loss", () => {
  it("distance positive quand le cours est encore au-dessus du seuil", () => {
    // Cours 100, SL à 90 → 10 % de marge avant de casser le seuil.
    const s = computeTriggerLevelStatus(100, 90, "stopLoss");
    expect(s?.distancePct).toBeCloseTo(10, 6);
    expect(s?.triggered).toBe(false);
  });

  it("déclenché quand le cours est passé sous le seuil", () => {
    const s = computeTriggerLevelStatus(85, 90, "stopLoss");
    expect(s?.triggered).toBe(true);
    expect(s?.distancePct).toBeLessThan(0);
  });

  it("déclenché à l'exact égalité (cours = seuil)", () => {
    const s = computeTriggerLevelStatus(90, 90, "stopLoss");
    expect(s?.distancePct).toBe(0);
    expect(s?.triggered).toBe(true);
  });
});

describe("computeTriggerLevelStatus — Take Profit", () => {
  it("distance positive quand le cours n'a pas encore atteint la cible", () => {
    // Cours 100, TP à 120 → il reste 20 % de hausse à faire.
    const s = computeTriggerLevelStatus(100, 120, "takeProfit");
    expect(s?.distancePct).toBeCloseTo(20, 6);
    expect(s?.triggered).toBe(false);
  });

  it("déclenché quand le cours a dépassé la cible", () => {
    const s = computeTriggerLevelStatus(125, 120, "takeProfit");
    expect(s?.triggered).toBe(true);
    expect(s?.distancePct).toBeLessThan(0);
  });
});

describe("computeTriggerLevelStatus — symétrie du signe", () => {
  it("un même écart en % donne la même magnitude, SL et TP confondus", () => {
    // 10 % sous le cours pour le SL, 10 % au-dessus pour le TP : même distance absolue.
    const sl = computeTriggerLevelStatus(100, 90, "stopLoss")!;
    const tp = computeTriggerLevelStatus(100, 110, "takeProfit")!;
    expect(sl.distancePct).toBeCloseTo(10, 6);
    expect(tp.distancePct).toBeCloseTo(10, 6);
  });
});

describe("computeTriggerLevelStatus — garde-fous", () => {
  it("renvoie null si le cours actuel est inconnu ou invalide", () => {
    expect(computeTriggerLevelStatus(NaN, 90, "stopLoss")).toBeNull();
    expect(computeTriggerLevelStatus(0, 90, "stopLoss")).toBeNull();
    expect(computeTriggerLevelStatus(-5, 90, "stopLoss")).toBeNull();
  });

  it("renvoie null si le niveau est invalide", () => {
    expect(computeTriggerLevelStatus(100, NaN, "stopLoss")).toBeNull();
    expect(computeTriggerLevelStatus(100, 0, "takeProfit")).toBeNull();
  });
});

describe("triggerKindOf", () => {
  it("route stopLoss vers stopLoss, tout le reste vers takeProfit", () => {
    expect(triggerKindOf("stopLoss")).toBe("stopLoss");
    expect(triggerKindOf("tp1")).toBe("takeProfit");
    expect(triggerKindOf("tp4")).toBe("takeProfit");
  });
});
