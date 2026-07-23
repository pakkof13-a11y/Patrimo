import { describe, expect, it } from "vitest";

/**
 * Spec produit : lors du merge multi-plateforme (ex. ETH-Coinbase + ETH-Revolut),
 * les niveaux SL/TP de la jambe secondaire ne doivent plus être silencieusement
 * ignorés si la jambe principale n'en a pas.
 * Logique pure, miroir du bloc merge de service.ts (getHoldings).
 */
type Levels = {
  stopLoss: string | null;
  tp1: string | null;
  tp2: string | null;
  tp3: string | null;
  tp4: string | null;
};

function pickLevel(a: string | null, b: string | null): string | null {
  return a ?? b ?? null;
}

function mergeLevels(
  principal: Levels,
  secondary: Levels
): Levels & { hasSecondaryLevels: boolean } {
  const secondaryHasOwnLevels = [
    secondary.stopLoss,
    secondary.tp1,
    secondary.tp2,
    secondary.tp3,
    secondary.tp4,
  ].some((v) => v != null);
  return {
    stopLoss: pickLevel(principal.stopLoss, secondary.stopLoss),
    tp1: pickLevel(principal.tp1, secondary.tp1),
    tp2: pickLevel(principal.tp2, secondary.tp2),
    tp3: pickLevel(principal.tp3, secondary.tp3),
    tp4: pickLevel(principal.tp4, secondary.tp4),
    hasSecondaryLevels: secondaryHasOwnLevels,
  };
}

const NO_LEVELS: Levels = {
  stopLoss: null,
  tp1: null,
  tp2: null,
  tp3: null,
  tp4: null,
};

describe("holdings merge — SL/TP levels (multi-plateforme)", () => {
  it("uses secondary leg levels when the principal leg has none", () => {
    // ETH-Coinbase (principale, plus grosse) sans niveaux ; ETH-Revolut avec SL/TP.
    const principal = NO_LEVELS;
    const secondary: Levels = {
      stopLoss: "3000",
      tp1: "4000",
      tp2: "4500",
      tp3: null,
      tp4: null,
    };
    const merged = mergeLevels(principal, secondary);
    expect(merged.stopLoss).toBe("3000");
    expect(merged.tp1).toBe("4000");
    expect(merged.tp2).toBe("4500");
    expect(merged.tp3).toBeNull();
    expect(merged.hasSecondaryLevels).toBe(true);
  });

  it("prioritizes principal leg levels over secondary when both are set", () => {
    const principal: Levels = {
      stopLoss: "3000",
      tp1: "4000",
      tp2: null,
      tp3: null,
      tp4: null,
    };
    const secondary: Levels = {
      stopLoss: "2500",
      tp1: "3800",
      tp2: "4200",
      tp3: null,
      tp4: null,
    };
    const merged = mergeLevels(principal, secondary);
    // Principale gagne quand elle a une valeur
    expect(merged.stopLoss).toBe("3000");
    expect(merged.tp1).toBe("4000");
    // Repli secondaire uniquement là où la principale est null
    expect(merged.tp2).toBe("4200");
    expect(merged.hasSecondaryLevels).toBe(true);
  });

  it("hasSecondaryLevels is false when the secondary leg carries no level", () => {
    const principal: Levels = {
      stopLoss: "3000",
      tp1: null,
      tp2: null,
      tp3: null,
      tp4: null,
    };
    const merged = mergeLevels(principal, NO_LEVELS);
    expect(merged.stopLoss).toBe("3000");
    expect(merged.hasSecondaryLevels).toBe(false);
  });

  it("null when neither leg has any level", () => {
    const merged = mergeLevels(NO_LEVELS, NO_LEVELS);
    expect(merged.stopLoss).toBeNull();
    expect(merged.tp1).toBeNull();
    expect(merged.hasSecondaryLevels).toBe(false);
  });
});
