import { describe, it, expect } from "vitest";
import {
  parseBarInterval,
  barIntervalShortLabel,
  SELECTABLE_BAR_INTERVALS,
  OPTIMAL_BAR_COUNT,
  INTERVAL_WINDOW_DAYS,
  type PriceBarInterval,
} from "@/app/lib/market/price-history-types";

describe("parseBarInterval", () => {
  it("accepts every selectable interval (case-insensitive)", () => {
    for (const iv of SELECTABLE_BAR_INTERVALS) {
      expect(parseBarInterval(iv)).toBe(iv);
      expect(parseBarInterval(iv.toUpperCase())).toBe(iv);
    }
  });
  it("rejects unknown / empty values", () => {
    expect(parseBarInterval(null)).toBeNull();
    expect(parseBarInterval("")).toBeNull();
    expect(parseBarInterval("3d")).toBeNull();
    expect(parseBarInterval("1mo")).toBeNull();
  });
});

describe("timeframe short labels", () => {
  it("gives a compact label for each interval", () => {
    const labels = SELECTABLE_BAR_INTERVALS.map(barIntervalShortLabel);
    expect(labels).toEqual(["15m", "1H", "4H", "1J", "1S"]);
  });
});

describe("optimal candle sizing", () => {
  it("defines a window and target count for every selectable interval", () => {
    for (const iv of SELECTABLE_BAR_INTERVALS) {
      expect(OPTIMAL_BAR_COUNT[iv]).toBeGreaterThan(0);
      expect(INTERVAL_WINDOW_DAYS[iv]).toBeGreaterThan(0);
    }
  });

  it("windows grow monotonically from fine to coarse timeframes", () => {
    const order: PriceBarInterval[] = ["15m", "1h", "4h", "1d", "1wk"];
    for (let i = 1; i < order.length; i++) {
      expect(INTERVAL_WINDOW_DAYS[order[i]!]).toBeGreaterThan(
        INTERVAL_WINDOW_DAYS[order[i - 1]!]
      );
    }
  });

  it("continuous-market candle count stays in a readable band (~120-320)", () => {
    // bougies ≈ fenêtre / durée d'une bougie, marché continu (crypto 24/7)
    const hoursPer: Record<PriceBarInterval, number> = {
      "15m": 0.25,
      "1h": 1,
      "4h": 4,
      "1d": 24,
      "1wk": 168,
    };
    for (const iv of SELECTABLE_BAR_INTERVALS) {
      const candles = (INTERVAL_WINDOW_DAYS[iv] * 24) / hoursPer[iv];
      expect(candles).toBeGreaterThanOrEqual(120);
      expect(candles).toBeLessThanOrEqual(320);
    }
  });
});
