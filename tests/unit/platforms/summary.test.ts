import { describe, expect, it } from "vitest";
import {
  summarizePlatforms,
  type SummarizablePlatform,
} from "@/app/lib/platforms/summary";

describe("summarizePlatforms", () => {
  it("compte actives (positions > 0) vs inactives", () => {
    const platforms: SummarizablePlatform[] = [
      { type: "BANQUE", positionCount: 0, totalValueBase: "100" },
      { type: "COURTIER", positionCount: 3, totalValueBase: "500" },
      { type: "COURTIER", positionCount: 0, totalValueBase: "0" },
    ];
    const s = summarizePlatforms(platforms);
    expect(s.activeCount).toBe(1);
    expect(s.inactiveCount).toBe(2);
  });

  it("agrège la valeur totale, tolère les valeurs manquantes/invalides", () => {
    const platforms: SummarizablePlatform[] = [
      { type: "BANQUE", totalValueBase: "100.5" },
      { type: "COURTIER", totalValueEur: "50" },
      { type: "EXCHANGE_CRYPTO" },
    ];
    const s = summarizePlatforms(platforms);
    expect(s.totalValue).toBeCloseTo(150.5, 6);
  });

  it("regroupe par type, trié par valeur décroissante", () => {
    const platforms: SummarizablePlatform[] = [
      { type: "BANQUE", totalValueBase: "100" },
      { type: "COURTIER", totalValueBase: "900" },
      { type: "BANQUE", totalValueBase: "50" },
    ];
    const s = summarizePlatforms(platforms);
    expect(s.byType).toEqual([
      { type: "COURTIER", value: 900, count: 1 },
      { type: "BANQUE", value: 150, count: 2 },
    ]);
  });

  it("liste vide → tout à zéro, pas d'erreur", () => {
    const s = summarizePlatforms([]);
    expect(s).toEqual({
      activeCount: 0,
      inactiveCount: 0,
      totalValue: 0,
      byType: [],
    });
  });
});
